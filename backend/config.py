"""Configuration constants for Attribution Intelligence Hub."""

from pathlib import Path

# Paths
BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data"
UPLOAD_DIR = DATA_DIR / "uploads"
TEMPLATE_DIR = DATA_DIR / "templates"
SAMPLE_DIR = DATA_DIR / "sample"

# Database
DATABASE_URL = "sqlite:///./attribution_hub.db"

# Adstock decay parameters per channel
ADSTOCK_PARAMS: dict[str, float] = {
    "meta": 0.35,
    "google": 0.10,
    "tiktok": 0.30,
    "linkedin": 0.25,
    "dv360": 0.20,
    "youtube": 0.40,
    "tv_match": 0.75,
    "tv_news": 0.75,
    "radio": 0.45,
    "dooh": 0.05,
}

# Saturation (Hill function) parameters per channel: (alpha, gamma)
SATURATION_PARAMS: dict[str, tuple[float, float]] = {
    "meta": (2_500_000.0, 1.2),
    "google": (300_000.0, 1.5),
    "tiktok": (800_000.0, 1.1),
    "linkedin": (500_000.0, 1.3),
    "dv360": (400_000.0, 1.0),
    "youtube": (600_000.0, 1.4),
    "tv_match": (1_000_000.0, 0.9),
    "tv_news": (500_000.0, 0.9),
    "radio": (200_000.0, 1.0),
    "dooh": (150_000.0, 0.8),
}

# Response model max lift per channel (estimated weekly leads at full saturation)
MAX_LIFT: dict[str, float] = {
    "meta": 1200.0,
    "google": 600.0,
    "tiktok": 400.0,
    "linkedin": 200.0,
    "dv360": 300.0,
    "youtube": 350.0,
    "tv_match": 500.0,
    "tv_news": 250.0,
    "radio": 150.0,
    "dooh": 80.0,
}

# Baseline weekly leads (organic / brand)
BASELINE_LEADS = 120.0

# Unified scoring weights (DDA replaces rule-based MTA)
UNIFIED_WEIGHTS = {
    "dda": 0.50,
    "mmm": 0.35,
    "incrementality": 0.15,
}

# DDA ensemble blend weights (Markov vs Shapley within DDA)
DDA_BLEND_WEIGHTS = {
    "markov": 0.65,
    "shapley": 0.35,
}

# Bayesian smoothing for Markov transition matrix
# Lower = less smoothing (trust data more), higher = more uniform
MARKOV_PRIOR_ALPHA = 0.5

# Cross-validation: max acceptable DDA vs MMM deviation
CROSS_VALIDATION_THRESHOLD = 0.20

# Offline channels (no individual-level touchpoint tracking)
OFFLINE_CHANNELS = {"tv_match", "tv_news", "radio", "dooh"}
ONLINE_CHANNELS = {"meta", "google", "tiktok", "linkedin", "dv360", "youtube"}

# Segments
SEGMENTS = {
    "S1": {"name": "Hızlı Ölçeklenen", "budget": 33_000_000, "share": 0.60},
    "S2": {"name": "Çalışanı Gözeten", "budget": 13_750_000, "share": 0.25},
    "S3": {"name": "Yaygın Filolu", "budget": 5_500_000, "share": 0.10},
    "S4": {"name": "Rakiple Çalışan", "budget": 2_750_000, "share": 0.05},
}

# All channels
CHANNELS = list(ADSTOCK_PARAMS.keys())
