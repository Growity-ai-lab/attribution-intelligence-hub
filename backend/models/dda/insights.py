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
    """Generate Turkish-language insights from DDA results."""
    insights: list[dict] = []

    if not assist_report:
        return insights

    avg_tp = (
        journey_stats.get("avg_path_length")
        or journey_stats.get("avg_touchpoints")
        or 0
    )
    is_single_touch = avg_tp <= 1.2

    if is_single_touch:
        _insight_single_touch_warning(journey_stats, insights)

    _insight_top_converter(assist_report, hybrid_attribution, insights)

    if not is_single_touch:
        _insight_top_assister(assist_report, insights)
        _insight_first_touch_leader(assist_report, insights)

    _insight_markov_shapley_deviation(markov_weights, shapley_weights, insights)
    _insight_cross_validation(cross_validation, insights)
    _insight_concentration(hybrid_attribution, insights)
    _insight_channel_count(hybrid_attribution, journey_stats, insights)

    return insights


def _insight_single_touch_warning(journey_stats: dict, out: list[dict]) -> None:
    total = journey_stats.get("total_journeys", 0)
    converted = journey_stats.get("converted", 0)
    rate_pct = round(journey_stats.get("conversion_rate", 0) * 100, 1)
    out.append({
        "type": "warning",
        "icon": "⚠️",
        "text": (
            f"Kullanıcı yolculukları ortalama 1 temas noktasından oluşuyor "
            f"({total} yolculuk, {converted} dönüşüm, %{rate_pct} oran). "
            f"Bu durum GA4'ün oturum bazlı veri toplamasından kaynaklanıyor — "
            f"çapraz oturum takibi (User-ID veya Google Signals) aktif değilse "
            f"aynı kullanıcının farklı oturumlardaki temasları birleştirilemiyor. "
            f"Asist analizi bu nedenle sınırlı."
        ),
        "category": "data_quality",
    })


def _insight_top_converter(
    assist_report: list[dict],
    hybrid_attribution: dict[str, float],
    out: list[dict],
) -> None:
    top = max(assist_report, key=lambda r: r["last_touch"])
    if top["last_touch"] == 0:
        return
    ch = top["channel"]
    dda_pct = round(hybrid_attribution.get(ch, 0) * 100, 1)

    second = sorted(assist_report, key=lambda r: -r["last_touch"])
    second_ch = second[1]["channel"] if len(second) > 1 else None
    second_lt = second[1]["last_touch"] if len(second) > 1 else 0

    text = (
        f"{ch} en yüksek dönüştürücü kanal — {top['last_touch']} son temas, "
        f"katkı payı %{dda_pct}."
    )
    if second_ch and second_lt > 0:
        gap = top["last_touch"] - second_lt
        text += f" İkinci sırada {second_ch} ({second_lt}), aradaki fark {gap} dönüşüm."

    out.append({"type": "success", "icon": "\U0001f3af", "text": text, "category": "top_converter"})


def _insight_top_assister(assist_report: list[dict], out: list[dict]) -> None:
    candidates = [
        r for r in assist_report
        if r["assist_ratio"] >= 0.55 and r["total_involvement"] >= 5
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
            f"{top['assists']} kez dönüşümden önceki adımda yer alıyor. "
            f"Farkındalık aşamasında kritik rol oynuyor, bütçe kesilmemeli."
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
            f"{top['channel']} ilk temas lideri ({top['first_touch']}x) — "
            f"kullanıcıyı markaya ilk kez tanıştıran kanal. "
            f"Son temas kanalı olan {top_converter['channel']} ile birlikte çalışıyor."
        ),
        "category": "first_touch_leader",
    })


