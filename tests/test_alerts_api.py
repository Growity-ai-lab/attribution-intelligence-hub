"""Tests for alert evaluation wiring and the /alerts endpoints."""

import json
from datetime import datetime, timedelta, timezone

import pytest

from backend.api.routes_alerts import evaluate_and_store_alerts
from backend.db.database import SessionLocal
from backend.db.models import Alert, Campaign, Client, DDAResult


def _snapshot(rate: float, total: int, hybrid: dict) -> str:
    return json.dumps({
        "journey_stats": {
            "conversion_rate": rate,
            "total_journeys": total,
            "converted": int(total * rate),
        },
        "hybrid_attribution": hybrid,
    })


@pytest.fixture()
def campaign_id():
    """A fresh campaign with two completed DDA runs: a healthy one, then a drop."""
    db = SessionLocal()
    try:
        t0 = datetime.now(timezone.utc)
        client = Client(name="Alert Test Co", year=2026, created_at=t0.isoformat())
        db.add(client)
        db.flush()
        camp = Campaign(client_id=client.id, name="Alert Test", created_at=t0.isoformat())
        db.add(camp)
        db.flush()
        db.add(DDAResult(
            campaign_id=camp.id, run_date=(t0 - timedelta(days=7)).isoformat(),
            data_source="csv", result_json=_snapshot(
                0.05, 1000, {"meta": 0.40, "google": 0.35, "tiktok": 0.25}),
        ))
        db.add(DDAResult(
            campaign_id=camp.id, run_date=t0.isoformat(),
            data_source="csv", result_json=_snapshot(
                0.02, 700, {"meta": 0.60, "google": 0.40}),
        ))
        # An in-flight BQ run must never be treated as the latest snapshot.
        db.add(DDAResult(
            campaign_id=camp.id, run_date=(t0 + timedelta(minutes=1)).isoformat(),
            data_source="bigquery", result_json="{}", status="running",
        ))
        db.commit()
        return camp.id
    finally:
        db.close()


def test_evaluation_creates_expected_alerts(campaign_id):
    db = SessionLocal()
    try:
        created = evaluate_and_store_alerts(db, campaign_id)
        rules = {a.rule_id for a in created}
    finally:
        db.close()
    assert {"conversion_drop", "volume_drop", "channel_disappeared", "channel_concentration"} <= rules


def test_evaluation_is_idempotent_per_run(campaign_id):
    db = SessionLocal()
    try:
        first = evaluate_and_store_alerts(db, campaign_id)
        second = evaluate_and_store_alerts(db, campaign_id)
        total = db.query(Alert).filter(Alert.campaign_id == campaign_id).count()
    finally:
        db.close()
    assert first and second == []
    assert total == len(first)


def test_no_campaign_is_noop():
    db = SessionLocal()
    try:
        assert evaluate_and_store_alerts(db, None) == []
    finally:
        db.close()


def test_list_summary_and_acknowledge(client, auth_headers, campaign_id):
    db = SessionLocal()
    try:
        evaluate_and_store_alerts(db, campaign_id)
    finally:
        db.close()

    res = client.get("/api/alerts", params={"campaign_id": campaign_id}, headers=auth_headers)
    assert res.status_code == 200
    alerts = res.json()
    assert alerts and all(not a["acknowledged"] for a in alerts)

    summary = client.get("/api/alerts/summary", params={"campaign_id": campaign_id}, headers=auth_headers).json()
    assert summary["unacknowledged"] == len(alerts)
    assert sum(summary["by_severity"].values()) == len(alerts)

    target = alerts[0]["id"]
    ack = client.post(f"/api/alerts/{target}/acknowledge", headers=auth_headers)
    assert ack.status_code == 200 and ack.json()["acknowledged"] is True

    remaining = client.get("/api/alerts", params={"campaign_id": campaign_id}, headers=auth_headers).json()
    assert target not in {a["id"] for a in remaining}
    everything = client.get(
        "/api/alerts", params={"campaign_id": campaign_id, "include_acknowledged": True},
        headers=auth_headers,
    ).json()
    assert target in {a["id"] for a in everything}


def test_acknowledge_unknown_alert_404(client, auth_headers):
    res = client.post("/api/alerts/999999/acknowledge", headers=auth_headers)
    assert res.status_code == 404


def test_alerts_require_auth(client, campaign_id):
    res = client.get("/api/alerts", params={"campaign_id": campaign_id})
    assert res.status_code in (401, 403)


def test_csv_dda_run_triggers_evaluation(client, auth_headers, campaign_id, sample_journeys_csv):
    """The CSV DDA endpoint must run alert evaluation without breaking the run."""
    files = {"file": ("journeys.csv", sample_journeys_csv, "text/csv")}
    res = client.post(
        "/api/dda/run-from-csv", files=files,
        params={"campaign_id": campaign_id}, headers=auth_headers,
    )
    assert res.status_code == 200, res.text
    db = SessionLocal()
    try:
        latest = (
            db.query(DDAResult)
            .filter(DDAResult.campaign_id == campaign_id, DDAResult.status == "complete")
            .order_by(DDAResult.run_date.desc())
            .first()
        )
        n_for_latest = db.query(Alert).filter(Alert.dda_result_id == latest.id).count()
    finally:
        db.close()
    # The new run differs sharply from the synthetic history, so rules fire on it.
    assert n_for_latest >= 1


def test_bq_background_run_commits_alerts_with_result(campaign_id):
    """BQ runs finish in a background thread; alerts must land in the same commit
    that marks the run complete, so a status poller never sees one without the other."""
    from backend.api.routes_bigquery import _finish_dda_run

    db = SessionLocal()
    try:
        row = DDAResult(
            campaign_id=campaign_id, run_date=datetime.now(timezone.utc).isoformat(),
            data_source="bigquery", result_json="{}", status="running",
        )
        db.add(row)
        db.commit()
        result_id = row.id

        touchpoints = []
        for i in range(6):
            lead = f"u{i}"
            touchpoints.append({"lead_id": lead, "timestamp": "2026-01-01T00:00:00",
                                "channel": "Email", "touchpoint_type": "click", "campaign": "",
                                "segment": "", "converted": False, "session_id": lead, "revenue": 0.0})
            touchpoints.append({"lead_id": lead, "timestamp": "2026-01-02T00:00:00",
                                "channel": "Paid Search", "touchpoint_type": "signup", "campaign": "",
                                "segment": "", "converted": True, "session_id": lead, "revenue": 0.0})

        _finish_dda_run(
            db, result_id, touchpoints,
            prior_alpha=0.5, campaign_id=campaign_id, target_campaign_id=campaign_id,
            data_source="bigquery_generic", no_conversion_msg="x",
        )
    finally:
        db.close()

    db = SessionLocal()
    try:
        assert db.get(DDAResult, result_id).status == "complete"
        assert db.query(Alert).filter(Alert.dda_result_id == result_id).count() >= 1
    finally:
        db.close()
