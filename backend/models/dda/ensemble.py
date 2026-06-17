"""Ensemble DDA: Markov + Shapley blending.

Combines Markov removal-effect attribution with data-driven Shapley
for digital channel attribution.
"""

from backend.config import WEIGHT_SUM_TOLERANCE
from backend.models.dda.data_prep import (
    Journey,
    compute_assist_report,
    extract_top_paths,
    get_unique_channels,
    journey_stats,
    journeys_to_state_sequences,
)
from backend.models.dda.insights import generate_insights
from backend.models.dda.markov import run_markov_attribution
from backend.models.dda.shapley_dda import run_shapley_dda

# Default blend: Markov gets more weight (more robust with sparse data)
DEFAULT_MARKOV_WEIGHT = 0.65
DEFAULT_SHAPLEY_WEIGHT = 0.35

# Cross-validation deviation threshold
DEVIATION_THRESHOLD = 0.20  # 20%


def _normalize_weights(weights: dict[str, float]) -> dict[str, float]:
    """Normalize weight dict to sum to 1.0. Returns copy unchanged if sum is zero."""
    total = sum(weights.values())
    if total > 0:
        return {k: v / total for k, v in weights.items()}
    return dict(weights)


def classify_channels(
    channels: list[str],
) -> tuple[list[str], list[str]]:
    """Return all channels as online (digital-only hub).

    Args:
        channels: All channel names.

    Returns:
        Tuple of (online_channels, offline_channels). Offline is always empty.
    """
    return list(channels), []


def blend_attributions(
    markov_weights: dict[str, float],
    shapley_weights: dict[str, float],
    markov_blend: float = DEFAULT_MARKOV_WEIGHT,
    shapley_blend: float = DEFAULT_SHAPLEY_WEIGHT,
) -> dict[str, float]:
    """Blend Markov and Shapley attribution weights.

    Args:
        markov_weights: Channel -> Markov attribution weight.
        shapley_weights: Channel -> Shapley attribution weight.
        markov_blend: Weight for Markov in the blend.
        shapley_blend: Weight for Shapley in the blend.

    Returns:
        Blended attribution weights (normalized to sum to 1.0).
    """
    all_channels = set(markov_weights.keys()) | set(shapley_weights.keys())
    blended: dict[str, float] = {}

    for ch in all_channels:
        m = markov_weights.get(ch, 0.0)
        s = shapley_weights.get(ch, 0.0)
        blended[ch] = markov_blend * m + shapley_blend * s

    return _normalize_weights(blended)


def cross_validate_dda_mmm(
    dda_weights: dict[str, float],
    mmm_weights: dict[str, float],
    threshold: float = DEVIATION_THRESHOLD,
) -> dict[str, dict]:
    """Compare DDA and MMM attribution for online channels.

    Flags channels where the two models disagree by more than threshold.

    Args:
        dda_weights: Channel -> DDA attribution weight (online only).
        mmm_weights: Channel -> MMM attribution share (online only).
        threshold: Maximum acceptable relative deviation.

    Returns:
        Dict mapping channel -> {dda, mmm, deviation, flagged}.
    """
    # Normalize MMM weights to only online channels for fair comparison
    online_mmm = _normalize_weights(
        {ch: mmm_weights[ch] for ch in dda_weights if ch in mmm_weights}
    )

    report: dict[str, dict] = {}
    for ch in dda_weights:
        dda_val = dda_weights[ch]
        mmm_val = online_mmm.get(ch, 0.0)

        # Relative deviation: |dda - mmm| / max(dda, mmm)
        max_val = max(dda_val, mmm_val)
        deviation = abs(dda_val - mmm_val) / max_val if max_val > 0 else 0.0

        report[ch] = {
            "dda_weight": round(dda_val, 4),
            "mmm_weight": round(mmm_val, 4),
            "deviation": round(deviation, 4),
            "flagged": deviation > threshold,
        }

    return report


