"""TV/radio spot effect endpoints: spot lists, minute traffic, analysis and day timeline.

GA4/BigQuery minute traffic is pulled in routes_bigquery (it owns the BQ client cache);
this module stores and reads both from the database.
"""

import io
from datetime import datetime

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from fastapi.responses import StreamingResponse
from sqlalchemy import func
from sqlalchemy.orm import Session

from backend.api.common import (
    _ensure_demo_sandbox_campaign,
    _read_file_content,
    _validate_file,
    store_traffic_minutes as store_traffic,
)
from backend.api.deps import check_campaign_access, get_current_user, resolve_read_campaign_id
from backend.data.spot_loader import parse_spot_file, parse_traffic_file
from backend.data.spot_sample import generate_sample
from backend.db.database import get_db
from backend.db.models import TrafficMinute, TvSpot
from backend.models.spot_effects import analyze_spots, day_timeline

router = APIRouter()

METRICS = {
    "sessions": "Tüm oturumlar",
    "sessions_unpaid": "Ücretsiz oturumlar (direct/organik)",
    "conversions": "Dönüşümler",
}
SPOT_TEMPLATE = (
    "Tarih;Saat;Kanal;Medya;Program;Reklam;Süre (sn);Net Tutar (TL);GRP\n"
    "12.10.2026;20:47;Kanal D;TV;Ana Haber;Lansman 30sn;30;185000;2,4\n"
    "12.10.2026;21:15;Show TV;TV;Dizi;Lansman 30sn;30;150000;1,9\n"
    "12.10.2026;08:12;Power FM;Radyo;Sabah Programı;Kampanya 15sn;15;12000;\n"
)
TRAFFIC_TEMPLATE = (
    "minute;sessions;sessions_unpaid;conversions\n"
    "2026-10-12 20:45;14;9;0\n"
    "2026-10-12 20:46;13;8;1\n"
    "2026-10-12 20:47;41;33;0\n"
)


def _write_id(db: Session, campaign_id: int, user: dict) -> int:
    check_campaign_access(db, campaign_id, user)
    return _ensure_demo_sandbox_campaign(db, campaign_id) if user.get("role") == "demo" else campaign_id


def _read_id(db: Session, campaign_id: int, user: dict) -> int:
    check_campaign_access(db, campaign_id, user)
    return resolve_read_campaign_id(db, campaign_id, user)


