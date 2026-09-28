"""BigQuery endpoints: connection, previews and background (GA4 / generic table) DDA runs."""

import json
import logging
import os
import threading
import time as _time
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from sqlalchemy.orm import Session
from backend.api.deps import check_campaign_access, get_current_user, resolve_read_campaign_id
from backend.crypto import decrypt, encrypt
from backend.db.database import SessionLocal, get_db
from backend.db.models import (
    Campaign,
    DDAResult,
    TouchpointData,
)
from backend.config import (
    BQ_CACHE_TTL,
    DDA_BLEND_WEIGHTS,
)
from backend.data.schemas import (
    GenericBQMapping,
)
from backend.models.dda.data_prep import extract_journeys
from backend.models.dda.ensemble import run_full_dda_pipeline
from backend.integrations.bigquery import (
    get_client as bq_get_client,
    test_connection as bq_test_connection,
    query_ga4_sessions,
    ga4_to_touchpoints,
    query_generic_events,
    generic_to_touchpoints,
    consolidate_channels,
    summarize_touchpoints,
    default_date_range,
)
from backend.api.routes_alerts import build_alerts_safely
from backend.api.common import (
    _CONVERSION_CHANNELS,
    _serialize_dda_result,
    _dda_only_unified_report,
    _validate_prior_alpha,
    _ensure_demo_sandbox_campaign,
)

router = APIRouter()

logger = logging.getLogger(__name__)


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


def _bq_reconnect_from_campaign(
    db: Session,
    project: str,
    dataset: str,
    campaign_id: int | None = None,
) -> dict | None:
    """Rebuild a BQ client from persisted Campaign credentials after cache miss.

    The in-memory cache is lost on server restart. If the campaign has
    encrypted BQ credentials saved (via /connect with campaign_id), decrypt
    them and re-create the client transparently — no re-upload needed.

    Returns the cached entry on success, or None when no usable credentials
    exist (e.g. ENCRYPTION_KEY changed across restart → decrypt fails).
    """
    if campaign_id:
        camp = db.query(Campaign).filter(Campaign.id == campaign_id).first()
    else:
        camp = (
            db.query(Campaign)
            .filter(
                Campaign.bq_project == project,
                Campaign.bq_dataset == dataset,
                Campaign.bq_credentials_enc != "",
            )
            .first()
        )
    if not camp or not camp.bq_credentials_enc:
        return None
    try:
        creds_str = decrypt(camp.bq_credentials_enc)
        client = bq_get_client(creds_str)
    except Exception:
        # Decrypt failure (rotated/ephemeral key) or invalid credentials.
        return None
    cache_key = f"{project}:{dataset}"
    _bq_cache_set(cache_key, {"client": client})
    return _bq_cache_get(cache_key)


def _write_id(db: Session, campaign_id: int, user: dict) -> int:
    """Campaign that per-campaign BQ settings are written to.

    Demo users write to their "Demo Sandbox" copy so seed campaigns are never
    modified (connect used to persist demo credentials onto the seed campaign).
    """
    return _ensure_demo_sandbox_campaign(db, campaign_id) if user.get("role") == "demo" else campaign_id


def _read_id(db: Session, campaign_id: int | None, user: dict) -> int | None:
    return resolve_read_campaign_id(db, campaign_id, user) if campaign_id else None


def _save_table_mapping(db: Session, campaign_id: int | None, mapping: GenericBQMapping, user: dict) -> bool:
    """Remember the last table mapping used for a campaign (best effort)."""
    if not campaign_id:
        return False
    try:
        camp = db.query(Campaign).filter(Campaign.id == _write_id(db, campaign_id, user)).first()
        if camp is None:
            return False
        camp.bq_table_mapping = mapping.model_dump_json()
        db.commit()
        return True
    except Exception:
        logger.exception("Failed to save BQ table mapping (campaign_id=%s)", campaign_id)
        db.rollback()
        return False


