"""Journey extraction and state encoding for DDA.

Converts raw CRM touchpoint records into ordered journey paths
suitable for Markov Chain and Shapley analysis.
"""

from collections import defaultdict
from dataclasses import dataclass


# Sentinel states for Markov Chain
STATE_START = "__start__"
STATE_CONVERSION = "__conversion__"
STATE_NULL = "__null__"


@dataclass
class Journey:
    """A single lead's touchpoint journey."""

    lead_id: str
    channels: list[str]
    converted: bool
    segment: str = ""


def extract_journeys(
    touchpoints: list[dict],
    timestamp_col: str = "timestamp",
    channel_col: str = "channel",
    lead_col: str = "lead_id",
    converted_col: str = "converted",
    segment_col: str = "segment",
) -> list[Journey]:
    """Extract ordered journeys from raw touchpoint records.

    Groups touchpoints by lead_id, sorts by timestamp, and builds
    a channel sequence per lead.

    Args:
        touchpoints: List of dicts, each with lead_id, timestamp, channel, etc.
        timestamp_col: Column name for timestamp.
        channel_col: Column name for channel.
        lead_col: Column name for lead ID.
        converted_col: Column name for conversion flag.
        segment_col: Column name for segment.

    Returns:
        List of Journey objects.
    """
    grouped: dict[str, list[dict]] = defaultdict(list)
    for tp in touchpoints:
        grouped[tp[lead_col]].append(tp)

    journeys: list[Journey] = []
    for lead_id, tps in grouped.items():
        sorted_tps = sorted(tps, key=lambda x: x.get(timestamp_col, ""))

        channels = [tp[channel_col] for tp in sorted_tps if tp.get(channel_col)]
        if not channels:
            continue

        # Conversion: any touchpoint has converted=True/1
        converted = any(
            _is_truthy(tp.get(converted_col, False)) for tp in sorted_tps
        )
        segment = sorted_tps[0].get(segment_col, "")

        journeys.append(Journey(
            lead_id=lead_id,
            channels=channels,
            converted=converted,
            segment=segment,
        ))

    return journeys


def journeys_to_state_sequences(
    journeys: list[Journey],
) -> list[list[str]]:
    """Convert journeys to Markov state sequences.

    Each sequence: [Start, ch1, ch2, ..., Conversion/Null]
    Consecutive duplicate channels are collapsed.

    Args:
        journeys: List of Journey objects.

    Returns:
        List of state sequences.
    """
    sequences: list[list[str]] = []
    for j in journeys:
        seq = [STATE_START]

        prev = None
        for ch in j.channels:
            if ch != prev:
                seq.append(ch)
                prev = ch

        seq.append(STATE_CONVERSION if j.converted else STATE_NULL)
        sequences.append(seq)

    return sequences


def get_unique_channels(journeys: list[Journey]) -> list[str]:
    """Extract unique channel names across all journeys, sorted."""
    channels: set[str] = set()
    for j in journeys:
        channels.update(j.channels)
    return sorted(channels)


def filter_journeys_by_segment(
    journeys: list[Journey], segment: str
) -> list[Journey]:
    """Filter journeys to a specific segment."""
    return [j for j in journeys if j.segment == segment]


def journey_stats(journeys: list[Journey]) -> dict:
    """Compute summary statistics for a set of journeys."""
    total = len(journeys)
    converted = sum(1 for j in journeys if j.converted)
    path_lengths = [len(j.channels) for j in journeys]

    channel_counts: dict[str, int] = defaultdict(int)
    for j in journeys:
        for ch in set(j.channels):
            channel_counts[ch] += 1

    return {
        "total_journeys": total,
        "converted": converted,
        "not_converted": total - converted,
        "conversion_rate": converted / total if total > 0 else 0.0,
        "avg_path_length": sum(path_lengths) / total if total > 0 else 0.0,
        "min_path_length": min(path_lengths) if path_lengths else 0,
        "max_path_length": max(path_lengths) if path_lengths else 0,
        "channel_frequency": dict(channel_counts),
    }


def _is_truthy(val) -> bool:
    """Check if a value is truthy (handles str '1', 'true', bool, int)."""
    if isinstance(val, bool):
        return val
    if isinstance(val, (int, float)):
        return val > 0
    if isinstance(val, str):
        return val.lower() in ("1", "true", "yes", "evet")
    return False
