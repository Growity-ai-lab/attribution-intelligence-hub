"""Budget simulation using DDA attribution weights.

Given channel spends and DDA weights, computes per-channel ROAS/CPA,
projects what-if scenarios with modified budgets, and generates
Turkish-language budget action recommendations.
"""

ORGANIC_KEYWORDS = {"direct", "organic", "referral", "email", "(direct)", "(none)"}


def _is_organic(channel: str) -> bool:
    lower = channel.lower()
    return any(kw in lower for kw in ORGANIC_KEYWORDS)


def simulate_budget(
    channel_spends: dict[str, float],
    dda_weights: dict[str, float],
    total_revenue: float,
    total_conversions: int,
    scenario_spends: dict[str, float] | None = None,
) -> dict:
    """Run budget simulation with optional what-if scenario.

    Args:
        channel_spends: Current spend per channel.
        dda_weights: DDA attribution weights (sum ~1.0).
        total_revenue: Total revenue from BQ summary.
        total_conversions: Total conversions from BQ summary.
        scenario_spends: Optional modified spends for what-if projection.

    Returns:
        Dict with current analysis, optional scenario projection,
        and budget recommendations.
    """
    current_channels: dict[str, dict] = {}
    total_spend = sum(channel_spends.values())

    for ch, weight in dda_weights.items():
        spend = channel_spends.get(ch, 0.0)
        attr_rev = total_revenue * weight
        attr_conv = total_conversions * weight

        entry = {
            "spend": round(spend, 2),
            "attributed_revenue": round(attr_rev, 2),
            "attributed_conversions": round(attr_conv, 1),
            "weight": round(weight, 4),
            "roas": round(attr_rev / spend, 2) if spend > 0 else None,
            "cpa": round(spend / attr_conv, 2) if attr_conv > 0 else None,
            "organic": _is_organic(ch),
        }
        current_channels[ch] = entry

    current_blended_roas = (
        round(total_revenue / total_spend, 2) if total_spend > 0 else None
    )

    current = {
        "total_spend": round(total_spend, 2),
        "total_revenue": round(total_revenue, 2),
        "total_conversions": total_conversions,
        "blended_roas": current_blended_roas,
        "channels": current_channels,
    }

    recommendations = generate_budget_recommendations(current_channels)

    result: dict = {"current": current, "recommendations": recommendations}

    if scenario_spends:
        result["scenario"] = _project_scenario(
            current_channels, scenario_spends, total_revenue, total_spend
        )

    return result


def _project_scenario(
    current_channels: dict[str, dict],
    scenario_spends: dict[str, float],
    total_revenue: float,
    current_total_spend: float,
) -> dict:
    scenario_channels: dict[str, dict] = {}
    projected_total_rev = 0.0
    projected_total_conv = 0.0
    scenario_total_spend = sum(scenario_spends.values())

    for ch, cur in current_channels.items():
        new_spend = scenario_spends.get(ch, cur["spend"])
        old_spend = cur["spend"]

        if old_spend > 0 and not cur["organic"]:
            ratio = new_spend / old_spend
            proj_rev = cur["attributed_revenue"] * ratio
            proj_conv = cur["attributed_conversions"] * ratio
        else:
            proj_rev = cur["attributed_revenue"]
            proj_conv = cur["attributed_conversions"]

        projected_total_rev += proj_rev
        projected_total_conv += proj_conv

        scenario_channels[ch] = {
            "spend": round(new_spend, 2),
            "projected_revenue": round(proj_rev, 2),
            "projected_conversions": round(proj_conv, 1),
            "roas": round(proj_rev / new_spend, 2) if new_spend > 0 else None,
            "cpa": round(new_spend / proj_conv, 2) if proj_conv > 0 else None,
            "delta_spend": round(new_spend - old_spend, 2),
        }

    delta_rev = projected_total_rev - total_revenue
    new_blended = (
        round(projected_total_rev / scenario_total_spend, 2)
        if scenario_total_spend > 0
        else None
    )
    old_blended = (
        round(total_revenue / current_total_spend, 2)
        if current_total_spend > 0
        else None
    )

    return {
        "total_spend": round(scenario_total_spend, 2),
        "projected_revenue": round(projected_total_rev, 2),
        "projected_conversions": round(projected_total_conv, 1),
        "blended_roas": new_blended,
        "delta_revenue": round(delta_rev, 2),
        "delta_revenue_pct": (
            round(delta_rev / total_revenue * 100, 1) if total_revenue > 0 else 0
        ),
        "delta_roas": (
            round(new_blended - old_blended, 2)
            if new_blended is not None and old_blended is not None
            else None
        ),
        "channels": scenario_channels,
    }


def generate_budget_recommendations(
    channels: dict[str, dict],
) -> list[dict]:
    """Generate Turkish-language budget action recommendations per channel."""
    paid = {ch: d for ch, d in channels.items() if d.get("roas") is not None}
    if not paid:
        return []

    avg_roas = sum(d["roas"] for d in paid.values()) / len(paid)
    recs: list[dict] = []

    for ch, d in channels.items():
        if d["organic"]:
            if d["weight"] >= 0.05:
                recs.append({
                    "channel": ch,
                    "action": "degerlendirmeli",
                    "icon": "💡",
                    "reason": (
                        f"Bu kanal organik trafik getiriyor (katkı payı %{round(d['weight']*100,1)}). "
                        f"Ücretli destekle test edilebilir."
                    ),
                })
            continue

        roas = d.get("roas")
        if roas is None:
            continue

        if roas >= avg_roas * 1.5:
            recs.append({
                "channel": ch,
                "action": "artir",
                "icon": "▲",
                "reason": (
                    f"ROAS ({roas:.1f}x) ortalamanın ({avg_roas:.1f}x) çok üstünde — "
                    f"bütçe artırımı değerlendirilmeli."
                ),
            })
        elif roas <= avg_roas * 0.5:
            recs.append({
                "channel": ch,
                "action": "azalt",
                "icon": "▼",
                "reason": (
                    f"ROAS ({roas:.1f}x) ortalamanın ({avg_roas:.1f}x) çok altında — "
                    f"bütçeyi verimli kanallara kaydırmak düşünülebilir."
                ),
            })
        else:
            recs.append({
                "channel": ch,
                "action": "koru",
                "icon": "↔",
                "reason": f"ROAS ({roas:.1f}x) ortalama seviyede — mevcut bütçe korunabilir.",
            })

    return recs
