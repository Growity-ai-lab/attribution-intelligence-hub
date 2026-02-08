"""Tests for Multi-Touch Attribution functions."""

import pytest

from backend.models.mta import (
    aggregate_shapley_paths,
    position_based_attribution,
    shapley_value,
)


class TestShapleyValue:
    def test_single_channel(self):
        vf = {
            frozenset(): 0.0,
            frozenset({"meta"}): 1.0,
        }
        result = shapley_value(["meta"], vf)
        assert result["meta"] == pytest.approx(1.0)

    def test_two_channels_equal(self):
        """Two channels with symmetric contribution."""
        vf = {
            frozenset(): 0.0,
            frozenset({"meta"}): 0.5,
            frozenset({"google"}): 0.5,
            frozenset({"meta", "google"}): 1.0,
        }
        result = shapley_value(["meta", "google"], vf)
        assert result["meta"] == pytest.approx(0.5)
        assert result["google"] == pytest.approx(0.5)

    def test_two_channels_asymmetric(self):
        """One channel contributes more alone."""
        vf = {
            frozenset(): 0.0,
            frozenset({"meta"}): 0.7,
            frozenset({"google"}): 0.3,
            frozenset({"meta", "google"}): 1.0,
        }
        result = shapley_value(["meta", "google"], vf)
        assert result["meta"] > result["google"]
        assert result["meta"] + result["google"] == pytest.approx(1.0)

    def test_three_channels(self):
        """Shapley values should sum to grand coalition value."""
        vf = {
            frozenset(): 0.0,
            frozenset({"a"}): 0.3,
            frozenset({"b"}): 0.2,
            frozenset({"c"}): 0.1,
            frozenset({"a", "b"}): 0.6,
            frozenset({"a", "c"}): 0.5,
            frozenset({"b", "c"}): 0.4,
            frozenset({"a", "b", "c"}): 1.0,
        }
        result = shapley_value(["a", "b", "c"], vf)
        total = sum(result.values())
        assert total == pytest.approx(1.0)


class TestPositionBased:
    def test_empty_path(self):
        assert position_based_attribution([]) == {}

    def test_single_touch(self):
        result = position_based_attribution(["meta"])
        assert result == {"meta": 1.0}

    def test_two_touches(self):
        result = position_based_attribution(["meta", "google"])
        assert result["meta"] == pytest.approx(0.30)
        assert result["google"] == pytest.approx(0.35)
        # Middle weight goes unused with only 2 touches, but first+last = 0.65
        # Actually with 2 touches, there are no middle touches
        total = sum(result.values())
        assert total == pytest.approx(0.65)

    def test_three_touches(self):
        result = position_based_attribution(["meta", "tiktok", "google"])
        assert result["meta"] == pytest.approx(0.30)
        assert result["google"] == pytest.approx(0.35)
        assert result["tiktok"] == pytest.approx(0.35)
        total = sum(result.values())
        assert total == pytest.approx(1.0)

    def test_five_touches(self):
        path = ["meta", "tiktok", "linkedin", "youtube", "google"]
        result = position_based_attribution(path)
        assert result["meta"] == pytest.approx(0.30)
        assert result["google"] == pytest.approx(0.35)
        # 3 middle touches share 0.35
        per_middle = 0.35 / 3
        assert result["tiktok"] == pytest.approx(per_middle)
        assert result["linkedin"] == pytest.approx(per_middle)
        assert result["youtube"] == pytest.approx(per_middle)

    def test_custom_weights(self):
        result = position_based_attribution(
            ["a", "b", "c"], first_weight=0.40, last_weight=0.40
        )
        assert result["a"] == pytest.approx(0.40)
        assert result["c"] == pytest.approx(0.40)
        assert result["b"] == pytest.approx(0.20)


class TestAggregateShapley:
    def test_single_path(self):
        result = aggregate_shapley_paths([["meta", "google"]])
        assert "meta" in result
        assert "google" in result
        total = sum(result.values())
        assert total == pytest.approx(1.0)

    def test_multiple_paths(self):
        paths = [
            ["meta", "google"],
            ["meta", "tiktok"],
            ["google", "tiktok", "meta"],
        ]
        result = aggregate_shapley_paths(paths)
        assert "meta" in result
        assert "google" in result
        assert "tiktok" in result
        total = sum(result.values())
        assert total == pytest.approx(3.0)  # 3 conversions * 1.0 each

    def test_weighted_conversions(self):
        paths = [["meta", "google"]]
        result = aggregate_shapley_paths(paths, conversions=[10.0])
        total = sum(result.values())
        assert total == pytest.approx(10.0)
