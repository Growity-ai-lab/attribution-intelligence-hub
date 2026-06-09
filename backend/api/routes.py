"""API routes for Time's Hub | Attribution Intelligence."""

import json
from datetime import datetime, timezone
from io import BytesIO
from pathlib import PurePosixPath

from fastapi import APIRouter, Body, Depends, File, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse
from starlette.responses import StreamingResponse
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.orm import Session

from backend.api.deps import get_current_user
from backend.auth import authenticate_user, create_access_token
from backend.db.database import get_db
from backend.db.models import (
    Campaign,
    CampaignModelParams,
    Client,
    DDAResult,
    MediaPlanSimulation,
    SalesStockData,
    TouchpointData,
    WeeklyData,
)

from backend.config import (
    ADSTOCK_PARAMS,
    ALLOWED_FILE_EXTENSIONS,
    BASELINE_LEADS,
    CHANNELS,
    DDA_BLEND_WEIGHTS,
    DIGITAL_CHANNEL_METRICS,
    DIGITAL_PRESETS,
    GRP_MAX_LIFT,
    GRP_PRESETS,
    GRP_SATURATION_PARAMS,
    MARKOV_PRIOR_ALPHA,
    MAX_ARRAY_SIZE,
    MAX_JOURNEY_COUNT,
    MAX_LIFT,
    MAX_UPLOAD_SIZE_BYTES,
    OFFLINE_CHANNELS,
    ONLINE_CHANNELS,
    PRIOR_ALPHA_MAX,
    PRIOR_ALPHA_MIN,
    REACH_LOOKUP,
    SAMPLE_DIR,
    SATURATION_PARAMS,
    TEMPLATE_DIR,
    UNIFIED_WEIGHTS,
)
from backend.data.loader import load_crm_touchpoints, load_sales_stock_csv, load_weekly_csv
from backend.data.schemas import (
    AdstockResult,
    ChannelDecomposition,
    FunnelDataPoint,
    MediaPlanningRequest,
    MediaPlanningResponse,
    OptimalGRPResult,
    ReachDataPoint,
    PeriodComparison,
    SalesStockSummary,
    SaturationResult,
    SegmentChannelScore,
    WeeklySimDetail,
)
from backend.models.dda.data_prep import Journey, _is_truthy, extract_journeys, journey_stats
from backend.models.dda.ensemble import run_full_dda_pipeline
from backend.models.dda.insights import compare_snapshots
from backend.export.report_builder import build_dda_report, workbook_to_bytes
from backend.models.mmm import (
    compute_adstock,
    compute_response,
    compute_saturation,
)
from backend.models.simulation import simulate_budget
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

# In-memory BQ client cache with 1-hour TTL (per-process; lost on restart)
import time as _time

_BQ_CACHE_TTL = 3600  # seconds
_bq_clients: dict[str, dict] = {}


def _bq_cache_get(key: str) -> dict | None:
    entry = _bq_clients.get(key)
    if entry and _time.monotonic() - entry.get("_ts", 0) < _BQ_CACHE_TTL:
        return entry
    _bq_clients.pop(key, None)
    return None


def _bq_cache_set(key: str, value: dict) -> None:
    value["_ts"] = _time.monotonic()
    _bq_clients[key] = value


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
    """LEGACY fallback: MMM channel shares from a hardcoded week_01 spend.

    Used only when no campaign context or no real WeeklyData is available.
    Prefer _compute_mmm_shares(db, campaign_id) when campaign context exists.
    """
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


# --------------- Health ---------------


@router.get("/health")
def health_check() -> dict[str, str]:
    return {"status": "healthy"}


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
        records = load_weekly_csv(BytesIO(content))
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))

    persisted = False
    target_campaign_id = campaign_id
    if campaign_id is not None:
        # Demo role: redirect to a sandbox campaign so seed data isn't overwritten
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
                grp=rec.grp,
                spot_count=rec.spot_count,
                segment=getattr(rec, "segment", "") or "",
            ))
        db.commit()
        persisted = True

    return {
        "filename": file.filename,
        "rows": len(records),
        "weeks": list({r.week for r in records}),
        "channels": list({r.channel for r in records}),
        "persisted": persisted,
        "campaign_id": target_campaign_id,
        "redirected_to_sandbox": persisted and target_campaign_id != campaign_id,
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
    _user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """Run DDA pipeline from a CRM touchpoint CSV.

    Parses the CSV, persists raw touchpoints (if campaign_id provided),
    extracts journeys (filtering conversion events), runs Markov+Shapley
    ensemble, and returns unified results.

    Re-upload semantics: existing touchpoints for the campaign are replaced.
    """
    _validate_file(file)
    _validate_prior_alpha(prior_alpha)
    content = await _read_file_content(file)

    try:
        touchpoints = load_crm_touchpoints(BytesIO(content))
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))

    # Persist raw touchpoints (forensic value; conversion-event filtering is lossy)
    persisted = False
    target_campaign_id = campaign_id
    if campaign_id is not None:
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
    _bq_cache_set(cache_key, {"client": client, "creds": creds_str})

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


