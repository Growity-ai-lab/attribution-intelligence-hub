"""Tests for GET /api/dda/latest and demo-sandbox read resolution."""

import json
from datetime import datetime, timedelta, timezone

import pytest

from backend.auth import create_access_token
from backend.db.database import SessionLocal
from backend.db.models import Campaign, Client, DDAResult


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


@pytest.fixture()
def demo_headers():
    token = create_access_token(data={"sub": "demo", "role": "demo"})
    return {"Authorization": f"Bearer {token}"}


def _run_csv(client, headers, campaign_id, csv_bytes):
    files = {"file": ("journeys.csv", csv_bytes, "text/csv")}
    res = client.post("/api/dda/run-from-csv", files=files,
                      params={"campaign_id": campaign_id}, headers=headers)
    assert res.status_code == 200, res.text
    return res.json()


def test_latest_none_for_fresh_campaign(client, auth_headers):
    cid = _new_campaign("Latest Empty")
    res = client.get("/api/dda/latest", params={"campaign_id": cid}, headers=auth_headers)
    assert res.status_code == 200
    assert res.json()["status"] == "none"


def test_latest_returns_stored_csv_run(client, auth_headers, sample_journeys_csv):
    cid = _new_campaign("Latest CSV")
    ran = _run_csv(client, auth_headers, cid, sample_journeys_csv)

    data = client.get("/api/dda/latest", params={"campaign_id": cid}, headers=auth_headers).json()
    assert data["status"] == "complete" and data["stored"] is True
    assert data["data_source"] == "csv"
    assert data["run_date"]
    # The report page renders from unified_report — it must survive persistence.
    assert data["unified_report"] and set(data["unified_report"]) == set(ran["unified_report"])
    assert data["hybrid_attribution"] == pytest.approx(ran["hybrid_attribution"])
    assert data["journey_stats"]["total_journeys"] == ran["journey_stats"]["total_journeys"]


def test_latest_rebuilds_unified_report_for_legacy_rows(client, auth_headers):
    """CSV rows stored before unified_report was persisted still render."""
    cid = _new_campaign("Latest Legacy")
    db = SessionLocal()
    try:
        db.add(DDAResult(
            campaign_id=cid, run_date=datetime.now(timezone.utc).isoformat(), data_source="csv",
            result_json=json.dumps({
                "journey_stats": {"total_journeys": 10, "converted": 4, "conversion_rate": 0.4},
                "hybrid_attribution": {"meta": 0.6, "google": 0.4},
            }),
        ))
        db.commit()
    finally:
        db.close()
    data = client.get("/api/dda/latest", params={"campaign_id": cid}, headers=auth_headers).json()
    assert set(data["unified_report"]) == {"meta", "google"}


def test_latest_skips_running_and_error_rows(client, auth_headers):
    cid = _new_campaign("Latest Skip")
    t0 = datetime.now(timezone.utc)
    db = SessionLocal()
    try:
        db.add(DDAResult(campaign_id=cid, run_date=t0.isoformat(), data_source="csv",
                         result_json=json.dumps({"hybrid_attribution": {"meta": 1.0}})))
        db.add(DDAResult(campaign_id=cid, run_date=(t0 + timedelta(minutes=1)).isoformat(),
                         data_source="bigquery", result_json="{}", status="running"))
        db.add(DDAResult(campaign_id=cid, run_date=(t0 + timedelta(minutes=2)).isoformat(),
                         data_source="bigquery", result_json="{}", status="error"))
        db.commit()
        complete_id = db.query(DDAResult).filter(
            DDAResult.campaign_id == cid, DDAResult.status == "complete").one().id
    finally:
        db.close()
    data = client.get("/api/dda/latest", params={"campaign_id": cid}, headers=auth_headers).json()
    assert data["result_id"] == complete_id


def test_latest_unknown_campaign_404(client, auth_headers):
    res = client.get("/api/dda/latest", params={"campaign_id": 999999}, headers=auth_headers)
    assert res.status_code == 404


def test_latest_requires_auth(client):
    assert client.get("/api/dda/latest", params={"campaign_id": 1}).status_code in (401, 403)


def test_demo_run_is_readable_through_selected_campaign(
    client, auth_headers, demo_headers, sample_journeys_csv,
):
    """Demo runs land in a "Demo Sandbox" campaign; reads on the selected
    (seed) campaign must resolve to it, while admins still see the seed data."""
    cid = _new_campaign("Latest Demo")
    _run_csv(client, demo_headers, cid, sample_journeys_csv)

    demo_view = client.get("/api/dda/latest", params={"campaign_id": cid}, headers=demo_headers).json()
    assert demo_view["status"] == "complete"

    admin_view = client.get("/api/dda/latest", params={"campaign_id": cid}, headers=auth_headers).json()
    assert admin_view["status"] == "none"  # the seed campaign itself was never written to

    # The demo user's trend/alerts endpoints resolve the same way (no 404s, sandbox data).
    assert client.get("/api/alerts", params={"campaign_id": cid}, headers=demo_headers).status_code == 200
    assert client.get("/api/export/dda-report", params={"campaign_id": cid}, headers=demo_headers).status_code == 200


def test_csv_run_has_no_empty_bq_summary(client, auth_headers, sample_journeys_csv):
    """Regression: an empty {} bq_summary is truthy in JS, so the report page
    tried to render BigQuery KPI tiles for a CSV run and crashed on toFixed."""
    cid = _new_campaign("Latest No BQ")
    _run_csv(client, auth_headers, cid, sample_journeys_csv)
    data = client.get("/api/dda/latest", params={"campaign_id": cid}, headers=auth_headers).json()
    assert "bq_summary" not in data


def test_legacy_empty_placeholders_are_dropped(client, auth_headers):
    cid = _new_campaign("Latest Legacy Empty")
    db = SessionLocal()
    try:
        db.add(DDAResult(
            campaign_id=cid, run_date=datetime.now(timezone.utc).isoformat(), data_source="csv",
            result_json=json.dumps({
                "journey_stats": {"total_journeys": 4, "converted": 2, "conversion_rate": 0.5},
                "hybrid_attribution": {"meta": 1.0},
                "bq_summary": {}, "insights": [], "top_paths": [],
            }),
        ))
        db.commit()
    finally:
        db.close()
    data = client.get("/api/dda/latest", params={"campaign_id": cid}, headers=auth_headers).json()
    assert not {"bq_summary", "insights", "top_paths"} & set(data)
