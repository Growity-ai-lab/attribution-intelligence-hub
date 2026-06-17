"""First-Order Markov Chain Attribution with Bayesian Smoothing.

Computes transition probabilities between channel states,
then calculates removal effects to derive DDA weights.

The model treats each user journey as a path through an absorbing
Markov chain with two absorbing states: Conversion and Null.
"""

import logging

import numpy as np

from backend.models.dda.data_prep import (
    STATE_CONVERSION,
    STATE_NULL,
    STATE_START,
)

_log = logging.getLogger(__name__)


def build_transition_counts(
    sequences: list[list[str]],
) -> tuple[dict[str, dict[str, int]], list[str]]:
    """Count transitions between states from journey sequences.

    Args:
        sequences: List of state sequences [Start, ch1, ..., Conv/Null].

    Returns:
        Tuple of (transition_counts dict, ordered list of all states).
    """
    counts: dict[str, dict[str, int]] = {}

    for seq in sequences:
        for i in range(len(seq) - 1):
            src, dst = seq[i], seq[i + 1]
            if src not in counts:
                counts[src] = {}
            counts[src][dst] = counts[src].get(dst, 0) + 1

    all_states = sorted(
        {s for seq in sequences for s in seq},
        key=lambda x: (
            0 if x == STATE_START else 2 if x in (STATE_CONVERSION, STATE_NULL) else 1,
            x,
        ),
    )

    return counts, all_states


def counts_to_probability_matrix(
    counts: dict[str, dict[str, int]],
    states: list[str],
    prior_alpha: float = 1.0,
) -> np.ndarray:
    """Convert transition counts to probability matrix with Bayesian smoothing.

    Uses Dirichlet prior (symmetric) to smooth sparse transitions.
    Higher prior_alpha = more smoothing (pulls toward uniform).

    Args:
        counts: {src: {dst: count}} dict.
        states: Ordered list of all states.
        prior_alpha: Dirichlet prior concentration. 1.0 = Laplace smoothing.
                     Lower values (0.1-0.5) for less aggressive smoothing.

    Returns:
        Transition probability matrix (n_states x n_states).
    """
    n = len(states)
    state_idx = {s: i for i, s in enumerate(states)}
    matrix = np.full((n, n), prior_alpha)

    for src, dests in counts.items():
        if src not in state_idx:
            continue
        i = state_idx[src]
        for dst, count in dests.items():
            if dst not in state_idx:
                continue
            j = state_idx[dst]
            matrix[i, j] += count

    # Absorbing states: Conversion and Null only transition to themselves
    for absorbing in (STATE_CONVERSION, STATE_NULL):
        if absorbing in state_idx:
            idx = state_idx[absorbing]
            matrix[idx, :] = 0.0
            matrix[idx, idx] = 1.0

    # Normalize rows to probabilities
    row_sums = matrix.sum(axis=1, keepdims=True)
    row_sums[row_sums == 0] = 1.0
    matrix = matrix / row_sums

    return matrix


def compute_conversion_probability(
    transition_matrix: np.ndarray,
    states: list[str],
) -> float:
    """Compute total conversion probability from Start via absorbing Markov chain.

    Uses the fundamental matrix: N = (I - Q)^{-1}
    where Q is the transient-to-transient sub-matrix.
    Conversion probability = N[start, :] @ R[:, conv_col]

    Args:
        transition_matrix: Full transition probability matrix.
        states: Ordered state list matching matrix rows/columns.

    Returns:
        Probability of reaching Conversion from Start.
    """
    state_idx = {s: i for i, s in enumerate(states)}

    conv_idx = state_idx.get(STATE_CONVERSION)
    null_idx = state_idx.get(STATE_NULL)
    start_idx = state_idx.get(STATE_START)

    if conv_idx is None or start_idx is None:
        return 0.0

    # Build absorbing set: always includes conversion, optionally null
    absorbing = {conv_idx}
    if null_idx is not None:
        absorbing.add(null_idx)

    transient = [i for i in range(len(states)) if i not in absorbing]

    if not transient:
        return 0.0

    # Q: transient-to-transient sub-matrix
    Q = transition_matrix[np.ix_(transient, transient)]

    # R: transient-to-absorbing sub-matrix
    absorbing_list = sorted(absorbing)
    R = transition_matrix[np.ix_(transient, absorbing_list)]

    # Fundamental matrix: N = (I - Q)^{-1}
    eye = np.eye(len(transient))
    try:
        N = np.linalg.inv(eye - Q)
    except np.linalg.LinAlgError:
        _log.warning("Markov matrix singular (I-Q not invertible) — likely single-touch data")
        return 0.0

    # Absorption probabilities: B = N @ R
    B = N @ R

    # Find start's position in transient states
    start_transient_idx = transient.index(start_idx) if start_idx in transient else None
    if start_transient_idx is None:
        return 0.0

    # Find conversion's position in absorbing states
    conv_absorbing_idx = absorbing_list.index(conv_idx)

    return float(B[start_transient_idx, conv_absorbing_idx])


