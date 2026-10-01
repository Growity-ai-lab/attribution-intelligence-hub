"""Spot effect measurement for TV and radio: the immediate web response to each airing.

The method is deliberately simple and transparent (the "spoteffects" idea):

1. Traffic is a minute-level series (GA4 sessions or conversions).
2. Spots whose response windows overlap are grouped into one block
   (e.g. the same commercial break on several stations); a block is measured
   as a whole and its effect is split over its spots by GRP, else cost, else equally.
3. Baseline = median traffic in the minutes just before the block
   (minutes inside another block's response window are left out).
4. Effect = traffic in the response window (airing minute .. +post minutes after
   the block's last spot) minus baseline × window length.
5. Trust check ("placebo"): the same calculation at the same time of day on
   days without spots. Their average is the method's bias (taken off every
   effect) and their spread the noise each block's effect is judged against (z-score).

Every function is pure: inputs in, results out.
"""

from __future__ import annotations

import math
from collections import defaultdict
from datetime import datetime, timedelta
from statistics import mean, median, pstdev

MINUTES_PER_DAY = 1440

# Turkish TV/radio dayparts (start hour inclusive, end hour exclusive).
DAYPARTS: list[tuple[int, int, str]] = [
    (6, 12, "Sabah (06–12)"),
    (12, 17, "Gündüz (12–17)"),
    (17, 20, "Akşam (17–20)"),
    (20, 24, "Prime time (20–24)"),
    (0, 6, "Gece (00–06)"),
]
WEEKDAYS_TR = ["Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma", "Cumartesi", "Pazar"]

# Below this many baseline sessions per minute, minute-level responses drown in noise.
LOW_TRAFFIC_PER_MINUTE = 2.0
MIN_PLACEBO_WINDOWS = 20


def daypart(dt: datetime) -> str:
    """Daypart label of an airing time."""
    for start, end, label in DAYPARTS:
        if start <= dt.hour < end:
            return label
    return DAYPARTS[-1][2]


