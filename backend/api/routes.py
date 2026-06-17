"""API routes for Time's Hub | Attribution Intelligence."""

import json
import time as _time
from datetime import datetime, timezone
from io import BytesIO
from pathlib import PurePosixPath

from fastapi import APIRouter, Body, Depends, File, HTTPException, Query, Request, UploadFile
from fastapi.responses import FileResponse
from fastapi.security import OAuth2PasswordRequestForm
from slowapi import Limiter
from slowapi.util import get_remote_address
from sqlalchemy.orm import Session, joinedload

from backend.api.deps import check_campaign_access, get_current_user
from backend.auth import authenticate_user, create_access_token
from backend.db.database import get_db
from backend.db.models import (
    Campaign,
    CampaignModelParams,
    Client,
    DDAResult,
    SalesStockData,
    TouchpointData,
    WeeklyData,
)

from backend.config import (
    ADSTOCK_PARAMS,
    ALLOWED_FILE_EXTENSIONS,
    BASELINE_LEADS,
    BQ_CACHE_TTL,
    CHANNELS,
    DDA_BLEND_WEIGHTS,
    MARKOV_PRIOR_ALPHA,
    MAX_ARRAY_SIZE,
    MAX_CSV_ROWS,
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
from backend.data.loader import load_crm_touchpoints, load_sales_stock_csv, load_weekly_csv
from backend.data.schemas import (
    AdstockResult,
    ChannelDecomposition,
    PeriodComparison,
    SalesStockSummary,
    SaturationResult,
    SegmentChannelScore,
)
from backend.models.dda.data_prep import Journey, _is_truthy, extract_journeys, journey_stats
from backend.models.dda.ensemble import run_full_dda_pipeline
from backend.models.mmm import (
    compute_adstock,
    compute_response,
    compute_saturation,
)
from backend.models.simulation import plan_cpl_target, simulate_budget
from backend.models.unified import suggest_reallocation
from backend.integrations.bigquery import (
    get_client as bq_get_client,
    test_connection as bq_test_connection,
    query_ga4_sessions,
    ga4_to_touchpoints,
    consolidate_channels,
    summarize_touchpoints,
    default_date_range,
)

router = APIRouter()

# In-memory BQ client cache with 1-hour TTL and bounded size.
# Credentials are NOT stored in cache — only the BQ client object.
_BQ_CACHE_MAX = 10
_bq_clients: dict[str, dict] = {}


def _bq_cache_get(key: str) -> dict | None:
    entry = _bq_clients.get(key)
    if entry and _time.monotonic() - entry.get("_ts", 0) < BQ_CACHE_TTL:
        return entry
    _bq_clients.pop(key, None)
    return None


def _bq_cache_set(key: str, value: dict) -> None:
    if len(_bq_clients) >= _BQ_CACHE_MAX and key not in _bq_clients:
        oldest = min(_bq_clients, key=lambda k: _bq_clients[k].get("_ts", 0))
        _bq_clients.pop(oldest, None)
    value["_ts"] = _time.monotonic()
    _bq_clients[key] = value


@router.get("/health")
def health_check():
    """Health check endpoint for Render / load balancers."""
    return {"status": "ok"}


# Channels that represent conversion events, not marketing touchpoints
_CONVERSION_CHANNELS = {"form", "landing_page", "website", "app"}


# --------------- Auth ---------------

_limiter = Limiter(key_func=get_remote_address)


@router.post("/auth/login")
@_limiter.limit("5/minute")
async def login(request: Request, form_data: OAuth2PasswordRequestForm = Depends()) -> dict:
    """Authenticate and return a JWT access token."""
    user = authenticate_user(form_data.username, form_data.password)
    if not user:
        raise HTTPException(status_code=401, detail="Incorrect username or password")
    token = create_access_token(data={"sub": user["username"], "role": user["role"]})
    return {"access_token": token, "token_type": "bearer"}


@router.post("/auth/demo")
@_limiter.limit("10/minute")
async def demo_login(request: Request) -> dict:
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
    q = db.query(Client).options(joinedload(Client.campaigns))
    if year is not None:
        q = q.filter(Client.year == year)
    clients = q.order_by(Client.name).all()
    return [
        {
            "id": c.id,
            "name": c.name,
            "year": c.year,
            "objective": c.objective or "lead",
            "created_at": c.created_at,
            "campaign_count": len(c.campaigns),
        }
        for c in clients
    ]


@router.post("/clients")
def create_client(
    name: str = Body(..., embed=True),
    year: int = Body(..., embed=True),
    objective: str = Body("lead", embed=True),
    _user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """Create a new client."""
    if not name or not name.strip():
        raise HTTPException(status_code=400, detail="Client name is required")
    if objective not in ("lead", "revenue"):
        raise HTTPException(status_code=400, detail="objective must be 'lead' or 'revenue'")
    client = Client(
        name=name.strip(),
        year=year,
        objective=objective,
        created_at=datetime.now(timezone.utc).isoformat(),
    )
    db.add(client)
    db.commit()
    db.refresh(client)
    return {
        "id": client.id,
        "name": client.name,
        "year": client.year,
        "objective": client.objective,
        "created_at": client.created_at,
    }


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
            "objective": c.objective or "lead",
            "lead_value": c.lead_value or 0.0,
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
    objective: str | None = Body(None, embed=True),
    lead_value: float = Body(0.0, embed=True),
    _user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """Create a new campaign under a client.

    objective defaults to the client's objective when not provided.
    """
    client = db.query(Client).filter(Client.id == client_id).first()
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    if not name or not name.strip():
        raise HTTPException(status_code=400, detail="Campaign name is required")
    resolved_objective = objective if objective is not None else (client.objective or "lead")
    if resolved_objective not in ("lead", "revenue"):
        raise HTTPException(status_code=400, detail="objective must be 'lead' or 'revenue'")
    campaign = Campaign(
        client_id=client_id,
        name=name.strip(),
        budget=budget,
        channels=channels,
        objective=resolved_objective,
        lead_value=max(0.0, lead_value),
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
        "objective": campaign.objective,
        "lead_value": campaign.lead_value,
        "created_at": campaign.created_at,
    }


@router.patch("/campaigns/{campaign_id}")
def update_campaign(
    campaign_id: int,
    name: str | None = Body(None, embed=True),
    budget: float | None = Body(None, embed=True),
    status: str | None = Body(None, embed=True),
    objective: str | None = Body(None, embed=True),
    lead_value: float | None = Body(None, embed=True),
    _user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """Update campaign fields — objective/lead_value/name/budget/status."""
    campaign = check_campaign_access(db, campaign_id, _user)
    if objective is not None:
        if objective not in ("lead", "revenue"):
            raise HTTPException(status_code=400, detail="objective must be 'lead' or 'revenue'")
        campaign.objective = objective
    if lead_value is not None:
        campaign.lead_value = max(0.0, lead_value)
    if name is not None and name.strip():
        campaign.name = name.strip()
    if budget is not None:
        if budget < 0:
            raise HTTPException(status_code=400, detail="Budget cannot be negative")
        campaign.budget = budget
    if status is not None:
        _VALID_STATUSES = {"active", "paused", "completed"}
        if status not in _VALID_STATUSES:
            raise HTTPException(status_code=400, detail=f"status must be one of: {', '.join(sorted(_VALID_STATUSES))}")
        campaign.status = status
    db.commit()
    db.refresh(campaign)
    return {
        "id": campaign.id,
        "client_id": campaign.client_id,
        "name": campaign.name,
        "budget": campaign.budget,
        "channels": campaign.channels.split(",") if campaign.channels else [],
        "status": campaign.status,
        "objective": campaign.objective,
        "lead_value": campaign.lead_value,
        "created_at": campaign.created_at,
    }


@router.delete("/campaigns/{campaign_id}")
def delete_campaign(
    campaign_id: int,
    _user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """Delete a campaign."""
    campaign = check_campaign_access(db, campaign_id, _user)
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
    """LEGACY fallback: MMM channel shares from a hardcoded week_01 spend.

    Used only when no campaign context or no real WeeklyData is available.
    Prefer _compute_mmm_shares(db, campaign_id) when campaign context exists.
    """
    default_spend = {
        "meta": 2_600_000, "google": 300_000, "tiktok": 800_000,
        "linkedin": 500_000, "dv360": 400_000, "youtube": 600_000,
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


def _compute_mmm_shares(
    db: Session, campaign_id: int | None
) -> tuple[dict[str, float], str]:
    """Compute MMM channel shares from real WeeklyData when available.

    Returns:
        (shares, source) where source is one of:
          "fitted_per_campaign"   — campaign has fit + WeeklyData
          "default_per_campaign"  — has WeeklyData, no fit yet (real spend, default params)
          "default_global"        — no campaign or no WeeklyData → legacy hardcoded
    """
    from backend.models.mmm_fit import get_active_params

    if campaign_id is None:
        return _compute_default_mmm_shares(), "default_global"

    rows = db.query(WeeklyData).filter(WeeklyData.campaign_id == campaign_id).all()
    if not rows:
        return _compute_default_mmm_shares(), "default_global"

    # Aggregate spend per channel across all weeks for this campaign
    spend_per_ch: dict[str, float] = {}
    for r in rows:
        spend_per_ch[r.channel] = spend_per_ch.get(r.channel, 0.0) + float(r.spend or 0.0)

    fitted = get_active_params(db, campaign_id)
    if fitted:
        params = fitted["params"]
        baseline = fitted["baseline"]
        source = "fitted_per_campaign"
    else:
        params = {
            ch: {
                "decay": ADSTOCK_PARAMS[ch],
                "alpha": SATURATION_PARAMS[ch][0],
                "gamma": SATURATION_PARAMS[ch][1],
                "max_lift": MAX_LIFT[ch],
            }
            for ch in CHANNELS
        }
        baseline = BASELINE_LEADS
        source = "default_per_campaign"

    shares: dict[str, float] = {}
    for ch in CHANNELS:
        s = spend_per_ch.get(ch, 0.0)
        p = params.get(
            ch,
            {
                "decay": ADSTOCK_PARAMS.get(ch, 0.3),
                "alpha": SATURATION_PARAMS.get(ch, (1e6, 1.0))[0],
                "gamma": SATURATION_PARAMS.get(ch, (1e6, 1.0))[1],
                "max_lift": MAX_LIFT.get(ch, 200.0),
            },
        )
        adstocked = compute_adstock([s], p["decay"])
        adstocked_val = adstocked[0] if adstocked else 0.0
        sat_val = compute_saturation(adstocked_val, p["alpha"], p["gamma"])
        shares[ch] = compute_response(
            sat_val, baseline / len(CHANNELS), p["max_lift"]
        )

    total = sum(shares.values())
    if total > 0:
        shares = {ch: v / total for ch, v in shares.items()}
    return shares, source


def _serialize_dda_result(result: dict) -> dict:
    """Convert numpy values in DDA result to JSON-serializable types."""
    return {
        "journey_stats": result["journey_stats"],
        "top_paths": [
            {
                "path": p["path"],
                "count": p.get("total", p.get("count", 0)),
                "conversion_rate": p.get("rate", p.get("conversion_rate", 0.0)),
                "conversions": p.get("conversions", 0),
            }
            for p in result.get("top_paths", [])
        ],
        "online_channels": result["online_channels"],
        "offline_channels": result["offline_channels"],
        "markov": {
            "conversion_probability": float(result["markov"]["conversion_probability"]),
            "removal_effects": {k: float(v) for k, v in result["markov"]["removal_effects"].items()},
            "attribution_weights": {k: float(v) for k, v in result["markov"]["attribution_weights"].items()},
            "prior_alpha": result["markov"]["prior_alpha"],
            "warnings": result["markov"].get("warnings", []),
        },
        "shapley_dda": {k: float(v) for k, v in result["shapley_dda"].items()},
        "blended_dda_online": {k: float(v) for k, v in result["blended_dda_online"].items()},
        "cross_validation": [
            {"channel": ch, **{k: float(v) if isinstance(v, (int, float)) else v for k, v in vals.items()}}
            for ch, vals in result["cross_validation"].items()
        ],
        "hybrid_attribution": {k: float(v) for k, v in result["hybrid_attribution"].items()},
        "assist_report": result.get("assist_report", []),
        "insights": result.get("insights", []),
    }


def _dda_only_unified_report(hybrid: dict[str, float]) -> dict[str, dict]:
    """Build a DDA-only unified report.

    MMM is not a fitted model without sufficient time-series data and
    incrementality has no real signal, so DDA (Markov + Shapley on real
    journeys) is the sole attribution source. The report keeps the same
    shape as the legacy unified report (dda_score + unified_score) so the
    frontend contract is unchanged.
    """
    return {
        ch: {
            "dda_score": round(float(w), 4),
            "unified_score": round(float(w), 4),
        }
        for ch, w in hybrid.items()
    }


def _persist_dda_result(
    db: Session,
    campaign_id: int | None,
    serialized: dict,
    created_by: str,
    data_source: str = "csv",
    start_date: str = "",
    end_date: str = "",
) -> None:
    """Store a DDA run so it can later serve as a media-planning benchmark.

    Only persists when a campaign_id is given (the same gate as TouchpointData).
    The latest row per campaign is treated as the active benchmark.
    """
    if campaign_id is None:
        return

    snapshot = {
        "journey_stats": serialized.get("journey_stats", {}),
        "hybrid_attribution": serialized.get("hybrid_attribution", {}),
        "markov": serialized.get("markov", {}),
        "shapley_dda": serialized.get("shapley_dda", {}),
        "assist_report": serialized.get("assist_report", []),
        "online_channels": serialized.get("online_channels", []),
        "channel_summary": serialized.get("channel_summary", {}),
        "bq_summary": serialized.get("bq_summary", {}),
        "insights": serialized.get("insights", []),
        "top_paths": serialized.get("top_paths", []),
    }
    db.add(DDAResult(
        campaign_id=campaign_id,
        run_date=datetime.now(timezone.utc).isoformat(),
        data_source=data_source,
        start_date=start_date or "",
        end_date=end_date or "",
        result_json=json.dumps(snapshot),
        created_by=created_by,
    ))
    db.commit()


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


# --------------- Demo Sandbox ---------------


def _ensure_demo_sandbox_campaign(db: Session, source_campaign_id: int) -> int:
    """For demo users, redirect uploads to a "Demo Sandbox" client/campaign
    so the seed data (Petrol Ofisi, etc.) is never overwritten.

    Creates the sandbox client/campaign on first use, returns its campaign_id.
    """
    source = db.query(Campaign).filter(Campaign.id == source_campaign_id).first()
    if source is None:
        return source_campaign_id

    src_client = db.query(Client).filter(Client.id == source.client_id).first()
    year = src_client.year if src_client else 2026

    sandbox_client = (
        db.query(Client)
        .filter(Client.name == "Demo Sandbox", Client.year == year)
        .first()
    )
    if sandbox_client is None:
        sandbox_client = Client(
            name="Demo Sandbox",
            year=year,
            created_at=datetime.now(timezone.utc).isoformat(),
        )
        db.add(sandbox_client)
        db.flush()

    sandbox_camp = (
        db.query(Campaign)
        .filter(
            Campaign.client_id == sandbox_client.id,
            Campaign.name == source.name,
        )
        .first()
    )
    if sandbox_camp is None:
        sandbox_camp = Campaign(
            client_id=sandbox_client.id,
            name=source.name,
            budget=source.budget or 0.0,
            channels=source.channels or "",
            created_at=datetime.now(timezone.utc).isoformat(),
        )
        db.add(sandbox_camp)
        db.commit()
        db.refresh(sandbox_camp)

    return sandbox_camp.id


# --------------- Data Upload ---------------


@router.post("/data/upload")
async def upload_weekly_data(
    file: UploadFile = File(...),
    campaign_id: int | None = Query(None),
    _user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """Upload weekly CSV data file. Persists to DB if campaign_id provided.

    Re-upload semantics: rows for the same (campaign_id, week) are replaced.
    """
    _validate_file(file)
    content = await _read_file_content(file)

    try:
        records, truncated = load_weekly_csv(BytesIO(content))
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))

    persisted = False
    target_campaign_id = campaign_id
    if campaign_id is not None:
        check_campaign_access(db, campaign_id, _user)
        if _user.get("role") == "demo":
            target_campaign_id = _ensure_demo_sandbox_campaign(db, campaign_id)

        weeks_in_upload = list({r.week for r in records})
        if weeks_in_upload:
            db.query(WeeklyData).filter(
                WeeklyData.campaign_id == target_campaign_id,
                WeeklyData.week.in_(weeks_in_upload),
            ).delete(synchronize_session=False)

        for rec in records:
            db.add(WeeklyData(
                campaign_id=target_campaign_id,
                week=rec.week,
                channel=rec.channel,
                spend=rec.spend,
                impressions=rec.impressions,
                clicks=rec.clicks,
                leads=rec.leads,
                segment=getattr(rec, "segment", "") or "",
            ))
        db.commit()
        persisted = True

    resp = {
        "filename": file.filename,
        "rows": len(records),
        "weeks": list({r.week for r in records}),
        "channels": list({r.channel for r in records}),
        "persisted": persisted,
        "campaign_id": target_campaign_id,
        "redirected_to_sandbox": persisted and target_campaign_id != campaign_id,
    }
    if truncated:
        resp["warning"] = f"Dosya {MAX_CSV_ROWS} satır sınırında kesildi. Fazla satırlar yüklenmedi."
    return resp


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


# --------------- BigQuery Integration ---------------


@router.post("/integrations/bigquery/connect")
async def bq_connect(
    credentials: UploadFile = File(...),
    project: str = Query(...),
    dataset: str = Query(...),
    _user: dict = Depends(get_current_user),
) -> dict:
    """Upload service account JSON and test BQ connection.

    Returns connection status, available date range, table count.
    Credentials are held in memory only (not persisted to disk).
    """
    if credentials.size and credentials.size > 1_000_000:
        raise HTTPException(status_code=400, detail="Credentials file too large")
    raw = await credentials.read()
    try:
        creds_str = raw.decode("utf-8")
        client = bq_get_client(creds_str)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid credentials: {e}")

    try:
        info = bq_test_connection(client, project, dataset)
    except Exception as e:
        msg = str(e)
        if "403" in msg or "Access Denied" in msg or "Permission" in msg.lower():
            sa_email = ""
            try:
                import json
                sa_info = json.loads(creds_str)
                sa_email = sa_info.get("client_email", "")
            except Exception:
                pass
            hint = (
                f"Bu service account'ın '{project}.{dataset}' dataset'ine erişim yetkisi yok. "
                f"Google Cloud Console → BigQuery → {dataset} → Paylaşım (Sharing) bölümünden "
            )
            if sa_email:
                hint += f"'{sa_email}' adresine "
            else:
                hint += "service account'a "
            hint += "'BigQuery Veri Görüntüleyici' (BigQuery Data Viewer) rolünü ekleyin."
            raise HTTPException(status_code=403, detail=hint)
        elif "404" in msg or "not exist" in msg.lower() or "not found" in msg.lower():
            raise HTTPException(
                status_code=404,
                detail=(
                    f"'{project}.{dataset}' dataset'i bulunamadı. "
                    f"Project ID ve Dataset adını kontrol edin. "
                    f"GA4 export dataset'leri genellikle 'analytics_' ile başlar."
                ),
            )
        raise HTTPException(status_code=400, detail=f"BigQuery bağlantı hatası: {e}")
    if not info["ok"]:
        raise HTTPException(status_code=400, detail=info.get("error", "Connection failed"))

    cache_key = f"{project}:{dataset}"
    _bq_cache_set(cache_key, {"client": client})

    return info


@router.post("/integrations/bigquery/preview")
def bq_preview(
    project: str = Query(...),
    dataset: str = Query(...),
    start_date: str = Query(None),
    end_date: str = Query(None),
    conversion_events: str = Query("purchase"),
    _user: dict = Depends(get_current_user),
) -> dict:
    """Pull GA4 sessions from BQ and return summary (without running DDA).

    Use this to preview data before committing to a full DDA run.
    """
    cache_key = f"{project}:{dataset}"
    cached = _bq_cache_get(cache_key)
    if not cached:
        raise HTTPException(status_code=400, detail="BigQuery not connected. Call /connect first.")

    if not start_date or not end_date:
        start_date, end_date = default_date_range(6)

    conv_list = [e.strip() for e in conversion_events.split(",") if e.strip()]
    client = cached["client"]

    try:
        df = query_ga4_sessions(client, project, dataset, start_date, end_date, conv_list, row_limit=100_000)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"BigQuery query failed: {e}")

    touchpoints = ga4_to_touchpoints(df, conv_list)
    summary = summarize_touchpoints(touchpoints)
    summary["start_date"] = start_date
    summary["end_date"] = end_date
    summary["conversion_events"] = conv_list
    summary["row_limit_applied"] = len(df) >= 100_000
    return summary


@router.post("/dda/run-from-bigquery")
def run_dda_from_bigquery(
    project: str = Query(...),
    dataset: str = Query(...),
    start_date: str = Query(None),
    end_date: str = Query(None),
    conversion_events: str = Query("purchase"),
    prior_alpha: float = Query(0.5),
    campaign_id: int | None = Query(None),
    _user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """Run full DDA pipeline from BigQuery GA4 export.

    1. Pull session-level touchpoints from BQ
    2. Extract journeys (filter conversion-event channels)
    3. Run Markov + Shapley ensemble (DDA-only attribution)
    """
    _validate_prior_alpha(prior_alpha)

    cache_key = f"{project}:{dataset}"
    cached = _bq_cache_get(cache_key)
    if not cached:
        raise HTTPException(status_code=400, detail="BigQuery not connected. Call /connect first.")

    if not start_date or not end_date:
        start_date, end_date = default_date_range(6)

    conv_list = [e.strip() for e in conversion_events.split(",") if e.strip()]
    client = cached["client"]

    # Step 1: Pull from BQ
    try:
        df = query_ga4_sessions(client, project, dataset, start_date, end_date, conv_list)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"BigQuery query failed: {e}")

    if df.empty:
        raise HTTPException(status_code=422, detail="No events found in the specified date range.")

    # Step 2: Convert to touchpoints, consolidate low-freq channels
    touchpoints = ga4_to_touchpoints(df, conv_list)
    touchpoints = consolidate_channels(touchpoints, max_channels=12)
    summary = summarize_touchpoints(touchpoints)

    if summary["conversions"] == 0:
        raise HTTPException(
            status_code=422,
            detail=f"No conversion events ({', '.join(conv_list)}) found. Check event names.",
        )

    # Step 3: Persist touchpoints if campaign_id given
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
                lead_id=tp["lead_id"],
                timestamp=tp["timestamp"],
                channel=tp["channel"],
                touchpoint_type=tp["touchpoint_type"],
                campaign=tp["campaign"],
                segment=tp["segment"],
            ))
        db.commit()
        persisted = True

    # Step 4: Extract journeys (same filtering as CSV path)
    lead_converted: dict[str, bool] = {}
    for tp in touchpoints:
        if tp.get("converted"):
            lead_converted[tp["lead_id"]] = True

    filtered = [
        tp for tp in touchpoints
        if tp["channel"] not in _CONVERSION_CHANNELS
    ]
    for tp in filtered:
        tp["converted"] = lead_converted.get(tp["lead_id"], False)

    journeys = extract_journeys(filtered)
    if not journeys:
        raise HTTPException(status_code=422, detail="No valid journeys extracted from BQ data.")

    _validate_journey_count(journeys)

    # Step 5: Run DDA (digital-only; GA4 journeys carry no offline channels)
    result = run_full_dda_pipeline(
        journeys,
        prior_alpha=prior_alpha,
        markov_blend=DDA_BLEND_WEIGHTS["markov"],
        shapley_blend=DDA_BLEND_WEIGHTS["shapley"],
    )

    # Step 6: DDA-only attribution (MMM/incrementality removed)
    serialized = _serialize_dda_result(result)
    serialized["unified_report"] = _dda_only_unified_report(result["hybrid_attribution"])
    serialized["bq_summary"] = summary
    serialized["persisted"] = persisted
    serialized["campaign_id"] = target_campaign_id
    serialized["redirected_to_sandbox"] = persisted and target_campaign_id != campaign_id
    serialized["data_source"] = "bigquery"
    serialized["date_range"] = {"start": start_date, "end": end_date}

    # Persist DDA result as a media-planning benchmark (gated on campaign_id)
    serialized_with_summary = {**serialized, "channel_summary": summary.get("channels", {})}
    _persist_dda_result(
        db, target_campaign_id, serialized_with_summary,
        created_by=_user.get("username", ""), data_source="bigquery",
        start_date=start_date, end_date=end_date,
    )
    return serialized


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


# --------------- Benchmarks (Media-Planning Validation) ---------------




# Benchmark and export endpoints moved to routes_benchmarks.py and routes_export.py


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


@router.get("/data/template/ga4")
async def get_template_ga4():
    """Serve the GA4 touchpoints template CSV file."""
    template_path = TEMPLATE_DIR / "ga4_touchpoints_template.csv"
    if not template_path.exists():
        raise HTTPException(status_code=404, detail="Template file not found")
    return FileResponse(template_path, media_type="text/csv", filename="ga4_touchpoints_template.csv")


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


# Media planning endpoints moved to routes_media.py


# Benchmark and export endpoints moved to routes_benchmarks.py and routes_export.py

# ── Budget Simulation (DDA-based) ─────────────────────────


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


# ── Sales & Stock Endpoints ──────────────────────────────


@router.post("/sales-stock/upload")
async def upload_sales_stock(
    file: UploadFile = File(...),
    campaign_id: int | None = Query(None),
    _user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """Upload sales/stock CSV data."""
    _validate_file(file)
    content = await _read_file_content(file)

    try:
        records, truncated = load_sales_stock_csv(BytesIO(content))
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))

    target_campaign_id = campaign_id
    if campaign_id is not None:
        check_campaign_access(db, campaign_id, _user)
        if _user.get("role") == "demo":
            target_campaign_id = _ensure_demo_sandbox_campaign(db, campaign_id)

    # Persist to DB
    for rec in records:
        db.add(SalesStockData(
            campaign_id=target_campaign_id,
            week=rec.week,
            channel=rec.channel,
            product=rec.product,
            region=rec.region,
            sales_units=rec.sales_units,
            sales_revenue=rec.sales_revenue,
            stock_units=rec.stock_units,
            stock_value=rec.stock_value,
            returns=rec.returns,
            new_customers=rec.new_customers,
            repeat_customers=rec.repeat_customers,
        ))
    db.commit()

    weeks = sorted({r.week for r in records})
    products = sorted({r.product for r in records if r.product})
    regions = sorted({r.region for r in records if r.region})

    resp = {
        "filename": file.filename,
        "rows": len(records),
        "weeks": weeks,
        "products": products,
        "regions": regions,
        "campaign_id": target_campaign_id,
        "redirected_to_sandbox": campaign_id is not None and target_campaign_id != campaign_id,
    }
    if truncated:
        resp["warning"] = f"Dosya {MAX_CSV_ROWS} satır sınırında kesildi. Fazla satırlar yüklenmedi."
    return resp


