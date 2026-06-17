"""Configuration constants for Time's Hub | Attribution Intelligence."""

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
}

# Saturation (Hill function) parameters per channel: (alpha, gamma)
SATURATION_PARAMS: dict[str, tuple[float, float]] = {
    "meta": (2_500_000.0, 1.2),
    "google": (300_000.0, 1.5),
    "tiktok": (800_000.0, 1.1),
    "linkedin": (500_000.0, 1.3),
    "dv360": (400_000.0, 1.0),
    "youtube": (600_000.0, 1.4),
}

# Response model max lift per channel (estimated weekly leads at full saturation)
MAX_LIFT: dict[str, float] = {
    "meta": 1200.0,
    "google": 600.0,
    "tiktok": 400.0,
    "linkedin": 200.0,
    "dv360": 300.0,
    "youtube": 350.0,
}

# Baseline weekly leads (organic / brand)
BASELINE_LEADS = 120.0

# Unified scoring weights — DDA is the sole attribution source.
# MMM and incrementality reserved for future calibration with 8+ weeks of data.
UNIFIED_WEIGHTS = {
    "dda": 1.0,
    "mmm": 0.0,
    "incrementality": 0.0,
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

# All supported digital channels
CHANNELS_SET = {"meta", "google", "tiktok", "linkedin", "dv360", "youtube"}

# Segments
SEGMENTS = {
    "S1": {"name": "Hızlı Ölçeklenen", "budget": 33_000_000, "share": 0.60},
    "S2": {"name": "Çalışanı Gözeten", "budget": 13_750_000, "share": 0.25},
    "S3": {"name": "Yaygın Filolu", "budget": 5_500_000, "share": 0.10},
    "S4": {"name": "Rakiple Çalışan", "budget": 2_750_000, "share": 0.05},
}

# --------------- Digital Media Planning ---------------

# Per-online-channel default funnel metrics for digital planning.
# CPM = TL per 1000 impressions; CTR = click-through rate; lead_rate = lead per click.
# target_audience = unique reachable user count (Türkiye, kategoriye göre); freq_cap = effective frequency ceiling.
# lead_rate values calibrated for B2B fleet lead generation (filo başvurusu);
# typical CPL ranges 2K–10K TL, so lead_rate stays in 0.001–0.005 band.
DIGITAL_CHANNEL_METRICS: dict[str, dict[str, float]] = {
    "meta":     {"cpm": 80,  "ctr": 0.018, "lead_rate": 0.0015, "target_audience": 4_000_000, "freq_cap": 5},
    "google":   {"cpm": 60,  "ctr": 0.045, "lead_rate": 0.0040, "target_audience": 2_500_000, "freq_cap": 3},
    "tiktok":   {"cpm": 55,  "ctr": 0.022, "lead_rate": 0.0010, "target_audience": 5_000_000, "freq_cap": 6},
    "linkedin": {"cpm": 220, "ctr": 0.008, "lead_rate": 0.0030, "target_audience": 800_000,   "freq_cap": 3},
    "dv360":    {"cpm": 95,  "ctr": 0.012, "lead_rate": 0.0012, "target_audience": 3_500_000, "freq_cap": 4},
    "youtube":  {"cpm": 70,  "ctr": 0.015, "lead_rate": 0.0009, "target_audience": 6_000_000, "freq_cap": 5},
}

# 12-week default spend curves per online channel (front-loaded for awareness ramp).
DIGITAL_PRESETS: dict[str, list[float]] = {
    "meta":     [3_500_000, 3_200_000, 2_900_000, 2_700_000, 2_500_000, 2_300_000,
                 2_300_000, 2_100_000, 2_100_000, 1_900_000, 1_900_000, 1_700_000],
    "google":   [400_000, 380_000, 360_000, 340_000, 320_000, 300_000,
                 300_000, 280_000, 280_000, 260_000, 260_000, 240_000],
    "tiktok":   [1_100_000, 1_000_000, 900_000, 850_000, 800_000, 750_000,
                 750_000, 700_000, 700_000, 650_000, 650_000, 600_000],
    "linkedin": [700_000, 650_000, 600_000, 550_000, 500_000, 450_000,
                 450_000, 400_000, 400_000, 350_000, 350_000, 300_000],
    "dv360":    [550_000, 500_000, 450_000, 400_000, 380_000, 350_000,
                 350_000, 320_000, 320_000, 300_000, 300_000, 280_000],
    "youtube":  [800_000, 750_000, 700_000, 650_000, 600_000, 550_000,
                 550_000, 500_000, 500_000, 450_000, 450_000, 400_000],
}


# All channels
CHANNELS = list(ADSTOCK_PARAMS.keys())

# Security limits
MAX_UPLOAD_SIZE_BYTES = 10 * 1024 * 1024  # 10 MB
MAX_CSV_ROWS = 50_000
MAX_ARRAY_SIZE = 312  # 6 channels * 52 weeks
MAX_JOURNEY_COUNT = 100_000
PRIOR_ALPHA_MIN = 0.01
PRIOR_ALPHA_MAX = 10.0
ALLOWED_FILE_EXTENSIONS = {".csv", ".xlsx", ".xls"}

# BigQuery cache
BQ_CACHE_TTL = 3600  # seconds

# Alert thresholds
CONVERSION_DROP_THRESHOLD = 0.02  # 2pp drop
VOLUME_DROP_THRESHOLD = -0.25  # 25% decline
CONCENTRATION_THRESHOLD = 0.50  # single channel > 50%
SUSTAINED_DECLINE_MIN_POINTS = 3  # consecutive declining snapshots

# Attribution classification
ASSIST_ROLE_DELTA = 0.10  # median ± delta for role assignment
WEIGHT_SUM_TOLERANCE = 1e-9
MAX_SHAPLEY_CHANNELS = 15

# Insight thresholds
SINGLE_TOUCH_THRESHOLD = 1.2  # avg_path_length <= this → single-touch data

# MMM fitting bounds
DECAY_BOUNDS = (0.0, 0.95)
GAMMA_BOUNDS = (0.3, 3.0)
