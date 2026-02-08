"""Multi-Touch Attribution — Shapley Value computation.

Pure functions for computing Shapley values from touchpoint paths.
"""

from itertools import combinations
from collections import defaultdict


def shapley_value(
    channels: list[str],
    value_function: dict[frozenset[str], float],
) -> dict[str, float]:
    """Compute Shapley values for a set of channels.

    Args:
        channels: List of unique channel names in the path.
        value_function: Maps each subset of channels to its value
                       (e.g., conversion probability).

    Returns:
        Dict mapping each channel to its Shapley value.
    """
    n = len(channels)
    shapley: dict[str, float] = {}

    for ch in channels:
        total = 0.0
        others = [c for c in channels if c != ch]

        for size in range(n):
            for subset in combinations(others, size):
                s = frozenset(subset)
                s_with = frozenset(subset) | {ch}
                v_with = value_function.get(s_with, 0.0)
                v_without = value_function.get(s, 0.0)
                marginal = v_with - v_without

                # Weight: |S|! * (n - |S| - 1)! / n!
                weight = (
                    _factorial(len(s))
                    * _factorial(n - len(s) - 1)
                    / _factorial(n)
                )
                total += weight * marginal

        shapley[ch] = total

    return shapley


def position_based_attribution(
    path: list[str],
    first_weight: float = 0.30,
    last_weight: float = 0.35,
) -> dict[str, float]:
    """Position-based attribution for a single conversion path.

    Args:
        path: Ordered list of channel touchpoints.
        first_weight: Credit for first touch.
        last_weight: Credit for last touch.

    Returns:
        Dict mapping channel to attributed credit (sums to 1.0).
    """
    if not path:
        return {}
    if len(path) == 1:
        return {path[0]: 1.0}

    middle_weight = 1.0 - first_weight - last_weight
    credits: dict[str, float] = defaultdict(float)

    credits[path[0]] += first_weight
    credits[path[-1]] += last_weight

    if len(path) > 2:
        middle_count = len(path) - 2
        per_middle = middle_weight / middle_count
        for ch in path[1:-1]:
            credits[ch] += per_middle

    return dict(credits)


def aggregate_shapley_paths(
    paths: list[list[str]],
    conversions: list[float] | None = None,
) -> dict[str, float]:
    """Aggregate Shapley values across multiple conversion paths.

    For each path, computes Shapley values assuming equal value function
    (each subset's value is proportional to the number of channels present).

    Args:
        paths: List of conversion paths (each path is a list of channels).
        conversions: Optional conversion value per path (defaults to 1.0 each).

    Returns:
        Dict mapping channel to total Shapley-attributed value.
    """
    if conversions is None:
        conversions = [1.0] * len(paths)

    totals: dict[str, float] = defaultdict(float)

    for path, conv_value in zip(paths, conversions):
        unique_channels = list(dict.fromkeys(path))  # preserve order, dedupe
        if not unique_channels:
            continue

        # Simple equal-marginal value function:
        # value of a subset = |subset| / |all_channels|
        n = len(unique_channels)
        vf: dict[frozenset[str], float] = {}
        for size in range(n + 1):
            for subset in combinations(unique_channels, size):
                vf[frozenset(subset)] = len(subset) / n

        sv = shapley_value(unique_channels, vf)
        for ch, val in sv.items():
            totals[ch] += val * conv_value

    return dict(totals)


def _factorial(n: int) -> int:
    """Compute factorial of n."""
    if n <= 1:
        return 1
    result = 1
    for i in range(2, n + 1):
        result *= i
    return result
