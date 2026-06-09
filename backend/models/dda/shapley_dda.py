"""Data-Driven Shapley Attribution.

Unlike rule-based Shapley (equal-marginal assumption), this module
computes coalition values from actual journey conversion data.

For each subset of channels, estimates the conversion rate when
ONLY those channels are present in a journey.
"""

from collections import defaultdict
from itertools import combinations

from backend.models.dda.data_prep import Journey
from backend.models.mta import shapley_value


def compute_coalition_values(
    journeys: list[Journey],
    channels: list[str],
    min_observations: int = 5,
) -> dict[frozenset[str], float]:
    """Estimate coalition value function from journey data.

    For each subset of channels, computes the observed conversion rate
    when a journey's channel set is exactly (or is a superset of) that subset.

    Falls back to a size-based interpolation for coalitions with fewer
    than min_observations journeys.

    Args:
        journeys: List of Journey objects.
        channels: Channels to compute coalitions for.
        min_observations: Minimum journeys to trust a coalition's rate.

    Returns:
        Dict mapping frozenset of channels -> conversion probability.
    """
    # Count conversions per observed channel set
    set_conversions: dict[frozenset[str], list[bool]] = defaultdict(list)
    for j in journeys:
        channel_set = frozenset(ch for ch in set(j.channels) if ch in channels)
        set_conversions[channel_set].append(j.converted)

    # Overall conversion rate as baseline
    total_conv = sum(1 for j in journeys if j.converted)
    total = len(journeys)
    base_rate = total_conv / total if total > 0 else 0.0

    # Compute conversion rate grouped by coalition size for interpolation
    size_rates: dict[int, list[float]] = defaultdict(list)
    for ch_set, outcomes in set_conversions.items():
        if len(outcomes) >= min_observations:
            rate = sum(outcomes) / len(outcomes)
            size_rates[len(ch_set)].append(rate)

    avg_size_rate: dict[int, float] = {}
    for size, rates in size_rates.items():
        avg_size_rate[size] = sum(rates) / len(rates)

    # Build coalition values for all subsets
    n = len(channels)
    coalition_values: dict[frozenset[str], float] = {frozenset(): 0.0}

    for size in range(1, n + 1):
        for subset in combinations(channels, size):
            s = frozenset(subset)

            # Find journeys that contain at least this subset
            matching_outcomes: list[bool] = []
            for ch_set, outcomes in set_conversions.items():
                if s.issubset(ch_set):
                    matching_outcomes.extend(outcomes)

            if len(matching_outcomes) >= min_observations:
                coalition_values[s] = sum(matching_outcomes) / len(matching_outcomes)
            elif size in avg_size_rate:
                # Interpolate from average rate at this coalition size
                coalition_values[s] = avg_size_rate[size]
            else:
                # Monotonic estimate: scale base_rate by relative size
                coalition_values[s] = base_rate * (size / n) if n > 0 else 0.0

    return coalition_values


def run_shapley_dda(
    journeys: list[Journey],
    channels: list[str] | None = None,
    min_observations: int = 5,
) -> dict[str, float]:
    """Run data-driven Shapley attribution.

    Args:
        journeys: Journey data.
        channels: Channels to attribute (auto-detected if None).
        min_observations: Min observations per coalition.

    Returns:
        Dict mapping channel -> Shapley value.
    """
    if channels is None:
        ch_set: set[str] = set()
        for j in journeys:
            ch_set.update(j.channels)
        channels = sorted(ch_set)

    if not channels:
        return {}

    _MAX_SHAPLEY_CHANNELS = 15
    if len(channels) > _MAX_SHAPLEY_CHANNELS:
        raise ValueError(
            f"Shapley computation requires 2^n evaluations. "
            f"{len(channels)} channels exceeds the safe limit of {_MAX_SHAPLEY_CHANNELS}. "
            f"Use consolidate_channels() to reduce channel count first."
        )

    vf = compute_coalition_values(journeys, channels, min_observations)
    return shapley_value(channels, vf)
