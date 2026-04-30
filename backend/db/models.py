"""SQLAlchemy ORM models."""

from sqlalchemy import Column, Float, ForeignKey, Integer, String
from sqlalchemy.orm import relationship

from backend.db.database import Base


class Client(Base):
    __tablename__ = "clients"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String, nullable=False)
    year = Column(Integer, nullable=False, index=True)
    created_at = Column(String, nullable=False)

    campaigns = relationship("Campaign", back_populates="client", cascade="all, delete-orphan")


class Campaign(Base):
    __tablename__ = "campaigns"

    id = Column(Integer, primary_key=True, autoincrement=True)
    client_id = Column(Integer, ForeignKey("clients.id"), nullable=False, index=True)
    name = Column(String, nullable=False)
    budget = Column(Float, default=0.0)
    channels = Column(String, default="")  # comma-separated channel list
    status = Column(String, default="active")  # active, paused, completed
    created_at = Column(String, nullable=False)

    client = relationship("Client", back_populates="campaigns")


class WeeklyData(Base):
    __tablename__ = "weekly_data"

    id = Column(Integer, primary_key=True, autoincrement=True)
    campaign_id = Column(Integer, ForeignKey("campaigns.id"), nullable=True, index=True)
    week = Column(String, nullable=False, index=True)
    channel = Column(String, nullable=False, index=True)
    spend = Column(Float, default=0.0)
    impressions = Column(Integer, default=0)
    clicks = Column(Integer, default=0)
    leads = Column(Integer, default=0)
    grp = Column(Float, default=0.0)
    spot_count = Column(Integer, default=0)
    segment = Column(String, default="", index=True)


class MediaPlanSimulation(Base):
    __tablename__ = "media_plan_simulations"

    id = Column(Integer, primary_key=True, autoincrement=True)
    campaign_id = Column(Integer, ForeignKey("campaigns.id"), nullable=True)
    name = Column(String, nullable=False)
    channel = Column(String, nullable=False)
    weekly_grps = Column(String, nullable=False)  # JSON array
    response_snapshot = Column(String, nullable=False)  # JSON blob
    created_at = Column(String, nullable=False)
    created_by = Column(String, default="")


class TouchpointData(Base):
    __tablename__ = "touchpoint_data"

    id = Column(Integer, primary_key=True, autoincrement=True)
    campaign_id = Column(Integer, ForeignKey("campaigns.id"), nullable=True, index=True)
    lead_id = Column(String, nullable=False, index=True)
    timestamp = Column(String, nullable=False)
    channel = Column(String, nullable=False)
    touchpoint_type = Column(String, nullable=False)
    campaign = Column(String, default="")
    segment = Column(String, default="")


class CampaignModelParams(Base):
    """Per-campaign fitted MMM parameters (one row per fit run; latest = active)."""

    __tablename__ = "campaign_model_params"

    id = Column(Integer, primary_key=True, autoincrement=True)
    campaign_id = Column(Integer, ForeignKey("campaigns.id"), nullable=False, index=True)
    created_at = Column(String, nullable=False, index=True)
    # JSON: {"channels": [...], "params": {ch: {decay, alpha, gamma, max_lift}}, "baseline": ...}
    params_json = Column(String, nullable=False)
    # JSON: {rmse, mape, r2, n_obs, converged}
    fit_quality_json = Column(String, nullable=False, default="{}")
    # JSON: list of residuals (y - pred) for bootstrap CI
    residuals_json = Column(String, nullable=False, default="[]")
    # MD5 hash of WeeklyData rows used for fit, to detect staleness
    source_data_hash = Column(String, nullable=False, default="", index=True)
    # 'fit' | 'manual_override' | 'config_default'
    source = Column(String, nullable=False, default="fit")


class SalesStockData(Base):
    __tablename__ = "sales_stock_data"

    id = Column(Integer, primary_key=True, autoincrement=True)
    campaign_id = Column(Integer, ForeignKey("campaigns.id"), nullable=True, index=True)
    week = Column(String, nullable=False, index=True)
    channel = Column(String, default="")
    product = Column(String, default="")
    region = Column(String, default="", index=True)
    segment = Column(String, default="", index=True)
    sales_units = Column(Integer, default=0)
    sales_revenue = Column(Float, default=0.0)
    stock_units = Column(Integer, default=0)
    stock_value = Column(Float, default=0.0)
    returns = Column(Integer, default=0)
    new_customers = Column(Integer, default=0)
    repeat_customers = Column(Integer, default=0)
