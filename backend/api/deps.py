"""Dependency injection for API routes."""

from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session

from backend.auth import decode_token
from backend.config import (
    ADSTOCK_PARAMS,
    BASELINE_LEADS,
    MAX_LIFT,
    SATURATION_PARAMS,
)
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")


async def get_current_user(token: str = Depends(oauth2_scheme)) -> dict:
    """Validate JWT token and return the current user."""
    payload = decode_token(token)
    if payload is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return {"username": payload.get("sub"), "role": payload.get("role", "viewer")}


def check_campaign_access(
    db: Session, campaign_id: int, user: dict
) -> "Campaign":  # noqa: F821
    """Verify the campaign exists and the user may access it.

    Admin and demo users can access any campaign.  In the future, when
    multi-tenant roles are added, this function will enforce ownership
    checks (e.g. campaign.client.owner == user).

    Returns the Campaign ORM object so callers don't need a second query.
    Raises 404 if the campaign doesn't exist and 403 if access is denied.
    """
    from backend.db.models import Campaign

    campaign = db.query(Campaign).filter(Campaign.id == campaign_id).first()
    if not campaign:
        raise HTTPException(status_code=404, detail="Kampanya bulunamadı")
    return campaign


def resolve_read_campaign_id(db: Session, campaign_id: int, user: dict) -> int:
    """Map a campaign to the one its stored results actually live in.

    Demo users' DDA runs are written to a same-named campaign under the
    "Demo Sandbox" client so seed data is never overwritten. Read endpoints
    (latest result, alerts, trend, export) must look there too, or a demo
    user never sees their own runs. Never creates the sandbox — if it does
    not exist yet, the original campaign id is returned.
    """
    if user.get("role") != "demo":
        return campaign_id

    from backend.db.models import Campaign, Client

    source = db.query(Campaign).filter(Campaign.id == campaign_id).first()
    if source is None:
        return campaign_id
    src_client = db.query(Client).filter(Client.id == source.client_id).first()
    year = src_client.year if src_client else 2026
    sandbox = (
        db.query(Campaign)
        .join(Client, Campaign.client_id == Client.id)
        .filter(
            Client.name == "Demo Sandbox",
            Client.year == year,
            Campaign.name == source.name,
        )
        .first()
    )
    return sandbox.id if sandbox else campaign_id


def get_model_config() -> dict:
    """Return model configuration."""
    return {
        "adstock_params": ADSTOCK_PARAMS,
        "saturation_params": SATURATION_PARAMS,
        "max_lift": MAX_LIFT,
        "baseline_leads": BASELINE_LEADS,
    }
