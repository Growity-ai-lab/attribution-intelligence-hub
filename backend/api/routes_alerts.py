"""Proactive alert endpoints and the post-DDA evaluation hook."""

import json
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from backend.api.deps import check_campaign_access, get_current_user
from backend.db.database import get_db
from backend.db.models import Alert, DDAResult
from backend.models.alerts import compute_trend_series, evaluate_alerts

logger = logging.getLogger(__name__)

router = APIRouter()

# How many completed runs feed the trend-based rules (sustained_decline needs 3+).
_TREND_WINDOW = 5


def build_alerts(
    db: Session,
    campaign_id: int,
    current_snapshot: dict,
    current_result_id: int,
) -> list[Alert]:
    """Evaluate alert rules for one DDA run and return *unsaved* Alert rows.

    *current_snapshot* is compared against the previous completed run and the
    recent trend. Read-only, so callers can add the result to the same commit
    that stores the run itself. Rules already stored for this run are skipped,
    so re-evaluating a run never duplicates alerts.
    """
    prev_rows = (
        db.query(DDAResult)
        .filter(
            DDAResult.campaign_id == campaign_id,
            DDAResult.status == "complete",
            DDAResult.id != current_result_id,
        )
        .order_by(DDAResult.run_date.desc())
        .limit(_TREND_WINDOW - 1)
        .all()
    )
    prev_snapshots = [json.loads(r.result_json or "{}") for r in prev_rows]
    previous = prev_snapshots[0] if prev_snapshots else None
    # compute_trend_series expects oldest → newest
    trend = compute_trend_series(
        list(reversed(prev_snapshots)) + [current_snapshot],
        [r.run_date for r in reversed(prev_rows)] + ["current"],
    )

    existing = {
        (a.rule_id, a.title)
        for a in db.query(Alert).filter(Alert.dda_result_id == current_result_id).all()
    }
    now = datetime.now(timezone.utc).isoformat()
    return [
        Alert(
            campaign_id=campaign_id,
            rule_id=a["rule_id"],
            severity=a["severity"],
            title=a["title"],
            message=a["message"],
            triggered_at=now,
            dda_result_id=current_result_id,
        )
        for a in evaluate_alerts(current_snapshot, previous, trend)
        if (a["rule_id"], a["title"]) not in existing
    ]


def build_alerts_safely(
    db: Session,
    campaign_id: int | None,
    current_snapshot: dict,
    current_result_id: int,
) -> list[Alert]:
    """build_alerts that never fails the DDA run it belongs to."""
    if campaign_id is None:
        return []
    try:
        return build_alerts(db, campaign_id, current_snapshot, current_result_id)
    except Exception:
        logger.exception("Alert evaluation failed (campaign_id=%s)", campaign_id)
        return []


def evaluate_and_store_alerts(db: Session, campaign_id: int | None) -> list[Alert]:
    """Evaluate the campaign's latest completed run and persist new alerts."""
    if campaign_id is None:
        return []
    latest = (
        db.query(DDAResult)
        .filter(DDAResult.campaign_id == campaign_id, DDAResult.status == "complete")
        .order_by(DDAResult.run_date.desc())
        .first()
    )
    if latest is None:
        return []
    created = build_alerts(db, campaign_id, json.loads(latest.result_json or "{}"), latest.id)
    if created:
        db.add_all(created)
        db.commit()
    return created


def evaluate_alerts_safely(db: Session, campaign_id: int | None) -> None:
    """Run alert evaluation without ever failing the DDA run that triggered it."""
    try:
        evaluate_and_store_alerts(db, campaign_id)
    except Exception:
        logger.exception("Alert evaluation failed (campaign_id=%s)", campaign_id)
        db.rollback()


def _serialize(alert: Alert) -> dict:
    return {
        "id": alert.id,
        "campaign_id": alert.campaign_id,
        "rule_id": alert.rule_id,
        "severity": alert.severity,
        "title": alert.title,
        "message": alert.message,
        "triggered_at": alert.triggered_at,
        "acknowledged": bool(alert.acknowledged),
        "acknowledged_at": alert.acknowledged_at or None,
        "dda_result_id": alert.dda_result_id,
    }


@router.get("/alerts")
def list_alerts(
    campaign_id: int = Query(...),
    include_acknowledged: bool = Query(False),
    _user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[dict]:
    """List a campaign's alerts, newest first (unacknowledged only by default)."""
    check_campaign_access(db, campaign_id, _user)
    q = db.query(Alert).filter(Alert.campaign_id == campaign_id)
    if not include_acknowledged:
        q = q.filter(Alert.acknowledged == 0)
    return [_serialize(a) for a in q.order_by(Alert.triggered_at.desc(), Alert.id.desc()).all()]


@router.get("/alerts/summary")
def alerts_summary(
    campaign_id: int = Query(...),
    _user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """Count unacknowledged alerts by severity."""
    check_campaign_access(db, campaign_id, _user)
    open_alerts = (
        db.query(Alert)
        .filter(Alert.campaign_id == campaign_id, Alert.acknowledged == 0)
        .all()
    )
    by_severity: dict[str, int] = {}
    for a in open_alerts:
        by_severity[a.severity] = by_severity.get(a.severity, 0) + 1
    return {"campaign_id": campaign_id, "unacknowledged": len(open_alerts), "by_severity": by_severity}


@router.post("/alerts/{alert_id}/acknowledge")
def acknowledge_alert(
    alert_id: int,
    _user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """Mark an alert as read."""
    alert = db.get(Alert, alert_id)
    if alert is None:
        raise HTTPException(status_code=404, detail="Alert bulunamadı.")
    check_campaign_access(db, alert.campaign_id, _user)
    if not alert.acknowledged:
        alert.acknowledged = 1
        alert.acknowledged_at = datetime.now(timezone.utc).isoformat()
        db.commit()
    return _serialize(alert)
