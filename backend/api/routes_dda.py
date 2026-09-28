"""DDA attribution endpoints: journey/CSV runs, latest stored result, run status."""

import json
import logging
from io import BytesIO
from fastapi import APIRouter, Body, Depends, File, HTTPException, Query, UploadFile
from sqlalchemy.orm import Session
from backend.api.deps import check_campaign_access, get_current_user, resolve_read_campaign_id
from backend.db.database import get_db
from backend.db.models import (
    DDAResult,
    TouchpointData,
)
from backend.config import (
    DDA_BLEND_WEIGHTS,
    MARKOV_PRIOR_ALPHA,
    MAX_CSV_ROWS,
)
from backend.data.loader import load_crm_touchpoints
from backend.models.dda.data_prep import Journey, _is_truthy, extract_journeys
from backend.models.dda.ensemble import run_full_dda_pipeline
from backend.api.routes_alerts import evaluate_alerts_safely
from backend.api.common import (
    _CONVERSION_CHANNELS,
    _validate_file,
    _read_file_content,
    _serialize_dda_result,
    _dda_only_unified_report,
    _persist_dda_result,
    _validate_prior_alpha,
    _validate_journey_count,
    _ensure_demo_sandbox_campaign,
)

router = APIRouter()

logger = logging.getLogger(__name__)


@router.post("/dda/run")
def run_dda(
    journeys: list[dict] = Body(..., description="List of journey objects"),
    mmm_shares: dict[str, float] | None = Body(None, description="MMM channel shares"),
    prior_alpha: float = Body(MARKOV_PRIOR_ALPHA, description="Bayesian smoothing"),
    _user: dict = Depends(get_current_user),
) -> dict:
    """Run the full DDA pipeline on journey data.

    Expects a list of journey dicts: {lead_id, channels, converted, segment}
    """
    if not journeys:
        raise HTTPException(status_code=422, detail="No journey data provided")

    _validate_prior_alpha(prior_alpha)
    _validate_journey_count(journeys)

    journey_objects = []
    for j in journeys:
        try:
            journey_objects.append(Journey(
                lead_id=j["lead_id"],
                channels=j["channels"],
                converted=j.get("converted", False),
                segment=j.get("segment", ""),
            ))
        except (KeyError, TypeError) as e:
            raise HTTPException(
                status_code=422,
                detail=f"Invalid journey format: {e}. Expected: lead_id, channels, converted",
            )

    result = run_full_dda_pipeline(
        journey_objects,
        mmm_shares,
        prior_alpha=prior_alpha,
        markov_blend=DDA_BLEND_WEIGHTS["markov"],
        shapley_blend=DDA_BLEND_WEIGHTS["shapley"],
    )

    return _serialize_dda_result(result)


