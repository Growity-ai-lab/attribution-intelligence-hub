"""Authentication module — JWT tokens + password hashing."""

import logging
import os
import secrets
from datetime import datetime, timedelta, timezone

from jose import JWTError, jwt
from passlib.context import CryptContext

_log = logging.getLogger(__name__)

_env_secret = os.environ.get("AUTH_SECRET_KEY", "")
if not _env_secret:
    _env_secret = secrets.token_urlsafe(48)
    _log.warning(
        "AUTH_SECRET_KEY not set — using random ephemeral key. "
        "Tokens will NOT survive restarts. Set AUTH_SECRET_KEY in production."
    )
SECRET_KEY = _env_secret
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.environ.get("AUTH_TOKEN_EXPIRE_MINUTES", "480"))  # 8 hours

# Default admin credentials — override via env vars
ADMIN_USERNAME = os.environ.get("AUTH_ADMIN_USER", "admin")
ADMIN_PASSWORD_HASH: str | None = None

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def _get_admin_hash() -> str:
    """Lazily compute the admin password hash."""
    global ADMIN_PASSWORD_HASH
    if ADMIN_PASSWORD_HASH is None:
        raw = os.environ.get("AUTH_ADMIN_PASSWORD", "")
        if not raw:
            raw = secrets.token_urlsafe(24)
            _log.warning(
                "AUTH_ADMIN_PASSWORD not set — using random ephemeral password. "
                "Login will fail on restart. Set AUTH_ADMIN_PASSWORD in production."
            )
        ADMIN_PASSWORD_HASH = pwd_context.hash(raw)
    return ADMIN_PASSWORD_HASH


def verify_password(plain_password: str, hashed_password: str) -> bool:
    return pwd_context.verify(plain_password, hashed_password)


def authenticate_user(username: str, password: str) -> dict | None:
    """Authenticate against the admin account. Returns user dict or None."""
    if username != ADMIN_USERNAME:
        return None
    if not verify_password(password, _get_admin_hash()):
        return None
    return {"username": username, "role": "admin"}


def create_access_token(data: dict, expires_delta: timedelta | None = None) -> str:
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + (expires_delta or timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES))
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


def decode_token(token: str) -> dict | None:
    """Decode and validate a JWT token. Returns payload or None."""
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username: str | None = payload.get("sub")
        if username is None:
            return None
        return payload
    except JWTError:
        return None
