"""FastAPI application entry point for Time's Hub | Attribution Intelligence."""

import os
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from slowapi import Limiter
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import FileResponse, Response

from backend.api.routes import router
from backend.api.routes_benchmarks import router as bench_router
from backend.api.routes_export import router as export_router
from backend.api.routes_media import router as media_router
from backend.db.database import Base, engine, migrate_add_columns
from backend.db.seed import seed_clients_and_campaigns

# Create all tables on startup, then migrate any missing columns
Base.metadata.create_all(bind=engine)
migrate_add_columns()

# Seed demo clients & campaigns (no-op if data already exists)
seed_clients_and_campaigns()

# Resolve paths relative to project root
PROJECT_ROOT = Path(__file__).resolve().parent.parent
DIST_DIR = PROJECT_ROOT / "frontend" / "dist"

# Rate limiter (applies to auth endpoints)
limiter = Limiter(key_func=get_remote_address)

# CORS origins: allow env override for production
_CORS_ORIGINS_DEFAULT = "http://localhost:5173,http://localhost:3000"
CORS_ORIGINS = [
    o.strip()
    for o in os.environ.get("CORS_ORIGINS", _CORS_ORIGINS_DEFAULT).split(",")
    if o.strip()
]


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """Add standard security headers to all responses."""

    async def dispatch(self, request: Request, call_next) -> Response:
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["X-XSS-Protection"] = "1; mode=block"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
        if os.environ.get("ENABLE_HSTS"):
            response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
        return response


app = FastAPI(
    title="Time's Hub | Attribution Intelligence",
    description="DDA attribution intelligence API for PO AutoMatic Filo",
    version="0.2.0",
)

app.state.limiter = limiter


@app.exception_handler(RateLimitExceeded)
async def _rate_limit_handler(request: Request, exc: RateLimitExceeded):
    return JSONResponse(
        status_code=429,
        content={"detail": "Çok fazla istek — lütfen biraz bekleyin."},
    )


app.add_middleware(SecurityHeadersMiddleware)

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "Accept", "Authorization"],
)

# API routes
app.include_router(router, prefix="/api")
app.include_router(media_router, prefix="/api")
app.include_router(bench_router, prefix="/api")
app.include_router(export_router, prefix="/api")

# Serve frontend static assets if build exists
if DIST_DIR.exists() and (DIST_DIR / "index.html").exists():
    # Mount /assets for JS/CSS bundles
    assets_dir = DIST_DIR / "assets"
    if assets_dir.exists():
        app.mount("/assets", StaticFiles(directory=str(assets_dir)), name="assets")

    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str) -> FileResponse:
        """Serve React SPA — any non-API route returns index.html."""
        file_path = (DIST_DIR / full_path).resolve()
        # Path traversal protection: only serve files inside DIST_DIR
        if full_path and file_path.is_relative_to(DIST_DIR) and file_path.is_file():
            return FileResponse(str(file_path))
        return FileResponse(str(DIST_DIR / "index.html"))
else:

    @app.get("/")
    def root() -> dict[str, str]:
        return {
            "status": "ok",
            "service": "Time's Hub | Attribution Intelligence",
            "hint": "Run 'npm run build' to enable the web UI",
        }