@router.get("/benchmarks/channel-metrics")
def get_channel_benchmarks(
    campaign_id: int = Query(...),
    _user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """Empirical per-channel benchmarks from the latest stored DDA run.

    Media planning runs on assumption-based parameters (CPM/CTR/lead_rate from
    config). This endpoint surfaces what real GA4/CRM journeys say per channel
    so plan assumptions can be validated. Returns ``available: False`` when no
    DDA run has been persisted for the campaign — the planner then stays in
    assumption mode (see frontend transparency labelling).
    """
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
    ch_summary = snapshot.get("channel_summary", {})  # BQ: channel -> touchpoint count

    # Touchpoint frequency per channel from persisted touchpoints (CSV fallback)
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


def _match_benchmark_channel(plan_channel: str, dda_channels: list[str]) -> str | None:
    """Best-effort map a media-plan channel to a DDA channel key.

    CSV journeys use clean keys ("meta"); BQ uses source/medium labels
    ("google / cpc"). Try exact match, then substring containment.
    """
    if plan_channel in dda_channels:
        return plan_channel
    pl = plan_channel.lower()
    for ch in dda_channels:
        if pl in ch.lower():
            return ch
    return None


@router.post("/benchmarks/plan-reconciliation")
def reconcile_plan(
    plan_id: int = Body(..., embed=True),
    _user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """Compare a saved media plan's assumptions against observed GA4/DDA data.

    Reads the planned channel metrics from the saved simulation snapshot and the
    actual per-channel signal from the latest stored DDA run for the same
    campaign. Per-channel attributed conversions are estimated as
    ``total_conversions * dda_weight`` (DDA shares the credit), which yields an
    empirical CPL to set against the plan's projected CPL.

    Returns ``available: False`` when no DDA benchmark exists for the campaign.
    """
    sim = db.query(MediaPlanSimulation).filter(MediaPlanSimulation.id == plan_id).first()
    if not sim:
        raise HTTPException(status_code=404, detail="Saved plan not found")

    snapshot = json.loads(sim.response_snapshot)
    summary = snapshot.get("summary", {})
    planned_spend = float(summary.get("total_spend") or summary.get("total_grp") or 0.0)
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


# --------------- Export ---------------


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

    wb = build_dda_report(snapshot, campaign_name, dda.run_date or "")
    buf = workbook_to_bytes(wb)

    filename = f"attribution_rapor_{campaign_id}_{dda.run_date[:10] if dda.run_date else 'unknown'}.xlsx"
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# --------------- Insight Trends ---------------


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
    """Find optimal and saturation-threshold input levels.

    Generic optimizer — works for both GRP-domain (offline, alpha~100s) and
    spend-domain (digital, alpha~1Ms). Test range scales with alpha.

    Returns (optimal_input, threshold_input) where:
    - optimal: input where marginal gain drops below 50% of initial marginal gain
    - threshold: input where marginal gain drops below 10% of initial marginal gain
    """
    # Scan up to 4x alpha (well past saturation knee for any reasonable gamma)
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


# --------------- Digital Planning Helpers ---------------


def _resolve_digital_metrics(channel: str, request: MediaPlanningRequest) -> dict:
    """Merge channel defaults with per-request overrides."""
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


def _compute_digital_funnel(
    weekly_spends: list[float], metrics: dict
) -> list[dict]:
    """Spend → Impressions → Clicks → Estimated Leads pipeline (per week)."""
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
    """Reach via Poisson coverage:  reach = 1 - exp(-impr/audience).
    Effective frequency capped by freq_cap.
    """
    import math
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
    """Turkish recommendation text for digital channels (spend-based)."""
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


@router.post("/media-planning/simulate")
def simulate_media_plan(
    request: MediaPlanningRequest,
    _user: dict = Depends(get_current_user),
) -> MediaPlanningResponse:
    """Simulate a media plan given weekly values.

    For mode='offline', weekly_grps carry GRP per week (TV/Radyo/DOOH).
    For mode='digital', weekly_grps carry weekly spend (TL) and a Spend →
    Impressions → Clicks → Funnel-Lead projection runs alongside the
    MMM lead estimate.
    """
    channel = request.channel
    mode = (request.mode or "offline").lower()

    if mode == "digital":
        return _simulate_digital_plan(request)

    # ----- OFFLINE PATH -----
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


def _simulate_digital_plan(request: MediaPlanningRequest) -> MediaPlanningResponse:
    """Digital media planning — spend-based MMM + funnel projection."""
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

    weekly_spends = list(request.weekly_grps)  # interpreted as spend in digital mode

    # 1. MMM pipeline (adstock → saturation → response)
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

    # 2. Funnel pipeline
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

    # 3. Summary
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
        "total_grp": round(total_spend, 0),  # field name kept for FE compat
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

    # 4. Optimal spend (reuse generic optimizer with spend-domain α)
    opt_spend, sat_threshold_spend = _find_optimal_grp(alpha, gamma, max_lift)
    recommendation = _generate_digital_recommendation(channel, avg_spend, opt_spend, sat_threshold_spend)
    optimal = OptimalGRPResult(
        optimal_weekly_grp=round(opt_spend, 0),
        saturation_threshold_grp=round(sat_threshold_spend, 0),
        current_avg_grp=round(avg_spend, 0),
        recommendation=recommendation,
    )

    # 5. Saturation curve (spend domain)
    max_spend_chart = max(max(weekly_spends, default=alpha * 2) * 1.5, alpha * 2)
    curve_count = 50
    curve_spends = [round(i * (max_spend_chart / curve_count), 0) for i in range(curve_count + 1)]
    curve_sat = [round(compute_saturation(s, alpha, gamma), 4) for s in curve_spends]
    saturation_curve = {"grp_values": curve_spends, "saturated_values": curve_sat}

    # 6. Reach curve (cumulative impressions)
    reach_curve: list[ReachDataPoint] = []
    for fp in funnel_curve:
        # reach_pct already computed; expose via r1, freq via r2 for FE
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


@router.get("/media-planning/presets/{channel}")
def get_media_planning_presets(
    channel: str,
    mode: str = Query("offline"),
    _user: dict = Depends(get_current_user),
) -> dict:
    """Return default presets and parameters for a channel.

    For mode='offline' returns GRP presets + GRP saturation params.
    For mode='digital' returns spend presets + online saturation params + funnel metrics.
    """
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
    # offline default
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


# --------------- Media Plan Simulations (Save/Load) ---------------


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
    """List saved media plan simulations. Optional ?mode=offline|digital filter."""
    q = db.query(MediaPlanSimulation)
    if campaign_id is not None:
        q = q.filter(MediaPlanSimulation.campaign_id == campaign_id)
    if mode is not None:
        q = q.filter(MediaPlanSimulation.mode == mode.lower())
    sims = q.order_by(MediaPlanSimulation.created_at.desc()).all()
    return [
        {
            "id": s.id,
            "name": s.name,
            "channel": s.channel,
            "mode": s.mode or "offline",
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
        "mode": sim.mode or "offline",
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
      "scenario_spends": {"google/cpc": 60000, ...}  // optional
    }
    """
    channel_spends = payload.get("channel_spends")
    dda_weights = payload.get("dda_weights")
    total_revenue = payload.get("total_revenue")
    total_conversions = payload.get("total_conversions")
    scenario_spends = payload.get("scenario_spends")

    if not channel_spends or not dda_weights:
        raise HTTPException(
            status_code=400,
            detail="channel_spends ve dda_weights zorunludur.",
        )
    if total_revenue is None or total_conversions is None:
        raise HTTPException(
            status_code=400,
            detail="total_revenue ve total_conversions zorunludur.",
        )

    result = simulate_budget(
        channel_spends=channel_spends,
        dda_weights=dda_weights,
        total_revenue=float(total_revenue),
        total_conversions=int(total_conversions),
        scenario_spends=scenario_spends,
    )
    return result


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

    records = load_sales_stock_csv(BytesIO(content))

    target_campaign_id = campaign_id
    if campaign_id is not None and _user.get("role") == "demo":
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

    return {
        "filename": file.filename,
        "rows": len(records),
        "weeks": weeks,
        "products": products,
        "regions": regions,
        "campaign_id": target_campaign_id,
        "redirected_to_sandbox": campaign_id is not None and target_campaign_id != campaign_id,
    }


@router.get("/sales-stock/summary")
def get_sales_stock_summary(
    campaign_id: int | None = Query(None),
    _user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """Get aggregated sales/stock summary."""
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