def _dense_series(points: dict[datetime, float], t0: datetime, n: int) -> list[float]:
    """Minute array from t0; minutes missing from the export had no traffic (GA4 omits them)."""
    arr = [0.0] * n
    for ts, v in points.items():
        i = int((ts - t0).total_seconds() // 60)
        if 0 <= i < n:
            arr[i] += float(v or 0)
    return arr


def _cluster(spots: list[dict], idx_of, post: int) -> list[list[dict]]:
    """Group spots whose response windows overlap into blocks."""
    blocks: list[list[dict]] = []
    end = None
    for s in sorted(spots, key=lambda s: s["aired_at"]):
        i = idx_of(s["aired_at"])
        if blocks and end is not None and i < end:
            blocks[-1].append(s)
            end = max(end, i + post)
        else:
            blocks.append([s])
            end = i + post
    return blocks


def _weights(block: list[dict]) -> list[float]:
    """How a block's effect is split over its spots: GRP, else cost, else equally."""
    for key in ("grp", "cost"):
        vals = [float(s.get(key) or 0) for s in block]
        if all(v > 0 for v in vals):
            total = sum(vals)
            return [v / total for v in vals]
    return [1 / len(block)] * len(block)


def analyze_spots(
    spots: list[dict],
    visits: dict[datetime, float],
    conversions: dict[datetime, float] | None = None,
    *,
    pre_minutes: int = 15,
    post_minutes: int = 10,
    placebo_days: int = 14,
    z_threshold: float = 2.0,
) -> dict:
    """Measure the immediate visit (and conversion) response to each spot.

    Args:
        spots: dicts with ``aired_at`` (naive local datetime), ``station``, ``medium``
            ("tv"/"radio"), ``program``, ``creative``, ``cost``, ``grp``, ``duration_sec``, ``id``.
        visits: minute (naive local datetime, floored to the minute) → visits.
        conversions: same for conversions (optional).
        pre_minutes: baseline window before a block.
        post_minutes: response window after a block's last spot (airing minute included).
        placebo_days: how many days before/after a block are searched for spot-free placebo windows.
        z_threshold: effect / noise needed to call a block's effect significant.

    Returns:
        dict with ``totals``, ``spots``, ``by_station``, ``by_daypart``, ``by_creative``,
        ``by_medium``, ``by_weekday``, ``response_curve``, ``placebo`` and ``warnings``.
    """
    pre, post = int(pre_minutes), int(post_minutes)
    warnings: list[str] = []
    if not visits:
        return _empty_result(spots, ["Trafik verisi yok: önce GA4/BigQuery'den çekin ya da dakikalık trafik dosyası yükleyin."])

    t0 = min(visits)
    n = int((max(visits) - t0).total_seconds() // 60) + 1
    arr = _dense_series(visits, t0, n)
    conv = _dense_series(conversions, t0, n) if conversions else None

    def idx_of(dt: datetime) -> int:
        return int((dt.replace(second=0, microsecond=0) - t0).total_seconds() // 60)

    in_range = [idx_of(s["aired_at"]) - pre >= 0 and idx_of(s["aired_at"]) + post <= n for s in spots]
    covered = [s for s, ok in zip(spots, in_range) if ok]
    uncovered = [s for s, ok in zip(spots, in_range) if not ok]
    if uncovered:
        warnings.append(
            f"{len(uncovered)} spotun yayın saati trafik verisinin kapsadığı aralığın dışında; bu spotlar ölçülemedi."
        )
    if not covered:
        return _empty_result(spots, warnings or ["Ölçülebilecek spot yok."])

    blocks = _cluster(covered, idx_of, post)
    spans = []  # (start, response_end) per block
    for b in blocks:
        start = idx_of(b[0]["aired_at"])
        end = max(idx_of(s["aired_at"]) for s in b) + post
        spans.append((start, end))

    in_response = [False] * n  # minutes inside any block's response window
    reserved = [False] * n  # minutes a placebo window must not touch (baseline + response)
    for start, end in spans:
        for i in range(max(0, start - pre), min(n, end)):
            reserved[i] = True
            if i >= start:
                in_response[i] = True

    def measure(series: list[float], start: int, end: int, exclude: list[bool] | None) -> tuple[float, float] | None:
        """(baseline per minute, effect) of a window, or None without a usable baseline."""
        base_idx = [i for i in range(start - pre, start) if 0 <= i < n and not (exclude and exclude[i])]
        if len(base_idx) < max(5, pre // 3):
            return None
        base = median(series[i] for i in base_idx)
        actual = sum(series[start:end])
        return base, actual - base * (end - start)

    # Placebo: same time of day, other days, nowhere near a spot.
    placebo_q: list[float] = []  # effect / sqrt(window length)
    placebo_curve: dict[int, list[float]] = defaultdict(list)
    seen: set[int] = set()
    for start, end in spans:
        for d in range(-placebo_days, placebo_days + 1):
            if d == 0:
                continue
            ps, pe = start + d * MINUTES_PER_DAY, end + d * MINUTES_PER_DAY
            if ps - pre < 0 or pe > n or ps in seen or any(reserved[ps - pre:pe]):
                continue
            seen.add(ps)
            m = measure(arr, ps, pe, None)
            if m is None:
                continue
            base, effect = m
            placebo_q.append(effect / math.sqrt(pe - ps))
            if pe - ps == post:
                for k in range(-pre, post):
                    placebo_curve[k].append(arr[ps + k] - base)

    noise_ok = len(placebo_q) >= MIN_PLACEBO_WINDOWS
    q_mean = mean(placebo_q) if placebo_q else 0.0
    q_sd = pstdev(placebo_q) if len(placebo_q) > 1 else 0.0
    if not noise_ok:
        warnings.append(
            f"Güven testi için yeterli spotsuz dönem bulunamadı ({len(placebo_q)} pencere; en az {MIN_PLACEBO_WINDOWS}). "
            "Etkiler hesaplandı ama anlamlılık değerlendirilemiyor; trafik verisini spotsuz günleri de kapsayacak şekilde genişletin."
        )

    spot_rows: list[dict] = []
    block_rows: list[dict] = []
    curve: dict[int, list[float]] = defaultdict(list)
    baselines: list[float] = []
    for bi, (block, (start, end)) in enumerate(zip(blocks, spans)):
        mv = measure(arr, start, end, in_response)
        if mv is None:
            for s in block:
                spot_rows.append(_spot_row(s, status="no_baseline"))
            continue
        base, effect = mv
        baselines.append(base)
        length = end - start
        # The median baseline sits slightly below the mean of skewed minute counts; the
        # placebo windows measure that bias, so it is taken off every block's effect.
        if noise_ok:
            effect -= q_mean * math.sqrt(length)
        conv_effect = None
        if conv is not None:
            mc = measure(conv, start, end, in_response)
            conv_effect = mc[1] if mc else None
        z = (effect / math.sqrt(length)) / q_sd if noise_ok and q_sd > 0 else None
        significant = z is not None and z >= z_threshold
        block_rows.append({"block": bi, "spots": len(block), "start": block[0]["aired_at"].isoformat(timespec="minutes"),
                           "baseline_per_min": round(base, 2), "effect": round(effect, 1),
                           "z": None if z is None else round(z, 2), "significant": significant})
        if len(block) == 1 and length == post:
            for k in range(-pre, post):
                curve[k].append(arr[start + k] - base)
        for s, w in zip(block, _weights(block)):
            spot_rows.append(_spot_row(
                s, status="measured", block=bi, block_size=len(block),
                baseline_per_min=base, visits=effect * w,
                conversions=None if conv_effect is None else conv_effect * w,
                z=z, significant=significant, response_minutes=length,
            ))

    spot_rows += [_spot_row(s, status="no_data") for s in uncovered]
    measured = [r for r in spot_rows if r["status"] == "measured"]
    if baselines and median(baselines) < LOW_TRAFFIC_PER_MINUTE:
        warnings.append(
            f"Spot öncesi trafik dakikada ortalama {median(baselines):.1f} oturum: bu hacimde dakika düzeyindeki "
            "tepki gürültüden zor ayrılır. Sonuçları kanal/kuşak toplamları düzeyinde okuyun."
        )

    total_traffic = sum(arr)
    totals = _aggregate(measured)
    totals.update({
        "spots_total": len(spots),
        "spots_measured": len(measured),
        "blocks": len(block_rows),
        "cost_total": round(sum(float(s.get("cost") or 0) for s in spots), 2),
        "traffic_total": round(total_traffic, 1),
        "effect_share_of_traffic": round(totals["visits"] / total_traffic, 4) if total_traffic else None,
        "baseline_per_min_median": round(median(baselines), 2) if baselines else None,
        "period_start": t0.isoformat(timespec="minutes"),
        "period_end": (t0 + timedelta(minutes=n - 1)).isoformat(timespec="minutes"),
    })

    false_positive = (
        round(sum(1 for q in placebo_q if q_sd > 0 and (q - q_mean) / q_sd >= z_threshold) / len(placebo_q), 4)
        if noise_ok and q_sd > 0 else None
    )
    return {
        "params": {"pre_minutes": pre, "post_minutes": post, "placebo_days": placebo_days, "z_threshold": z_threshold},
        "totals": totals,
        "spots": sorted(spot_rows, key=lambda r: r["aired_at"]),
        "blocks": block_rows,
        "by_station": _group(measured, lambda r: r["station"]),
        "by_daypart": _group(measured, lambda r: r["daypart"], order=[d[2] for d in DAYPARTS]),
        "by_creative": _group(measured, lambda r: r["creative"] or "—"),
        "by_medium": _group(measured, lambda r: r["medium"]),
        "by_weekday": _group(measured, lambda r: r["weekday"], order=WEEKDAYS_TR),
        "response_curve": [
            {"minute": k,
             "spot": round(mean(curve[k]), 3) if curve[k] else None,
             "placebo": round(mean(placebo_curve[k]), 3) if placebo_curve[k] else None}
            for k in range(-pre, post)
        ],
        "placebo": {
            "windows": len(placebo_q),
            "mean_effect_per_window": round(q_mean * math.sqrt(post), 2) if placebo_q else None,
            "noise_sd_per_window": round(q_sd * math.sqrt(post), 2) if placebo_q else None,
            "false_positive_rate": false_positive,
            "ok": noise_ok,
        },
        "warnings": warnings,
    }


def _spot_row(s: dict, *, status: str, block: int | None = None, block_size: int = 1,
              baseline_per_min: float | None = None, visits: float | None = None,
              conversions: float | None = None, z: float | None = None,
              significant: bool = False, response_minutes: int | None = None) -> dict:
    cost = float(s.get("cost") or 0)
    return {
        "id": s.get("id"),
        "aired_at": s["aired_at"].isoformat(timespec="minutes"),
        "medium": s.get("medium") or "tv",
        "station": s.get("station") or "—",
        "program": s.get("program") or "",
        "creative": s.get("creative") or "",
        "duration_sec": s.get("duration_sec"),
        "cost": round(cost, 2),
        "grp": s.get("grp"),
        "daypart": daypart(s["aired_at"]),
        "weekday": WEEKDAYS_TR[s["aired_at"].weekday()],
        "status": status,
        "block": block,
        "block_size": block_size,
        "baseline_per_min": None if baseline_per_min is None else round(baseline_per_min, 2),
        "visits": None if visits is None else round(visits, 1),
        "conversions": None if conversions is None else round(conversions, 2),
        "cost_per_visit": round(cost / visits, 2) if visits and visits > 0 and cost else None,
        "z": None if z is None else round(z, 2),
        "significant": significant,
        "response_minutes": response_minutes,
    }


def _aggregate(rows: list[dict]) -> dict:
    """Sums and ratios of measured spot rows."""
    visits = sum(r["visits"] or 0 for r in rows)
    conv_vals = [r["conversions"] for r in rows if r["conversions"] is not None]
    cost = sum(r["cost"] for r in rows)
    return {
        "spots": len(rows),
        "cost": round(cost, 2),
        "visits": round(visits, 1),
        "visits_per_spot": round(visits / len(rows), 1) if rows else None,
        "conversions": round(sum(conv_vals), 2) if conv_vals else None,
        "cost_per_visit": round(cost / visits, 2) if visits > 0 and cost else None,
        "cost_per_conversion": round(cost / sum(conv_vals), 2) if conv_vals and sum(conv_vals) > 0 and cost else None,
        "significant_share": round(sum(1 for r in rows if r["significant"]) / len(rows), 3) if rows else None,
    }


def _group(rows: list[dict], key, order: list[str] | None = None) -> list[dict]:
    groups: dict[str, list[dict]] = defaultdict(list)
    for r in rows:
        groups[key(r)].append(r)
    out = [{"name": k, **_aggregate(v)} for k, v in groups.items()]
    if order:
        out.sort(key=lambda g: order.index(g["name"]) if g["name"] in order else len(order))
    else:
        out.sort(key=lambda g: -g["visits"])
    return out


def _empty_result(spots: list[dict], warnings: list[str]) -> dict:
    return {
        "params": {},
        "totals": {**_aggregate([]), "spots_total": len(spots), "spots_measured": 0, "blocks": 0,
                   "cost_total": round(sum(float(s.get("cost") or 0) for s in spots), 2)},
        "spots": [_spot_row(s, status="no_data") for s in sorted(spots, key=lambda s: s["aired_at"])],
        "blocks": [], "by_station": [], "by_daypart": [], "by_creative": [], "by_medium": [], "by_weekday": [],
        "response_curve": [], "placebo": {"windows": 0, "ok": False}, "warnings": warnings,
    }


def day_timeline(visits: dict[datetime, float], spots: list[dict], day: datetime) -> dict:
    """One day's minute series with the spots that aired that day (for the timeline chart)."""
    start = day.replace(hour=0, minute=0, second=0, microsecond=0)
    arr = _dense_series(visits, start, MINUTES_PER_DAY)
    has_data = any(start <= ts < start + timedelta(days=1) for ts in visits)
    day_spots = [
        {"minute": int((s["aired_at"] - start).total_seconds() // 60), "station": s.get("station") or "",
         "medium": s.get("medium") or "tv", "creative": s.get("creative") or "", "cost": s.get("cost")}
        for s in spots if start <= s["aired_at"] < start + timedelta(days=1)
    ]
    return {"date": start.date().isoformat(), "has_data": has_data, "visits": arr, "spots": day_spots}