def _minute_str(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%dT%H:%M")


def _load_spots(db: Session, campaign_id: int) -> list[dict]:
    rows = db.query(TvSpot).filter(TvSpot.campaign_id == campaign_id).order_by(TvSpot.aired_at).all()
    return [{
        "id": r.id, "aired_at": datetime.fromisoformat(r.aired_at), "medium": r.medium, "station": r.station,
        "program": r.program, "creative": r.creative, "duration_sec": r.duration_sec, "cost": r.cost, "grp": r.grp,
    } for r in rows]


def _load_traffic(db: Session, campaign_id: int, metric: str) -> dict[datetime, float]:
    col = getattr(TrafficMinute, metric)
    rows = (db.query(TrafficMinute.minute, col)
            .filter(TrafficMinute.campaign_id == campaign_id, col.isnot(None)).all())
    return {datetime.fromisoformat(m): float(v) for m, v in rows}


def _store_spots(db: Session, campaign_id: int, spots: list[dict], source: str) -> None:
    db.query(TvSpot).filter(TvSpot.campaign_id == campaign_id).delete(synchronize_session=False)
    db.bulk_insert_mappings(TvSpot, [{
        "campaign_id": campaign_id, "aired_at": _minute_str(s["aired_at"]), "medium": s.get("medium") or "tv",
        "station": s["station"], "program": s.get("program") or "", "creative": s.get("creative") or "",
        "duration_sec": s.get("duration_sec"), "cost": float(s.get("cost") or 0), "grp": s.get("grp"),
        "source": source,
    } for s in spots])


def _status(db: Session, campaign_id: int) -> dict:
    spot_q = db.query(func.count(TvSpot.id), func.min(TvSpot.aired_at), func.max(TvSpot.aired_at),
                      func.sum(TvSpot.cost)).filter(TvSpot.campaign_id == campaign_id).one()
    by_medium = dict(db.query(TvSpot.medium, func.count(TvSpot.id))
                     .filter(TvSpot.campaign_id == campaign_id).group_by(TvSpot.medium).all())
    spot_source = db.query(TvSpot.source).filter(TvSpot.campaign_id == campaign_id).first()
    tr = db.query(func.count(TrafficMinute.id), func.min(TrafficMinute.minute), func.max(TrafficMinute.minute),
                  func.sum(TrafficMinute.sessions), func.count(TrafficMinute.sessions_unpaid),
                  func.count(TrafficMinute.conversions)).filter(TrafficMinute.campaign_id == campaign_id).one()
    tr_source = db.query(TrafficMinute.source).filter(TrafficMinute.campaign_id == campaign_id).first()
    return {
        "campaign_id": campaign_id,
        "spots": {"count": spot_q[0], "first": spot_q[1], "last": spot_q[2], "cost": round(spot_q[3] or 0, 2),
                  "tv": by_medium.get("tv", 0), "radio": by_medium.get("radio", 0),
                  "source": spot_source[0] if spot_source else None},
        "traffic": {"minutes": tr[0], "first": tr[1], "last": tr[2], "sessions": round(tr[3] or 0, 1),
                    "has_unpaid": tr[4] > 0, "has_conversions": tr[5] > 0,
                    "source": tr_source[0] if tr_source else None},
        "metrics": METRICS,
    }


@router.get("/spots/status")
def spots_status(campaign_id: int = Query(...), user: dict = Depends(get_current_user),
                 db: Session = Depends(get_db)) -> dict:
    """What spot and traffic data a campaign has."""
    return _status(db, _read_id(db, campaign_id, user))


@router.post("/spots/upload")
async def upload_spots(
    campaign_id: int = Query(...),
    default_medium: str = Query("tv", pattern="^(tv|radio)$"),
    file: UploadFile = File(...),
    user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """Replace the campaign's spot list with a TV/radio broadcast list (Excel/CSV)."""
    _validate_file(file)
    content = await _read_file_content(file)
    try:
        spots, warnings = parse_spot_file(content, file.filename or "", default_medium)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    target = _write_id(db, campaign_id, user)
    _store_spots(db, target, spots, "file")
    db.commit()
    return {**_status(db, target), "warnings": warnings, "imported": len(spots)}


@router.post("/spots/traffic/upload")
async def upload_traffic(
    campaign_id: int = Query(...),
    file: UploadFile = File(...),
    user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """Replace the campaign's minute traffic with an uploaded file (minute, sessions, ...)."""
    _validate_file(file)
    content = await _read_file_content(file)
    try:
        rows, warnings = parse_traffic_file(content, file.filename or "")
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    target = _write_id(db, campaign_id, user)
    store_traffic(db, target, rows, "file")
    db.commit()
    return {**_status(db, target), "warnings": warnings, "imported": len(rows)}


@router.post("/spots/sample")
def load_sample(campaign_id: int = Query(...), user: dict = Depends(get_current_user),
                db: Session = Depends(get_db)) -> dict:
    """Load synthetic spots + traffic (with a known injected effect) to try the module."""
    target = _write_id(db, campaign_id, user)
    spots, visits, conversions = generate_sample()
    _store_spots(db, target, spots, "sample")
    store_traffic(db, target, [{
        "minute": m, "sessions": v, "sessions_unpaid": round(v * 0.7), "conversions": conversions.get(m, 0.0),
    } for m, v in visits.items()], "sample")
    db.commit()
    return _status(db, target)


@router.delete("/spots")
def delete_spot_data(
    campaign_id: int = Query(...),
    what: str = Query("all", pattern="^(all|spots|traffic)$"),
    user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """Clear a campaign's spots, traffic or both."""
    target = _write_id(db, campaign_id, user)
    if what in ("all", "spots"):
        db.query(TvSpot).filter(TvSpot.campaign_id == target).delete(synchronize_session=False)
    if what in ("all", "traffic"):
        db.query(TrafficMinute).filter(TrafficMinute.campaign_id == target).delete(synchronize_session=False)
    db.commit()
    return _status(db, target)


@router.get("/spots/analysis")
def spot_analysis(
    campaign_id: int = Query(...),
    metric: str = Query("sessions", pattern="^(sessions|sessions_unpaid|conversions)$"),
    pre_minutes: int = Query(15, ge=5, le=60),
    post_minutes: int = Query(10, ge=3, le=60),
    medium: str = Query("all", pattern="^(all|tv|radio)$"),
    user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """Immediate web response per spot, with station/daypart/creative breakdowns and a placebo check."""
    target = _read_id(db, campaign_id, user)
    spots = _load_spots(db, target)
    if medium != "all":
        spots = [s for s in spots if s["medium"] == medium]
    if not spots:
        raise HTTPException(status_code=404, detail="Bu kampanya için spot listesi yok. Önce TV/radyo yayın listesini yükleyin.")
    visits = _load_traffic(db, target, metric)
    conversions = _load_traffic(db, target, "conversions") if metric != "conversions" else None
    result = analyze_spots(spots, visits, conversions or None, pre_minutes=pre_minutes, post_minutes=post_minutes)
    status = _status(db, target)
    result["metric"] = {"key": metric, "label": METRICS[metric]}
    result["data"] = status
    result["is_sample"] = status["spots"]["source"] == "sample" or status["traffic"]["source"] == "sample"
    return result


@router.get("/spots/timeline")
def spot_timeline(
    campaign_id: int = Query(...),
    date: str = Query(..., pattern=r"^\d{4}-\d{2}-\d{2}$"),
    metric: str = Query("sessions", pattern="^(sessions|sessions_unpaid|conversions)$"),
    user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """One day's minute traffic with that day's spots marked."""
    target = _read_id(db, campaign_id, user)
    day = datetime.fromisoformat(date)
    return day_timeline(_load_traffic(db, target, metric), _load_spots(db, target), day)


@router.get("/spots/template/{kind}")
def spot_template(kind: str) -> StreamingResponse:
    """Example spot list or minute-traffic file (semicolon CSV, opens in Turkish Excel)."""
    if kind not in ("spots", "traffic"):
        raise HTTPException(status_code=404, detail="Şablon bulunamadı")
    body = SPOT_TEMPLATE if kind == "spots" else TRAFFIC_TEMPLATE
    name = "tv_radyo_spot_listesi_sablon.csv" if kind == "spots" else "dakikalik_trafik_sablon.csv"
    return StreamingResponse(io.BytesIO(("﻿" + body).encode("utf-8")), media_type="text/csv",
                             headers={"Content-Disposition": f'attachment; filename="{name}"'})