@router.post("/dda/run-from-csv")
async def run_dda_from_csv(
    file: UploadFile = File(...),
    prior_alpha: float = 0.5,
    campaign_id: int | None = Query(None),
    conversion_events: str = Query("purchase,generate_lead"),
    _user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """Run DDA pipeline from a CRM touchpoint CSV or GA4 export CSV.

    Auto-detects GA4 format (user_pseudo_id, event_name, source, medium) and
    converts it with channel mapping. Standard CRM format also accepted.

    Re-upload semantics: existing touchpoints for the campaign are replaced.
    """
    _validate_file(file)
    _validate_prior_alpha(prior_alpha)
    content = await _read_file_content(file)

    conv_list = [e.strip() for e in conversion_events.split(",") if e.strip()]
    try:
        touchpoints, truncated = load_crm_touchpoints(BytesIO(content), conversion_events=conv_list)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))

    # Persist raw touchpoints (forensic value; conversion-event filtering is lossy)
    persisted = False
    target_campaign_id = campaign_id
    if campaign_id is not None:
        check_campaign_access(db, campaign_id, _user)
        if _user.get("role") == "demo":
            target_campaign_id = _ensure_demo_sandbox_campaign(db, campaign_id)
        db.query(TouchpointData).filter(
            TouchpointData.campaign_id == target_campaign_id,
        ).delete(synchronize_session=False)
        for tp in touchpoints:
            db.add(TouchpointData(
                campaign_id=target_campaign_id,
                lead_id=tp.lead_id,
                timestamp=tp.timestamp,
                channel=tp.channel,
                touchpoint_type=tp.touchpoint_type,
                campaign=tp.campaign,
                segment=tp.segment,
            ))
        db.commit()
        persisted = True

    # Capture lead-level conversion status BEFORE filtering
    lead_converted: dict[str, bool] = {}
    for tp in touchpoints:
        if _is_truthy(tp.converted):
            lead_converted[tp.lead_id] = True

    # Filter out conversion-event channels (form, landing_page etc.)
    tp_dicts = [
        tp.model_dump()
        for tp in touchpoints
        if tp.channel not in _CONVERSION_CHANNELS
    ]

    # Restore lead-level conversion flag on remaining touchpoints
    for tp in tp_dicts:
        tp["converted"] = lead_converted.get(tp["lead_id"], False)

    journeys = extract_journeys(tp_dicts)
    if not journeys:
        raise HTTPException(status_code=422, detail="No valid journeys extracted from touchpoints")

    _validate_journey_count(journeys)

    result = run_full_dda_pipeline(
        journeys,
        prior_alpha=prior_alpha,
        markov_blend=DDA_BLEND_WEIGHTS["markov"],
        shapley_blend=DDA_BLEND_WEIGHTS["shapley"],
    )

    # DDA-only attribution (MMM/incrementality removed — not fitted on real data)
    serialized = _serialize_dda_result(result)
    serialized["unified_report"] = _dda_only_unified_report(result["hybrid_attribution"])
    serialized["persisted"] = persisted
    serialized["campaign_id"] = target_campaign_id
    serialized["redirected_to_sandbox"] = persisted and target_campaign_id != campaign_id
    if truncated:
        serialized["warning"] = f"CSV dosyası {MAX_CSV_ROWS} satır sınırında kesildi. Fazla satırlar dahil edilmedi."

    # Persist DDA result as a media-planning benchmark (gated on campaign_id)
    _persist_dda_result(
        db, target_campaign_id, serialized,
        created_by=_user.get("username", ""), data_source="csv",
    )
    evaluate_alerts_safely(db, target_campaign_id)
    return serialized


@router.get("/dda/latest")
def dda_latest(
    campaign_id: int = Query(...),
    _user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """Return the campaign's most recent completed DDA result.

    Lets the report page show stored results after a reload or restart
    instead of only what was run in the current browser session. Returns
    ``{"status": "none"}`` when the campaign has no completed run yet.
    """
    check_campaign_access(db, campaign_id, _user)
    read_id = resolve_read_campaign_id(db, campaign_id, _user)
    row = (
        db.query(DDAResult)
        .filter(DDAResult.campaign_id == read_id, DDAResult.status == "complete")
        .order_by(DDAResult.run_date.desc())
        .first()
    )
    if row is None:
        return {"status": "none", "campaign_id": campaign_id}

    result = json.loads(row.result_json or "{}")
    # Older CSV rows stored empty placeholders; drop them so the UI hides those sections.
    result = {k: v for k, v in result.items() if v not in ({}, [], None)}
    # CSV runs persisted before unified_report was stored only kept the blend.
    if not result.get("unified_report") and result.get("hybrid_attribution"):
        result["unified_report"] = _dda_only_unified_report(result["hybrid_attribution"])
    return {
        **result,
        "status": "complete",
        "result_id": row.id,
        "run_date": row.run_date,
        "data_source": row.data_source or result.get("data_source", ""),
        "stored": True,
    }


@router.get("/dda/status/{result_id}")
def dda_status(
    result_id: int,
    _user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """Poll for a background DDA run's status.

    Returns the full DDA result once status is 'complete', an error message
    on 'error', or just the status while still 'running'.
    """
    row = db.query(DDAResult).filter(DDAResult.id == result_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="DDA result not found")
    if row.campaign_id is not None:
        check_campaign_access(db, row.campaign_id, _user)

    if row.status == "running":
        return {"status": "running", "result_id": result_id}

    if row.status == "error":
        return {"status": "error", "result_id": result_id, "detail": row.error_message}

    # status == "complete"
    result = json.loads(row.result_json)
    return {"status": "complete", "result_id": result_id, **result}
