"""Data upload, sample data and template download endpoints."""

import logging
from io import BytesIO
from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from backend.api.deps import check_campaign_access, get_current_user
from backend.db.database import get_db
from backend.db.models import (
    SalesStockData,
    WeeklyData,
)
from backend.config import (
    MAX_CSV_ROWS,
    SAMPLE_DIR,
    TEMPLATE_DIR,
)
from backend.data.loader import load_sales_stock_csv, load_weekly_csv
from backend.data.schemas import (
    SalesStockSummary,
)
from backend.api.common import (
    _validate_file,
    _read_file_content,
    _ensure_demo_sandbox_campaign,
)

router = APIRouter()

logger = logging.getLogger(__name__)


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