def _insight_markov_shapley_deviation(
    markov_weights: dict[str, float],
    shapley_weights: dict[str, float],
    out: list[dict],
) -> None:
    deviations = []
    for ch in markov_weights:
        m = markov_weights.get(ch, 0.0)
        s = shapley_weights.get(ch, 0.0)
        diff = abs(m - s)
        if diff >= 0.10 and max(m, s) >= 0.05:
            deviations.append((ch, m, s, diff))

    deviations.sort(key=lambda x: -x[3])

    if not deviations:
        return

    if len(deviations) == 1:
        ch, m, s, diff = deviations[0]
        m_pct = round(m * 100, 1)
        s_pct = round(s * 100, 1)
        dev_pct = round(diff * 100, 1)
        if m > s:
            explanation = (
                f"Zincir etkisi (%{m_pct}) bağımsız katkıdan (%{s_pct}) yüksek — "
                f"bu kanal, dönüşüm yolculuğunun vazgeçilmez bir halkası."
            )
        else:
            explanation = (
                f"Bağımsız katkı (%{s_pct}) zincir etkisinden (%{m_pct}) yüksek — "
                f"bu kanal tek başına da dönüşüm sağlayabiliyor."
            )
        out.append({
            "type": "info",
            "icon": "\U0001f50d",
            "text": f"{ch} kanalında iki analiz yöntemi farklı sonuç veriyor (%{dev_pct} fark). {explanation}",
            "category": "model_divergence",
        })
    else:
        top2 = deviations[:2]
        lines = []
        for ch, m, s, diff in top2:
            dev_pct = round(diff * 100, 1)
            if m > s:
                lines.append(f"{ch} (%{dev_pct} fark — zincirde kritik)")
            else:
                lines.append(f"{ch} (%{dev_pct} fark — tek başına etkili)")
        count_extra = len(deviations) - 2
        text = (
            f"İki analiz yöntemi bazı kanallarda farklı sonuç veriyor: "
            f"{lines[0]}; {lines[1]}."
        )
        if count_extra > 0:
            text += f" +{count_extra} kanal daha farklılık gösteriyor."
        text += (
            " Zincir etkisi kanalı yolculuktan çıkararak, bağımsız katkı ise "
            "tüm kombinasyonlardaki etkiyi ölçerek hesaplanır. "
            "Fark büyükse kanalın rolü karmaşık demektir, her iki değere birlikte bakılmalı."
        )
        out.append({
            "type": "info",
            "icon": "\U0001f50d",
            "text": text,
            "category": "model_divergence",
        })


def _insight_cross_validation(
    cross_validation: list[dict],
    out: list[dict],
) -> None:
    flagged = [
        cv for cv in cross_validation
        if cv.get("flagged") and cv.get("mmm_weight", 0) > 0.01
    ]
    if not flagged:
        return
    worst = max(flagged, key=lambda cv: cv.get("deviation", 0))
    ch = worst.get("channel", "?")
    dda_pct = round(worst.get("dda_weight", 0) * 100, 1)
    mmm_pct = round(worst.get("mmm_weight", 0) * 100, 1)
    out.append({
        "type": "info",
        "icon": "\U0001f4ca",
        "text": (
            f"{ch}: Yolculuk analizi (%{dda_pct}) ile harcama modeli (%{mmm_pct}) farklı sonuç veriyor. "
            f"Yolculuk analizi kullanıcının hangi kanallardan geçtiğine, "
            f"harcama modeli ise toplam bütçe-dönüşüm ilişkisine bakar. "
            f"İkisini birlikte değerlendirmek daha sağlıklı bir tablo sunar."
        ),
        "category": "cross_validation",
    })


def _insight_concentration(
    hybrid_attribution: dict[str, float],
    out: list[dict],
) -> None:
    if not hybrid_attribution:
        return
    top_ch = max(hybrid_attribution, key=hybrid_attribution.get)
    top_share = hybrid_attribution[top_ch]
    if top_share < 0.35:
        return
    pct = round(top_share * 100, 1)

    sorted_chs = sorted(hybrid_attribution.items(), key=lambda x: -x[1])
    if len(sorted_chs) >= 2:
        second_ch, second_share = sorted_chs[1]
        second_pct = round(second_share * 100, 1)
        suggestion = (
            f"En yakın alternatif {second_ch} (%{second_pct}). "
            f"Bütçenin bir kısmını {second_ch} gibi destekleyici kanallara "
            f"kaydırmak riski azaltabilir."
        )
    else:
        suggestion = "Bütçe çeşitlendirmesi önerilir."

    out.append({
        "type": "warning",
        "icon": "\U0001f4b0",
        "text": (
            f"Dönüşümlerin %{pct}'i {top_ch} kanalında yoğunlaşmış. "
            f"{suggestion}"
        ),
        "category": "concentration",
    })


def _insight_channel_count(
    hybrid_attribution: dict[str, float],
    journey_stats: dict,
    out: list[dict],
) -> None:
    n_channels = len(hybrid_attribution)
    converted = journey_stats.get("converted", 0)
    if n_channels < 3 or converted == 0:
        return

    active = sum(1 for v in hybrid_attribution.values() if v >= 0.05)
    low = sum(1 for v in hybrid_attribution.values() if 0 < v < 0.03)

    if low >= 3:
        low_chs = [ch for ch, v in hybrid_attribution.items() if 0 < v < 0.03]
        out.append({
            "type": "info",
            "icon": "\U0001f4cb",
            "text": (
                f"Toplam {n_channels} kanal arasından {active} tanesi anlamlı katkı sağlıyor (>%5). "
                f"{', '.join(low_chs[:3])} gibi {low} kanal çok düşük ağırlıkta — "
                f"bu kanalların bütçe-getiri oranı değerlendirilmeli."
            ),
            "category": "channel_efficiency",
        })
