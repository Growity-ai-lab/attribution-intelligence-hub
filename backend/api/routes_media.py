"""Media planning endpoints: simulate, presets, CRUD."""

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
    CHANNELS,
    DIGITAL_CHANNEL_METRICS,
    DIGITAL_PRESETS,
    GRP_MAX_LIFT,
    GRP_PRESETS,
    GRP_SATURATION_PARAMS,
    MAX_LIFT,
    OFFLINE_CHANNELS,
    ONLINE_CHANNELS,
    REACH_LOOKUP,
    SATURATION_PARAMS,
)
from backend.data.schemas import (
    FunnelDataPoint,
    MediaPlanningRequest,
    MediaPlanningResponse,
    OptimalGRPResult,
    ReachDataPoint,
    WeeklySimDetail,
)
from backend.db.models import MediaPlanSimulation
from backend.models.mmm import compute_adstock, compute_response, compute_saturation

router = APIRouter()


# --------------- Helpers ---------------


def _find_optimal_grp(alpha: float, gamma: float, max_lift: float) -> tuple[float, float]:
    upper = max(alpha * 4.0, 1500.0)
    n_steps = 150
    step = upper / n_steps
    test_grps = [i * step for i in range(n_steps + 1)]
    responses = []
    for g in test_grps:
        sat = compute_saturation(float(g), alpha, gamma)
        resp = compute_response(sat, 0.0, max_lift)
        responses.append(resp)

    marginal_ref = responses[1] - responses[0] if len(responses) > 1 else 1.0
    if marginal_ref <= 0:
        return float(test_grps[-1]), float(test_grps[-1])

    optimal_grp = float(test_grps[-1])
    threshold_grp = float(test_grps[-1])
    found_optimal = False
    for i in range(2, len(test_grps)):
        marginal = responses[i] - responses[i - 1]
        if not found_optimal and marginal < marginal_ref * 0.5:
            optimal_grp = float(test_grps[i])
            found_optimal = True
        if marginal < marginal_ref * 0.1:
            threshold_grp = float(test_grps[i])
            break

    return optimal_grp, threshold_grp


def _generate_recommendation(channel: str, avg_grp: float, optimal: float, threshold: float) -> str:
    label = {
        "tv_match": "TV Maç", "tv_news": "TV Haber",
        "radio": "Radyo", "dooh": "DOOH",
    }.get(channel, channel)

    if avg_grp < optimal * 0.8:
        return (
            f"{label} kanalında mevcut ortalama GRP ({avg_grp:.0f}) optimal seviyenin "
            f"({optimal:.0f}) altında. GRP artışı ile lead kazanımı artırılabilir."
        )
    if avg_grp > threshold:
        return (
            f"{label} kanalında mevcut ortalama GRP ({avg_grp:.0f}) doygunluk eşiğini "
            f"({threshold:.0f}) aşıyor. GRP azaltılarak verimlilik artırılabilir."
        )
    return (
        f"{label} kanalında mevcut GRP seviyesi ({avg_grp:.0f}) optimal aralıkta "
        f"({optimal:.0f}–{threshold:.0f}). Mevcut plana devam edilmesi önerilir."
    )


def _interpolate_reach(cumulative_grp: float) -> dict[str, float]:
    grp_keys = sorted(REACH_LOOKUP.keys())
    if cumulative_grp <= grp_keys[0]:
        entry = REACH_LOOKUP[grp_keys[0]]
        ratio = cumulative_grp / grp_keys[0] if grp_keys[0] > 0 else 0
        return {"r1": entry["r1"] * ratio, "r2": entry["r2"] * ratio, "r3": entry["r3"] * ratio}
    if cumulative_grp >= grp_keys[-1]:
        return REACH_LOOKUP[grp_keys[-1]]

    for i in range(len(grp_keys) - 1):
        lo, hi = grp_keys[i], grp_keys[i + 1]
        if lo <= cumulative_grp <= hi:
            t = (cumulative_grp - lo) / (hi - lo)
            lo_v, hi_v = REACH_LOOKUP[lo], REACH_LOOKUP[hi]
            return {
                "r1": lo_v["r1"] + t * (hi_v["r1"] - lo_v["r1"]),
                "r2": lo_v["r2"] + t * (hi_v["r2"] - lo_v["r2"]),
                "r3": lo_v["r3"] + t * (hi_v["r3"] - lo_v["r3"]),
            }
    return REACH_LOOKUP[grp_keys[-1]]


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


