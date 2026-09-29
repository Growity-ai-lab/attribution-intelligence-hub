"""Pydantic schemas for data validation."""

from typing import Literal

from pydantic import BaseModel, Field, model_validator


class WeeklyChannelInput(BaseModel):
    """Single row of weekly channel performance data."""

    week: str = Field(..., description="ISO week string, e.g. 2026-W06")
    channel: str
    spend: float = Field(ge=0)
    impressions: int = Field(ge=0)
    clicks: int = Field(ge=0)
    leads: int = Field(ge=0)
    segment: str = Field(default="", description="Segment code, e.g. S1, S2, S3, S4")


class CRMTouchpoint(BaseModel):
    """Single CRM touchpoint record."""

    lead_id: str
    timestamp: str
    channel: str
    touchpoint_type: str
    campaign: str = ""
    segment: str = ""
    converted: bool = False
    session_id: str = ""


class GenericBQMapping(BaseModel):
    """Column mapping for the source-agnostic BigQuery connector.

    Maps an arbitrary BQ table (CRM events, server-side GTM, app analytics,
    ad-cost exports, offline conversions, ...) onto the standard touchpoint
    schema the DDA engine consumes. GA4 is just one pre-built adapter; this
    lets any warehouse table run through the same Markov + Shapley pipeline.
    """

    table: str = Field(..., description="BQ tablo adı (project.dataset ayrı verilir)")
    entity_col: str = Field(..., description="Kullanıcı/lead kimliği kolonu")
    timestamp_col: str = Field(..., description="Zaman damgası kolonu")
    timestamp_type: Literal["datetime", "unix_micros", "unix_seconds"] = "datetime"

    # Channel: either a ready channel column OR a source+medium pair.
    channel_col: str | None = Field(None, description="Hazır kanal adı kolonu")
    source_col: str | None = None
    medium_col: str | None = None

    # Conversion: either a boolean column OR an event column + matching values.
    converted_col: str | None = Field(None, description="Dönüşüm bayrağı (bool/int) kolonu")
    event_col: str | None = Field(None, description="Olay adı kolonu")
    conversion_values: list[str] = Field(
        default_factory=list, description="event_col için dönüşüm sayılan değerler"
    )

    revenue_col: str | None = Field(None, description="Gelir kolonu (opsiyonel)")

    @model_validator(mode="after")
    def _check_mapping(self) -> "GenericBQMapping":
        if not self.channel_col and not (self.source_col and self.medium_col):
            raise ValueError(
                "channel_col VEYA (source_col + medium_col) eşlemesi zorunlu."
            )
        if not self.converted_col and not (self.event_col and self.conversion_values):
            raise ValueError(
                "converted_col VEYA (event_col + conversion_values) eşlemesi zorunlu."
            )
        return self


class AdstockResult(BaseModel):
    """Adstock computation result for a channel."""

    channel: str
    decay: float
    raw_spend: list[float]
    adstocked: list[float]


class SaturationResult(BaseModel):
    """Saturation curve result for a channel."""

    channel: str
    alpha: float
    gamma: float
    input_values: list[float]
    saturated_values: list[float]


class ChannelDecomposition(BaseModel):
    """Channel contribution decomposition.

    CI fields are populated only when ?with_ci=true and a fit with
    residuals is available; otherwise None.
    """

    channel: str
    spend: float
    adstocked_spend: float
    saturated_value: float
    attributed_leads: float
    share: float
    lead_ci_low: float | None = None
    lead_ci_high: float | None = None
    share_ci_low: float | None = None
    share_ci_high: float | None = None


# --------------- Sales & Stock ---------------


class SalesStockInput(BaseModel):
    """Single row of weekly sales/stock data."""

    week: str = Field(..., description="ISO week string, e.g. 2026-W06")
    channel: str = Field(default="", description="Attribution channel (optional)")
    product: str = Field(default="", description="Product or SKU name")
    region: str = Field(default="", description="Geographic region / city")
    segment: str = Field(default="", description="Segment code, e.g. S1, S2, S3, S4")
    sales_units: int = Field(ge=0, default=0, description="Units sold")
    sales_revenue: float = Field(ge=0, default=0.0, description="Revenue in TL")
    stock_units: int = Field(ge=0, default=0, description="Stock on hand (units)")
    stock_value: float = Field(ge=0, default=0.0, description="Stock value in TL")
    returns: int = Field(ge=0, default=0, description="Returned units")
    new_customers: int = Field(ge=0, default=0, description="New customer count")
    repeat_customers: int = Field(ge=0, default=0, description="Repeat customer count")


class SalesStockSummary(BaseModel):
    """Aggregated sales/stock summary."""

    total_weeks: int
    total_revenue: float
    total_units_sold: int
    total_stock_units: int
    avg_weekly_revenue: float
    total_returns: int
    return_rate: float
    total_new_customers: int
    total_repeat_customers: int
    products: list[str]
    regions: list[str]


# --------------- Segment Analytics ---------------


# --------------- Media Planning ---------------


class MediaPlanningRequest(BaseModel):
    """Request for digital media planning simulation."""

    channel: str = Field(..., description="Digital channel name")
    weekly_spends: list[float] = Field(..., description="Weekly spend (TL) per week", min_length=1, max_length=52)
    cpm_override: float | None = Field(None, description="Cost per 1000 impressions (TL)")
    ctr_override: float | None = Field(None, description="Click-through rate")
    lead_rate_override: float | None = Field(None, description="Lead per click rate")
    target_audience_override: int | None = Field(None, description="Reachable unique users")
    freq_cap_override: int | None = Field(None, description="Effective frequency cap")
    planned_clicks: float | None = Field(
        None, description="Planda öngörülen toplam tıklama (CPC satırları); CTR bundan türetilir")


class WeeklySimDetail(BaseModel):
    """Per-week simulation result."""

    week: int
    spend: float
    adstocked_spend: float
    saturated: float
    estimated_leads: float
    marginal_leads: float


class OptimalSpendResult(BaseModel):
    """Optimal weekly spend recommendation."""

    optimal_weekly_spend: float
    saturation_threshold_spend: float
    # False when marginal return never fell below 10% within the scan (up to 4×alpha):
    # saturation_threshold_spend is then only the scan limit, i.e. saturation is "beyond" it.
    saturation_threshold_found: bool = True
    current_avg_spend: float
    recommendation: str


class FunnelDataPoint(BaseModel):
    """Per-week funnel projection for digital planning.

    Spend → Impressions (via CPM) → Clicks (via CTR) → Estimated Leads (via lead_rate).
    Rendered alongside MMM-driven leads in WeeklySimDetail to surface
    calibration drift between funnel and MMM models.
    """

    week: int
    spend: float
    impressions: float
    clicks: float
    estimated_leads_funnel: float
    reach_pct: float
    frequency: float


class MediaPlanningResponse(BaseModel):
    """Full media planning simulation response."""

    channel: str
    decay: float
    alpha: float
    gamma: float
    max_lift: float
    weekly_details: list[WeeklySimDetail]
    summary: dict
    optimal: OptimalSpendResult
    saturation_curve: dict
    funnel_curve: list[FunnelDataPoint]
    digital_metrics: dict
    # The channel's own defaults before any override, to sanity-check agency values against.
    default_metrics: dict = {}
    # True when the channel's CPM/CTR/audience are placeholders and no CPM override was given.
    assumed_metrics: bool = False
