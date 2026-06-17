"""Media planning endpoints: simulate, presets, CRUD (digital channels only)."""

import json
import math
from datetime import datetime, timezone

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from backend.api.deps import get_current_user
from backend.db.database import get_db
from backend.config import (
    ADSTOCK_PARAMS,
    BASELINE_LEADS,
    CHANNELS_SET,
    DIGITAL_CHANNEL_METRICS,
    DIGITAL_PRESETS,
    MAX_LIFT,
    SATURATION_PARAMS,
)
from backend.data.schemas import (
    FunnelDataPoint,
    MediaPlanningRequest,
    MediaPlanningResponse,
    OptimalSpendResult,
    WeeklySimDetail,
)
from backend.db.models import MediaPlanSimulation
from backend.models.mmm import compute_adstock, compute_response, compute_saturation

router = APIRouter()


# --------------- Helpers ---------------


def _find_optimal_spend(alpha: float, gamma: float, max_lift: float) -> tuple[float, float]:
    upper = max(alpha * 4.0, 1500.0)
    n_steps = 150
    step = upper / n_steps
    test_spends = [i * step for i in range(n_steps + 1)]
    responses = []
    for s in test_spends:
        sat = compute_saturation(float(s), alpha, gamma)
        resp = compute_response(sat, 0.0, max_lift)
        responses.append(resp)

    marginal_ref = responses[1] - responses[0] if len(responses) > 1 else 1.0
    if marginal_ref <= 0:
        return float(test_spends[-1]), float(test_spends[-1])

    optimal_spend = float(test_spends[-1])
    threshold_spend = float(test_spends[-1])
    found_optimal = False
    for i in range(2, len(test_spends)):
        marginal = responses[i] - responses[i - 1]
        if not found_optimal and marginal < marginal_ref * 0.5:
            optimal_spend = float(test_spends[i])
            found_optimal = True
        if marginal < marginal_ref * 0.1:
            threshold_spend = float(test_spends[i])
            break

    return optimal_spend, threshold_spend


def _resolve_digital_metrics(channel: str, request: MediaPlanningRequest) -> dict:
    base = dict(DIGITAL_CHANNEL_METRICS[channel])
    if request.cpm_override is not None and request.cpm_override > 0:
        base["cpm"] = float(request.cpm_override)
    if request.ctr_override is not None and request.ctr_override > 0:
        base["ctr"] = float(request.ctr_override)
    if request.lead_rate_override is not None and request.lead_rate_override > 0:
        base["lead_rate"] = float(request.lead_rate_override)
    if request.target_audience_override is not None and request.target_audience_override > 0:
        base["target_audience"] = int(request.target_audience_override)
    if request.freq_cap_override is not None and request.freq_cap_override > 0:
        base["freq_cap"] = int(request.freq_cap_override)
    return base


def _compute_digital_funnel(weekly_spends: list[float], metrics: dict) -> list[dict]:
    cpm = float(metrics["cpm"])
    ctr = float(metrics["ctr"])
    lead_rate = float(metrics["lead_rate"])
    out = []
    for i, spend in enumerate(weekly_spends):
        impressions = (spend / cpm) * 1000 if cpm > 0 else 0.0
        clicks = impressions * ctr
        leads = clicks * lead_rate
        out.append({
            "week": i + 1,
            "spend": float(spend),
            "impressions": impressions,
            "clicks": clicks,
            "estimated_leads_funnel": leads,
        })
    return out


def _compute_digital_reach(
    cumulative_impressions: list[float], target_audience: int, freq_cap: int
) -> list[dict]:
    out = []
    for impr in cumulative_impressions:
        if target_audience <= 0:
            out.append({"reach_pct": 0.0, "frequency": 0.0})
            continue
        lam = impr / target_audience
        coverage = 1 - math.exp(-lam)
        reach_pct = coverage * 100.0
        raw_freq = lam / coverage if coverage > 0 else 0.0
        eff_freq = min(raw_freq, float(freq_cap))
        out.append({"reach_pct": reach_pct, "frequency": eff_freq})
    return out


def _generate_recommendation(
    channel: str, avg_spend: float, optimal: float, threshold: float
) -> str:
    def _fmt(v: float) -> str:
        return f"{v/1_000_000:.1f}M TL" if v >= 1_000_000 else f"{v/1_000:.0f}K TL"
    if avg_spend < optimal * 0.8:
        return (
            f"{channel.capitalize()} kanalında haftalık ortalama harcama {_fmt(avg_spend)} olup "
            f"optimal seviyenin ({_fmt(optimal)}) altındadır. Ek bütçe ile marjinal lead getirisi "
            f"hâlâ yüksek; bütçe artışı {_fmt(threshold)} doygunluk sınırına kadar verimli olacaktır."
        )
    if avg_spend > threshold:
        return (
            f"{channel.capitalize()} kanalında haftalık ortalama harcama {_fmt(avg_spend)} olup "
            f"doygunluk noktasını ({_fmt(threshold)}) aşmıştır. Marjinal getiri sıfıra yaklaşır; "
            f"bütçenin bir kısmının daha düşük doygunluk sergileyen kanallara aktarılması önerilir."
        )
    return (
        f"{channel.capitalize()} kanalında haftalık ortalama harcama {_fmt(avg_spend)} olup "
        f"optimal aralıkta ({_fmt(optimal)}–{_fmt(threshold)}) bulunmaktadır. Mevcut plana devam "
        f"edilmesi önerilir."
    )