def _generate_digital_recommendation(
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


def _simulate_digital_plan(request: MediaPlanningRequest) -> MediaPlanningResponse:
    channel = request.channel
    if channel not in ONLINE_CHANNELS:
        raise HTTPException(
            status_code=400,
            detail=f"Channel must be online: {', '.join(sorted(ONLINE_CHANNELS))}",
        )

    metrics = _resolve_digital_metrics(channel, request)
    decay = ADSTOCK_PARAMS[channel]
    alpha, gamma = SATURATION_PARAMS[channel]
    max_lift = MAX_LIFT[channel]
    baseline_per_ch = BASELINE_LEADS / len(CHANNELS)

    weekly_spends = list(request.weekly_grps)

    adstocked = compute_adstock(weekly_spends, decay)
    weekly_details: list[WeeklySimDetail] = []
    for i, (spend, adst) in enumerate(zip(weekly_spends, adstocked)):
        sat = compute_saturation(adst, alpha, gamma)
        leads = compute_response(sat, baseline_per_ch, max_lift)
        weekly_details.append(WeeklySimDetail(
            week=i + 1,
            grp=round(spend, 0),
            adstocked_grp=round(adst, 0),
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
        "total_grp": round(total_spend, 0),
        "avg_grp": round(avg_spend, 0),
        "total_leads": round(total_leads_mmm, 1),
        "leads_per_100_grp": round((total_leads_mmm / total_spend * 100_000) if total_spend > 0 else 0, 2),
        "peak_week": peak_week,
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
    }

    opt_spend, sat_threshold_spend = _find_optimal_grp(alpha, gamma, max_lift)
    recommendation = _generate_digital_recommendation(channel, avg_spend, opt_spend, sat_threshold_spend)
    optimal = OptimalGRPResult(
        optimal_weekly_grp=round(opt_spend, 0),
        saturation_threshold_grp=round(sat_threshold_spend, 0),
        current_avg_grp=round(avg_spend, 0),
        recommendation=recommendation,
    )

    max_spend_chart = max(max(weekly_spends, default=alpha * 2) * 1.5, alpha * 2)
    curve_count = 50
    curve_spends = [round(i * (max_spend_chart / curve_count), 0) for i in range(curve_count + 1)]
    curve_sat = [round(compute_saturation(s, alpha, gamma), 4) for s in curve_spends]
    saturation_curve = {"grp_values": curve_spends, "saturated_values": curve_sat}

    reach_curve: list[ReachDataPoint] = []
    for fp in funnel_curve:
        reach_curve.append(ReachDataPoint(
            cumulative_grp=round(cumulative_impressions[fp.week - 1], 0),
            r1=round(fp.reach_pct, 2),
            r2=round(fp.frequency, 2),
            r3=0.0,
        ))

    return MediaPlanningResponse(
        channel=channel,
        mode="digital",
        decay=decay,
        alpha=alpha,
        gamma=gamma,
        max_lift=max_lift,
        weekly_details=weekly_details,
        summary=summary,
        optimal=optimal,
        saturation_curve=saturation_curve,
        reach_curve=reach_curve,
        funnel_curve=funnel_curve,
        digital_metrics=metrics,
    )


@router.post("/media-planning/simulate")
def simulate_media_plan(
    request: MediaPlanningRequest,
    _user: dict = Depends(get_current_user),
) -> MediaPlanningResponse:
    """Simulate a media plan given weekly values."""
    channel = request.channel
    mode = (request.mode or "offline").lower()

    if mode == "digital":
        return _simulate_digital_plan(request)

    if channel not in OFFLINE_CHANNELS:
        raise HTTPException(
            status_code=400,
            detail=f"Channel must be offline: {', '.join(sorted(OFFLINE_CHANNELS))}",
        )

    decay = ADSTOCK_PARAMS[channel]
    alpha, gamma = GRP_SATURATION_PARAMS[channel]
    max_lift = GRP_MAX_LIFT[channel]
    baseline_per_ch = BASELINE_LEADS / len(CHANNELS)

    adstocked = compute_adstock(list(request.weekly_grps), decay)

    weekly_details: list[WeeklySimDetail] = []
    for i, (grp, adst) in enumerate(zip(request.weekly_grps, adstocked)):
        sat = compute_saturation(adst, alpha, gamma)
        leads = compute_response(sat, baseline_per_ch, max_lift)
        weekly_details.append(WeeklySimDetail(
            week=i + 1,
            grp=round(grp, 1),
            adstocked_grp=round(adst, 1),
            saturated=round(sat, 4),
            estimated_leads=round(leads, 1),
            marginal_leads=round(leads - baseline_per_ch, 1),
        ))

    total_grp = sum(request.weekly_grps)
    total_leads = sum(d.estimated_leads for d in weekly_details)
    avg_grp = total_grp / len(request.weekly_grps) if request.weekly_grps else 0
    peak_week = max(weekly_details, key=lambda d: d.estimated_leads).week if weekly_details else 1
    leads_per_100 = (total_leads / total_grp * 100) if total_grp > 0 else 0

    summary = {
        "total_grp": round(total_grp, 0),
        "avg_grp": round(avg_grp, 1),
        "total_leads": round(total_leads, 1),
        "leads_per_100_grp": round(leads_per_100, 2),
        "peak_week": peak_week,
    }

    opt_grp, sat_threshold = _find_optimal_grp(alpha, gamma, max_lift)
    recommendation = _generate_recommendation(channel, avg_grp, opt_grp, sat_threshold)
    optimal = OptimalGRPResult(
        optimal_weekly_grp=opt_grp,
        saturation_threshold_grp=sat_threshold,
        current_avg_grp=round(avg_grp, 1),
        recommendation=recommendation,
    )

    max_grp_chart = max(max(request.weekly_grps, default=400) * 2, 800)
    curve_count = 50
    curve_grps = [round(i * (max_grp_chart / curve_count), 1) for i in range(curve_count + 1)]
    curve_sat = [round(compute_saturation(g, alpha, gamma), 4) for g in curve_grps]
    saturation_curve = {"grp_values": curve_grps, "saturated_values": curve_sat}

    reach_curve: list[ReachDataPoint] = []
    cum_grp = 0.0
    for d in weekly_details:
        cum_grp += d.grp
        r = _interpolate_reach(cum_grp)
        reach_curve.append(ReachDataPoint(
            cumulative_grp=round(cum_grp, 0),
            r1=round(r["r1"], 1),
            r2=round(r["r2"], 1),
            r3=round(r["r3"], 1),
        ))

    return MediaPlanningResponse(
        channel=channel,
        mode="offline",
        decay=decay,
        alpha=alpha,
        gamma=gamma,
        max_lift=max_lift,
        weekly_details=weekly_details,
        summary=summary,
        optimal=optimal,
        saturation_curve=saturation_curve,
        reach_curve=reach_curve,
    )


@router.get("/media-planning/presets/{channel}")
def get_media_planning_presets(
    channel: str,
    mode: str = Query("offline"),
    _user: dict = Depends(get_current_user),
) -> dict:
    """Return default presets and parameters for a channel."""
    mode = (mode or "offline").lower()
    if mode == "digital":
        if channel not in ONLINE_CHANNELS:
            raise HTTPException(
                status_code=400,
                detail=f"Channel must be online: {', '.join(sorted(ONLINE_CHANNELS))}",
            )
        alpha, gamma = SATURATION_PARAMS[channel]
        return {
            "channel": channel,
            "mode": "digital",
            "preset_grps": DIGITAL_PRESETS.get(channel, []),
            "decay": ADSTOCK_PARAMS[channel],
            "alpha": alpha,
            "gamma": gamma,
            "max_lift": MAX_LIFT[channel],
            "metrics": DIGITAL_CHANNEL_METRICS.get(channel, {}),
        }
    if channel not in OFFLINE_CHANNELS:
        raise HTTPException(
            status_code=400,
            detail=f"Channel must be offline: {', '.join(sorted(OFFLINE_CHANNELS))}",
        )
    alpha, gamma = GRP_SATURATION_PARAMS[channel]
    return {
        "channel": channel,
        "mode": "offline",
        "preset_grps": GRP_PRESETS.get(channel, []),
        "decay": ADSTOCK_PARAMS[channel],
        "alpha": alpha,
        "gamma": gamma,
        "max_lift": GRP_MAX_LIFT[channel],
    }


# --------------- Save/Load ---------------


@router.post("/media-planning/save")
def save_media_plan(
    name: str = Body(..., embed=True),
    channel: str = Body(..., embed=True),
    weekly_grps: list[float] = Body(..., embed=True),
    response_snapshot: dict = Body(..., embed=True),
    campaign_id: int | None = Body(None, embed=True),
    mode: str = Body("offline", embed=True),
    user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """Save a media plan simulation (offline or digital)."""
    if not name or not name.strip():
        raise HTTPException(status_code=400, detail="Simulation name is required")
    mode = (mode or "offline").lower()
    if mode == "digital":
        if channel not in ONLINE_CHANNELS:
            raise HTTPException(status_code=400, detail=f"Invalid digital channel: {channel}")
    else:
        if channel not in OFFLINE_CHANNELS:
            raise HTTPException(status_code=400, detail=f"Invalid offline channel: {channel}")

    sim = MediaPlanSimulation(
        campaign_id=campaign_id,
        name=name.strip(),
        channel=channel,
        weekly_grps=json.dumps(weekly_grps),
        response_snapshot=json.dumps(response_snapshot),
        mode=mode,
        created_at=datetime.now(timezone.utc).isoformat(),
        created_by=user.get("username", ""),
    )
    db.add(sim)
    db.commit()
    db.refresh(sim)
    return {"id": sim.id, "name": sim.name, "channel": sim.channel, "mode": sim.mode, "created_at": sim.created_at}


@router.get("/media-planning/saved")
def list_saved_media_plans(
    campaign_id: int | None = Query(None),
    mode: str | None = Query(None),
    _user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[dict]:
    """List saved media plan simulations."""
    q = db.query(MediaPlanSimulation)
    if campaign_id is not None:
        q = q.filter(MediaPlanSimulation.campaign_id == campaign_id)
    if mode is not None:
        q = q.filter(MediaPlanSimulation.mode == mode.lower())
    sims = q.order_by(MediaPlanSimulation.created_at.desc()).all()
    return [
        {
            "id": s.id, "name": s.name, "channel": s.channel,
            "mode": s.mode or "offline", "campaign_id": s.campaign_id,
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
        "mode": sim.mode or "offline", "campaign_id": sim.campaign_id,
        "weekly_grps": json.loads(sim.weekly_grps),
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
