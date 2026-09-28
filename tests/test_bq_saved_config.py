"""Per-campaign BigQuery settings: stored table mapping, saved-config, reconnect."""

import io
from datetime import datetime, timezone
from unittest.mock import patch

import pytest

from backend.api import routes_bigquery
from backend.auth import create_access_token
from backend.db.database import SessionLocal
from backend.db.models import Campaign, Client

FAKE_CREDS = '{"type": "service_account", "client_email": "sa@proj.iam.gserviceaccount.com"}'
CONN_INFO = {"ok": True, "event_tables": 3, "first_date": "20260101", "last_date": "20260601"}
MAPPING = {
    "table": "crm_events",
    "entity_col": "customer_id",
    "timestamp_col": "touch_ts",
    "channel_col": "channel",
    "event_col": "event",
    "conversion_values": ["lead_form"],
    "revenue_col": "deal_value",
}


def _new_campaign(name: str) -> int:
    db = SessionLocal()
    try:
        now = datetime.now(timezone.utc).isoformat()
        client = Client(name=f"{name} Co", year=2026, created_at=now)
        db.add(client)
        db.flush()
        camp = Campaign(client_id=client.id, name=name, created_at=now)
        db.add(camp)
        db.commit()
        return camp.id
    finally:
        db.close()


def _campaign(cid: int) -> Campaign:
    db = SessionLocal()
    try:
        return db.get(Campaign, cid)
    finally:
        db.close()


def _sandbox_campaign(name: str) -> Campaign | None:
    db = SessionLocal()
    try:
        return (
            db.query(Campaign).join(Client, Campaign.client_id == Client.id)
            .filter(Client.name == "Demo Sandbox", Campaign.name == name).first()
        )
    finally:
        db.close()


@pytest.fixture()
def demo_headers():
    return {"Authorization": f"Bearer {create_access_token(data={'sub': 'demo', 'role': 'demo'})}"}


def _connect(client, headers, campaign_id):
    with patch.object(routes_bigquery, "bq_get_client", return_value=object()), \
         patch.object(routes_bigquery, "bq_test_connection", return_value=dict(CONN_INFO)):
        return client.post(
            "/api/integrations/bigquery/connect",
            params={"project": "proj", "dataset": "ds", "campaign_id": campaign_id},
            files={"credentials": ("sa.json", io.BytesIO(FAKE_CREDS.encode()), "application/json")},
            headers=headers,
        )


def test_saved_config_empty_for_new_campaign(client, auth_headers):
    cid = _new_campaign("Cfg Empty")
    data = client.get("/api/integrations/bigquery/saved-config", params={"campaign_id": cid},
                      headers=auth_headers).json()
    assert data == {"project": "", "dataset": "", "has_credentials": False, "table_mapping": None}


def test_table_mapping_roundtrip(client, auth_headers):
    cid = _new_campaign("Cfg Mapping")
    res = client.put("/api/integrations/bigquery/table-mapping", params={"campaign_id": cid},
                     json=MAPPING, headers=auth_headers)
    assert res.status_code == 200 and res.json()["saved"] is True

    saved = client.get("/api/integrations/bigquery/saved-config", params={"campaign_id": cid},
                       headers=auth_headers).json()["table_mapping"]
    assert saved["table"] == "crm_events"
    assert saved["conversion_values"] == ["lead_form"]
    assert saved["timestamp_type"] == "datetime"  # default filled in
    assert "source_col" not in saved  # unset optionals are omitted, not null


def test_invalid_mapping_rejected(client, auth_headers):
    cid = _new_campaign("Cfg Invalid")
    bad = {k: v for k, v in MAPPING.items() if k not in ("channel_col",)}  # no channel mapping
    res = client.put("/api/integrations/bigquery/table-mapping", params={"campaign_id": cid},
                     json=bad, headers=auth_headers)
    assert res.status_code == 422
    assert _campaign(cid).bq_table_mapping == ""


def test_mapping_unknown_campaign_404(client, auth_headers):
    res = client.put("/api/integrations/bigquery/table-mapping", params={"campaign_id": 999999},
                     json=MAPPING, headers=auth_headers)
    assert res.status_code == 404


def test_connect_persists_and_saved_config_never_leaks_credentials(client, auth_headers):
    cid = _new_campaign("Cfg Connect")
    assert _connect(client, auth_headers, cid).status_code == 200
    res = client.get("/api/integrations/bigquery/saved-config", params={"campaign_id": cid},
                     headers=auth_headers)
    data = res.json()
    assert data["project"] == "proj" and data["dataset"] == "ds" and data["has_credentials"] is True
    assert "sa@proj" not in res.text and "service_account" not in res.text


def test_reconnect_uses_stored_credentials(client, auth_headers):
    cid = _new_campaign("Cfg Reconnect")
    assert _connect(client, auth_headers, cid).status_code == 200
    routes_bigquery._bq_clients.clear()  # simulate a server restart

    with patch.object(routes_bigquery, "bq_get_client", return_value=object()) as get_client, \
         patch.object(routes_bigquery, "bq_test_connection", return_value=dict(CONN_INFO)):
        res = client.post("/api/integrations/bigquery/reconnect", params={"campaign_id": cid},
                          headers=auth_headers)
    assert res.status_code == 200, res.text
    assert res.json()["project"] == "proj" and res.json()["event_tables"] == 3
    # the stored, decrypted credentials were used — no upload
    assert get_client.call_args.args[0] == FAKE_CREDS
    assert "proj:ds" in routes_bigquery._bq_clients


def test_reconnect_without_stored_credentials_404(client, auth_headers):
    cid = _new_campaign("Cfg No Creds")
    res = client.post("/api/integrations/bigquery/reconnect", params={"campaign_id": cid},
                      headers=auth_headers)
    assert res.status_code == 404


def test_reconnect_undecryptable_credentials_400(client, auth_headers):
    cid = _new_campaign("Cfg Bad Key")
    db = SessionLocal()
    try:
        camp = db.get(Campaign, cid)
        camp.bq_project, camp.bq_dataset, camp.bq_credentials_enc = "proj", "ds", "not-a-fernet-token"
        db.commit()
    finally:
        db.close()
    res = client.post("/api/integrations/bigquery/reconnect", params={"campaign_id": cid},
                      headers=auth_headers)
    assert res.status_code == 400 and "yeniden yükleyin" in res.json()["detail"]


def test_demo_never_writes_bq_settings_to_the_seed_campaign(client, auth_headers, demo_headers):
    cid = _new_campaign("Cfg Demo")
    assert _connect(client, demo_headers, cid).status_code == 200
    assert client.put("/api/integrations/bigquery/table-mapping", params={"campaign_id": cid},
                      json=MAPPING, headers=demo_headers).status_code == 200

    seed = _campaign(cid)
    assert seed.bq_credentials_enc == "" and seed.bq_table_mapping == "" and seed.bq_project == ""
    sandbox = _sandbox_campaign("Cfg Demo")
    assert sandbox is not None and sandbox.bq_credentials_enc and sandbox.bq_table_mapping

    demo_view = client.get("/api/integrations/bigquery/saved-config", params={"campaign_id": cid},
                           headers=demo_headers).json()
    assert demo_view["has_credentials"] is True and demo_view["table_mapping"]["table"] == "crm_events"
    admin_view = client.get("/api/integrations/bigquery/saved-config", params={"campaign_id": cid},
                            headers=auth_headers).json()
    assert admin_view["has_credentials"] is False and admin_view["table_mapping"] is None
