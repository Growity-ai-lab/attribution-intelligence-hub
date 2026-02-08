"""Ensemble DDA: Markov + Shapley blending and cross-validation.

Combines Markov removal-effect attribution with data-driven Shapley,
and provides cross-validation against MMM decomposition to detect
and report deviations.
"""

from backend.models.dda.data_prep import (
    Journey,
    get_unique_channels,
    journey_stats,
    journeys_to_state_sequences,
)
from backend.models.dda.markov import run_markov_attribution
from backend.models.dda.shapley_dda import run_shapley_dda

# Channels that cannot appear in journey data (no individual tracking)
OFFLINE_CHANNELS = {"tv_match", "tv_news", "radio", "dooh"}

# Default blend: Markov gets more weight (more robust with sparse data)
DEFAULT_MARKOV_WEIGHT = 0.65
DEFAULT_SHAPLEY_WEIGHT = 0.35

# Cross-validation deviation threshold
DEVIATION_THRESHOLD = 0.20  # 20%


def classify_channels(
    channels: list[str],
) -> tuple[list[str], list[str]]:
    """Separate online (DDA-eligible) and offline channels.

    Args:
        channels: All channel names.

    Returns:
        Tuple of (online_channels, offline_channels).
    """
    online = [ch for ch in channels if ch not in OFFLINE_CHANNELS]
    offline = [ch for ch in channels if ch in OFFLINE_CHANNELS]
    return online, offline


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

    # Normalize
    total = sum(blended.values())
    if total > 0:
        blended = {ch: v / total for ch, v in blended.items()}

    return blended


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
    online_mmm = {ch: mmm_weights[ch] for ch in dda_weights if ch in mmm_weights}
    mmm_total = sum(online_mmm.values())
    if mmm_total > 0:
        online_mmm = {ch: v / mmm_total for ch, v in online_mmm.items()}

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

    # Normalize
    total = sum(combined.values())
    if total > 0:
        combined = {ch: v / total for ch, v in combined.items()}

    return combined


def run_full_dda_pipeline(
    journeys: list[Journey],
    mmm_channel_shares: dict[str, float] | None = None,
    prior_alpha: float = 0.5,
    markov_blend: float = DEFAULT_MARKOV_WEIGHT,
    shapley_blend: float = DEFAULT_SHAPLEY_WEIGHT,
    online_budget_share: float | None = None,
    offline_budget_share: float | None = None,
) -> dict:
    """Run the complete Calibrated Hybrid DDA pipeline.

    Pipeline:
    1. Extract online channels from journeys
    2. Run Markov Chain attribution (Bayesian smoothed)
    3. Run Data-Driven Shapley attribution
    4. Blend Markov + Shapley for online DDA weights
    5. Cross-validate DDA vs MMM for online channels
    6. Merge online (DDA) + offline (MMM) into final hybrid weights

    Args:
        journeys: All journey data.
        mmm_channel_shares: Channel -> MMM attribution share (all channels).
        prior_alpha: Bayesian smoothing for Markov.
        markov_blend: Weight for Markov in DDA blend.
        shapley_blend: Weight for Shapley in DDA blend.
        online_budget_share: Online channels' share of total attribution.
        offline_budget_share: Offline channels' share of total attribution.

    Returns:
        Full pipeline results dict.
    """
    if mmm_channel_shares is None:
        mmm_channel_shares = {}

    stats = journey_stats(journeys)
    all_journey_channels = get_unique_channels(journeys)
    online_channels, offline_channels_found = classify_channels(all_journey_channels)

    # Step 1-2: Markov Chain
    sequences = journeys_to_state_sequences(journeys)
    markov_result = run_markov_attribution(sequences, online_channels, prior_alpha)

    # Step 3: Data-Driven Shapley
    shapley_weights = run_shapley_dda(journeys, online_channels)

    # Normalize shapley to sum to 1
    s_total = sum(shapley_weights.values())
    if s_total > 0:
        shapley_weights = {ch: v / s_total for ch, v in shapley_weights.items()}

    # Step 4: Blend
    dda_online = blend_attributions(
        markov_result["attribution_weights"],
        shapley_weights,
        markov_blend,
        shapley_blend,
    )

    # Step 5: Cross-validation
    cross_val = cross_validate_dda_mmm(dda_online, mmm_channel_shares)

    # Step 6: Merge with offline (MMM)
    # Extract MMM weights for offline channels only
    offline_from_mmm: dict[str, float] = {}
    for ch in OFFLINE_CHANNELS:
        if ch in mmm_channel_shares:
            offline_from_mmm[ch] = mmm_channel_shares[ch]

    # Normalize offline MMM weights
    off_total = sum(offline_from_mmm.values())
    if off_total > 0:
        offline_from_mmm = {ch: v / off_total for ch, v in offline_from_mmm.items()}

    hybrid_weights = build_hybrid_attribution(
        dda_online,
        offline_from_mmm,
        online_budget_share,
        offline_budget_share,
    )

    return {
        "journey_stats": stats,
        "online_channels": online_channels,
        "offline_channels": list(OFFLINE_CHANNELS),
        "markov": {
            "conversion_probability": markov_result["conversion_probability"],
            "removal_effects": markov_result["removal_effects"],
            "attribution_weights": markov_result["attribution_weights"],
            "prior_alpha": prior_alpha,
        },
        "shapley_dda": shapley_weights,
        "blended_dda_online": dda_online,
        "cross_validation": cross_val,
        "mmm_offline_weights": offline_from_mmm,
        "hybrid_attribution": hybrid_weights,
    }
