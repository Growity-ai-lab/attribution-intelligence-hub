"""MMM, budget simulation, reallocation and channel config endpoints."""

import json
import logging
from fastapi import APIRouter, Body, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from backend.api.deps import check_campaign_access, get_current_user
from backend.db.database import get_db
from backend.db.models import (
    CampaignModelParams,
    WeeklyData,
)
from backend.config import (
    ADSTOCK_PARAMS,
    BASELINE_LEADS,
    CHANNELS,
    DDA_BLEND_WEIGHTS,
    MARKOV_PRIOR_ALPHA,
    MAX_LIFT,
    SATURATION_PARAMS,
    UNIFIED_WEIGHTS,
)
from backend.data.schemas import (
    AdstockResult,
    ChannelDecomposition,
    SaturationResult,
)
from backend.models.mmm import (
    compute_adstock,
    compute_response,
    compute_saturation,
)
from backend.models.simulation import plan_cpl_target, simulate_budget
from backend.models.unified import suggest_reallocation
from backend.api.common import (
    _parse_float_list,
)

router = APIRouter()

logger = logging.getLogger(__name__)


@router.get("/mmm/adstock/{channel}")
def get_adstock(channel: str, spend: str = "") -> AdstockResult:
    """Compute adstock for a channel given comma-separated spend values."""
    if channel not in ADSTOCK_PARAMS:
        raise HTTPException(status_code=404, detail=f"Unknown channel: {channel}")

    decay = ADSTOCK_PARAMS[channel]
    spend_values = _parse_float_list(spend, "spend")
    adstocked = compute_adstock(spend_values, decay)

    return AdstockResult(
        channel=channel,
        decay=decay,
        raw_spend=spend_values,
        adstocked=adstocked,
    )


@router.get("/mmm/saturation/{channel}")
def get_saturation(channel: str, values: str = "") -> SaturationResult:
    """Compute saturation curve for a channel."""
    if channel not in SATURATION_PARAMS:
        raise HTTPException(status_code=404, detail=f"Unknown channel: {channel}")

    alpha, gamma = SATURATION_PARAMS[channel]
    input_values = _parse_float_list(values, "values")
    saturated = [compute_saturation(v, alpha, gamma) for v in input_values]

    return SaturationResult(
        channel=channel,
        alpha=alpha,
        gamma=gamma,
        input_values=input_values,
        saturated_values=saturated,
    )


