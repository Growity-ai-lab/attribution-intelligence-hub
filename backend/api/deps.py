"""Dependency injection for API routes."""

from backend.config import (
    ADSTOCK_PARAMS,
    BASELINE_LEADS,
    MAX_LIFT,
    SATURATION_PARAMS,
)


def get_model_config() -> dict:
    """Return model configuration."""
    return {
        "adstock_params": ADSTOCK_PARAMS,
        "saturation_params": SATURATION_PARAMS,
        "max_lift": MAX_LIFT,
        "baseline_leads": BASELINE_LEADS,
    }
