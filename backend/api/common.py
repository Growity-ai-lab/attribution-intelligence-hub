"""Helpers shared by the API route modules (validation, DDA serialization/persistence, demo sandbox)."""

import json
import logging
from datetime import datetime, timezone
from pathlib import PurePosixPath
from fastapi import HTTPException, UploadFile
from sqlalchemy.orm import Session
from backend.db.models import (
    Campaign,
    Client,
    DDAResult,
)
from backend.config import (
    ALLOWED_FILE_EXTENSIONS,
    MAX_ARRAY_SIZE,
    MAX_JOURNEY_COUNT,
    MAX_UPLOAD_SIZE_BYTES,
    PRIOR_ALPHA_MAX,
    PRIOR_ALPHA_MIN,
)

logger = logging.getLogger(__name__)


# Channels that represent conversion events, not marketing touchpoints
_CONVERSION_CHANNELS = {"form", "landing_page", "website", "app"}


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


_SNAPSHOT_KEYS = (
    "journey_stats", "hybrid_attribution", "unified_report", "markov", "shapley_dda",
    "assist_report", "online_channels", "channel_summary", "bq_summary", "insights", "top_paths",
)


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

    # Store only keys the run actually produced: an empty {} placeholder (e.g.
    # bq_summary on a CSV run) is truthy in JS and made the report page render
    # BigQuery KPI tiles for a CSV result and crash on missing numbers.
    snapshot = {k: serialized[k] for k in _SNAPSHOT_KEYS if serialized.get(k)}
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
