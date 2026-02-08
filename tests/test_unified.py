"""Tests for Unified scoring functions."""

import pytest

from backend.models.unified import (
    compute_unified_report,
    compute_unified_score,
    suggest_reallocation,
)


class TestUnifiedScore:
    def test_default_weights(self):
        """MTA=0.50, MMM=0.35, INC=0.15."""
        result = compute_unified_score(
            mmm_score=100.0, mta_score=100.0, incrementality_score=100.0
        )
        expected = 100.0 * 0.50 + 100.0 * 0.35 + 100.0 * 0.15
        assert result == pytest.approx(expected)

    def test_custom_weights(self):
        result = compute_unified_score(
            mmm_score=100.0,
            mta_score=200.0,
            incrementality_score=50.0,
            weights={"mmm": 0.40, "mta": 0.40, "incrementality": 0.20},
        )
        expected = 200.0 * 0.40 + 100.0 * 0.40 + 50.0 * 0.20
        assert result == pytest.approx(expected)

    def test_zero_scores(self):
        result = compute_unified_score(0.0, 0.0, 0.0)
        assert result == 0.0

    def test_mta_dominant(self):
        """MTA has highest weight (0.50), should have most influence."""
        high_mta = compute_unified_score(50.0, 100.0, 50.0)
        high_mmm = compute_unified_score(100.0, 50.0, 50.0)
        assert high_mta > high_mmm


class TestUnifiedReport:
    def test_basic_report(self):
        mmm = {"meta": 1200.0, "google": 600.0}
        mta = {"meta": 1000.0, "google": 500.0}
        result = compute_unified_report(mmm, mta)

        assert "meta" in result
        assert "google" in result
        assert "unified_score" in result["meta"]
        assert result["meta"]["mmm_score"] == 1200.0
        assert result["meta"]["mta_score"] == 1000.0

    def test_missing_incrementality_defaults_to_one(self):
        result = compute_unified_report(
            mmm_scores={"meta": 100.0},
            mta_scores={"meta": 100.0},
        )
        assert result["meta"]["incrementality_score"] == 1.0

    def test_channels_union(self):
        """Report should include channels from both MMM and MTA."""
        result = compute_unified_report(
            mmm_scores={"meta": 100.0},
            mta_scores={"google": 200.0},
        )
        assert "meta" in result
        assert "google" in result


class TestReallocation:
    def test_basic_reallocation(self):
        scores = {
            "meta": {"unified_score": 0.6, "mmm_score": 0, "mta_score": 0, "incrementality_score": 0},
            "google": {"unified_score": 0.4, "mmm_score": 0, "mta_score": 0, "incrementality_score": 0},
        }
        budgets = {"meta": 50_000, "google": 50_000}
        result = suggest_reallocation(scores, budgets)

        assert result["meta"]["suggested"] > result["google"]["suggested"]
        total_suggested = result["meta"]["suggested"] + result["google"]["suggested"]
        assert total_suggested == pytest.approx(100_000)

    def test_custom_total_budget(self):
        scores = {
            "a": {"unified_score": 1.0, "mmm_score": 0, "mta_score": 0, "incrementality_score": 0},
        }
        result = suggest_reallocation(scores, {"a": 50_000}, total_budget=200_000)
        assert result["a"]["suggested"] == pytest.approx(200_000)