@router.get("/mmm/decomposition")
def get_decomposition(
    spend: str = "",
    campaign_id: int | None = Query(None),
    with_ci: bool = Query(False),
    _user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[ChannelDecomposition]:
    """Compute channel decomposition given spend per channel.

    Expects spend as: meta:2600000,google:300000,...

    If campaign_id is provided and a fit exists, uses fitted per-campaign
    parameters. Otherwise falls back to config defaults.
    If with_ci=true and a fit with residuals exists, also returns 95% CI
    via parametric bootstrap (200 iterations).
    """
    channel_spend: dict[str, float] = {}
    if spend:
        for pair in spend.split(","):
            parts = pair.strip().split(":")
            if len(parts) == 2:
                ch_name = parts[0].strip()
                if ch_name not in ADSTOCK_PARAMS:
                    raise HTTPException(
                        status_code=400,
                        detail=f"Unknown channel: '{ch_name}'. Valid: {', '.join(CHANNELS)}",
                    )
                try:
                    channel_spend[ch_name] = float(parts[1])
                except ValueError:
                    raise HTTPException(
                        status_code=400,
                        detail=f"Invalid spend value for {ch_name}",
                    )

    # Resolve params: fitted (per campaign) or config defaults
    fitted = None
    if campaign_id is not None:
        check_campaign_access(db, campaign_id, _user)
        from backend.models.mmm_fit import get_active_params
        fitted = get_active_params(db, campaign_id)

    if fitted:
        per_ch_params = fitted["params"]
        baseline = fitted["baseline"]
    else:
        per_ch_params = {
            ch: {
                "decay": ADSTOCK_PARAMS[ch],
                "alpha": SATURATION_PARAMS[ch][0],
                "gamma": SATURATION_PARAMS[ch][1],
                "max_lift": MAX_LIFT[ch],
            }
            for ch in CHANNELS
        }
        baseline = BASELINE_LEADS

    results: list[ChannelDecomposition] = []
    point_leads: dict[str, float] = {}
    for ch in CHANNELS:
        s = channel_spend.get(ch, 0.0)
        p = per_ch_params.get(ch, {
            "decay": ADSTOCK_PARAMS[ch],
            "alpha": SATURATION_PARAMS[ch][0],
            "gamma": SATURATION_PARAMS[ch][1],
            "max_lift": MAX_LIFT[ch],
        })

        adstocked = compute_adstock([s], p["decay"])
        adstocked_val = adstocked[0] if adstocked else 0.0
        sat_val = compute_saturation(adstocked_val, p["alpha"], p["gamma"])
        leads = compute_response(sat_val, baseline / len(CHANNELS), p["max_lift"])
        point_leads[ch] = leads

        results.append(
            ChannelDecomposition(
                channel=ch,
                spend=s,
                adstocked_spend=adstocked_val,
                saturated_value=sat_val,
                attributed_leads=leads,
                share=0.0,
            )
        )

    total_attributed = sum(r.attributed_leads for r in results)
    if total_attributed > 0:
        for r in results:
            r.share = r.attributed_leads / total_attributed

    # Bootstrap CI (only if explicitly requested and we have residuals)
    if with_ci and fitted and fitted.get("residuals"):
        from backend.models.uncertainty import parametric_bootstrap_decomposition
        ci = parametric_bootstrap_decomposition(
            spend_map=channel_spend,
            per_ch_params=per_ch_params,
            baseline=baseline,
            residuals=fitted["residuals"],
            n_iter=200,
            baseline_divisor=len(CHANNELS),
        )
        for r in results:
            entry = ci.get(r.channel)
            if entry is not None:
                r.lead_ci_low = entry["lead_ci_low"]
                r.lead_ci_high = entry["lead_ci_high"]
                r.share_ci_low = entry["share_ci_low"]
                r.share_ci_high = entry["share_ci_high"]

    return results


@router.post("/mmm/fit")
def fit_campaign_mmm(
    campaign_id: int = Query(...),
    _user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """Fit per-campaign MMM parameters from WeeklyData via scipy NLS.

    Persists result to CampaignModelParams; latest row is the active fit.
    Returns fit_quality (rmse, mape, r2) plus the fitted params per channel.
    """
    check_campaign_access(db, campaign_id, _user)
    from backend.models.mmm_fit import fit_and_store
    try:
        result = fit_and_store(db, campaign_id)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    return {
        "channels": result["channels"],
        "params": result["params"],
        "baseline": result["baseline"],
        "fit_quality": result["fit_quality"],
        "actual": result["actual"],
        "predicted": result["predicted"],
    }


@router.get("/mmm/fit-status")
def get_fit_status(
    campaign_id: int = Query(...),
    _user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """Check whether the campaign has an active fit and whether it's stale."""
    check_campaign_access(db, campaign_id, _user)
    from backend.models.mmm_fit import compute_data_hash
    rec = (
        db.query(CampaignModelParams)
        .filter(CampaignModelParams.campaign_id == campaign_id)
        .order_by(CampaignModelParams.created_at.desc())
        .first()
    )
    rows = db.query(WeeklyData).filter(WeeklyData.campaign_id == campaign_id).all()
    n_weeks = len({r.week for r in rows})
    n_rows = len(rows)
    if not rec:
        return {
            "has_fit": False,
            "stale": True,
            "n_rows": n_rows,
            "n_weeks": n_weeks,
            "can_fit": n_rows >= 8,
        }
    current_hash = compute_data_hash(rows) if rows else ""
    return {
        "has_fit": True,
        "fit_quality": json.loads(rec.fit_quality_json),
        "created_at": rec.created_at,
        "stale": current_hash != rec.source_data_hash,
        "source": rec.source,
        "n_rows": n_rows,
        "n_weeks": n_weeks,
        "can_fit": n_rows >= 8,
    }


@router.post("/unified/reallocation")
def get_reallocation(
    unified_report: dict[str, dict[str, float]] = Body(..., description="Unified report scores"),
    current_budgets: dict[str, float] = Body(..., description="Current budget per channel"),
    total_budget: float | None = Body(None, description="Total budget to reallocate"),
    _user: dict = Depends(get_current_user),
) -> dict:
    """Suggest budget reallocation based on unified attribution scores."""
    if not unified_report:
        raise HTTPException(status_code=422, detail="No unified report data provided")
    if not current_budgets:
        raise HTTPException(status_code=422, detail="No budget data provided")

    for ch, budget in current_budgets.items():
        if budget < 0:
            raise HTTPException(status_code=400, detail=f"Negative budget for {ch}")

    if total_budget is not None and total_budget < 0:
        raise HTTPException(status_code=400, detail="Total budget cannot be negative")

    suggestions = suggest_reallocation(unified_report, current_budgets, total_budget)
    return {
        "total_budget": total_budget if total_budget is not None else sum(current_budgets.values()),
        "suggestions": suggestions,
    }


@router.get("/config/channels")
def get_channels() -> dict:
    """Return channel configuration."""
    return {
        "channels": CHANNELS,
        "adstock_params": ADSTOCK_PARAMS,
        "saturation_params": {k: {"alpha": v[0], "gamma": v[1]} for k, v in SATURATION_PARAMS.items()},
        "max_lift": MAX_LIFT,
        "unified_weights": UNIFIED_WEIGHTS,
        "dda_blend_weights": DDA_BLEND_WEIGHTS,
        "markov_prior_alpha": MARKOV_PRIOR_ALPHA,
    }


@router.post("/simulation/budget")
def run_budget_simulation(
    payload: dict = Body(...),
    _user: dict = Depends(get_current_user),
) -> dict:
    """Simulate budget allocation using DDA attribution weights.

    Expects JSON body:
    {
      "channel_spends": {"google/cpc": 50000, ...},
      "dda_weights": {"google/cpc": 0.326, ...},
      "total_revenue": 1100000,
      "total_conversions": 571,
      "scenario_spends": {"google/cpc": 60000, ...},  // optional
      "objective": "lead" | "revenue",                // optional, default revenue
      "lead_value": 15000                              // optional, lead mode
    }
    """
    channel_spends = payload.get("channel_spends")
    dda_weights = payload.get("dda_weights")
    total_revenue = payload.get("total_revenue")
    total_conversions = payload.get("total_conversions")
    scenario_spends = payload.get("scenario_spends")
    objective = payload.get("objective", "revenue")
    lead_value = payload.get("lead_value", 0.0)

    if not channel_spends or not dda_weights:
        raise HTTPException(
            status_code=400,
            detail="channel_spends ve dda_weights zorunludur.",
        )
    if total_conversions is None:
        raise HTTPException(
            status_code=400,
            detail="total_conversions zorunludur.",
        )
    # In lead mode revenue is optional (CSV flow has no revenue)
    if objective != "lead" and total_revenue is None:
        raise HTTPException(
            status_code=400,
            detail="total_revenue ve total_conversions zorunludur.",
        )

    result = simulate_budget(
        channel_spends=channel_spends,
        dda_weights=dda_weights,
        total_revenue=float(total_revenue or 0.0),
        total_conversions=int(total_conversions),
        scenario_spends=scenario_spends,
        objective=objective,
        lead_value=float(lead_value or 0.0),
    )
    return result


@router.post("/simulation/cpl-target")
def run_cpl_target_planner(
    payload: dict = Body(...),
    _user: dict = Depends(get_current_user),
) -> dict:
    """Plan budget allocation to achieve a target CPL and lead count."""
    target_cpl = payload.get("target_cpl")
    target_leads = payload.get("target_leads")
    channel_weights = payload.get("channel_weights")
    current_spends = payload.get("current_spends", {})
    lead_value = payload.get("lead_value", 0.0)

    if not target_cpl or not target_leads:
        raise HTTPException(status_code=400, detail="target_cpl ve target_leads zorunludur.")
    if not channel_weights:
        raise HTTPException(status_code=400, detail="channel_weights zorunludur.")

    return plan_cpl_target(
        target_cpl=float(target_cpl),
        target_leads=int(target_leads),
        channel_weights=channel_weights,
        current_spends={ch: float(v) for ch, v in current_spends.items()} if current_spends else {},
        lead_value=float(lead_value or 0),
    )
