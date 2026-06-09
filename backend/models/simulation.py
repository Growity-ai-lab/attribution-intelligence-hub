"""Budget simulation using DDA attribution weights.

Given channel spends and DDA weights, computes per-channel ROAS/CPA,
projects what-if scenarios with modified budgets, and generates
Turkish-language budget action recommendations.

Scenario projections use Hill saturation for diminishing returns
when channel saturation params are available, linear fallback otherwise.
"""

from backend.models.mmm import compute_saturation
from backend.config import SATURATION_PARAMS

_ORGANIC_MEDIUMS = {"organic", "referral", "(none)", "social", "email", "aylikmail"}
_ORGANIC_SOURCES = {"(direct)", "direct"}

_CHANNEL_KEYWORDS: list[tuple[str, list[str]]] = [
    ("meta", ["facebook", "instagram", "meta", "fb", "ig"]),
    ("google", ["google"]),
    ("tiktok", ["tiktok"]),
    ("linkedin", ["linkedin"]),
    ("dv360", ["dv360", "dbm", "programatik", "programmatic"]),
    ("youtube", ["youtube"]),
    ("tv_match", ["tv_match", "tv match"]),
    ("tv_news", ["tv_news", "tv news"]),
    ("radio", ["radio", "radyo"]),
    ("dooh", ["dooh"]),
]


def _resolve_hub_channel(label: str) -> str | None:
    """Map a BQ 'source / medium' label to a hub channel for saturation lookup."""
    lower = label.lower()
    for hub_ch, keywords in _CHANNEL_KEYWORDS:
        if any(kw in lower for kw in keywords):
            return hub_ch
    return None


def _saturation_ratio(old_spend: float, new_spend: float, alpha: float, gamma: float) -> float:
    """Compute the ratio of saturated values for diminishing returns projection."""
    sat_old = compute_saturation(old_spend, alpha, gamma)
    sat_new = compute_saturation(new_spend, alpha, gamma)
    if sat_old <= 0:
        return sat_new / compute_saturation(alpha, alpha, gamma) if sat_new > 0 else 1.0
    return sat_new / sat_old


def _is_organic(channel: str) -> bool:
    """Detect organic channels from 'source / medium' labels.

    Medium is the primary signal — organic, referral, social, (none).
    Paid channels have mediums like cpc, cpm, conversion, paid, etc.
    """
    parts = channel.lower().split(" / ", 1)
    source = parts[0].strip() if parts else ""
    medium = parts[1].strip() if len(parts) > 1 else ""
    if source in _ORGANIC_SOURCES:
        return True
    return any(kw in medium for kw in _ORGANIC_MEDIUMS)


