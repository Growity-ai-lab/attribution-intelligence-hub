"""Rule-based alert engine evaluated after each DDA run."""


def _safe_rate(snapshot: dict) -> float:
    return snapshot.get("journey_stats", {}).get("conversion_rate", 0)


def _safe_total(snapshot: dict) -> int:
    return snapshot.get("journey_stats", {}).get("total_journeys", 0)


def _safe_hybrid(snapshot: dict) -> dict:
    return snapshot.get("hybrid_attribution", {})


def evaluate_alerts(
    current: dict,
    previous: dict | None = None,
    trend_data: dict | None = None,
) -> list[dict]:
    """Evaluate all alert rules against DDA snapshots."""
    out: list[dict] = []
    cur_rate = _safe_rate(current)
    cur_hybrid = _safe_hybrid(current)

    if previous is not None:
        prev_rate = _safe_rate(previous)
        prev_total = _safe_total(previous)
        prev_hybrid = _safe_hybrid(previous)

        # Conversion rate drop > 2pp
        if prev_rate > 0 and (prev_rate - cur_rate) > 0.02:
            out.append({
                "rule_id": "conversion_drop",
                "severity": "critical",
                "title": "Dönüşüm Oranı Düşüşü",
                "message": (
                    f"Dönüşüm oranı %{round(prev_rate * 100, 1)}'den "
                    f"%{round(cur_rate * 100, 1)}'e düştü "
                    f"({round((prev_rate - cur_rate) * 100, 1)}pp kayıp)."
                ),
            })

        # Volume drop > 25%
        cur_total = _safe_total(current)
        if prev_total > 0:
            vol_change = (cur_total - prev_total) / prev_total
            if vol_change < -0.25:
                out.append({
                    "rule_id": "volume_drop",
                    "severity": "warning",
                    "title": "Yolculuk Hacmi Düşüşü",
                    "message": (
                        f"Toplam yolculuk sayısı %{abs(round(vol_change * 100))} azaldı "
                        f"({prev_total} → {cur_total})."
                    ),
                })

        # Channel disappeared
        gone = set(prev_hybrid) - set(cur_hybrid)
        if gone:
            names = ", ".join(sorted(gone))
            out.append({
                "rule_id": "channel_disappeared",
                "severity": "critical",
                "title": "Kanal Kaybı",
                "message": f"Şu kanallar artık yolculuklarda görünmüyor: {names}.",
            })

    # Concentration > 50%
    if cur_hybrid:
        top_val = max(cur_hybrid.values())
        if top_val > 0.50:
            top_ch = max(cur_hybrid, key=cur_hybrid.get)
            out.append({
                "rule_id": "channel_concentration",
                "severity": "warning",
                "title": "Kanal Yoğunlaşması",
                "message": (
                    f"Dönüşümlerin %{round(top_val * 100, 1)}'i {top_ch} kanalında "
                    f"yoğunlaşmış. Bütçe çeşitlendirmesi önerilir."
                ),
            })

    # Sustained decline (3+ consecutive drops in any channel)
    if trend_data and trend_data.get("channel_trends"):
        for ch, points in trend_data["channel_trends"].items():
            if len(points) < 3:
                continue
            last3 = points[-3:]
            weights = [p["weight"] for p in last3]
            if all(weights[i] > weights[i + 1] for i in range(len(weights) - 1)):
                total_drop = weights[0] - weights[-1]
                if total_drop >= 0.03:
                    out.append({
                        "rule_id": "sustained_decline",
                        "severity": "critical",
                        "title": f"{ch} Sürekli Düşüş",
                        "message": (
                            f"{ch} kanalı son 3 çalışmada ardışık düşüş gösteriyor "
                            f"(%{round(weights[0] * 100, 1)} → %{round(weights[-1] * 100, 1)}, "
                            f"toplam -{round(total_drop * 100, 1)}pp)."
                        ),
                    })

    return out


def compute_trend_series(
    snapshots: list[dict],
    run_dates: list[str] | None = None,
) -> dict:
    """Build time-series data from N DDA snapshots (oldest to newest)."""
    if not snapshots:
        return {"channel_trends": {}, "conversion_rate_trend": [], "volume_trend": []}

    dates = run_dates or [f"run_{i}" for i in range(len(snapshots))]

    channel_trends: dict[str, list] = {}
    conversion_rate_trend = []
    volume_trend = []

    for i, snap in enumerate(snapshots):
        hybrid = snap.get("hybrid_attribution", {})
        stats = snap.get("journey_stats", {})
        d = dates[i] if i < len(dates) else f"run_{i}"

        for ch, w in hybrid.items():
            channel_trends.setdefault(ch, []).append({"run_date": d, "weight": round(w, 4)})

        conversion_rate_trend.append({
            "run_date": d,
            "rate": round(stats.get("conversion_rate", 0), 4),
        })
        volume_trend.append({
            "run_date": d,
            "total": stats.get("total_journeys", 0),
        })

    return {
        "channel_trends": channel_trends,
        "conversion_rate_trend": conversion_rate_trend,
        "volume_trend": volume_trend,
    }
