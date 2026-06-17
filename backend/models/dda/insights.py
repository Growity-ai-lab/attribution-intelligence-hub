"""Rule-based insight generator for DDA attribution results.

Generates Turkish-language insights from assist report, attribution weights,
cross-validation, and journey statistics.
"""

from backend.config import SINGLE_TOUCH_THRESHOLD


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
    is_single_touch = avg_tp <= SINGLE_TOUCH_THRESHOLD

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

    if bq_summary:
        _insight_data_quality(bq_summary, journey_stats, insights)

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
        if r.get("channel_role") == "Farkındalık" and r["total_involvement"] >= 5
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


def compare_snapshots(
    current: dict,
    previous: dict,
) -> list[dict]:
    """Compare two DDA result snapshots and generate Turkish temporal insights.

    Args:
        current: The latest DDAResult.result_json (deserialized).
        previous: The previous DDAResult.result_json (deserialized).

    Returns:
        List of insight dicts with {type, icon, text, category}.
    """
    out: list[dict] = []
    cur_hybrid = current.get("hybrid_attribution", {})
    prev_hybrid = previous.get("hybrid_attribution", {})
    cur_stats = current.get("journey_stats", {})
    prev_stats = previous.get("journey_stats", {})
    cur_assist = current.get("assist_report", [])
    prev_assist = previous.get("assist_report", [])

    _compare_attribution_weights(cur_hybrid, prev_hybrid, out)
    _compare_conversion_rate(cur_stats, prev_stats, out)
    _compare_volume(cur_stats, prev_stats, out)
    _compare_channel_roles(cur_assist, prev_assist, out)
    _detect_new_disappeared_channels(cur_hybrid, prev_hybrid, out)
    _compare_path_length(cur_stats, prev_stats, out)
    _compare_concentration(cur_hybrid, prev_hybrid, out)

    return out


def _compare_attribution_weights(
    cur: dict[str, float],
    prev: dict[str, float],
    out: list[dict],
) -> None:
    shifts = []
    all_ch = set(cur) | set(prev)
    for ch in all_ch:
        c_val = cur.get(ch, 0.0)
        p_val = prev.get(ch, 0.0)
        delta = c_val - p_val
        if abs(delta) >= 0.03:
            shifts.append((ch, p_val, c_val, delta))

    shifts.sort(key=lambda x: -abs(x[3]))

    for ch, p_val, c_val, delta in shifts[:3]:
        pp = round(delta * 100, 1)
        p_pct = round(p_val * 100, 1)
        c_pct = round(c_val * 100, 1)
        sign = "+" if delta > 0 else ""
        if delta > 0.05:
            t = "success"
            icon = "\U0001f4c8"
        elif delta < -0.05:
            t = "warning"
            icon = "\U0001f4c9"
        else:
            t = "info"
            icon = "\U0001f504"
        out.append({
            "type": t,
            "icon": icon,
            "text": (
                f"{ch} katkı payı %{p_pct}'den %{c_pct}'e "
                f"{'yükseldi' if delta > 0 else 'düştü'} ({sign}{pp}pp)."
            ),
            "category": "attribution_shift",
        })


def _compare_conversion_rate(
    cur_stats: dict,
    prev_stats: dict,
    out: list[dict],
) -> None:
    c_rate = cur_stats.get("conversion_rate", 0)
    p_rate = prev_stats.get("conversion_rate", 0)
    delta = c_rate - p_rate
    if abs(delta) < 0.005:
        return
    pp = round(delta * 100, 1)
    sign = "+" if delta > 0 else ""
    out.append({
        "type": "success" if delta > 0 else "warning",
        "icon": "\U0001f4c8" if delta > 0 else "\U0001f4c9",
        "text": (
            f"Dönüşüm oranı %{round(p_rate * 100, 1)}'den "
            f"%{round(c_rate * 100, 1)}'e "
            f"{'yükseldi' if delta > 0 else 'düştü'} ({sign}{pp}pp)."
        ),
        "category": "conversion_trend",
    })


def _compare_volume(
    cur_stats: dict,
    prev_stats: dict,
    out: list[dict],
) -> None:
    c_total = cur_stats.get("total_journeys", 0)
    p_total = prev_stats.get("total_journeys", 0)
    if p_total == 0:
        return
    pct_change = (c_total - p_total) / p_total
    if abs(pct_change) < 0.10:
        return
    pct_str = round(abs(pct_change) * 100, 0)
    if pct_change > 0:
        out.append({
            "type": "info",
            "icon": "\U0001f4c8",
            "text": f"Toplam yolculuk sayısı %{pct_str:.0f} arttı ({p_total} → {c_total}).",
            "category": "volume_change",
        })
    else:
        t = "warning" if abs(pct_change) > 0.20 else "info"
        out.append({
            "type": t,
            "icon": "\U0001f4c9",
            "text": f"Toplam yolculuk sayısı %{pct_str:.0f} azaldı ({p_total} → {c_total}).",
            "category": "volume_change",
        })


def _compare_channel_roles(
    cur_assist: list[dict],
    prev_assist: list[dict],
    out: list[dict],
) -> None:
    if not cur_assist or not prev_assist:
        return

    cur_top = max(cur_assist, key=lambda r: r.get("last_touch", 0))
    prev_top = max(prev_assist, key=lambda r: r.get("last_touch", 0))
    if cur_top.get("last_touch", 0) == 0:
        return

    if cur_top["channel"] != prev_top["channel"]:
        out.append({
            "type": "info",
            "icon": "\U0001f451",
            "text": (
                f"{cur_top['channel']} artık en güçlü dönüştürücü "
                f"(önceki: {prev_top['channel']})."
            ),
            "category": "role_change",
        })

    cur_ft = max(cur_assist, key=lambda r: r.get("first_touch", 0))
    prev_ft = max(prev_assist, key=lambda r: r.get("first_touch", 0))
    if cur_ft.get("first_touch", 0) > 0 and cur_ft["channel"] != prev_ft["channel"]:
        out.append({
            "type": "info",
            "icon": "\U0001f44b",
            "text": (
                f"İlk temas lideri değişti: {prev_ft['channel']} → {cur_ft['channel']}."
            ),
            "category": "role_change",
        })


