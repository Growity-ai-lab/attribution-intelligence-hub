"""Tests for Marketing Mix Model functions."""

import pytest

from backend.models.mmm import (
    compute_adstock,
    compute_channel_contribution,
    compute_response,
    compute_saturation,
    decompose_contributions,
)


class TestAdstock:
    def test_empty_spend(self):
        assert compute_adstock([], 0.5) == []

    def test_single_value(self):
        result = compute_adstock([1000.0], 0.5)
        assert result == [1000.0]

    def test_decay_accumulation(self):
        result = compute_adstock([1000.0, 1000.0, 1000.0], 0.5)
        assert result[0] == 1000.0
        assert result[1] == 1000.0 + 0.5 * 1000.0  # 1500
        assert result[2] == 1000.0 + 0.5 * 1500.0  # 1750

    def test_zero_decay(self):
        result = compute_adstock([1000.0, 1000.0, 1000.0], 0.0)
        assert result == [1000.0, 1000.0, 1000.0]

    def test_full_decay(self):
        result = compute_adstock([1000.0, 0.0, 0.0], 1.0)
        assert result == [1000.0, 1000.0, 1000.0]

    def test_invalid_decay(self):
        with pytest.raises(ValueError):
            compute_adstock([100.0], 1.5)
        with pytest.raises(ValueError):
            compute_adstock([100.0], -0.1)

    def test_tv_high_decay(self):
        """TV has high decay (0.75), effect should persist."""
        result = compute_adstock([1_000_000.0, 0.0, 0.0, 0.0], 0.75)
        assert result[0] == 1_000_000.0
        assert result[1] == 750_000.0
        assert result[2] == pytest.approx(562_500.0)
        assert result[3] == pytest.approx(421_875.0)

    def test_google_low_decay(self):
        """Google has low decay (0.10), effect should drop fast."""
        result = compute_adstock([1_000_000.0, 0.0, 0.0], 0.10)
        assert result[1] == pytest.approx(100_000.0)
        assert result[2] == pytest.approx(10_000.0)


class TestSaturation:
    def test_zero_input(self):
        assert compute_saturation(0, 1_000_000, 1.0) == 0.0

    def test_negative_input(self):
        assert compute_saturation(-100, 1_000_000, 1.0) == 0.0

    def test_at_half_saturation(self):
        """At x = alpha, saturation should be 0.5."""
        result = compute_saturation(1_000_000, 1_000_000, 1.0)
        assert result == pytest.approx(0.5)

    def test_high_input_approaches_one(self):
        result = compute_saturation(100_000_000, 1_000_000, 1.0)
        assert result > 0.99

    def test_gamma_effect(self):
        """Higher gamma = steeper curve."""
        low_gamma = compute_saturation(500_000, 1_000_000, 0.8)
        high_gamma = compute_saturation(500_000, 1_000_000, 2.0)
        # With higher gamma, below half-sat point the value is lower
        assert high_gamma < low_gamma

    def test_invalid_alpha(self):
        with pytest.raises(ValueError):
            compute_saturation(100, 0, 1.0)
        with pytest.raises(ValueError):
            compute_saturation(100, -1, 1.0)

    def test_invalid_gamma(self):
        with pytest.raises(ValueError):
            compute_saturation(100, 1000, 0)
        with pytest.raises(ValueError):
            compute_saturation(100, 1000, -1)


class TestResponse:
    def test_zero_saturation(self):
        result = compute_response(0.0, 100.0, 500.0)
        assert result == 100.0

    def test_full_saturation(self):
        result = compute_response(1.0, 100.0, 500.0)
        assert result == 600.0

    def test_half_saturation(self):
        result = compute_response(0.5, 100.0, 500.0)
        assert result == 350.0


class TestChannelContribution:
    def test_basic_pipeline(self):
        result = compute_channel_contribution(
            spend_series=[1_000_000, 1_000_000, 0],
            decay=0.5,
            alpha=1_000_000,
            gamma=1.0,
            baseline=10.0,
            max_lift=100.0,
        )
        assert "adstocked" in result
        assert "saturated" in result
        assert "response" in result
        assert len(result["response"]) == 3
        # All responses should be >= baseline
        assert all(r >= 10.0 for r in result["response"])


class TestDecomposeContributions:
    def test_multi_channel(self):
        result = decompose_contributions(
            channel_spends={
                "meta": [2_600_000, 2_800_000],
                "google": [300_000, 320_000],
            },
            adstock_params={"meta": 0.35, "google": 0.10},
            saturation_params={
                "meta": (2_500_000, 1.2),
                "google": (300_000, 1.5),
            },
            max_lift={"meta": 1200, "google": 600},
            baseline=120.0,
        )
        assert "meta" in result
        assert "google" in result
        assert len(result["meta"]) == 2
        assert len(result["google"]) == 2
