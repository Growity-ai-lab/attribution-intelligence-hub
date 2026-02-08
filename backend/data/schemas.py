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
    """Channel contribution decomposition."""

    channel: str
    spend: float
    adstocked_spend: float
    saturated_value: float
    attributed_leads: float
    share: float


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