def compute_removal_effects(
    transition_matrix: np.ndarray,
    states: list[str],
    channels: list[str],
) -> dict[str, float]:
    """Compute removal effect for each channel.

    For each channel, removes it from the transition matrix
    (redirects all transitions through it to Null) and measures
    the drop in conversion probability.

    Removal Effect = (P_full - P_removed) / P_full

    Args:
        transition_matrix: Full transition matrix.
        states: Ordered state list.
        channels: List of channel names to compute removal effects for.

    Returns:
        Dict mapping channel -> removal effect (0 to 1).
    """
    state_idx = {s: i for i, s in enumerate(states)}
    null_idx = state_idx.get(STATE_NULL)

    p_full = compute_conversion_probability(transition_matrix, states)

    if p_full <= 0:
        return {ch: 0.0 for ch in channels}

    effects: dict[str, float] = {}

    for channel in channels:
        if channel not in state_idx:
            effects[channel] = 0.0
            continue

        ch_idx = state_idx[channel]

        # Create modified matrix: channel's row redirects entirely to Null
        modified = transition_matrix.copy()
        modified[ch_idx, :] = 0.0
        if null_idx is not None:
            modified[ch_idx, null_idx] = 1.0

        # Also redirect any transitions TO this channel → Null
        for i in range(len(states)):
            if i == ch_idx:
                continue
            prob_to_channel = modified[i, ch_idx]
            if prob_to_channel > 0:
                modified[i, ch_idx] = 0.0
                if null_idx is not None:
                    modified[i, null_idx] += prob_to_channel

        p_removed = compute_conversion_probability(modified, states)
        effect = (p_full - p_removed) / p_full
        effects[channel] = max(effect, 0.0)

    return effects


def removal_effects_to_attribution(
    removal_effects: dict[str, float],
) -> dict[str, float]:
    """Normalize removal effects to attribution weights (sum to 1.0).

    Args:
        removal_effects: Channel -> removal effect value.

    Returns:
        Channel -> attribution weight (normalized).
    """
    total = sum(removal_effects.values())
    if total <= 0:
        n = len(removal_effects)
        return {ch: 1.0 / n if n > 0 else 0.0 for ch in removal_effects}

    return {ch: val / total for ch, val in removal_effects.items()}


def run_markov_attribution(
    sequences: list[list[str]],
    channels: list[str],
    prior_alpha: float = 0.5,
) -> dict:
    """Full Markov Chain DDA pipeline.

    Args:
        sequences: State sequences from journeys_to_state_sequences().
        channels: Channel names to compute attribution for.
        prior_alpha: Bayesian smoothing parameter.

    Returns:
        Dict with keys: transition_matrix, states, conversion_prob,
        removal_effects, attribution_weights.
    """
    counts, states = build_transition_counts(sequences)
    matrix = counts_to_probability_matrix(counts, states, prior_alpha)
    conv_prob = compute_conversion_probability(matrix, states)
    removal = compute_removal_effects(matrix, states, channels)
    weights = removal_effects_to_attribution(removal)

    warnings = []
    if conv_prob == 0.0:
        warnings.append("degenerate_data: Markov model could not compute conversion probability — data may be single-touch only")
        _log.warning("Markov conv_prob=0.0 for channels=%s", channels)
    if all(v == 0.0 for v in removal.values()):
        warnings.append("no_removal_effect: No channel removal produced a measurable effect")

    return {
        "transition_matrix": matrix,
        "states": states,
        "conversion_probability": conv_prob,
        "removal_effects": removal,
        "attribution_weights": weights,
        "prior_alpha": prior_alpha,
        "warnings": warnings,
    }
