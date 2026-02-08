"""SQLAlchemy ORM models."""

from sqlalchemy import Column, Float, Integer, String

from backend.db.database import Base


class WeeklyData(Base):
    __tablename__ = "weekly_data"

    id = Column(Integer, primary_key=True, autoincrement=True)
    week = Column(String, nullable=False, index=True)
    channel = Column(String, nullable=False, index=True)
    spend = Column(Float, default=0.0)
    impressions = Column(Integer, default=0)
    clicks = Column(Integer, default=0)
    leads = Column(Integer, default=0)
    grp = Column(Float, default=0.0)
    spot_count = Column(Integer, default=0)


class TouchpointData(Base):
    __tablename__ = "touchpoint_data"

    id = Column(Integer, primary_key=True, autoincrement=True)
    lead_id = Column(String, nullable=False, index=True)
    timestamp = Column(String, nullable=False)
    channel = Column(String, nullable=False)
    touchpoint_type = Column(String, nullable=False)
    campaign = Column(String, default="")
    segment = Column(String, default="")
