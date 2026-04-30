"""Uncertainty quantification for MMM via parametric bootstrap.

Given a fitted model's residuals, resample residuals into per-channel lead
estimates and compute 95% CI via percentile method. Cheap (no refit), but
honest about model uncertainty conditional on the fitted parameters.
"""

import numpy as np

from backend.models.mmm import compute_adstock, compute_saturation


def parametric_bootstrap_decomposition(
    spend_map: dict[str, float],
    per_ch_params: dict[str, dict],
    baseline: float,
    residuals: list[float],
    n_iter: int = 200,
    seed: int = 42,
    baseline_divisor: int | None = None,
) -> dict[str, dict]:
    """Bootstrap CI for per-channel lead and share.

    For each channel j, the point estimate is:
        leads_j = baseline/N + max_lift_j * sat_j(adstock_j(spend_j))

    `baseline_divisor` matches the divisor used by the caller's point
    estimate (typically len(CHANNELS) = 10). Falls back to len(per_ch_params).
    """
    rng = np.random.default_rng(seed)
    channels = list(per_ch_params.keys())
    n_ch = len(channels)
    if n_ch == 0:
        return {}

    n_baseline = int(baseline_divisor) if baseline_divisor else n_ch

    # Compute deterministic per-channel point lead from spend_map
    point_lead: dict[str, float] = {}
    for ch in channels:
        p = per_ch_params[ch]
        s = float(spend_map.get(ch, 0.0))
        adst = compute_adstock([s], p["decay"])
        sat = compute_saturation(adst[0] if adst else 0.0, p["alpha"], p["gamma"])
        point_lead[ch] = baseline / n_baseline + p["max_lift"] * sat

    residuals_arr = np.array(residuals, dtype=float) if residuals else np.zeros(1)

    samples_leads: dict[str, list[float]] = {ch: [] for ch in channels}
    samples_shares: dict[str, list[float]] = {ch: [] for ch in channels}

    for _ in range(n_iter):
        # Sample N independent residual realizations (one per channel)
        eps = rng.choice(residuals_arr, size=n_ch, replace=True)
        per_ch_sample: dict[str, float] = {}
        for j, ch in enumerate(channels):
            v = max(0.0, point_lead[ch] + float(eps[j]))
            per_ch_sample[ch] = v
            samples_leads[ch].append(v)
        total = sum(per_ch_sample.values())
        for ch in channels:
            samples_shares[ch].append(per_ch_sample[ch] / total if total > 0 else 0.0)

    out: dict[str, dict] = {}
    for ch in channels:
        leads_arr = np.array(samples_leads[ch])
        shares_arr = np.array(samples_shares[ch])
        out[ch] = {
            "lead_mean": float(leads_arr.mean()),
            "lead_ci_low": float(np.percentile(leads_arr, 2.5)),
            "lead_ci_high": float(np.percentile(leads_arr, 97.5)),
            "share_ci_low": float(np.percentile(shares_arr, 2.5)),
            "share_ci_high": float(np.percentile(shares_arr, 97.5)),
        }
    return out