@router.post("/integrations/bigquery/connect")
async def bq_connect(
    credentials: UploadFile = File(...),
    project: str = Query(...),
    dataset: str = Query(...),
    campaign_id: int | None = Query(None),
    _user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """Upload service account JSON and test BQ connection.

    Returns connection status, available date range, table count.
    The BQ client is cached in memory. When campaign_id is supplied, the
    credentials are also encrypted and persisted to the Campaign so the
    connection survives a server restart (auto-reconnect on cache miss).
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

    # Persist encrypted credentials so the connection survives a restart.
    info["credentials_persisted"] = False
    if campaign_id:
        check_campaign_access(db, campaign_id, _user)
        camp = db.query(Campaign).filter(Campaign.id == _write_id(db, campaign_id, _user)).first()
        if camp:
            try:
                camp.bq_project = project
                camp.bq_dataset = dataset
                camp.bq_credentials_enc = encrypt(creds_str)
                db.commit()
                info["credentials_persisted"] = True
                if not os.environ.get("ENCRYPTION_KEY"):
                    logger.warning(
                        "BQ credentials persisted with an ephemeral ENCRYPTION_KEY; "
                        "they will NOT be decryptable after a restart. "
                        "Set ENCRYPTION_KEY for durable auto-reconnect."
                    )
            except Exception as e:
                db.rollback()
                logger.warning("Failed to persist BQ credentials: %s", e)

    return info


@router.post("/integrations/bigquery/preview")
def bq_preview(
    project: str = Query(...),
    dataset: str = Query(...),
    start_date: str = Query(None),
    end_date: str = Query(None),
    conversion_events: str = Query("purchase"),
    campaign_id: int | None = Query(None),
    _user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """Pull GA4 sessions from BQ and return summary (without running DDA).

    Use this to preview data before committing to a full DDA run.
    """
    cache_key = f"{project}:{dataset}"
    cached = _bq_cache_get(cache_key)
    if not cached:
        cached = _bq_reconnect_from_campaign(db, project, dataset, _read_id(db, campaign_id, _user))
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


def _run_dda_bq_background(
    result_id: int,
    bq_client,
    project: str,
    dataset: str,
    start_date: str,
    end_date: str,
    conv_list: list[str],
    prior_alpha: float,
    campaign_id: int | None,
    target_campaign_id: int | None,
    username: str,
) -> None:
    """Execute the BQ→DDA pipeline in a background thread.

    Writes the result (or error) back to the DDAResult row identified by
    *result_id*, so the frontend can poll ``GET /dda/status/{result_id}``.
    """
    db = SessionLocal()
    try:
        df = query_ga4_sessions(bq_client, project, dataset, start_date, end_date, conv_list)

        if df.empty:
            _mark_dda_error(db, result_id, "No events found in the specified date range.")
            return

        touchpoints = ga4_to_touchpoints(df, conv_list)
        del df

        _finish_dda_run(
            db, result_id, touchpoints,
            prior_alpha=prior_alpha,
            campaign_id=campaign_id,
            target_campaign_id=target_campaign_id,
            data_source="bigquery",
            no_conversion_msg=(
                f"No conversion events ({', '.join(conv_list)}) found. Check event names."
            ),
            extra_meta={"date_range": {"start": start_date, "end": end_date}},
        )

    except Exception as e:
        logger.exception("Background DDA run failed (result_id=%s)", result_id)
        _mark_dda_error(db, result_id, str(e)[:500])
    finally:
        db.close()


def _mark_dda_error(db: Session, result_id: int, message: str) -> None:
    """Best-effort write of an error status to the DDAResult row."""
    try:
        row = db.get(DDAResult, result_id)
        if row:
            row.status = "error"
            row.error_message = message
            db.commit()
    except Exception:
        pass


def _finish_dda_run(
    db: Session,
    result_id: int,
    touchpoints: list[dict],
    *,
    prior_alpha: float,
    campaign_id: int | None,
    target_campaign_id: int | None,
    data_source: str,
    no_conversion_msg: str,
    extra_meta: dict | None = None,
) -> None:
    """Source-agnostic DDA core: consolidate → persist → journeys → pipeline.

    Shared by the GA4 and generic BigQuery background runners. Everything from
    channel consolidation onward is identical regardless of where *touchpoints*
    came from, which is exactly why the engine is not GA4-bound.
    """
    touchpoints = consolidate_channels(touchpoints, max_channels=12)
    summary = summarize_touchpoints(touchpoints)

    if summary.get("conversions", 0) == 0:
        _mark_dda_error(db, result_id, no_conversion_msg)
        return

    persisted = False
    if target_campaign_id is not None:
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

    lead_converted: dict[str, bool] = {}
    for tp in touchpoints:
        if tp.get("converted"):
            lead_converted[tp["lead_id"]] = True

    filtered = [tp for tp in touchpoints if tp["channel"] not in _CONVERSION_CHANNELS]
    for tp in filtered:
        tp["converted"] = lead_converted.get(tp["lead_id"], False)

    journeys = extract_journeys(filtered)
    if not journeys:
        _mark_dda_error(db, result_id, "No valid journeys extracted from BQ data.")
        return

    result = run_full_dda_pipeline(
        journeys,
        prior_alpha=prior_alpha,
        markov_blend=DDA_BLEND_WEIGHTS["markov"],
        shapley_blend=DDA_BLEND_WEIGHTS["shapley"],
    )

    serialized = _serialize_dda_result(result)
    serialized["unified_report"] = _dda_only_unified_report(result["hybrid_attribution"])
    serialized["bq_summary"] = summary
    serialized["persisted"] = persisted
    serialized["campaign_id"] = target_campaign_id
    serialized["redirected_to_sandbox"] = persisted and target_campaign_id != campaign_id
    serialized["data_source"] = data_source
    if extra_meta:
        serialized.update(extra_meta)

    serialized_with_summary = {**serialized, "channel_summary": summary.get("channels", {})}

    # Alerts are computed first and committed together with the result, so a
    # client polling /dda/status never sees "complete" before its alerts exist.
    alerts = build_alerts_safely(db, target_campaign_id, serialized_with_summary, result_id)
    row = db.get(DDAResult, result_id)
    row.result_json = json.dumps(serialized_with_summary)
    row.status = "complete"
    db.add_all(alerts)
    db.commit()


def _run_dda_generic_bq_background(
    result_id: int,
    bq_client,
    project: str,
    dataset: str,
    mapping: dict,
    start_date: str | None,
    end_date: str | None,
    prior_alpha: float,
    campaign_id: int | None,
    target_campaign_id: int | None,
) -> None:
    """Execute the generic-table BQ→DDA pipeline in a background thread.

    Identical to the GA4 runner except for the fetch+normalize step, proving
    the engine is source-agnostic: any mapped warehouse table reuses the core.
    """
    db = SessionLocal()
    try:
        df = query_generic_events(
            bq_client, project, dataset, mapping, start_date, end_date,
        )

        if df.empty:
            _mark_dda_error(db, result_id, "Eşlenen tabloda satır bulunamadı (filtre/aralığı kontrol edin).")
            return

        touchpoints = generic_to_touchpoints(df)
        del df

        _finish_dda_run(
            db, result_id, touchpoints,
            prior_alpha=prior_alpha,
            campaign_id=campaign_id,
            target_campaign_id=target_campaign_id,
            data_source="bigquery_generic",
            no_conversion_msg="Dönüşüm bulunamadı. converted_col / event_col eşlemesini kontrol edin.",
            extra_meta={
                "date_range": {"start": start_date, "end": end_date},
                "source_table": f"{dataset}.{mapping.get('table')}",
            },
        )

    except Exception as e:
        logger.exception("Background generic DDA run failed (result_id=%s)", result_id)
        _mark_dda_error(db, result_id, str(e)[:500])
    finally:
        db.close()


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
    """Start DDA pipeline from BigQuery GA4 export (asynchronous).

    Returns immediately with a result_id. The heavy work (BQ query + Markov +
    Shapley) runs in a background thread.  Poll ``GET /dda/status/{result_id}``
    to retrieve the result once it completes.
    """
    _validate_prior_alpha(prior_alpha)

    cache_key = f"{project}:{dataset}"
    cached = _bq_cache_get(cache_key)
    if not cached:
        cached = _bq_reconnect_from_campaign(db, project, dataset, _read_id(db, campaign_id, _user))
    if not cached:
        raise HTTPException(status_code=400, detail="BigQuery not connected. Call /connect first.")

    if not start_date or not end_date:
        start_date, end_date = default_date_range(6)

    conv_list = [e.strip() for e in conversion_events.split(",") if e.strip()]
    bq_client = cached["client"]

    target_campaign_id = campaign_id
    if campaign_id is not None:
        check_campaign_access(db, campaign_id, _user)
        if _user.get("role") == "demo":
            target_campaign_id = _ensure_demo_sandbox_campaign(db, campaign_id)

    # Create a placeholder row so the frontend can poll for status.
    dda_row = DDAResult(
        campaign_id=target_campaign_id,
        run_date=datetime.now(timezone.utc).isoformat(),
        data_source="bigquery",
        start_date=start_date,
        end_date=end_date,
        result_json="{}",
        status="running",
        created_by=_user.get("username", ""),
    )
    db.add(dda_row)
    db.commit()
    db.refresh(dda_row)
    result_id = dda_row.id

    threading.Thread(
        target=_run_dda_bq_background,
        args=(
            result_id, bq_client, project, dataset,
            start_date, end_date, conv_list, prior_alpha,
            campaign_id, target_campaign_id,
            _user.get("username", ""),
        ),
        daemon=True,
    ).start()

    return {"status": "running", "result_id": result_id}


@router.post("/dda/run-from-bigquery-table")
def run_dda_from_bigquery_table(
    mapping: GenericBQMapping,
    project: str = Query(...),
    dataset: str = Query(...),
    start_date: str = Query(None),
    end_date: str = Query(None),
    prior_alpha: float = Query(0.5),
    campaign_id: int | None = Query(None),
    _user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """Start DDA from ANY BigQuery table via a column mapping (asynchronous).

    GA4 is just one pre-built adapter; this endpoint lets any warehouse table —
    CRM events, server-side GTM, app analytics, ad-cost exports, offline
    conversions — feed the same Markov + Shapley engine once its columns are
    mapped onto the standard touchpoint schema. Poll ``GET /dda/status/{id}``.
    """
    _validate_prior_alpha(prior_alpha)

    cache_key = f"{project}:{dataset}"
    cached = _bq_cache_get(cache_key)
    if not cached:
        cached = _bq_reconnect_from_campaign(db, project, dataset, _read_id(db, campaign_id, _user))
    if not cached:
        raise HTTPException(status_code=400, detail="BigQuery not connected. Call /connect first.")

    bq_client = cached["client"]

    target_campaign_id = campaign_id
    if campaign_id is not None:
        check_campaign_access(db, campaign_id, _user)
        if _user.get("role") == "demo":
            target_campaign_id = _ensure_demo_sandbox_campaign(db, campaign_id)

    dda_row = DDAResult(
        campaign_id=target_campaign_id,
        run_date=datetime.now(timezone.utc).isoformat(),
        data_source="bigquery_generic",
        start_date=start_date or "",
        end_date=end_date or "",
        result_json="{}",
        status="running",
        created_by=_user.get("username", ""),
    )
    db.add(dda_row)
    db.commit()
    db.refresh(dda_row)
    result_id = dda_row.id
    _save_table_mapping(db, campaign_id, mapping, _user)

    threading.Thread(
        target=_run_dda_generic_bq_background,
        args=(
            result_id, bq_client, project, dataset, mapping.model_dump(),
            start_date, end_date, prior_alpha,
            campaign_id, target_campaign_id,
        ),
        daemon=True,
    ).start()

    return {"status": "running", "result_id": result_id}


@router.post("/integrations/bigquery/preview-table")
def preview_bigquery_table(
    mapping: GenericBQMapping,
    project: str = Query(...),
    dataset: str = Query(...),
    start_date: str = Query(None),
    end_date: str = Query(None),
    campaign_id: int | None = Query(None),
    _user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """Preview a generic BQ table mapping (summary only, no DDA run)."""
    if campaign_id is not None:
        check_campaign_access(db, campaign_id, _user)
    cache_key = f"{project}:{dataset}"
    cached = _bq_cache_get(cache_key)
    if not cached:
        cached = _bq_reconnect_from_campaign(db, project, dataset, _read_id(db, campaign_id, _user))
    if not cached:
        raise HTTPException(status_code=400, detail="BigQuery not connected. Call /connect first.")

    try:
        df = query_generic_events(
            cached["client"], project, dataset, mapping.model_dump(),
            start_date, end_date, row_limit=100_000,
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"BigQuery sorgu hatası: {e}")

    touchpoints = generic_to_touchpoints(df)
    touchpoints = consolidate_channels(touchpoints, max_channels=12)
    summary = summarize_touchpoints(touchpoints)
    summary["start_date"] = start_date
    summary["end_date"] = end_date
    summary["source_table"] = f"{dataset}.{mapping.table}"
    summary["row_limit_applied"] = len(df) >= 100_000
    summary["mapping_saved"] = _save_table_mapping(db, campaign_id, mapping, _user)
    return summary


@router.get("/integrations/bigquery/saved-config")
def bq_saved_config(
    campaign_id: int = Query(...),
    _user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """What this campaign remembers about BigQuery, to prefill the connect form.

    Never returns the credentials themselves — only whether they are stored.
    """
    check_campaign_access(db, campaign_id, _user)
    camp = db.query(Campaign).filter(Campaign.id == _read_id(db, campaign_id, _user)).first()
    mapping = None
    if camp is not None and camp.bq_table_mapping:
        try:
            mapping = GenericBQMapping.model_validate_json(camp.bq_table_mapping).model_dump(exclude_none=True)
        except ValueError:
            logger.warning("Ignoring invalid stored table mapping (campaign_id=%s)", camp.id)
    return {
        "project": (camp.bq_project or "") if camp else "",
        "dataset": (camp.bq_dataset or "") if camp else "",
        "has_credentials": bool(camp and camp.bq_credentials_enc),
        "table_mapping": mapping,
    }


@router.put("/integrations/bigquery/table-mapping")
def bq_save_table_mapping(
    mapping: GenericBQMapping,
    campaign_id: int = Query(...),
    _user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """Store a generic-table column mapping for the campaign."""
    check_campaign_access(db, campaign_id, _user)
    if not _save_table_mapping(db, campaign_id, mapping, _user):
        raise HTTPException(status_code=500, detail="Eşleme kaydedilemedi.")
    return {"saved": True, "table_mapping": mapping.model_dump(exclude_none=True)}


@router.post("/integrations/bigquery/reconnect")
def bq_reconnect(
    campaign_id: int = Query(...),
    _user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """Connect with the campaign's stored (encrypted) credentials — no JSON re-upload."""
    check_campaign_access(db, campaign_id, _user)
    read_id = _read_id(db, campaign_id, _user)
    camp = db.query(Campaign).filter(Campaign.id == read_id).first()
    if camp is None or not camp.bq_credentials_enc or not camp.bq_project or not camp.bq_dataset:
        raise HTTPException(status_code=404, detail="Bu kampanya için kayıtlı BigQuery bağlantısı yok.")
    cached = _bq_reconnect_from_campaign(db, camp.bq_project, camp.bq_dataset, read_id)
    if not cached:
        raise HTTPException(
            status_code=400,
            detail=(
                "Kayıtlı kimlik bilgileri çözülemedi (ENCRYPTION_KEY değişmiş olabilir). "
                "Service account JSON dosyasını yeniden yükleyin."
            ),
        )
    try:
        info = bq_test_connection(cached["client"], camp.bq_project, camp.bq_dataset)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"BigQuery bağlantı hatası: {e}")
    if not info.get("ok"):
        raise HTTPException(status_code=400, detail=info.get("error", "Bağlantı kurulamadı"))
    return {**info, "project": camp.bq_project, "dataset": camp.bq_dataset}