@router.get("/sales-stock/summary")
def get_sales_stock_summary(
    campaign_id: int | None = Query(None),
    _user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """Get aggregated sales/stock summary."""
    if campaign_id is not None:
        check_campaign_access(db, campaign_id, _user)
    query = db.query(SalesStockData)
    if campaign_id:
        query = query.filter(SalesStockData.campaign_id == campaign_id)
    rows = query.all()

    if not rows:
        raise HTTPException(status_code=404, detail="No sales/stock data found")

    total_revenue = sum(r.sales_revenue for r in rows)
    total_units = sum(r.sales_units for r in rows)
    total_stock = sum(r.stock_units for r in rows)
    total_returns = sum(r.returns for r in rows)
    total_new = sum(r.new_customers for r in rows)
    total_repeat = sum(r.repeat_customers for r in rows)
    weeks = sorted({r.week for r in rows})

    return SalesStockSummary(
        total_weeks=len(weeks),
        total_revenue=total_revenue,
        total_units_sold=total_units,
        total_stock_units=total_stock,
        avg_weekly_revenue=total_revenue / len(weeks) if weeks else 0,
        total_returns=total_returns,
        return_rate=total_returns / total_units if total_units > 0 else 0,
        total_new_customers=total_new,
        total_repeat_customers=total_repeat,
        products=sorted({r.product for r in rows if r.product}),
        regions=sorted({r.region for r in rows if r.region}),
    ).model_dump()


@router.get("/sales-stock/weekly")
def get_sales_stock_weekly(
    campaign_id: int | None = Query(None),
    _user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[dict]:
    """Get weekly sales/stock breakdown."""
    if campaign_id is not None:
        check_campaign_access(db, campaign_id, _user)
    query = db.query(SalesStockData)
    if campaign_id:
        query = query.filter(SalesStockData.campaign_id == campaign_id)
    rows = query.order_by(SalesStockData.week).all()

    weekly: dict[str, dict] = {}
    for r in rows:
        if r.week not in weekly:
            weekly[r.week] = {
                "week": r.week, "sales_units": 0, "sales_revenue": 0.0,
                "stock_units": 0, "returns": 0, "new_customers": 0, "repeat_customers": 0,
            }
        w = weekly[r.week]
        w["sales_units"] += r.sales_units
        w["sales_revenue"] += r.sales_revenue
        w["stock_units"] += r.stock_units
        w["returns"] += r.returns
        w["new_customers"] += r.new_customers
        w["repeat_customers"] += r.repeat_customers

    return list(weekly.values())


@router.get("/data/template/sales-stock")
def download_sales_stock_template() -> FileResponse:
    """Download sales/stock CSV template."""
    path = TEMPLATE_DIR / "sales_stock_template.csv"
    if not path.exists():
        raise HTTPException(status_code=404, detail="Template not found")
    return FileResponse(path, filename="sales_stock_template.csv", media_type="text/csv")


# ── Segment Analytics Endpoints ──────────────────────────


@router.get("/segments/decomposition")
def segment_decomposition(
    campaign_id: int | None = Query(None),
    _user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[dict]:
    """Segment x Channel decomposition with saturation alerts.

    Combines weekly spend/lead data with sales data to produce
    per-segment, per-channel scoring including cost metrics and
    saturation warnings.
    """
    if campaign_id is not None:
        check_campaign_access(db, campaign_id, _user)
    from backend.db.models import WeeklyData

    # Fetch weekly data
    wq = db.query(WeeklyData)
    if campaign_id:
        wq = wq.filter(WeeklyData.campaign_id == campaign_id)
    weekly_rows = wq.all()

    # Fetch sales data
    sq = db.query(SalesStockData)
    if campaign_id:
        sq = sq.filter(SalesStockData.campaign_id == campaign_id)
    sales_rows = sq.all()

    # Aggregate weekly by segment+channel
    agg: dict[tuple[str, str], dict] = {}
    for r in weekly_rows:
        seg = r.segment or "ALL"
        key = (seg, r.channel)
        if key not in agg:
            agg[key] = {"spend": 0.0, "leads": 0, "weeks": set()}
        agg[key]["spend"] += r.spend
        agg[key]["leads"] += r.leads
        agg[key]["weeks"].add(r.week)

    # Aggregate sales by segment+channel
    sales_agg: dict[tuple[str, str], dict] = {}
    for r in sales_rows:
        seg = r.segment or "ALL"
        ch = r.channel or "direct"
        key = (seg, ch)
        if key not in sales_agg:
            sales_agg[key] = {"sales_units": 0, "sales_revenue": 0.0}
        sales_agg[key]["sales_units"] += r.sales_units
        sales_agg[key]["sales_revenue"] += r.sales_revenue

    # Build segment channel scores
    results = []
    for (seg, ch), data in agg.items():
        spend = data["spend"]
        leads = data["leads"]
        sales = sales_agg.get((seg, ch), {"sales_units": 0, "sales_revenue": 0.0})

        cpl = spend / leads if leads > 0 else 0.0
        cps = spend / sales["sales_units"] if sales["sales_units"] > 0 else 0.0

        # Calculate saturation level using Hill function
        sat_pct = 0.0
        sat_alert = ""
        if ch in SATURATION_PARAMS and spend > 0:
            alpha, gamma = SATURATION_PARAMS[ch]
            n_weeks = len(data["weeks"]) or 1
            avg_weekly = spend / n_weeks
            decay = ADSTOCK_PARAMS.get(ch, 0.0)
            adstocked = compute_adstock([avg_weekly] * n_weeks, decay)
            sat_pct = compute_saturation(adstocked[-1], alpha, gamma) * 100

            if sat_pct >= 85:
                sat_alert = "saturated"
            elif sat_pct >= 70:
                sat_alert = "near_saturation"

        results.append(SegmentChannelScore(
            segment=seg,
            channel=ch,
            spend=round(spend, 2),
            leads=leads,
            sales_units=sales["sales_units"],
            sales_revenue=round(sales["sales_revenue"], 2),
            cost_per_lead=round(cpl, 2),
            cost_per_sale=round(cps, 2),
            saturation_pct=round(sat_pct, 1),
            saturation_alert=sat_alert,
        ).model_dump())

    # Sort: saturated channels first, then by spend desc
    results.sort(key=lambda x: (-1 if x["saturation_alert"] == "saturated" else 0, -x["spend"]))
    return results


@router.get("/segments/period-comparison")
def period_comparison(
    period_a: str = Query(..., description="First period, e.g. 2026-W01:2026-W06"),
    period_b: str = Query(..., description="Second period, e.g. 2026-W07:2026-W12"),
    segment: str | None = Query(None),
    campaign_id: int | None = Query(None),
    _user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[dict]:
    """Compare two periods for segment+channel performance.

    Produces cost-per-lead and cost-per-sale changes with recommendations.
    Period format: 'YYYY-Www:YYYY-Www' (start:end).
    """
    if campaign_id is not None:
        check_campaign_access(db, campaign_id, _user)
    from backend.db.models import WeeklyData

    def parse_period(p: str) -> tuple[str, str]:
        parts = p.split(":")
        if len(parts) != 2:
            raise HTTPException(status_code=400, detail=f"Invalid period format: {p}. Use YYYY-Www:YYYY-Www")
        return parts[0].strip(), parts[1].strip()

    start_a, end_a = parse_period(period_a)
    start_b, end_b = parse_period(period_b)

    def query_period(start: str, end: str) -> list:
        q = db.query(WeeklyData).filter(WeeklyData.week >= start, WeeklyData.week <= end)
        if campaign_id:
            q = q.filter(WeeklyData.campaign_id == campaign_id)
        if segment:
            q = q.filter(WeeklyData.segment == segment)
        return q.all()

    def query_sales_period(start: str, end: str) -> list:
        q = db.query(SalesStockData).filter(SalesStockData.week >= start, SalesStockData.week <= end)
        if campaign_id:
            q = q.filter(SalesStockData.campaign_id == campaign_id)
        if segment:
            q = q.filter(SalesStockData.segment == segment)
        return q.all()

    def aggregate(rows, sales_rows):
        agg = {}
        for r in rows:
            seg = r.segment or "ALL"
            key = (seg, r.channel)
            if key not in agg:
                agg[key] = {"spend": 0.0, "leads": 0}
            agg[key]["spend"] += r.spend
            agg[key]["leads"] += r.leads

        for r in sales_rows:
            seg = r.segment or "ALL"
            ch = r.channel or "direct"
            key = (seg, ch)
            if key not in agg:
                agg[key] = {"spend": 0.0, "leads": 0}
            agg[key].setdefault("sales", 0)
            agg[key]["sales"] += r.sales_units
        return agg

    rows_a = query_period(start_a, end_a)
    rows_b = query_period(start_b, end_b)
    sales_a = query_sales_period(start_a, end_a)
    sales_b = query_sales_period(start_b, end_b)

    agg_a = aggregate(rows_a, sales_a)
    agg_b = aggregate(rows_b, sales_b)

    all_keys = set(agg_a.keys()) | set(agg_b.keys())
    results = []

    for seg, ch in all_keys:
        a = agg_a.get((seg, ch), {"spend": 0, "leads": 0, "sales": 0})
        b = agg_b.get((seg, ch), {"spend": 0, "leads": 0, "sales": 0})

        cpl_a = a["spend"] / a["leads"] if a["leads"] > 0 else 0
        cpl_b = b["spend"] / b["leads"] if b["leads"] > 0 else 0
        cpl_change = ((cpl_b - cpl_a) / cpl_a * 100) if cpl_a > 0 else 0

        # Auto-recommendation
        rec = ""
        if cpl_b > 0 and cpl_a > 0:
            if cpl_change < -10:
                rec = f"CPL {abs(cpl_change):.0f}% düştü — bu kanala bütçe artır"
            elif cpl_change > 20:
                rec = f"CPL {cpl_change:.0f}% arttı — doygunluk kontrolü yap, bütçe kaydır"
            else:
                rec = "Stabil performans"

        results.append(PeriodComparison(
            segment=seg,
            channel=ch,
            period_a=period_a,
            period_b=period_b,
            spend_a=round(a["spend"], 2),
            spend_b=round(b["spend"], 2),
            leads_a=a["leads"],
            leads_b=b["leads"],
            sales_a=a.get("sales", 0),
            sales_b=b.get("sales", 0),
            cpl_a=round(cpl_a, 2),
            cpl_b=round(cpl_b, 2),
            cpl_change_pct=round(cpl_change, 1),
            recommendation=rec,
        ).model_dump())

    results.sort(key=lambda x: x["cpl_change_pct"])
    return results
