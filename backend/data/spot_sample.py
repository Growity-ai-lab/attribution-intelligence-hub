"""Synthetic TV/radio spot + minute-traffic data for the spot-effect demo.

Clearly synthetic: a known effect is injected per spot so the measurement can be
checked against the truth (tests) and the screens can be shown without a client's data.
"""

from __future__ import annotations

from datetime import datetime, timedelta

import numpy as np

STATIONS = [
    # (station, medium, visits added at the response peak in prime time, cost per spot TL)
    ("Kanal D", "tv", 60.0, 180_000.0),
    ("Show TV", "tv", 45.0, 140_000.0),
    ("ATV", "tv", 50.0, 160_000.0),
    ("TV8", "tv", 25.0, 70_000.0),
    ("Power FM", "radio", 8.0, 12_000.0),
    ("Süper FM", "radio", 6.0, 10_000.0),
]
CREATIVES = ["Lansman 30sn", "Kampanya 15sn"]
# Share of the peak response per minute after airing (airing minute = 0).
RESPONSE_SHAPE = [0.35, 1.0, 0.8, 0.55, 0.35, 0.22, 0.12, 0.06, 0.03, 0.01]
DAYPART_FACTOR = {6: 0.5, 12: 0.6, 17: 0.8, 20: 1.0, 0: 0.4}


def _traffic_profile(minute_of_day: int) -> float:
    """Typical visits per minute over a day: low at night, evening peak."""
    h = minute_of_day / 60
    return 4.0 + 10.0 * np.exp(-((h - 21.0) ** 2) / 8.0) + 5.0 * np.exp(-((h - 13.0) ** 2) / 10.0)


def _daypart_factor(hour: int) -> float:
    """Response strength by daypart: prime time strongest, night weakest."""
    for begin in (20, 17, 12, 6):
        if hour >= begin:
            return DAYPART_FACTOR[begin]
    return DAYPART_FACTOR[0]


def generate_sample(
    start: datetime | None = None,
    days: int = 21,
    spot_days_from: int = 7,
    spots_per_day: int = 8,
    effect_scale: float = 1.0,
    seed: int = 42,
) -> tuple[list[dict], dict[datetime, float], dict[datetime, float]]:
    """Spots, minute visits and minute conversions with a known per-spot effect.

    The first ``spot_days_from`` days have no spots (pre-campaign baseline).
    Each spot carries ``true_visits``: the visits injected for it.
    Returns (spots, visits, conversions).
    """
    rng = np.random.default_rng(seed)
    start = (start or datetime(2026, 10, 1)).replace(hour=0, minute=0, second=0, microsecond=0)
    n = days * 1440
    expected = np.array([_traffic_profile(i % 1440) for i in range(n)])
    expected *= np.where([(start + timedelta(minutes=i)).weekday() >= 5 for i in range(0, n)], 1.15, 1.0)

    spots: list[dict] = []
    for d in range(spot_days_from, days):
        day = start + timedelta(days=d)
        minutes = sorted(rng.choice(np.arange(7 * 60, 24 * 60 - 15), size=spots_per_day, replace=False))
        for m in minutes:
            station, medium, peak, cost = STATIONS[int(rng.integers(len(STATIONS)))]
            aired = day + timedelta(minutes=int(m))
            peak_here = peak * _daypart_factor(aired.hour) * effect_scale
            i0 = d * 1440 + int(m)
            for k, share in enumerate(RESPONSE_SHAPE):
                if i0 + k < n:
                    expected[i0 + k] += peak_here * share
            spots.append({
                "aired_at": aired,
                "medium": medium,
                "station": station,
                "program": "",
                "creative": CREATIVES[int(rng.integers(len(CREATIVES)))],
                "duration_sec": 30,
                "cost": cost * (1.4 if aired.hour >= 20 else 1.0),
                "grp": None,
                "true_visits": peak_here * sum(RESPONSE_SHAPE),
            })

    observed = rng.poisson(expected)
    conv_obs = rng.binomial(observed, 0.02)
    visits = {start + timedelta(minutes=i): float(v) for i, v in enumerate(observed) if v}
    conversions = {start + timedelta(minutes=i): float(v) for i, v in enumerate(conv_obs) if v}
    return spots, visits, conversions
