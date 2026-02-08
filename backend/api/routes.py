"""API routes for Attribution Intelligence Hub."""

from io import BytesIO

from fastapi import APIRouter, Body, File, HTTPException, UploadFile

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
from backend.data.loader import load_weekly_csv
from backend.data.schemas import (
    AdstockResult,
    ChannelDecomposition,
    SaturationResult,
)
from backend.models.dda.data_prep import Journey, journey_stats
from backend.models.dda.ensemble import run_full_dda_pipeline
from backend.models.mmm import (
    compute_adstock,
    compute_response,
    compute_saturation,
)

router = APIRouter()


@router.get("/health")
def health_check() -> dict[str, str]:
    return {"status": "healthy"}


@router.post("/data/upload")
async def upload_weekly_data(file: UploadFile = File(...)) -> dict:
    """Upload weekly CSV data file."""
    if not file.filename:
        raise HTTPException(status_code=400, detail="No file provided")

    content = await file.read()
    try:
        records = load_weekly_csv(BytesIO(content))
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))

    return {
        "filename": file.filename,
        "rows": len(records),
        "weeks": list({r.week for r in records}),
        "channels": list({r.channel for r in records}),
    }


@router.get("/mmm/adstock/{channel}")
def get_adstock(channel: str, spend: str = "") -> AdstockResult:
    """Compute adstock for a channel given comma-separated spend values."""
    if channel not in ADSTOCK_PARAMS:
        raise HTTPException(status_code=404, detail=f"Unknown channel: {channel}")

    decay = ADSTOCK_PARAMS[channel]
    spend_values = [float(x) for x in spend.split(",") if x.strip()] if spend else []
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
    input_values = (
        [float(x) for x in values.split(",") if x.strip()] if values else []
    )
    saturated = [compute_saturation(v, alpha, gamma) for v in input_values]

    return SaturationResult(
        channel=channel,
        alpha=alpha,
        gamma=gamma,
        input_values=input_values,
        saturated_values=saturated,
    )


@router.get("/mmm/decomposition")
def get_decomposition(spend: str = "") -> list[ChannelDecomposition]:
    """Compute channel decomposition given spend per channel.

    Expects spend as: meta:2600000,google:300000,...
    """
    channel_spend: dict[str, float] = {}
    if spend:
        for pair in spend.split(","):
            parts = pair.strip().split(":")
            if len(parts) == 2:
                channel_spend[parts[0]] = float(parts[1])

    results: list[ChannelDecomposition] = []
    total_leads = BASELINE_LEADS

    for ch in CHANNELS:
        s = channel_spend.get(ch, 0.0)
        decay = ADSTOCK_PARAMS[ch]
        alpha, gamma = SATURATION_PARAMS[ch]
        max_lift = MAX_LIFT[ch]

        adstocked = compute_adstock([s], decay)
        adstocked_val = adstocked[0] if adstocked else 0.0
        sat_val = compute_saturation(adstocked_val, alpha, gamma)
        leads = compute_response(sat_val, BASELINE_LEADS / len(CHANNELS), max_lift)
        total_leads += leads - BASELINE_LEADS / len(CHANNELS)

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

    # Calculate shares
    total_attributed = sum(r.attributed_leads for r in results)
    if total_attributed > 0:
        for r in results:
            r.share = r.attributed_leads / total_attributed

    return results


# --------------- DDA Endpoints ---------------


@router.post("/dda/run")
def run_dda(
    journeys: list[dict] = Body(..., description="List of journey objects"),
    mmm_shares: dict[str, float] | None = Body(None, description="MMM channel shares"),
    prior_alpha: float = Body(MARKOV_PRIOR_ALPHA, description="Bayesian smoothing"),
) -> dict:
    """Run the full DDA pipeline on journey data.

    Expects a list of journey dicts: {lead_id, channels, converted, segment}
    """
    if not journeys:
        raise HTTPException(status_code=422, detail="No journey data provided")

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

    # Convert numpy values for JSON serialization
    return {
        "journey_stats": result["journey_stats"],
        "online_channels": result["online_channels"],
        "offline_channels": result["offline_channels"],
        "markov": {
            "conversion_probability": float(result["markov"]["conversion_probability"]),
            "removal_effects": {k: float(v) for k, v in result["markov"]["removal_effects"].items()},
            "attribution_weights": {k: float(v) for k, v in result["markov"]["attribution_weights"].items()},
            "prior_alpha": result["markov"]["prior_alpha"],
        },
        "shapley_dda": {k: float(v) for k, v in result["shapley_dda"].items()},
        "blended_dda_online": {k: float(v) for k, v in result["blended_dda_online"].items()},
        "cross_validation": result["cross_validation"],
        "hybrid_attribution": {k: float(v) for k, v in result["hybrid_attribution"].items()},
    }


@router.post("/dda/journey-stats")
def get_journey_stats(
    journeys: list[dict] = Body(...),
) -> dict:
    """Get summary statistics for journey data."""
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
            raise HTTPException(status_code=422, detail=f"Invalid journey: {e}")

    return journey_stats(journey_objects)


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
