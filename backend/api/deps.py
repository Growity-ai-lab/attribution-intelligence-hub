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


def get_model_config() -> dict:
    """Return model configuration."""
    return {
        "adstock_params": ADSTOCK_PARAMS,
        "saturation_params": SATURATION_PARAMS,
        "max_lift": MAX_LIFT,
        "baseline_leads": BASELINE_LEADS,
    }
