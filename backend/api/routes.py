"""API routes for Time's Hub | Attribution Intelligence."""

import json
from datetime import datetime, timezone
from io import BytesIO
from pathlib import PurePosixPath

from fastapi import APIRouter, Body, Depends, File, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.orm import Session

from backend.api.deps import get_current_user
from backend.auth import authenticate_user, create_access_token
from backend.db.database import get_db
from backend.db.models import Campaign, Client, MediaPlanSimulation

from backend.config import (
    ADSTOCK_PARAMS,
    ALLOWED_FILE_EXTENSIONS,
    BASELINE_LEADS,
    CHANNELS,
    DDA_BLEND_WEIGHTS,
    GRP_MAX_LIFT,
    GRP_PRESETS,
    GRP_SATURATION_PARAMS,
    MARKOV_PRIOR_ALPHA,
    MAX_ARRAY_SIZE,
    MAX_JOURNEY_COUNT,
    MAX_LIFT,
    MAX_UPLOAD_SIZE_BYTES,
    OFFLINE_CHANNELS,
    PRIOR_ALPHA_MAX,
    PRIOR_ALPHA_MIN,
    REACH_LOOKUP,
    SAMPLE_DIR,
    SATURATION_PARAMS,
    TEMPLATE_DIR,
    UNIFIED_WEIGHTS,
)
from backend.data.loader import load_crm_touchpoints, load_weekly_csv
from backend.data.schemas import (
    AdstockResult,
    ChannelDecomposition,
    MediaPlanningRequest,
    MediaPlanningResponse,
    OptimalGRPResult,
    ReachDataPoint,
    SaturationResult,
    WeeklySimDetail,
)
from backend.models.dda.data_prep import Journey, _is_truthy, extract_journeys, journey_stats
from backend.models.dda.ensemble import run_full_dda_pipeline
from backend.models.mmm import (
    compute_adstock,
    compute_response,
    compute_saturation,
)
from backend.models.unified import compute_unified_report, suggest_reallocation

router = APIRouter()


@router.get("/health")
def health_check():
    """Health check endpoint for Render / load balancers."""
    return {"status": "ok"}


# Channels that represent conversion events, not marketing touchpoints
_CONVERSION_CHANNELS = {"form", "landing_page", "website", "app"}


# --------------- Auth ---------------


@router.post("/auth/login")
async def login(form_data: OAuth2PasswordRequestForm = Depends()) -> dict:
    """Authenticate and return a JWT access token."""
    user = authenticate_user(form_data.username, form_data.password)
    if not user:
        raise HTTPException(status_code=401, detail="Incorrect username or password")
    token = create_access_token(data={"sub": user["username"], "role": user["role"]})
    return {"access_token": token, "token_type": "bearer"}


@router.post("/auth/demo")
async def demo_login() -> dict:
    """Generate a demo access token — no credentials required."""
    token = create_access_token(data={"sub": "demo", "role": "demo"})
    return {"access_token": token, "token_type": "bearer"}


@router.get("/auth/me")
async def get_me(current_user: dict = Depends(get_current_user)) -> dict:
    """Return the current authenticated user."""
    return current_user


# --------------- Clients ---------------


