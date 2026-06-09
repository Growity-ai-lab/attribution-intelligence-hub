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

        raw_channels = [tp[channel_col] for tp in sorted_tps if tp.get(channel_col)]
        if not raw_channels:
            continue

        # Deduplicate consecutive identical channels
        channels = [raw_channels[0]]
        for ch in raw_channels[1:]:
            if ch != channels[-1]:
                channels.append(ch)
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


def extract_top_paths(
    journeys: list[Journey],
    top_n: int = 15,
) -> list[dict]:
    """Extract the most common conversion paths with stats.

    Groups journeys by their channel sequence, counts total occurrences
    and conversions, then returns the top N paths sorted by conversion count.

    Args:
        journeys: List of Journey objects.
        top_n: Number of top paths to return.

    Returns:
        List of dicts: {path, conversions, total, rate, segments}
    """
    path_stats: dict[tuple[str, ...], dict] = defaultdict(
        lambda: {"conversions": 0, "total": 0, "segments": defaultdict(int)}
    )

    for j in journeys:
        key = tuple(j.channels)
        path_stats[key]["total"] += 1
        if j.converted:
            path_stats[key]["conversions"] += 1
        if j.segment:
            path_stats[key]["segments"][j.segment] += 1

    results = []
    for path_tuple, stats in path_stats.items():
        total = stats["total"]
        conversions = stats["conversions"]
        # Dominant segment for this path
        seg_counts = stats["segments"]
        top_segment = max(seg_counts, key=seg_counts.get) if seg_counts else ""
        results.append({
            "path": list(path_tuple),
            "conversions": conversions,
            "total": total,
            "rate": conversions / total if total > 0 else 0.0,
            "segment": top_segment,
        })

    # Sort by conversions descending, then by total descending
    results.sort(key=lambda x: (-x["conversions"], -x["total"]))
    return results[:top_n]


def compute_assist_report(journeys: list[Journey]) -> list[dict]:
    """Compute assisted vs last-touch conversion stats per channel.

    For each converting journey:
    - Last channel gets a 'last_touch' credit
    - All other channels get an 'assist' credit
    - First channel gets a 'first_touch' credit

    Returns list of dicts sorted by total involvement, each with:
      channel, assists, last_touch, first_touch, total_involvement,
      assist_ratio (assists / total_involvement)
    """
    assists: dict[str, int] = defaultdict(int)
    last_touch: dict[str, int] = defaultdict(int)
    first_touch: dict[str, int] = defaultdict(int)

    for j in journeys:
        if not j.converted or not j.channels:
            continue
        last_touch[j.channels[-1]] += 1
        first_touch[j.channels[0]] += 1
        for ch in j.channels[:-1]:
            assists[ch] += 1

    all_channels = set(assists) | set(last_touch) | set(first_touch)
    results = []
    for ch in all_channels:
        a = assists.get(ch, 0)
        lt = last_touch.get(ch, 0)
        ft = first_touch.get(ch, 0)
        total = a + lt
        results.append({
            "channel": ch,
            "assists": a,
            "last_touch": lt,
            "first_touch": ft,
            "total_involvement": total,
            "assist_ratio": a / total if total > 0 else 0.0,
        })

    results.sort(key=lambda x: -x["total_involvement"])

    ratios = sorted(r["assist_ratio"] for r in results if r["total_involvement"] > 0)
    if len(ratios) >= 2:
        mid = len(ratios) // 2
        median_ratio = (ratios[mid - 1] + ratios[mid]) / 2 if len(ratios) % 2 == 0 else ratios[mid]
        delta = 0.10
        for r in results:
            ar = r["assist_ratio"]
            if ar >= median_ratio + delta:
                r["channel_role"] = "Farkındalık"
            elif ar <= median_ratio - delta:
                r["channel_role"] = "Dönüştürücü"
            else:
                r["channel_role"] = "Hibrit"
    else:
        for r in results:
            r["channel_role"] = "Hibrit"

    return results


def _is_truthy(val) -> bool:
    """Check if a value is truthy (handles str '1', 'true', bool, int)."""
    if isinstance(val, bool):
        return val
    if isinstance(val, (int, float)):
        return val > 0
    if isinstance(val, str):
        return val.lower() in ("1", "true", "yes", "evet")
    return False
