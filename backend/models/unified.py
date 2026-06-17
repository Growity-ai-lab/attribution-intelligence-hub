"""Unified scoring: budget reallocation based on DDA attribution.

DDA (Markov + Shapley ensemble) is the sole attribution source for digital
channels. MMM and incrementality layers are reserved for future use when
8+ weeks of calibration data is available.
"""


def suggest_reallocation(
    channel_scores: dict[str, dict[str, float]],
    current_budgets: dict[str, float],
    total_budget: float | None = None,
) -> dict[str, dict[str, float]]:
    """Suggest budget reallocation based on attribution scores.

    Channels with higher unified/DDA scores get proportionally more budget.

    Args:
        channel_scores: Channel -> {unified_score, dda_score, ...}.
        current_budgets: Current budget per channel.
        total_budget: Total budget to reallocate. Defaults to sum of current.

    Returns:
        Dict mapping channel -> {current, suggested, delta, share}.
    """
    if total_budget is None:
        total_budget = sum(current_budgets.values())

    total_unified = sum(
        s.get("unified_score", s.get("dda_score", 0)) for s in channel_scores.values()
    )

    suggestions: dict[str, dict[str, float]] = {}
    for ch, scores in channel_scores.items():
        current = current_budgets.get(ch, 0.0)
        score = scores.get("unified_score", scores.get("dda_score", 0))
        share = score / total_unified if total_unified > 0 else 0
        suggested = total_budget * share
        suggestions[ch] = {
            "current": current,
            "suggested": round(suggested, 2),
            "delta": round(suggested - current, 2),
            "share": round(share, 4),
        }

    return suggestions