def simulate_budget(
    channel_spends: dict[str, float],
    dda_weights: dict[str, float],
    total_revenue: float,
    total_conversions: int,
    scenario_spends: dict[str, float] | None = None,
) -> dict:
    """Run budget simulation with optional what-if scenario."""
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
            "cpa": round(spend / attr_conv, 2) if spend > 0 and attr_conv > 0 else None,
            "organic": _is_organic(ch),
        }
        current_channels[ch] = entry

    current_blended_roas = (
        round(total_revenue / total_spend, 2) if total_spend > 0 else None
    )

    paid_with_conv = [
        d for d in current_channels.values()
        if d.get("cpa") is not None and not d["organic"]
    ]
    avg_cpa = (
        round(sum(d["cpa"] for d in paid_with_conv) / len(paid_with_conv), 2)
        if paid_with_conv
        else None
    )
    aov = (
        round(total_revenue / total_conversions, 2)
        if total_conversions > 0
        else None
    )

    current = {
        "total_spend": round(total_spend, 2),
        "total_revenue": round(total_revenue, 2),
        "total_conversions": total_conversions,
        "blended_roas": current_blended_roas,
        "avg_cpa": avg_cpa,
        "aov": aov,
        "channels": current_channels,
    }

    recommendations = generate_budget_recommendations(current_channels, total_spend)

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
            hub_ch = _resolve_hub_channel(ch)
            sat_params = SATURATION_PARAMS.get(hub_ch) if hub_ch else None

            if sat_params:
                alpha, gamma = sat_params
                ratio = _saturation_ratio(old_spend, new_spend, alpha, gamma)
                projection_model = "hill"
            else:
                ratio = new_spend / old_spend
                projection_model = "linear"

            proj_rev = cur["attributed_revenue"] * ratio
            proj_conv = cur["attributed_conversions"] * ratio
        else:
            proj_rev = cur["attributed_revenue"]
            proj_conv = cur["attributed_conversions"]
            projection_model = "organic"

        projected_total_rev += proj_rev
        projected_total_conv += proj_conv

        scenario_channels[ch] = {
            "spend": round(new_spend, 2),
            "projected_revenue": round(proj_rev, 2),
            "projected_conversions": round(proj_conv, 1),
            "roas": round(proj_rev / new_spend, 2) if new_spend > 0 else None,
            "cpa": round(new_spend / proj_conv, 2) if new_spend > 0 and proj_conv > 0 else None,
            "delta_spend": round(new_spend - old_spend, 2),
            "projection_model": projection_model,
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
    total_spend: float = 0,
) -> list[dict]:
    """Generate Turkish-language budget action recommendations per channel.

    Uses ROAS as primary metric when revenue is meaningful,
    falls back to CPA comparison when it isn't.
    """
    paid = {ch: d for ch, d in channels.items() if not d["organic"] and d.get("cpa") is not None}
    if not paid:
        return []

    total_rev = sum(d.get("attributed_revenue", 0) for d in paid.values())
    revenue_meaningful = total_spend > 0 and total_rev > total_spend * 0.05

    paid_with_roas = [d for d in paid.values() if d.get("roas") is not None]
    avg_roas = (
        sum(d["roas"] for d in paid_with_roas) / len(paid_with_roas)
        if revenue_meaningful and paid_with_roas
        else 0
    )
    paid_with_cpa = [d for d in paid.values() if d.get("cpa") is not None]
    avg_cpa = (
        sum(d["cpa"] for d in paid_with_cpa) / len(paid_with_cpa)
        if paid_with_cpa
        else 0
    )

    recs: list[dict] = []

    for ch, d in channels.items():
        if d["organic"]:
            if d["weight"] >= 0.05:
                recs.append({
                    "channel": ch,
                    "action": "degerlendirmeli",
                    "icon": "\U0001f4a1",
                    "reason": (
                        f"Bu kanal organik trafik getiriyor (katkı payı %{round(d['weight']*100,1)}). "
                        f"Ücretli destekle test edilebilir."
                    ),
                })
            continue

        roas = d.get("roas")
        cpa = d.get("cpa")
        if cpa is None:
            continue

        if revenue_meaningful and roas is not None:
            cpa_info = f", CPA {cpa:,.0f}₺"
            if roas >= avg_roas * 1.5:
                recs.append({
                    "channel": ch,
                    "action": "artir",
                    "icon": "▲",
                    "reason": (
                        f"ROAS ({roas:.1f}x) ortalamanın ({avg_roas:.1f}x) çok üstünde{cpa_info} — "
                        f"bütçe artırılabilir."
                    ),
                })
            elif roas <= avg_roas * 0.5:
                recs.append({
                    "channel": ch,
                    "action": "azalt",
                    "icon": "▼",
                    "reason": (
                        f"ROAS ({roas:.1f}x) ortalamanın ({avg_roas:.1f}x) çok altında{cpa_info} — "
                        f"bütçeyi verimli kanallara kaydırmak düşünülebilir."
                    ),
                })
            else:
                recs.append({
                    "channel": ch,
                    "action": "koru",
                    "icon": "↔",
                    "reason": f"ROAS ({roas:.1f}x) ortalama seviyede{cpa_info} — mevcut bütçe korunabilir.",
                })
        else:
            if cpa <= avg_cpa * 0.6:
                recs.append({
                    "channel": ch,
                    "action": "artir",
                    "icon": "▲",
                    "reason": (
                        f"CPA ({cpa:,.0f}₺) ortalamanın ({avg_cpa:,.0f}₺) çok altında — "
                        f"bu kanal düşük maliyetle dönüşüm getiriyor, bütçe artırılabilir."
                    ),
                })
            elif cpa >= avg_cpa * 1.5:
                recs.append({
                    "channel": ch,
                    "action": "azalt",
                    "icon": "▼",
                    "reason": (
                        f"CPA ({cpa:,.0f}₺) ortalamanın ({avg_cpa:,.0f}₺) çok üstünde — "
                        f"dönüşüm maliyeti yüksek, bütçeyi verimli kanallara kaydırın."
                    ),
                })
            else:
                recs.append({
                    "channel": ch,
                    "action": "koru",
                    "icon": "↔",
                    "reason": f"CPA ({cpa:,.0f}₺) ortalama seviyede ({avg_cpa:,.0f}₺) — mevcut bütçe korunabilir.",
                })

    return recs
