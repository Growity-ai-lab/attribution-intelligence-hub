"""Rule-based insight generator for DDA attribution results.

Generates Turkish-language insights from assist report, attribution weights,
cross-validation, and journey statistics.
"""


def generate_insights(
    assist_report: list[dict],
    hybrid_attribution: dict[str, float],
    markov_weights: dict[str, float],
    shapley_weights: dict[str, float],
    cross_validation: list[dict],
    journey_stats: dict,
    bq_summary: dict | None = None,
) -> list[dict]:
    """Generate Turkish-language insights from DDA results.

    Returns list of dicts with keys: type, icon, text, category.
    """
    insights: list[dict] = []

    if not assist_report:
        return insights

    _insight_top_converter(assist_report, insights)
    _insight_top_assister(assist_report, insights)
    _insight_first_touch_leader(assist_report, insights)
    _insight_markov_shapley_deviation(markov_weights, shapley_weights, insights)
    _insight_cross_validation(cross_validation, insights)
    _insight_journey_pattern(journey_stats, insights)
    _insight_concentration(hybrid_attribution, insights)

    return insights


def _insight_top_converter(assist_report: list[dict], out: list[dict]) -> None:
    top = max(assist_report, key=lambda r: r["last_touch"])
    if top["last_touch"] == 0:
        return
    out.append({
        "type": "success",
        "icon": "\U0001f3af",
        "text": (
            f"{top['channel']} en yüksek son temas kanalı "
            f"({top['last_touch']} dönüşüm) — doğrudan dönüşüm sağlayan ana kanal."
        ),
        "category": "top_converter",
    })


def _insight_top_assister(assist_report: list[dict], out: list[dict]) -> None:
    candidates = [
        r for r in assist_report
        if r["assist_ratio"] >= 0.60 and r["total_involvement"] >= 5
    ]
    if not candidates:
        return
    top = max(candidates, key=lambda r: r["assists"])
    pct = round(top["assist_ratio"] * 100, 1)
    out.append({
        "type": "info",
        "icon": "\U0001f517",
        "text": (
            f"{top['channel']} yüksek asist oranına sahip (%{pct}) — "
            f"farkındalık/değerlendirme aşamasında kritik rol oynuyor, bütçe kesilmemeli."
        ),
        "category": "top_assister",
    })


def _insight_first_touch_leader(assist_report: list[dict], out: list[dict]) -> None:
    top = max(assist_report, key=lambda r: r["first_touch"])
    if top["first_touch"] == 0:
        return
    top_converter = max(assist_report, key=lambda r: r["last_touch"])
    if top["channel"] == top_converter["channel"]:
        return
    out.append({
        "type": "info",
        "icon": "\U0001f44b",
        "text": (
            f"{top['channel']} en çok ilk temas noktası "
            f"({top['first_touch']}x) — yeni kullanıcı kazanımında lider."
        ),
        "category": "first_touch_leader",
    })


def _insight_markov_shapley_deviation(
    markov_weights: dict[str, float],
    shapley_weights: dict[str, float],
    out: list[dict],
) -> None:
    for ch in markov_weights:
        m = markov_weights.get(ch, 0.0)
        s = shapley_weights.get(ch, 0.0)
        diff = abs(m - s)
        if diff < 0.10:
            continue
        m_pct = round(m * 100, 1)
        s_pct = round(s * 100, 1)
        dev_pct = round(diff * 100, 1)
        out.append({
            "type": "warning",
            "icon": "⚠️",
            "text": (
                f"{ch} için Markov (%{m_pct}) ve Shapley (%{s_pct}) "
                f"arasında %{dev_pct} sapma — bu kanalın etkisi modele göre farklı ölçülüyor."
            ),
            "category": "model_divergence",
        })


def _insight_cross_validation(
    cross_validation: list[dict],
    out: list[dict],
) -> None:
    flagged = [cv for cv in cross_validation if cv.get("flagged")]
    if not flagged:
        return
    worst = max(flagged, key=lambda cv: cv.get("deviation", 0))
    ch = worst.get("channel", "?")
    dda_pct = round(worst.get("dda_weight", 0) * 100, 1)
    mmm_pct = round(worst.get("mmm_weight", 0) * 100, 1)
    dev_pct = round(worst.get("deviation", 0) * 100, 1)
    out.append({
        "type": "warning",
        "icon": "\U0001f4ca",
        "text": (
            f"{ch}: DDA (%{dda_pct}) vs MMM (%{mmm_pct}) arasında "
            f"%{dev_pct} fark — panel raporları ile model tahmini uyuşmuyor."
        ),
        "category": "cross_validation",
    })


def _insight_journey_pattern(journey_stats: dict, out: list[dict]) -> None:
    avg = journey_stats.get("avg_path_length") or journey_stats.get("avg_touchpoints")
    rate = journey_stats.get("conversion_rate", 0)
    if avg is None:
        return
    avg_r = round(avg, 1)
    rate_pct = round(rate * 100, 1)
    if avg > 3:
        interpretation = "çok adımlı bir satın alma yolculuğu, üst huni kanalları korunmalı"
    elif avg <= 1.5:
        interpretation = "kısa dönüşüm yolculuğu, son temas kanallarına odaklanılmalı"
    else:
        interpretation = "orta uzunlukta yolculuk, hem farkındalık hem dönüşüm kanalları dengeli tutulmalı"
    out.append({
        "type": "info",
        "icon": "\U0001f4c8",
        "text": (
            f"Ortalama {avg_r} temas noktası ile %{rate_pct} dönüşüm oranı — {interpretation}."
        ),
        "category": "journey_pattern",
    })


def _insight_concentration(
    hybrid_attribution: dict[str, float],
    out: list[dict],
) -> None:
    if not hybrid_attribution:
        return
    top_ch = max(hybrid_attribution, key=hybrid_attribution.get)
    top_share = hybrid_attribution[top_ch]
    if top_share < 0.40:
        return
    pct = round(top_share * 100, 1)
    out.append({
        "type": "warning",
        "icon": "\U0001f4b0",
        "text": (
            f"Dönüşüm %{pct} oranında {top_ch} kanalına yoğunlaşmış — "
            f"tek kanala bağımlılık riski var, çeşitlendirme önerilir."
        ),
        "category": "concentration",
    })
