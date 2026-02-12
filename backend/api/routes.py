"""API routes for Time's Hub | Attribution Intelligence."""

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
from backend.db.models import Campaign, Client

from backend.config import (
    ADSTOCK_PARAMS,
    ALLOWED_FILE_EXTENSIONS,
    BASELINE_LEADS,
    CHANNELS,
    DDA_BLEND_WEIGHTS,
    MARKOV_PRIOR_ALPHA,
    MAX_ARRAY_SIZE,
    MAX_JOURNEY_COUNT,
    MAX_LIFT,
    MAX_UPLOAD_SIZE_BYTES,
    PRIOR_ALPHA_MAX,
    PRIOR_ALPHA_MIN,
    SAMPLE_DIR,
    SATURATION_PARAMS,
    TEMPLATE_DIR,
    UNIFIED_WEIGHTS,
)
from backend.data.loader import load_crm_touchpoints, load_weekly_csv
from backend.data.schemas import (
    AdstockResult,
    ChannelDecomposition,
    SaturationResult,
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
