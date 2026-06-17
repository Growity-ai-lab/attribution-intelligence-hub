"""Tests for Unified scoring functions (DDA-only)."""

import pytest

from backend.models.unified import suggest_reallocation


class TestReallocation:
    def test_basic_reallocation(self):
        scores = {
            "meta": {"unified_score": 0.6, "dda_score": 0.6},
            "google": {"unified_score": 0.4, "dda_score": 0.4},
        }
        budgets = {"meta": 50_000, "google": 50_000}
        result = suggest_reallocation(scores, budgets)

        assert result["meta"]["suggested"] > result["google"]["suggested"]
        total_suggested = result["meta"]["suggested"] + result["google"]["suggested"]
        assert total_suggested == pytest.approx(100_000)

    def test_custom_total_budget(self):
        scores = {
            "a": {"unified_score": 1.0, "dda_score": 1.0},
        }
        result = suggest_reallocation(scores, {"a": 50_000}, total_budget=200_000)
        assert result["a"]["suggested"] == pytest.approx(200_000)

    def test_dda_score_fallback(self):
        """When unified_score is missing, falls back to dda_score."""
        scores = {
            "meta": {"dda_score": 0.7},
            "google": {"dda_score": 0.3},
        }
        budgets = {"meta": 50_000, "google": 50_000}
        result = suggest_reallocation(scores, budgets)
        assert result["meta"]["share"] == pytest.approx(0.7)
        assert result["google"]["share"] == pytest.approx(0.3)


# --------------- Reallocation API Tests ---------------

from fastapi.testclient import TestClient
from backend.auth import create_access_token
from backend.main import app

_client = TestClient(app)
_auth_headers = {"Authorization": f"Bearer {create_access_token(data={'sub': 'admin', 'role': 'admin'})}"}


class TestReallocationAPI:
    """Tests for POST /api/unified/reallocation endpoint."""

    _report = {
        "meta": {"unified_score": 0.6, "dda_score": 0.6},
        "google": {"unified_score": 0.4, "dda_score": 0.4},
    }
    _budgets = {"meta": 100_000, "google": 50_000}

    def test_basic_response_format(self):
        r = _client.post(
            "/api/unified/reallocation",
            json={"unified_report": self._report, "current_budgets": self._budgets},
            headers=_auth_headers,
        )
        assert r.status_code == 200
        data = r.json()
        assert "total_budget" in data
        assert "suggestions" in data
        assert data["total_budget"] == pytest.approx(150_000)
        for ch in ("meta", "google"):
            s = data["suggestions"][ch]
            assert "current" in s
            assert "suggested" in s
            assert "delta" in s
            assert "share" in s

    def test_budget_sum_preserved(self):
        r = _client.post(
            "/api/unified/reallocation",
            json={"unified_report": self._report, "current_budgets": self._budgets},
            headers=_auth_headers,
        )
        data = r.json()
        total = sum(s["suggested"] for s in data["suggestions"].values())
        assert total == pytest.approx(data["total_budget"])

    def test_custom_total_budget_endpoint(self):
        r = _client.post(
            "/api/unified/reallocation",
            json={
                "unified_report": self._report,
                "current_budgets": self._budgets,
                "total_budget": 200_000,
            },
            headers=_auth_headers,
        )
        assert r.status_code == 200
        assert r.json()["total_budget"] == pytest.approx(200_000)

    def test_empty_report_rejected(self):
        r = _client.post(
            "/api/unified/reallocation",
            json={"unified_report": {}, "current_budgets": self._budgets},
            headers=_auth_headers,
        )
        assert r.status_code == 422

    def test_empty_budgets_rejected(self):
        r = _client.post(
            "/api/unified/reallocation",
            json={"unified_report": self._report, "current_budgets": {}},
            headers=_auth_headers,
        )
        assert r.status_code == 422

    def test_negative_budget_rejected(self):
        r = _client.post(
            "/api/unified/reallocation",
            json={
                "unified_report": self._report,
                "current_budgets": {"meta": -1000},
            },
            headers=_auth_headers,
        )
        assert r.status_code == 400
        assert "Negative budget" in r.json()["detail"]

    def test_negative_total_budget_rejected(self):
        r = _client.post(
            "/api/unified/reallocation",
            json={
                "unified_report": self._report,
                "current_budgets": self._budgets,
                "total_budget": -500,
            },
            headers=_auth_headers,
        )
        assert r.status_code == 400
        assert "Total budget cannot be negative" in r.json()["detail"]
