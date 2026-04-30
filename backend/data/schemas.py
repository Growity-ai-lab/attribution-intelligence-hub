"""Pydantic schemas for data validation."""

from pydantic import BaseModel, Field


class WeeklyChannelInput(BaseModel):
    """Single row of weekly channel performance data."""

    week: str = Field(..., description="ISO week string, e.g. 2026-W06")
    channel: str
    spend: float = Field(ge=0)
    impressions: int = Field(ge=0)
    clicks: int = Field(ge=0)
    leads: int = Field(ge=0)
    grp: float = Field(ge=0, default=0)
    spot_count: int = Field(ge=0, default=0)
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


class DDAResult(BaseModel):
    """DDA pipeline result for a channel."""

    channel: str
    markov_weight: float
    shapley_weight: float
    blended_weight: float
    is_online: bool


class CrossValidationResult(BaseModel):
    """Cross-validation result comparing DDA vs MMM."""

    channel: str
    dda_weight: float
    mmm_weight: float
    deviation: float
    flagged: bool


class UnifiedScore(BaseModel):
    """Unified attribution score for a channel."""

    channel: str
    mmm_score: float
    dda_score: float
    incrementality_score: float
    unified_score: float


class WeeklyReport(BaseModel):
    """Weekly unified attribution report."""

    week: str
    total_spend: float
    total_leads: int
    baseline_leads: float
    channel_scores: list[UnifiedScore]


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


class SegmentChannelScore(BaseModel):
    """Per-segment, per-channel attribution score."""

    segment: str
    channel: str
    spend: float = 0.0
    leads: int = 0
    sales_units: int = 0
    sales_revenue: float = 0.0
    cost_per_lead: float = 0.0
    cost_per_sale: float = 0.0
    saturation_pct: float = Field(
        default=0.0, description="Current saturation level (0-100%)"
    )
    saturation_alert: str = Field(
        default="", description="Alert: 'saturated', 'near_saturation', or ''"
    )


class PeriodComparison(BaseModel):
    """Period-over-period comparison for a segment+channel."""

    segment: str
    channel: str
    period_a: str
    period_b: str
    spend_a: float
    spend_b: float
    leads_a: int
    leads_b: int
    sales_a: int = 0
    sales_b: int = 0
    cpl_a: float = 0.0
    cpl_b: float = 0.0
    cpl_change_pct: float = 0.0
    recommendation: str = ""


# --------------- Media Planning ---------------


class MediaPlanningRequest(BaseModel):
    """Request for media planning simulation.

    For offline mode: weekly_grps carries GRP values per week.
    For digital mode: weekly_grps carries weekly spend (TL); the field name is
    kept for backward compatibility but the value is interpreted by the mode.
    """

    channel: str = Field(..., description="Channel name (offline or online)")
    weekly_grps: list[float] = Field(..., description="GRP (offline) or spend TL (digital) per week", min_length=1, max_length=52)
    mode: str = Field("offline", description="'offline' (GRP-based) or 'digital' (spend-based)")
    # Optional digital-only overrides (None → use DIGITAL_CHANNEL_METRICS defaults)
    cpm_override: float | None = Field(None, description="Cost per 1000 impressions (TL) — digital only")
    ctr_override: float | None = Field(None, description="Click-through rate — digital only")
    lead_rate_override: float | None = Field(None, description="Lead per click rate — digital only")
    target_audience_override: int | None = Field(None, description="Reachable unique users — digital only")
    freq_cap_override: int | None = Field(None, description="Effective frequency cap — digital only")


class WeeklySimDetail(BaseModel):
    """Per-week simulation result."""

    week: int
    grp: float
    adstocked_grp: float
    saturated: float
    estimated_leads: float
    marginal_leads: float


class OptimalGRPResult(BaseModel):
    """Optimal GRP recommendation."""

    optimal_weekly_grp: float
    saturation_threshold_grp: float
    current_avg_grp: float
    recommendation: str


class ReachDataPoint(BaseModel):
    """Single GRP-to-reach data point."""

    cumulative_grp: float
    r1: float
    r2: float
    r3: float


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
    mode: str = "offline"
    decay: float
    alpha: float
    gamma: float
    max_lift: float
    weekly_details: list[WeeklySimDetail]
    summary: dict
    optimal: OptimalGRPResult
    saturation_curve: dict
    reach_curve: list[ReachDataPoint]
    # Digital-only fields (None for offline mode)
    funnel_curve: list[FunnelDataPoint] | None = None
    digital_metrics: dict | None = None
