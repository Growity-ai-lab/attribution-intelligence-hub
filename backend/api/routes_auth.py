"""Health check and authentication endpoints."""

import logging
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.security import OAuth2PasswordRequestForm
from slowapi import Limiter
from slowapi.util import get_remote_address
from backend.api.deps import get_current_user
from backend.auth import authenticate_user, create_access_token

router = APIRouter()

logger = logging.getLogger(__name__)


@router.get("/health")
def health_check():
    """Health check endpoint for Render / load balancers."""
    return {"status": "ok"}


_limiter = Limiter(key_func=get_remote_address)


@router.post("/auth/login")
@_limiter.limit("5/minute")
async def login(request: Request, form_data: OAuth2PasswordRequestForm = Depends()) -> dict:
    """Authenticate and return a JWT access token."""
    user = authenticate_user(form_data.username, form_data.password)
    if not user:
        raise HTTPException(status_code=401, detail="Incorrect username or password")
    token = create_access_token(data={"sub": user["username"], "role": user["role"]})
    return {"access_token": token, "token_type": "bearer"}


@router.post("/auth/demo")
@_limiter.limit("10/minute")
async def demo_login(request: Request) -> dict:
    """Generate a demo access token — no credentials required."""
    token = create_access_token(data={"sub": "demo", "role": "demo"})
    return {"access_token": token, "token_type": "bearer"}


@router.get("/auth/me")
async def get_me(current_user: dict = Depends(get_current_user)) -> dict:
    """Return the current authenticated user."""
    return current_user
