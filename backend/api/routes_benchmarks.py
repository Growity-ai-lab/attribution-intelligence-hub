"""Benchmark endpoints: channel metrics from DDA, plan reconciliation."""

import json

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from backend.api.deps import check_campaign_access, get_current_user
from backend.db.database import get_db
from backend.db.models import DDAResult, MediaPlanSimulation, TouchpointData

router = APIRouter()


def _match_benchmark_channel(plan_channel: str, dda_channels: list[str]) -> str | None:
    if plan_channel in dda_channels:
        return plan_channel
    pl = plan_channel.lower()
    for ch in dda_channels:
        if pl in ch.lower():
            return ch
    return None


@router.get("/benchmarks/channel-metrics")
def get_channel_benchmarks(
    campaign_id: int = Query(...),
    _user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """Empirical per-channel benchmarks from the latest stored DDA run."""
    check_campaign_access(db, campaign_id, _user)
    last = (
        db.query(DDAResult)
        .filter(DDAResult.campaign_id == campaign_id)
        .order_by(DDAResult.run_date.desc())
        .first()
    )
    if not last:
        return {"available": False, "campaign_id": campaign_id}

    snapshot = json.loads(last.result_json)
    hybrid = snapshot.get("hybrid_attribution", {})
    removal = snapshot.get("markov", {}).get("removal_effects", {})
    assist_list = snapshot.get("assist_report", [])
    assist_by_ch = {a["channel"]: a for a in assist_list}
    ch_summary = snapshot.get("channel_summary", {})

    if not ch_summary:
        rows = (
            db.query(TouchpointData.channel)
            .filter(TouchpointData.campaign_id == campaign_id)
            .all()
        )
        for (ch,) in rows:
            ch_summary[ch] = ch_summary.get(ch, 0) + 1

    stats = snapshot.get("journey_stats", {})
    overall_conv_rate = stats.get("conversion_rate", 0.0)

    channels: dict[str, dict] = {}
    all_ch = set(hybrid) | set(removal) | set(assist_by_ch) | set(ch_summary)
    for ch in all_ch:
        a = assist_by_ch.get(ch, {})
        channels[ch] = {
            "dda_weight": round(float(hybrid.get(ch, 0.0)), 4),
            "removal_effect": round(float(removal.get(ch, 0.0)), 4),
            "assist_ratio": round(float(a.get("assist_ratio", 0.0)), 4),
            "last_touch": a.get("last_touch", 0),
            "first_touch": a.get("first_touch", 0),
            "touchpoints": ch_summary.get(ch, 0),
        }

    return {
        "available": True,
        "campaign_id": campaign_id,
        "run_date": last.run_date,
        "data_source": last.data_source,
        "date_range": {"start": last.start_date, "end": last.end_date},
        "overall_conversion_rate": round(float(overall_conv_rate), 4),
        "journey_stats": stats,
        "channels": channels,
    }


@router.post("/benchmarks/plan-reconciliation")
def reconcile_plan(
    plan_id: int = Body(..., embed=True),
    _user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """Compare a saved media plan's assumptions against observed GA4/DDA data."""
    sim = db.query(MediaPlanSimulation).filter(MediaPlanSimulation.id == plan_id).first()
    if not sim:
        raise HTTPException(status_code=404, detail="Saved plan not found")
    if sim.campaign_id:
        check_campaign_access(db, sim.campaign_id, _user)

    snapshot = json.loads(sim.response_snapshot)
    summary = snapshot.get("summary", {})
    planned_spend = float(summary.get("total_spend") or 0.0)
    planned_leads = float(summary.get("total_leads") or 0.0)
    planned_funnel_leads = float(summary.get("total_funnel_leads") or 0.0)
    planned_cpl = float(summary.get("avg_cpl") or 0.0)

    last = (
        db.query(DDAResult)
        .filter(DDAResult.campaign_id == sim.campaign_id)
        .order_by(DDAResult.run_date.desc())
        .first()
    )
    if not last:
        return {
            "available": False,
            "plan_id": plan_id,
            "channel": sim.channel,
            "campaign_id": sim.campaign_id,
        }

    dda = json.loads(last.result_json)
    hybrid = dda.get("hybrid_attribution", {})
    stats = dda.get("journey_stats", {})
    total_conversions = float(stats.get("converted", 0) or 0)

    matched = _match_benchmark_channel(sim.channel, list(hybrid.keys()))
    dda_weight = float(hybrid.get(matched, 0.0)) if matched else 0.0
    actual_conversions = total_conversions * dda_weight
    empirical_cpl = (planned_spend / actual_conversions) if actual_conversions > 0 else None

    def _dev(actual: float, planned: float) -> float | None:
        if planned <= 0:
            return None
        return round((actual - planned) / planned * 100, 1)

    lead_dev = _dev(actual_conversions, planned_leads)
    cpl_dev = _dev(empirical_cpl, planned_cpl) if empirical_cpl is not None else None

    if not matched:
        verdict = "Kanal eşleşmedi — GA4 verisinde bu kanal için sinyal yok."
    elif actual_conversions == 0:
        verdict = "GA4'te bu kanala atfedilen dönüşüm yok — plan doğrulanamıyor."
    elif lead_dev is not None and lead_dev < -25:
        verdict = f"Plan iyimser — gerçek atfedilen dönüşüm planlanandan %{abs(lead_dev):.0f} düşük."
    elif lead_dev is not None and lead_dev > 25:
        verdict = f"Plan temkinli — gerçek atfedilen dönüşüm planlanandan %{lead_dev:.0f} yüksek."
    else:
        verdict = "Plan gerçekleşmeyle uyumlu (±%25 içinde)."

    return {
        "available": True,
        "plan_id": plan_id,
        "campaign_id": sim.campaign_id,
        "channel": sim.channel,
        "matched_dda_channel": matched,
        "run_date": last.run_date,
        "planned": {
            "total_spend": round(planned_spend, 2),
            "total_leads_mmm": round(planned_leads, 1),
            "total_leads_funnel": round(planned_funnel_leads, 1),
            "cpl": round(planned_cpl, 2),
        },
        "actual": {
            "total_conversions": round(total_conversions, 1),
            "dda_weight": round(dda_weight, 4),
            "attributed_conversions": round(actual_conversions, 1),
            "empirical_cpl": round(empirical_cpl, 2) if empirical_cpl is not None else None,
        },
        "deviations": {
            "lead_deviation_pct": lead_dev,
            "cpl_deviation_pct": cpl_dev,
            "verdict": verdict,
        },
    }
