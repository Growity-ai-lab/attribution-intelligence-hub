"""Unified scoring: combines MMM, MTA, and Incrementality scores.

Formula: Final = (MTA * 0.50) + (MMM * 0.35) + (Incrementality * 0.15)
"""

from backend.config import UNIFIED_WEIGHTS


def compute_unified_score(
    mmm_score: float,
    mta_score: float,
    incrementality_score: float,
    weights: dict[str, float] | None = None,
) -> float:
    """Compute unified attribution score.

    Args:
        mmm_score: Normalized MMM attribution (0-1 or absolute).
        mta_score: Normalized MTA attribution (0-1 or absolute).
        incrementality_score: Incrementality adjustment factor.
        weights: Optional custom weights dict with keys: mmm, mta, incrementality.

    Returns:
        Unified score.
    """
    w = weights or UNIFIED_WEIGHTS
    return (
        mta_score * w["mta"]
        + mmm_score * w["mmm"]
        + incrementality_score * w["incrementality"]
    )


def compute_unified_report(
    mmm_scores: dict[str, float],
    mta_scores: dict[str, float],
    incrementality_scores: dict[str, float] | None = None,
    weights: dict[str, float] | None = None,
) -> dict[str, dict[str, float]]:
    """Compute unified scores for all channels.

    Args:
        mmm_scores: Channel -> MMM score.
        mta_scores: Channel -> MTA score.
        incrementality_scores: Channel -> incrementality score (defaults to 1.0).
        weights: Optional custom weights.

    Returns:
        Dict mapping channel -> {mmm, mta, inc, unified} scores.
    """
    if incrementality_scores is None:
        incrementality_scores = {}

    all_channels = set(mmm_scores.keys()) | set(mta_scores.keys())
    report: dict[str, dict[str, float]] = {}

    for ch in all_channels:
        mmm = mmm_scores.get(ch, 0.0)
        mta = mta_scores.get(ch, 0.0)
        inc = incrementality_scores.get(ch, 1.0)

        unified = compute_unified_score(mmm, mta, inc, weights)
        report[ch] = {
            "mmm_score": mmm,
            "mta_score": mta,
            "incrementality_score": inc,
            "unified_score": unified,
        }

    return report


def suggest_reallocation(
    channel_scores: dict[str, dict[str, float]],
    current_budgets: dict[str, float],
    total_budget: float | None = None,
) -> dict[str, dict[str, float]]:
    """Suggest budget reallocation based on unified scores.

    Channels with higher unified scores get proportionally more budget.

    Args:
        channel_scores: Output of compute_unified_report.
        current_budgets: Current budget per channel.
        total_budget: Total budget to reallocate. Defaults to sum of current.

    Returns:
        Dict mapping channel -> {current, suggested, delta}.
    """
    if total_budget is None:
        total_budget = sum(current_budgets.values())

    total_unified = sum(
        s["unified_score"] for s in channel_scores.values()
    )

    suggestions: dict[str, dict[str, float]] = {}
    for ch, scores in channel_scores.items():
        current = current_budgets.get(ch, 0.0)
        share = scores["unified_score"] / total_unified if total_unified > 0 else 0
        suggested = total_budget * share
        suggestions[ch] = {
            "current": current,
            "suggested": round(suggested, 2),
            "delta": round(suggested - current, 2),
            "share": round(share, 4),
        }

    return suggestions
