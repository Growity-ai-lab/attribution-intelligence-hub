"""MMM parameter fitting using scipy NLS (Non-linear Least Squares).

Fits adstock decay, Hill saturation (alpha, gamma), max_lift and baseline
to historical weekly spend + leads data. Uses L-BFGS-B with bounded
parameters and log-parametrized alpha for numerical stability.

Per-campaign fit results are persisted in CampaignModelParams (see
backend/db/models.py). Use fit_and_store(db, campaign_id) for the
end-to-end flow.
"""

import hashlib
import json
from datetime import datetime, timezone

import numpy as np
from scipy.optimize import minimize
from sqlalchemy.orm import Session

from backend.config import (
    ADSTOCK_PARAMS,
    BASELINE_LEADS,
    DECAY_BOUNDS,
    GAMMA_BOUNDS,
    MAX_LIFT,
    SATURATION_PARAMS,
)
from backend.db.models import CampaignModelParams, WeeklyData
from backend.models.mmm import compute_adstock, compute_saturation


def _model_predict(
    params: np.ndarray, spend_matrix: np.ndarray, n_channels: int
) -> np.ndarray:
    """Predict weekly leads given flattened parameter vector.

    params layout: [decay_1..N, log_alpha_1..N, gamma_1..N, max_lift_1..N, baseline]
    """
    T = spend_matrix.shape[0]
    decays = np.clip(params[0:n_channels], 0.0, 0.99)
    log_alphas = params[n_channels:2 * n_channels]
    gammas = np.clip(params[2 * n_channels:3 * n_channels], GAMMA_BOUNDS[0], GAMMA_BOUNDS[1])
    max_lifts = np.maximum(params[3 * n_channels:4 * n_channels], 0.0)
    baseline = max(float(params[4 * n_channels]), 0.0)

    pred = np.full(T, baseline, dtype=float)
    for j in range(n_channels):
        decay = float(decays[j])
        alpha = float(np.exp(log_alphas[j]))
        gamma = float(gammas[j])
        ml = float(max_lifts[j])
        adst = compute_adstock(spend_matrix[:, j].tolist(), decay)
        sat = np.array([compute_saturation(v, alpha, gamma) for v in adst])
        pred = pred + ml * sat
    return pred


def fit_mmm(
    weekly_spends: dict[str, list[float]],
    weekly_leads: list[float],
) -> dict:
    """Fit MMM parameters via L-BFGS-B NLS on weekly observations.

    Args:
        weekly_spends: Channel -> weekly spend list. All channels must have
            the same length (one entry per week, in chronological order).
        weekly_leads: Total weekly leads (same length).

    Returns:
        {
          "channels": [...],
          "params": {ch: {decay, alpha, gamma, max_lift}},
          "baseline": float,
          "fit_quality": {rmse, mape, r2, n_obs, converged},
          "residuals": [y_t - pred_t for each t],
          "predicted": [pred_t for each t],
          "actual": [y_t],
        }
    """
    channels = list(weekly_spends.keys())
    n = len(channels)
    if n == 0:
        raise ValueError("No channels provided")
    T = len(weekly_leads)
    if T < 4:
        raise ValueError(f"Need at least 4 weekly observations, got {T}")
    for ch, vals in weekly_spends.items():
        if len(vals) != T:
            raise ValueError(
                f"Channel {ch} has {len(vals)} weeks but leads has {T}"
            )

    spend_matrix = np.array([weekly_spends[ch] for ch in channels]).T
    y = np.array(weekly_leads, dtype=float)

    # Initialize from existing config defaults so the fit drifts mildly
    x0 = np.concatenate([
        np.array([ADSTOCK_PARAMS.get(ch, 0.3) for ch in channels]),
        np.log([max(SATURATION_PARAMS.get(ch, (1e6, 1.0))[0], 1.0) for ch in channels]),
        np.array([SATURATION_PARAMS.get(ch, (1e6, 1.0))[1] for ch in channels]),
        np.array([MAX_LIFT.get(ch, 200.0) for ch in channels]),
        np.array([BASELINE_LEADS]),
    ])

    def loss(p: np.ndarray) -> float:
        pred = _model_predict(p, spend_matrix, n)
        return float(np.sum((pred - y) ** 2))

    bounds = (
        [DECAY_BOUNDS] * n
        + [(np.log(1e3), np.log(1e10))] * n
        + [GAMMA_BOUNDS] * n
        + [(0.0, 1e5)] * n
        + [(0.0, 1e5)]
    )
    res = minimize(loss, x0, method="L-BFGS-B", bounds=bounds, options={"maxiter": 500})

    p = res.x
    pred = _model_predict(p, spend_matrix, n)
    rmse = float(np.sqrt(np.mean((pred - y) ** 2)))
    nonzero = np.where(y > 0, y, 1.0)
    mape = float(np.mean(np.abs((y - pred) / nonzero)) * 100)
    ss_res = float(np.sum((y - pred) ** 2))
    ss_tot = float(np.sum((y - y.mean()) ** 2)) or 1.0
    r2 = 1.0 - ss_res / ss_tot

    params_out = {}
    for j, ch in enumerate(channels):
        params_out[ch] = {
            "decay": float(np.clip(p[j], 0.0, 0.99)),
            "alpha": float(np.exp(p[n + j])),
            "gamma": float(np.clip(p[2 * n + j], GAMMA_BOUNDS[0], GAMMA_BOUNDS[1])),
            "max_lift": float(max(p[3 * n + j], 0.0)),
        }

    return {
        "channels": channels,
        "params": params_out,
        "baseline": float(max(p[4 * n], 0.0)),
        "fit_quality": {
            "rmse": rmse,
            "mape": mape,
            "r2": r2,
            "n_obs": T,
            "converged": bool(res.success),
        },
        "residuals": (y - pred).tolist(),
        "predicted": pred.tolist(),
        "actual": y.tolist(),
    }


