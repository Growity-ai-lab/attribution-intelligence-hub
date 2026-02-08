"""Marketing Mix Model — Adstock, Saturation, and Response functions.

All functions are pure (no side effects) for testability.
"""

import numpy as np


def compute_adstock(spend: list[float], decay: float) -> list[float]:
    """Apply geometric adstock transformation.

    Formula: adstock[t] = spend[t] + decay * adstock[t-1]

    Args:
        spend: Raw spend values per time period.
        decay: Decay rate (lambda), between 0 and 1.

    Returns:
        Adstocked spend values.
    """
    if not spend:
        return []
    if not 0 <= decay <= 1:
        raise ValueError(f"Decay must be between 0 and 1, got {decay}")

    adstocked = [0.0] * len(spend)
    adstocked[0] = spend[0]
    for t in range(1, len(spend)):
        adstocked[t] = spend[t] + decay * adstocked[t - 1]
    return adstocked


def compute_saturation(x: float, alpha: float, gamma: float) -> float:
    """Apply Hill function saturation transformation.

    Formula: saturation(x) = x^gamma / (alpha^gamma + x^gamma)

    Args:
        x: Input value (typically adstocked spend).
        alpha: Half-saturation point.
        gamma: Curve shape parameter.

    Returns:
        Saturated value between 0 and 1.
    """
    if x <= 0:
        return 0.0
    if alpha <= 0:
        raise ValueError(f"Alpha must be positive, got {alpha}")
    if gamma <= 0:
        raise ValueError(f"Gamma must be positive, got {gamma}")

    x_g = x ** gamma
    a_g = alpha ** gamma
    return x_g / (a_g + x_g)


def compute_response(
    saturated_value: float, baseline: float, max_lift: float
) -> float:
    """Compute response (leads) from saturated value.

    Formula: response = baseline + max_lift * saturated_value

    Args:
        saturated_value: Output of saturation function (0 to 1).
        baseline: Baseline leads without media.
        max_lift: Maximum additional leads at full saturation.

    Returns:
        Estimated leads.
    """
    return baseline + max_lift * saturated_value


def compute_channel_contribution(
    spend_series: list[float],
    decay: float,
    alpha: float,
    gamma: float,
    baseline: float,
    max_lift: float,
) -> dict[str, list[float]]:
    """Full MMM pipeline for a single channel: adstock -> saturation -> response.

    Args:
        spend_series: Weekly spend values.
        decay: Adstock decay parameter.
        alpha: Hill function half-saturation.
        gamma: Hill function shape.
        baseline: Baseline leads.
        max_lift: Max additional leads.

    Returns:
        Dict with keys: adstocked, saturated, response.
    """
    adstocked = compute_adstock(spend_series, decay)
    saturated = [compute_saturation(v, alpha, gamma) for v in adstocked]
    response = [compute_response(s, baseline, max_lift) for s in saturated]

    return {
        "adstocked": adstocked,
        "saturated": saturated,
        "response": response,
    }


def decompose_contributions(
    channel_spends: dict[str, list[float]],
    adstock_params: dict[str, float],
    saturation_params: dict[str, tuple[float, float]],
    max_lift: dict[str, float],
    baseline: float,
) -> dict[str, list[float]]:
    """Decompose total response into per-channel contributions.

    Args:
        channel_spends: Dict mapping channel -> weekly spend list.
        adstock_params: Decay per channel.
        saturation_params: (alpha, gamma) per channel.
        max_lift: Max lift per channel.
        baseline: Total baseline leads.

    Returns:
        Dict mapping channel -> weekly attributed leads.
    """
    n_channels = len(channel_spends)
    per_channel_baseline = baseline / n_channels if n_channels > 0 else 0

    contributions: dict[str, list[float]] = {}
    for channel, spends in channel_spends.items():
        decay = adstock_params.get(channel, 0.0)
        alpha, gamma_val = saturation_params.get(channel, (1.0, 1.0))
        ml = max_lift.get(channel, 0.0)

        result = compute_channel_contribution(
            spends, decay, alpha, gamma_val, per_channel_baseline, ml
        )
        contributions[channel] = result["response"]

    return contributions
