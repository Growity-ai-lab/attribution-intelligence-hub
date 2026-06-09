"""Shared test fixtures for Time's Hub | Attribution Intelligence."""

import io
import os

os.environ.setdefault("AUTH_SECRET_KEY", "test-secret-key-for-ci")
os.environ.setdefault("AUTH_ADMIN_PASSWORD", "test-password-for-ci")

import pytest
from fastapi.testclient import TestClient

from backend.auth import create_access_token
from backend.main import app


@pytest.fixture()
def client():
    """FastAPI test client."""
    return TestClient(app)


@pytest.fixture()
def auth_headers():
    """Return Authorization headers with a valid JWT token for test requests."""
    token = create_access_token(data={"sub": "admin", "role": "admin"})
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture()
def sample_journeys_csv():
    """Minimal CRM touchpoint CSV with known conversion outcomes.

    4 leads: L1 converted, L2 converted, L3 not converted, L4 not converted.
    """
    csv = (
        "lead_id,timestamp,channel,touchpoint_type,campaign,segment,converted,session_id\n"
        "L1,2026-01-15 10:00,meta,impression,camp1,S1,0,s01\n"
        "L1,2026-01-16 14:00,google,click,search,S1,0,s02\n"
        "L1,2026-01-16 14:05,form,submit,lp,S1,1,s02\n"
        "L2,2026-01-15 09:00,tiktok,view,video,S1,0,s03\n"
        "L2,2026-01-17 11:00,meta,click,retarget,S1,0,s04\n"
        "L2,2026-01-18 09:00,google,click,search,S1,0,s05\n"
        "L2,2026-01-18 09:05,form,submit,lp,S1,1,s05\n"
        "L3,2026-01-14 08:00,linkedin,impression,aware,S2,0,s06\n"
        "L3,2026-01-16 10:00,meta,click,lead,S2,0,s07\n"
        "L4,2026-01-15 12:00,meta,impression,lead,S1,0,s08\n"
        "L4,2026-01-16 08:00,dv360,impression,display,S1,0,s09\n"
    )
    return csv.encode()


@pytest.fixture()
def sample_weekly_csv():
    """Minimal weekly channel CSV."""
    csv = (
        "week,channel,spend,impressions,clicks,leads\n"
        "2026-W06,meta,2600000,4500000,85000,1050\n"
        "2026-W06,google,300000,800000,24000,520\n"
    )
    return csv.encode()


@pytest.fixture()
def minimal_journeys():
    """Minimal journey list for DDA JSON endpoint."""
    return [
        {"lead_id": "L1", "channels": ["meta", "google"], "converted": True, "segment": "S1"},
        {"lead_id": "L2", "channels": ["tiktok", "meta", "google"], "converted": True, "segment": "S1"},
        {"lead_id": "L3", "channels": ["meta"], "converted": False, "segment": "S1"},
        {"lead_id": "L4", "channels": ["google", "meta"], "converted": False, "segment": "S2"},
        {"lead_id": "L5", "channels": ["meta", "google"], "converted": True, "segment": "S1"},
    ]