# --------------- Persistence helpers ---------------


def compute_data_hash(rows: list) -> str:
    """Hash the WeeklyData rows that fed a fit, to detect staleness later."""
    payload = "|".join(
        f"{r.week}:{r.channel}:{r.spend}:{r.leads}"
        for r in sorted(rows, key=lambda x: (x.week, x.channel))
    )
    return hashlib.md5(payload.encode()).hexdigest()


def get_active_params(db: Session, campaign_id: int) -> dict | None:
    """Return the most recent fitted params for a campaign, or None."""
    rec = (
        db.query(CampaignModelParams)
        .filter(CampaignModelParams.campaign_id == campaign_id)
        .order_by(CampaignModelParams.created_at.desc())
        .first()
    )
    if not rec:
        return None
    payload = json.loads(rec.params_json)
    payload["fit_quality"] = json.loads(rec.fit_quality_json)
    payload["created_at"] = rec.created_at
    payload["source_data_hash"] = rec.source_data_hash
    payload["residuals"] = json.loads(rec.residuals_json) if rec.residuals_json else []
    return payload


def fit_and_store(db: Session, campaign_id: int) -> dict:
    """Run a fresh fit on WeeklyData for this campaign and persist it."""
    rows = (
        db.query(WeeklyData)
        .filter(WeeklyData.campaign_id == campaign_id)
        .all()
    )
    if len(rows) < 8:
        raise ValueError(
            f"Not enough data to fit (need >= 8 weekly rows, got {len(rows)})"
        )

    weeks = sorted({r.week for r in rows})
    channels = sorted({r.channel for r in rows})
    spend_map: dict[str, list[float]] = {ch: [0.0] * len(weeks) for ch in channels}
    leads_per_week: list[float] = [0.0] * len(weeks)
    week_idx = {w: i for i, w in enumerate(weeks)}

    for r in rows:
        i = week_idx[r.week]
        spend_map[r.channel][i] += float(r.spend or 0.0)
        leads_per_week[i] += float(r.leads or 0.0)

    fit_result = fit_mmm(spend_map, leads_per_week)
    h = compute_data_hash(rows)

    rec = CampaignModelParams(
        campaign_id=campaign_id,
        created_at=datetime.now(timezone.utc).isoformat(),
        params_json=json.dumps({
            "channels": fit_result["channels"],
            "params": fit_result["params"],
            "baseline": fit_result["baseline"],
        }),
        fit_quality_json=json.dumps(fit_result["fit_quality"]),
        residuals_json=json.dumps(fit_result["residuals"]),
        source_data_hash=h,
        source="fit",
    )
    db.add(rec)
    db.commit()
    return fit_result
