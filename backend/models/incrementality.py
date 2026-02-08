"""Incrementality testing — lift estimation and geo-lift stubs.

Phase 2+ implementation. Currently provides placeholder calculations.
"""


def estimate_incremental_lift(
    test_leads: float,
    control_leads: float,
    test_size: int,
    control_size: int,
) -> dict[str, float]:
    """Estimate incremental lift from A/B or geo-lift test.

    Args:
        test_leads: Total leads in test group.
        control_leads: Total leads in control group.
        test_size: Size of test group.
        control_size: Size of control group.

    Returns:
        Dict with lift metrics.
    """
    test_rate = test_leads / test_size if test_size > 0 else 0
    control_rate = control_leads / control_size if control_size > 0 else 0
    absolute_lift = test_rate - control_rate
    relative_lift = (
        absolute_lift / control_rate if control_rate > 0 else 0.0
    )

    return {
        "test_rate": test_rate,
        "control_rate": control_rate,
        "absolute_lift": absolute_lift,
        "relative_lift": relative_lift,
        "incremental_leads": absolute_lift * test_size,
    }


def channel_incrementality_score(
    channel: str,
    incremental_leads: float,
    total_leads: float,
) -> float:
    """Compute incrementality score for a channel.

    Score = incremental leads / total leads attributed to channel.

    Args:
        channel: Channel name.
        incremental_leads: Leads proven incremental via testing.
        total_leads: Total leads attributed to this channel.

    Returns:
        Incrementality score between 0 and 1.
    """
    if total_leads <= 0:
        return 0.0
    return min(incremental_leads / total_leads, 1.0)