def _detect_new_disappeared_channels(
    cur: dict[str, float],
    prev: dict[str, float],
    out: list[dict],
) -> None:
    new_chs = set(cur) - set(prev)
    gone_chs = set(prev) - set(cur)

    for ch in new_chs:
        pct = round(cur[ch] * 100, 1)
        out.append({
            "type": "info",
            "icon": "\U0001f195",
            "text": f"{ch} ilk kez yolculuklarda göründü (%{pct} katkı).",
            "category": "channel_emergence",
        })

    for ch in gone_chs:
        out.append({
            "type": "warning",
            "icon": "\U0001f6ab",
            "text": f"{ch} artık yolculuklarda görünmüyor (önceki: %{round(prev[ch] * 100, 1)}).",
            "category": "channel_emergence",
        })


def _compare_path_length(
    cur_stats: dict,
    prev_stats: dict,
    out: list[dict],
) -> None:
    c_len = cur_stats.get("avg_path_length", cur_stats.get("avg_touchpoints", 0))
    p_len = prev_stats.get("avg_path_length", prev_stats.get("avg_touchpoints", 0))
    delta = c_len - p_len
    if abs(delta) < 0.3:
        return
    out.append({
        "type": "info",
        "icon": "\U0001f4cf",
        "text": (
            f"Ortalama yolculuk uzunluğu {p_len:.1f}'den {c_len:.1f}'e "
            f"{'çıktı' if delta > 0 else 'düştü'} — kullanıcılar "
            f"{'daha fazla' if delta > 0 else 'daha az'} kanalla etkileşiyor."
        ),
        "category": "path_length_change",
    })


def _compare_concentration(
    cur: dict[str, float],
    prev: dict[str, float],
    out: list[dict],
) -> None:
    if not cur or not prev:
        return
    cur_top = max(cur.values())
    prev_top = max(prev.values())
    delta = cur_top - prev_top
    if abs(delta) < 0.05:
        return

    cur_ch = max(cur, key=cur.get)
    c_pct = round(cur_top * 100, 1)
    p_pct = round(prev_top * 100, 1)
    if delta > 0:
        out.append({
            "type": "warning",
            "icon": "\U0001f4b0",
            "text": (
                f"{cur_ch} yoğunlaşması arttı (%{p_pct} → %{c_pct}) — "
                f"bütçe tek kanala bağımlı hale geliyor."
            ),
            "category": "concentration_change",
        })
    else:
        out.append({
            "type": "success",
            "icon": "\U0001f4b0",
            "text": (
                f"Kanal yoğunlaşması azaldı (%{p_pct} → %{c_pct}) — "
                f"bütçe dağılımı iyileşiyor."
            ),
            "category": "concentration_change",
        })


def _insight_data_quality(
    bq_summary: dict,
    journey_stats: dict,
    out: list[dict],
) -> None:
    conversions = bq_summary.get("conversions", 0)
    users = bq_summary.get("unique_users", 0)
    revenue = bq_summary.get("total_revenue", 0)

    if conversions > 0 and users > 0:
        conv_rate = conversions / users
        if conv_rate > 0.5:
            out.append({
                "type": "warning",
                "icon": "⚠️",
                "text": (
                    f"Dönüşüm oranı çok yüksek (%{round(conv_rate * 100, 1)}) — "
                    f"{users} benzersiz kullanıcıdan {conversions}'i dönüşüm yapmış. "
                    f"Conversion event tanımını kontrol edin, yanlış event seçilmiş olabilir."
                ),
                "category": "data_quality",
            })

    if conversions > 0 and revenue > 0:
        aov = revenue / conversions
        if aov < 1:
            out.append({
                "type": "warning",
                "icon": "⚠️",
                "text": (
                    f"Ortalama sipariş değeri çok düşük ({aov:.2f} TL). "
                    f"GA4'te e-ticaret gelir takibi doğru yapılandırılmamış olabilir."
                ),
                "category": "data_quality",
            })
        elif aov > 1_000_000:
            out.append({
                "type": "warning",
                "icon": "⚠️",
                "text": (
                    f"Ortalama sipariş değeri çok yüksek ({aov:,.0f} TL). "
                    f"Gelir verisinde duplikasyon veya para birimi sorunu olabilir."
                ),
                "category": "data_quality",
            })

    converted_journeys = journey_stats.get("converted", 0)
    total_journeys = journey_stats.get("total_journeys", 0)
    if total_journeys > 0 and converted_journeys > 0:
        single_touch_ratio = 1.0
        avg_tp = journey_stats.get("avg_path_length") or journey_stats.get("avg_touchpoints") or 0
        if avg_tp > 0:
            single_touch_ratio = 1.0 if avg_tp <= 1.05 else 0.0
        if single_touch_ratio > 0 and avg_tp <= 1.05:
            out.append({
                "type": "info",
                "icon": "\U0001f4a1",
                "text": (
                    f"Ortalama temas noktası {avg_tp:.2f} — kullanıcıların büyük çoğunluğu tek oturumda "
                    f"dönüşüm yapıyor. GA4 User-ID veya Google Signals aktif edilirse "
                    f"çapraz oturum yolculukları birleştirilir ve asist analizi daha anlamlı hale gelir."
                ),
                "category": "data_quality",
            })