# --------------- Simulate ---------------


@router.post("/media-planning/simulate")
def simulate_media_plan(
    request: MediaPlanningRequest,
    _user: dict = Depends(get_current_user),
) -> MediaPlanningResponse:
    """Simulate a digital media plan given weekly spend values."""
    channel = request.channel
    if channel not in CHANNELS_SET:
        raise HTTPException(
            status_code=400,
            detail=f"Channel must be one of: {', '.join(sorted(CHANNELS_SET))}",
        )

    metrics = _resolve_digital_metrics(channel, request)
    decay = ADSTOCK_PARAMS[channel]
    alpha, gamma = SATURATION_PARAMS[channel]
    max_lift = MAX_LIFT[channel]
    baseline_per_ch = BASELINE_LEADS / len(CHANNELS_SET)

    weekly_spends = list(request.weekly_spends)

    adstocked = compute_adstock(weekly_spends, decay)
    weekly_details: list[WeeklySimDetail] = []
    for i, (spend, adst) in enumerate(zip(weekly_spends, adstocked)):
        sat = compute_saturation(adst, alpha, gamma)
        leads = compute_response(sat, baseline_per_ch, max_lift)
        weekly_details.append(WeeklySimDetail(
            week=i + 1,
            spend=round(spend, 0),
            adstocked_spend=round(adst, 0),
            saturated=round(sat, 4),
            estimated_leads=round(leads, 1),
            marginal_leads=round(leads - baseline_per_ch, 1),
        ))

    funnel_rows = _compute_digital_funnel(weekly_spends, metrics)
    funnel_curve: list[FunnelDataPoint] = []
    cumulative_impressions = []
    cum_impr = 0.0
    for row in funnel_rows:
        cum_impr += row["impressions"]
        cumulative_impressions.append(cum_impr)

    reach_rows = _compute_digital_reach(
        cumulative_impressions,
        int(metrics["target_audience"]),
        int(metrics["freq_cap"]),
    )

    for fr, rr in zip(funnel_rows, reach_rows):
        funnel_curve.append(FunnelDataPoint(
            week=fr["week"],
            spend=round(fr["spend"], 0),
            impressions=round(fr["impressions"], 0),
            clicks=round(fr["clicks"], 0),
            estimated_leads_funnel=round(fr["estimated_leads_funnel"], 1),
            reach_pct=round(rr["reach_pct"], 2),
            frequency=round(rr["frequency"], 2),
        ))

    total_spend = sum(weekly_spends)
    total_impressions = sum(f["impressions"] for f in funnel_rows)
    total_clicks = sum(f["clicks"] for f in funnel_rows)
    total_leads_mmm = sum(d.estimated_leads for d in weekly_details)
    total_leads_funnel = sum(f["estimated_leads_funnel"] for f in funnel_rows)
    avg_spend = total_spend / len(weekly_spends) if weekly_spends else 0
    peak_week = max(weekly_details, key=lambda d: d.estimated_leads).week if weekly_details else 1

    avg_cpm = (total_spend / total_impressions * 1000) if total_impressions > 0 else 0
    avg_cpc = (total_spend / total_clicks) if total_clicks > 0 else 0
    avg_cpl_mmm = (total_spend / total_leads_mmm) if total_leads_mmm > 0 else 0
    avg_cpl_funnel = (total_spend / total_leads_funnel) if total_leads_funnel > 0 else 0
    deviation_pct = (
        (total_leads_funnel - total_leads_mmm) / total_leads_mmm * 100
        if total_leads_mmm > 0 else 0
    )

    summary = {
        "total_spend": round(total_spend, 0),
        "avg_spend": round(avg_spend, 0),
        "total_impressions": round(total_impressions, 0),
        "total_clicks": round(total_clicks, 0),
        "total_leads_mmm": round(total_leads_mmm, 1),
        "total_leads_funnel": round(total_leads_funnel, 1),
        "avg_cpm": round(avg_cpm, 2),
        "avg_cpc": round(avg_cpc, 2),
        "avg_cpl_mmm": round(avg_cpl_mmm, 2),
        "avg_cpl_funnel": round(avg_cpl_funnel, 2),
        "funnel_vs_mmm_deviation_pct": round(deviation_pct, 1),
        "peak_week": peak_week,
    }

    opt_spend, sat_threshold_spend = _find_optimal_spend(alpha, gamma, max_lift)
    recommendation = _generate_recommendation(channel, avg_spend, opt_spend, sat_threshold_spend)
    optimal = OptimalSpendResult(
        optimal_weekly_spend=round(opt_spend, 0),
        saturation_threshold_spend=round(sat_threshold_spend, 0),
        current_avg_spend=round(avg_spend, 0),
        recommendation=recommendation,
    )

    max_spend_chart = max(max(weekly_spends, default=alpha * 2) * 1.5, alpha * 2)
    curve_count = 50
    curve_spends = [round(i * (max_spend_chart / curve_count), 0) for i in range(curve_count + 1)]
    curve_sat = [round(compute_saturation(s, alpha, gamma), 4) for s in curve_spends]
    saturation_curve = {"spend_values": curve_spends, "saturated_values": curve_sat}

    return MediaPlanningResponse(
        channel=channel,
        decay=decay,
        alpha=alpha,
        gamma=gamma,
        max_lift=max_lift,
        weekly_details=weekly_details,
        summary=summary,
        optimal=optimal,
        saturation_curve=saturation_curve,
        funnel_curve=funnel_curve,
        digital_metrics=metrics,
    )


