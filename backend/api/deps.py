"""Dependency injection for API routes."""

from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer

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


def get_model_config() -> dict:
    """Return model configuration."""
    return {
        "adstock_params": ADSTOCK_PARAMS,
        "saturation_params": SATURATION_PARAMS,
        "max_lift": MAX_LIFT,
        "baseline_leads": BASELINE_LEADS,
    }