def build_hybrid_attribution(
    dda_online_weights: dict[str, float],
    mmm_offline_weights: dict[str, float],
    online_share: float | None = None,
    offline_share: float | None = None,
) -> dict[str, float]:
    """Merge DDA (online) and MMM (offline) into final attribution.

    If shares aren't given, they're derived from the number of channels.
    Online and offline weights are scaled by their respective share
    of the total budget or simply by channel count ratio.

    Args:
        dda_online_weights: Online channel -> DDA weight (sums to ~1).
        mmm_offline_weights: Offline channel -> MMM weight (sums to ~1).
        online_share: Fraction of total attribution for online (0-1).
        offline_share: Fraction of total attribution for offline (0-1).

    Returns:
        Final attribution weights across all channels (sums to 1.0).
    """
    n_online = len(dda_online_weights)
    n_offline = len(mmm_offline_weights)
    n_total = n_online + n_offline

    if online_share is None or offline_share is None:
        # Default: proportional to channel count
        online_share = n_online / n_total if n_total > 0 else 0.5
        offline_share = n_offline / n_total if n_total > 0 else 0.5

    combined: dict[str, float] = {}
    for ch, w in dda_online_weights.items():
        combined[ch] = w * online_share
    for ch, w in mmm_offline_weights.items():
        combined[ch] = w * offline_share

    return _normalize_weights(combined)


def run_full_dda_pipeline(
    journeys: list[Journey],
    mmm_channel_shares: dict[str, float] | None = None,
    prior_alpha: float = 0.5,
    markov_blend: float = DEFAULT_MARKOV_WEIGHT,
    shapley_blend: float = DEFAULT_SHAPLEY_WEIGHT,
    online_budget_share: float | None = None,
    offline_budget_share: float | None = None,
) -> dict:
    """Run the complete DDA pipeline (digital channels only).

    Pipeline:
    1. Extract channels from journeys
    2. Run Markov Chain attribution (Bayesian smoothed)
    3. Run Data-Driven Shapley attribution
    4. Blend Markov + Shapley for DDA weights

    Args:
        journeys: All journey data.
        mmm_channel_shares: Unused, kept for API compatibility.
        prior_alpha: Bayesian smoothing for Markov.
        markov_blend: Weight for Markov in DDA blend.
        shapley_blend: Weight for Shapley in DDA blend.
        online_budget_share: Unused, kept for API compatibility.
        offline_budget_share: Unused, kept for API compatibility.

    Returns:
        Full pipeline results dict.
    """
    if mmm_channel_shares is None:
        mmm_channel_shares = {}

    stats = journey_stats(journeys)
    all_journey_channels = get_unique_channels(journeys)
    online_channels, _ = classify_channels(all_journey_channels)

    # Step 1-2: Markov Chain
    sequences = journeys_to_state_sequences(journeys)
    markov_result = run_markov_attribution(sequences, online_channels, prior_alpha)

    # Step 3: Data-Driven Shapley
    shapley_weights = run_shapley_dda(journeys, online_channels)
    shapley_weights = _normalize_weights(shapley_weights)

    # Step 4: Blend
    hybrid_weights = blend_attributions(
        markov_result["attribution_weights"],
        shapley_weights,
        markov_blend,
        shapley_blend,
    )

    # Cross-validation (only when MMM shares are provided)
    cross_val = (
        cross_validate_dda_mmm(hybrid_weights, mmm_channel_shares)
        if mmm_channel_shares
        else {}
    )

    # Ensure weights sum to exactly 1.0 (correct float drift from chained normalizations)
    if hybrid_weights:
        hw_total = sum(hybrid_weights.values())
        if hw_total > 0 and abs(hw_total - 1.0) > WEIGHT_SUM_TOLERANCE:
            hybrid_weights = _normalize_weights(hybrid_weights)
        largest = max(hybrid_weights, key=hybrid_weights.get)
        hybrid_weights[largest] = 1.0 - sum(v for ch, v in hybrid_weights.items() if ch != largest)

    # Extract top conversion paths
    top_paths = extract_top_paths(journeys, top_n=15)

    # Assist report + insights
    assist_report = compute_assist_report(journeys)
    insights = generate_insights(
        assist_report=assist_report,
        hybrid_attribution=hybrid_weights,
        markov_weights=markov_result["attribution_weights"],
        shapley_weights=shapley_weights,
        cross_validation=[
            {"channel": ch, **vals} for ch, vals in cross_val.items()
        ],
        journey_stats=stats,
    )

    return {
        "journey_stats": stats,
        "top_paths": top_paths,
        "online_channels": online_channels,
        "offline_channels": [],
        "markov": {
            "conversion_probability": markov_result["conversion_probability"],
            "removal_effects": markov_result["removal_effects"],
            "attribution_weights": markov_result["attribution_weights"],
            "prior_alpha": prior_alpha,
            "warnings": markov_result.get("warnings", []),
        },
        "shapley_dda": shapley_weights,
        "blended_dda_online": hybrid_weights,
        "cross_validation": cross_val,
        "mmm_offline_weights": {},
        "hybrid_attribution": hybrid_weights,
        "assist_report": assist_report,
        "insights": insights,
    }