@router.get("/clients")
def list_clients(
    year: int | None = Query(None),
    _user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[dict]:
    """List all clients, optionally filtered by year."""
    q = db.query(Client)
    if year is not None:
        q = q.filter(Client.year == year)
    clients = q.order_by(Client.name).all()
    return [
        {
            "id": c.id,
            "name": c.name,
            "year": c.year,
            "created_at": c.created_at,
            "campaign_count": len(c.campaigns),
        }
        for c in clients
    ]


@router.post("/clients")
def create_client(
    name: str = Body(..., embed=True),
    year: int = Body(..., embed=True),
    _user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """Create a new client."""
    if not name or not name.strip():
        raise HTTPException(status_code=400, detail="Client name is required")
    client = Client(
        name=name.strip(),
        year=year,
        created_at=datetime.now(timezone.utc).isoformat(),
    )
    db.add(client)
    db.commit()
    db.refresh(client)
    return {"id": client.id, "name": client.name, "year": client.year, "created_at": client.created_at}


@router.delete("/clients/{client_id}")
def delete_client(
    client_id: int,
    _user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """Delete a client and all its campaigns."""
    client = db.query(Client).filter(Client.id == client_id).first()
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    db.delete(client)
    db.commit()
    return {"deleted": True, "id": client_id}


# --------------- Campaigns ---------------


@router.get("/clients/{client_id}/campaigns")
def list_campaigns(
    client_id: int,
    _user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[dict]:
    """List campaigns for a client."""
    client = db.query(Client).filter(Client.id == client_id).first()
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    return [
        {
            "id": c.id,
            "client_id": c.client_id,
            "name": c.name,
            "budget": c.budget,
            "channels": c.channels.split(",") if c.channels else [],
            "status": c.status,
            "created_at": c.created_at,
        }
        for c in client.campaigns
    ]


@router.post("/clients/{client_id}/campaigns")
def create_campaign(
    client_id: int,
    name: str = Body(..., embed=True),
    budget: float = Body(0.0, embed=True),
    channels: str = Body("", embed=True),
    _user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """Create a new campaign under a client."""
    client = db.query(Client).filter(Client.id == client_id).first()
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    if not name or not name.strip():
        raise HTTPException(status_code=400, detail="Campaign name is required")
    campaign = Campaign(
        client_id=client_id,
        name=name.strip(),
        budget=budget,
        channels=channels,
        created_at=datetime.now(timezone.utc).isoformat(),
    )
    db.add(campaign)
    db.commit()
    db.refresh(campaign)
    return {
        "id": campaign.id,
        "client_id": campaign.client_id,
        "name": campaign.name,
        "budget": campaign.budget,
        "channels": campaign.channels.split(",") if campaign.channels else [],
        "status": campaign.status,
        "created_at": campaign.created_at,
    }


@router.delete("/campaigns/{campaign_id}")
def delete_campaign(
    campaign_id: int,
    _user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """Delete a campaign."""
    campaign = db.query(Campaign).filter(Campaign.id == campaign_id).first()
    if not campaign:
        raise HTTPException(status_code=404, detail="Campaign not found")
    db.delete(campaign)
    db.commit()
    return {"deleted": True, "id": campaign_id}


def _validate_file(file: UploadFile) -> None:
    """Validate uploaded file has a name and allowed extension."""
    if not file.filename:
        raise HTTPException(status_code=400, detail="No file provided")
    ext = PurePosixPath(file.filename).suffix.lower()
    if ext not in ALLOWED_FILE_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type: {ext}. Allowed: {', '.join(sorted(ALLOWED_FILE_EXTENSIONS))}",
        )


async def _read_file_content(file: UploadFile) -> bytes:
    """Read file content with size limit."""
    content = await file.read(MAX_UPLOAD_SIZE_BYTES + 1)
    if len(content) > MAX_UPLOAD_SIZE_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"File too large. Maximum: {MAX_UPLOAD_SIZE_BYTES // (1024 * 1024)} MB",
        )
    return content


def _parse_float_list(raw: str, param_name: str) -> list[float]:
    """Parse comma-separated float string with validation."""
    if not raw:
        return []
    try:
        values = [float(x) for x in raw.split(",") if x.strip()]
    except ValueError:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid {param_name}: must be comma-separated numbers",
        )
    if len(values) > MAX_ARRAY_SIZE:
        raise HTTPException(
            status_code=400,
            detail=f"Too many values ({len(values)}). Maximum: {MAX_ARRAY_SIZE}",
        )
    return values


def _compute_default_mmm_shares() -> dict[str, float]:
    """Compute MMM channel shares using default week_01 spend values."""
    default_spend = {
        "meta": 2_600_000, "google": 300_000, "tiktok": 800_000,
        "linkedin": 500_000, "dv360": 400_000, "youtube": 600_000,
        "tv_match": 0, "tv_news": 0, "radio": 0, "dooh": 150_000,
    }
    shares: dict[str, float] = {}
    for ch in CHANNELS:
        s = default_spend.get(ch, 0.0)
        decay = ADSTOCK_PARAMS[ch]
        alpha, gamma = SATURATION_PARAMS[ch]
        max_lift = MAX_LIFT[ch]
        adstocked = compute_adstock([s], decay)
        adstocked_val = adstocked[0] if adstocked else 0.0
        sat_val = compute_saturation(adstocked_val, alpha, gamma)
        shares[ch] = compute_response(sat_val, BASELINE_LEADS / len(CHANNELS), max_lift)

    total = sum(shares.values())
    if total > 0:
        shares = {ch: v / total for ch, v in shares.items()}
    return shares


def _serialize_dda_result(result: dict) -> dict:
    """Convert numpy values in DDA result to JSON-serializable types."""
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
        "cross_validation": [
            {"channel": ch, **{k: float(v) if isinstance(v, (int, float)) else v for k, v in vals.items()}}
            for ch, vals in result["cross_validation"].items()
        ],
        "hybrid_attribution": {k: float(v) for k, v in result["hybrid_attribution"].items()},
    }


def _validate_prior_alpha(prior_alpha: float) -> None:
    """Validate prior_alpha is within acceptable bounds."""
    if not (PRIOR_ALPHA_MIN <= prior_alpha <= PRIOR_ALPHA_MAX):
        raise HTTPException(
            status_code=400,
            detail=f"prior_alpha must be between {PRIOR_ALPHA_MIN} and {PRIOR_ALPHA_MAX}",
        )


def _validate_journey_count(journeys: list) -> None:
    """Validate journey list doesn't exceed maximum."""
    if len(journeys) > MAX_JOURNEY_COUNT:
        raise HTTPException(
            status_code=400,
            detail=f"Too many journeys ({len(journeys)}). Maximum: {MAX_JOURNEY_COUNT}",
        )


# --------------- Health ---------------


@router.get("/health")
def health_check() -> dict[str, str]:
    return {"status": "healthy"}


# --------------- Data Upload ---------------


@router.post("/data/upload")
async def upload_weekly_data(file: UploadFile = File(...), _user: dict = Depends(get_current_user)) -> dict:
    """Upload weekly CSV data file."""
    _validate_file(file)
    content = await _read_file_content(file)

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


# --------------- MMM Endpoints ---------------


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
def get_decomposition(spend: str = "") -> list[ChannelDecomposition]:
    """Compute channel decomposition given spend per channel.

    Expects spend as: meta:2600000,google:300000,...
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
    _user: dict = Depends(get_current_user),
) -> dict:
    """Run DDA pipeline from a CRM touchpoint CSV.

    Parses the CSV, extracts journeys (filtering conversion events),
    runs Markov+Shapley ensemble, and returns unified results.
    """
    _validate_file(file)
    _validate_prior_alpha(prior_alpha)
    content = await _read_file_content(file)

    try:
        touchpoints = load_crm_touchpoints(BytesIO(content))
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))

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

    mmm_shares = _compute_default_mmm_shares()

    result = run_full_dda_pipeline(
        journeys,
        mmm_shares,
        prior_alpha=prior_alpha,
        markov_blend=DDA_BLEND_WEIGHTS["markov"],
        shapley_blend=DDA_BLEND_WEIGHTS["shapley"],
    )

    # Build unified report
    hybrid = result["hybrid_attribution"]
    unified = compute_unified_report(
        mmm_scores=mmm_shares,
        dda_scores={k: float(v) for k, v in hybrid.items()},
    )

    serialized = _serialize_dda_result(result)
    serialized["unified_report"] = {
        ch: {k: round(float(v), 4) for k, v in scores.items()}
        for ch, scores in unified.items()
    }
    return serialized


@router.post("/dda/journey-stats")
def get_journey_stats(
    journeys: list[dict] = Body(...),
    _user: dict = Depends(get_current_user),
) -> dict:
    """Get summary statistics for journey data."""
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
            raise HTTPException(status_code=422, detail=f"Invalid journey: {e}")

    return journey_stats(journey_objects)


# --------------- Unified / Reallocation ---------------


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


# --------------- Sample Data ---------------


@router.get("/data/sample/journeys")
async def get_sample_journeys():
    """Serve the sample journeys CSV file."""
    sample_path = SAMPLE_DIR / "journeys_sample.csv"
    if not sample_path.exists():
        raise HTTPException(status_code=404, detail="Sample file not found")
    return FileResponse(sample_path, media_type="text/csv", filename="journeys_sample.csv")


@router.get("/data/sample/weekly")
async def get_sample_weekly():
    """Serve the sample weekly CSV file."""
    sample_path = SAMPLE_DIR / "week_01.csv"
    if not sample_path.exists():
        raise HTTPException(status_code=404, detail="Sample file not found")
    return FileResponse(sample_path, media_type="text/csv", filename="week_01_sample.csv")


@router.get("/data/template/weekly")
async def get_template_weekly():
    """Serve the weekly input template CSV file."""
    template_path = TEMPLATE_DIR / "weekly_input_template.csv"
    if not template_path.exists():
        raise HTTPException(status_code=404, detail="Template file not found")
    return FileResponse(template_path, media_type="text/csv", filename="weekly_input_template.csv")


@router.get("/data/template/crm")
async def get_template_crm():
    """Serve the CRM touchpoints template CSV file."""
    template_path = TEMPLATE_DIR / "crm_touchpoints_template.csv"
    if not template_path.exists():
        raise HTTPException(status_code=404, detail="Template file not found")
    return FileResponse(template_path, media_type="text/csv", filename="crm_touchpoints_template.csv")


@router.get("/data/sample/bitaksi/journeys")
async def get_bitaksi_sample_journeys():
    """Serve the BiTaksi sample journeys CSV file."""
    sample_path = SAMPLE_DIR / "bitaksi_journeys.csv"
    if not sample_path.exists():
        raise HTTPException(status_code=404, detail="Sample file not found")
    return FileResponse(sample_path, media_type="text/csv", filename="bitaksi_journeys.csv")


@router.get("/data/sample/bitaksi/weekly")
async def get_bitaksi_sample_weekly():
    """Serve the BiTaksi sample weekly CSV file."""
    sample_path = SAMPLE_DIR / "bitaksi_week_01.csv"
    if not sample_path.exists():
        raise HTTPException(status_code=404, detail="Sample file not found")
    return FileResponse(sample_path, media_type="text/csv", filename="bitaksi_week_01.csv")


# --------------- Config ---------------


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


# --------------- Media Planning ---------------


def _find_optimal_grp(alpha: float, gamma: float, max_lift: float) -> tuple[float, float]:
    """Find optimal and saturation-threshold GRP levels.

    Returns (optimal_grp, threshold_grp) where:
    - optimal: GRP where marginal gain drops below 50% of initial marginal gain
    - threshold: GRP where marginal gain drops below 10% of initial marginal gain
    """
    step = 10
    test_grps = list(range(0, 1501, step))
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
    """Generate Turkish-language GRP recommendation."""
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
    """Interpolate reach values from lookup table."""
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


@router.post("/media-planning/simulate")
def simulate_media_plan(
    request: MediaPlanningRequest,
    _user: dict = Depends(get_current_user),
) -> MediaPlanningResponse:
    """Simulate offline media plan given weekly GRP values."""
    channel = request.channel
    if channel not in OFFLINE_CHANNELS:
        raise HTTPException(
            status_code=400,
            detail=f"Channel must be offline: {', '.join(sorted(OFFLINE_CHANNELS))}",
        )

    decay = ADSTOCK_PARAMS[channel]
    alpha, gamma = GRP_SATURATION_PARAMS[channel]
    max_lift = GRP_MAX_LIFT[channel]
    baseline_per_ch = BASELINE_LEADS / len(CHANNELS)

    # 1. Adstock
    adstocked = compute_adstock(list(request.weekly_grps), decay)

    # 2. Saturation + Response per week
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

    # 3. Summary
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

    # 4. Optimal GRP
    opt_grp, sat_threshold = _find_optimal_grp(alpha, gamma, max_lift)
    recommendation = _generate_recommendation(channel, avg_grp, opt_grp, sat_threshold)
    optimal = OptimalGRPResult(
        optimal_weekly_grp=opt_grp,
        saturation_threshold_grp=sat_threshold,
        current_avg_grp=round(avg_grp, 1),
        recommendation=recommendation,
    )

    # 5. Saturation curve for chart
    max_grp_chart = max(max(request.weekly_grps, default=400) * 2, 800)
    curve_count = 50
    curve_grps = [round(i * (max_grp_chart / curve_count), 1) for i in range(curve_count + 1)]
    curve_sat = [round(compute_saturation(g, alpha, gamma), 4) for g in curve_grps]
    saturation_curve = {"grp_values": curve_grps, "saturated_values": curve_sat}

    # 6. Reach curve
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
    _user: dict = Depends(get_current_user),
) -> dict:
    """Return default GRP presets and parameters for a channel."""
    if channel not in OFFLINE_CHANNELS:
        raise HTTPException(
            status_code=400,
            detail=f"Channel must be offline: {', '.join(sorted(OFFLINE_CHANNELS))}",
        )
    alpha, gamma = GRP_SATURATION_PARAMS[channel]
    return {
        "channel": channel,
        "preset_grps": GRP_PRESETS.get(channel, []),
        "decay": ADSTOCK_PARAMS[channel],
        "alpha": alpha,
        "gamma": gamma,
        "max_lift": GRP_MAX_LIFT[channel],
    }


# --------------- Media Plan Simulations (Save/Load) ---------------


@router.post("/media-planning/save")
def save_media_plan(
    name: str = Body(..., embed=True),
    channel: str = Body(..., embed=True),
    weekly_grps: list[float] = Body(..., embed=True),
    response_snapshot: dict = Body(..., embed=True),
    campaign_id: int | None = Body(None, embed=True),
    user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """Save a media plan simulation."""
    if not name or not name.strip():
        raise HTTPException(status_code=400, detail="Simulation name is required")
    if channel not in OFFLINE_CHANNELS:
        raise HTTPException(status_code=400, detail=f"Invalid channel: {channel}")

    sim = MediaPlanSimulation(
        campaign_id=campaign_id,
        name=name.strip(),
        channel=channel,
        weekly_grps=json.dumps(weekly_grps),
        response_snapshot=json.dumps(response_snapshot),
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
            "id": s.id,
            "name": s.name,
            "channel": s.channel,
            "campaign_id": s.campaign_id,
            "created_at": s.created_at,
            "created_by": s.created_by,
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
        "id": sim.id,
        "name": sim.name,
        "channel": sim.channel,
        "campaign_id": sim.campaign_id,
        "weekly_grps": json.loads(sim.weekly_grps),
        "response_snapshot": json.loads(sim.response_snapshot),
        "created_at": sim.created_at,
        "created_by": sim.created_by,
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