@router.get("/media-planning/presets/{channel}")
def get_media_planning_presets(
    channel: str,
    _user: dict = Depends(get_current_user),
) -> dict:
    """Return default presets and parameters for a digital channel."""
    if channel not in CHANNELS_SET:
        raise HTTPException(
            status_code=400,
            detail=f"Channel must be one of: {', '.join(sorted(CHANNELS_SET))}",
        )
    alpha, gamma = SATURATION_PARAMS[channel]
    return {
        "channel": channel,
        "preset_spends": DIGITAL_PRESETS.get(channel, []),
        "decay": ADSTOCK_PARAMS[channel],
        "alpha": alpha,
        "gamma": gamma,
        "max_lift": MAX_LIFT[channel],
        "metrics": DIGITAL_CHANNEL_METRICS.get(channel, {}),
    }


# --------------- Save/Load ---------------


@router.post("/media-planning/save")
def save_media_plan(
    name: str = Body(..., embed=True),
    channel: str = Body(..., embed=True),
    weekly_spends: list[float] = Body(..., embed=True),
    response_snapshot: dict = Body(..., embed=True),
    campaign_id: int | None = Body(None, embed=True),
    user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """Save a media plan simulation."""
    if not name or not name.strip():
        raise HTTPException(status_code=400, detail="Simulation name is required")
    if channel not in CHANNELS_SET:
        raise HTTPException(status_code=400, detail=f"Invalid channel: {channel}")

    sim = MediaPlanSimulation(
        campaign_id=campaign_id,
        name=name.strip(),
        channel=channel,
        weekly_grps=json.dumps(weekly_spends),
        response_snapshot=json.dumps(response_snapshot),
        mode="digital",
        created_at=datetime.now(timezone.utc).isoformat(),
        created_by=user.get("username", ""),
    )
    db.add(sim)
    db.commit()
    db.refresh(sim)
    return {"id": sim.id, "name": sim.name, "channel": sim.channel, "created_at": sim.created_at}


@router.get("/media-planning/saved")
def list_saved_media_plans(
    campaign_id: int | None = Query(None),
    _user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[dict]:
    """List saved media plan simulations."""
    q = db.query(MediaPlanSimulation)
    if campaign_id is not None:
        q = q.filter(MediaPlanSimulation.campaign_id == campaign_id)
    sims = q.order_by(MediaPlanSimulation.created_at.desc()).all()
    return [
        {
            "id": s.id, "name": s.name, "channel": s.channel,
            "campaign_id": s.campaign_id,
            "created_at": s.created_at, "created_by": s.created_by,
        }
        for s in sims
    ]


@router.get("/media-planning/saved/{sim_id}")
def get_saved_media_plan(
    sim_id: int,
    _user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """Get a single saved media plan simulation."""
    sim = db.query(MediaPlanSimulation).filter(MediaPlanSimulation.id == sim_id).first()
    if not sim:
        raise HTTPException(status_code=404, detail="Simulation not found")
    return {
        "id": sim.id, "name": sim.name, "channel": sim.channel,
        "campaign_id": sim.campaign_id,
        "weekly_spends": json.loads(sim.weekly_grps),
        "response_snapshot": json.loads(sim.response_snapshot),
        "created_at": sim.created_at, "created_by": sim.created_by,
    }


@router.delete("/media-planning/saved/{sim_id}")
def delete_saved_media_plan(
    sim_id: int,
    _user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """Delete a saved media plan simulation."""
    sim = db.query(MediaPlanSimulation).filter(MediaPlanSimulation.id == sim_id).first()
    if not sim:
        raise HTTPException(status_code=404, detail="Simulation not found")
    db.delete(sim)
    db.commit()
    return {"deleted": True, "id": sim_id}
