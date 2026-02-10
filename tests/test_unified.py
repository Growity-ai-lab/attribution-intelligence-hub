"""Tests for Unified scoring functions (DDA-integrated)."""

import pytest

from backend.models.unified import (
    compute_unified_report,
    compute_unified_score,
    suggest_reallocation,
)


class TestUnifiedScore:
    def test_default_weights(self):
        """DDA=0.50, MMM=0.35, INC=0.15."""
        result = compute_unified_score(
            mmm_score=100.0, dda_score=100.0, incrementality_score=100.0
        )
        expected = 100.0 * 0.50 + 100.0 * 0.35 + 100.0 * 0.15
        assert result == pytest.approx(expected)

    def test_custom_weights(self):
        result = compute_unified_score(
            mmm_score=100.0,
            dda_score=200.0,
            incrementality_score=50.0,
            weights={"mmm": 0.40, "dda": 0.40, "incrementality": 0.20},
        )
        expected = 200.0 * 0.40 + 100.0 * 0.40 + 50.0 * 0.20
        assert result == pytest.approx(expected)

    def test_zero_scores(self):
        result = compute_unified_score(0.0, 0.0, 0.0)
        assert result == 0.0

    def test_dda_dominant(self):
        """DDA has highest weight (0.50), should have most influence."""
        high_dda = compute_unified_score(50.0, 100.0, 50.0)
        high_mmm = compute_unified_score(100.0, 50.0, 50.0)
        assert high_dda > high_mmm


class TestUnifiedReport:
    def test_basic_report(self):
        mmm = {"meta": 1200.0, "google": 600.0}
        dda = {"meta": 1000.0, "google": 500.0}
        result = compute_unified_report(mmm, dda)

        assert "meta" in result
        assert "google" in result
        assert "unified_score" in result["meta"]
        assert result["meta"]["mmm_score"] == 1200.0
        assert result["meta"]["dda_score"] == 1000.0

    def test_missing_incrementality_defaults_to_one(self):
        result = compute_unified_report(
            mmm_scores={"meta": 100.0},
            dda_scores={"meta": 100.0},
        )
        assert result["meta"]["incrementality_score"] == 1.0

    def test_channels_union(self):
        """Report should include channels from both MMM and DDA."""
        result = compute_unified_report(
            mmm_scores={"meta": 100.0},
            dda_scores={"google": 200.0},
        )
        assert "meta" in result
        assert "google" in result


class TestReallocation:
    def test_basic_reallocation(self):
        scores = {
            "meta": {"unified_score": 0.6, "mmm_score": 0, "dda_score": 0, "incrementality_score": 0},
            "google": {"unified_score": 0.4, "mmm_score": 0, "dda_score": 0, "incrementality_score": 0},
        }
        budgets = {"meta": 50_000, "google": 50_000}
        result = suggest_reallocation(scores, budgets)

        assert result["meta"]["suggested"] > result["google"]["suggested"]
        total_suggested = result["meta"]["suggested"] + result["google"]["suggested"]
        assert total_suggested == pytest.approx(100_000)

    def test_custom_total_budget(self):
        scores = {
            "a": {"unified_score": 1.0, "mmm_score": 0, "dda_score": 0, "incrementality_score": 0},
        }
        result = suggest_reallocation(scores, {"a": 50_000}, total_budget=200_000)
        assert result["a"]["suggested"] == pytest.approx(200_000)


# --------------- Reallocation API Tests ---------------

from fastapi.testclient import TestClient
from backend.auth import create_access_token
from backend.main import app

_client = TestClient(app)
_auth_headers = {"Authorization": f"Bearer {create_access_token(data={'sub': 'admin', 'role': 'admin'})}"}


class TestReallocationAPI:
    """Tests for POST /api/unified/reallocation endpoint."""

    _report = {
        "meta": {"unified_score": 0.6, "mmm_score": 0.3, "dda_score": 0.5, "incrementality_score": 1.0},
        "google": {"unified_score": 0.4, "mmm_score": 0.2, "dda_score": 0.3, "incrementality_score": 1.0},
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
