"""Export and insight trend endpoints."""

import json

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from starlette.responses import StreamingResponse

from backend.api.deps import get_current_user
from backend.db.database import get_db
from backend.db.models import Campaign, DDAResult
from backend.export.report_builder import build_dda_report, workbook_to_bytes
from backend.models.dda.insights import compare_snapshots

router = APIRouter()


@router.get("/export/dda-report")
def export_dda_report(
    campaign_id: int = Query(...),
    result_id: int | None = Query(None),
    _user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Export DDA attribution results as a formatted Excel workbook."""
    if result_id is not None:
        dda = (
            db.query(DDAResult)
            .filter(DDAResult.id == result_id, DDAResult.campaign_id == campaign_id)
            .first()
        )
    else:
        dda = (
            db.query(DDAResult)
            .filter(DDAResult.campaign_id == campaign_id)
            .order_by(DDAResult.run_date.desc())
            .first()
        )
    if not dda:
        raise HTTPException(status_code=404, detail="Bu kampanya için DDA sonucu bulunamadı.")

    snapshot = json.loads(dda.result_json)

    campaign = db.query(Campaign).filter(Campaign.id == campaign_id).first()
    campaign_name = campaign.name if campaign else f"Kampanya {campaign_id}"
    objective = (campaign.objective if campaign else "lead") or "lead"

    wb = build_dda_report(snapshot, campaign_name, dda.run_date or "", objective)
    buf = workbook_to_bytes(wb)

    mode_tag = "lead" if objective == "lead" else "gelir"
    date_tag = dda.run_date[:10] if dda.run_date else "unknown"
    filename = f"attribution_{mode_tag}_rapor_{campaign_id}_{date_tag}.xlsx"
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/insights/trend")
def get_insight_trends(
    campaign_id: int = Query(...),
    _user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """Compare the latest DDA run with the previous one for temporal insights."""
    results = (
        db.query(DDAResult)
        .filter(DDAResult.campaign_id == campaign_id)
        .order_by(DDAResult.run_date.desc())
        .limit(2)
        .all()
    )
    if len(results) < 2:
        return {
            "available": False,
            "campaign_id": campaign_id,
            "run_count": len(results),
            "reason": "Karşılaştırma için en az 2 DDA çalışması gerekli.",
        }

    current = json.loads(results[0].result_json)
    previous = json.loads(results[1].result_json)
    insights = compare_snapshots(current, previous)

    cur_stats = current.get("journey_stats", {})
    prev_stats = previous.get("journey_stats", {})

    return {
        "available": True,
        "campaign_id": campaign_id,
        "current_run_date": results[0].run_date,
        "previous_run_date": results[1].run_date,
        "current_data_source": results[0].data_source,
        "insights": insights,
        "summary": {
            "current_conversion_rate": cur_stats.get("conversion_rate", 0),
            "previous_conversion_rate": prev_stats.get("conversion_rate", 0),
            "current_total_journeys": cur_stats.get("total_journeys", 0),
            "previous_total_journeys": prev_stats.get("total_journeys", 0),
        },
    }
