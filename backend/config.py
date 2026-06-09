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

# GRP-scale saturation parameters for media planning tool
# Alpha = half-saturation GRP level, Gamma = curve shape
GRP_SATURATION_PARAMS: dict[str, tuple[float, float]] = {
    "tv_match": (400.0, 0.9),
    "tv_news": (250.0, 0.9),
    "radio": (200.0, 1.0),
    "dooh": (150.0, 0.8),
}

# Max weekly leads at GRP full saturation
GRP_MAX_LIFT: dict[str, float] = {
    "tv_match": 500.0,
    "tv_news": 250.0,
    "radio": 150.0,
    "dooh": 80.0,
}

# Default GRP presets for quick-start (12 weeks)
GRP_PRESETS: dict[str, list[float]] = {
    "tv_match": [450, 400, 350, 300, 250, 200, 200, 150, 150, 100, 100, 50],
    "tv_news": [180, 160, 140, 120, 100, 80, 80, 60, 60, 40, 40, 20],
    "radio": [120, 100, 80, 60, 50, 40, 40, 30, 30, 20, 20, 10],
    "dooh": [100, 80, 60, 50, 40, 30, 30, 20, 20, 10, 10, 5],
}

# Reach lookup table (Coverguide data) — cumulative GRP to reach %
REACH_LOOKUP: dict[int, dict[str, float]] = {
    50: {"r1": 30.3, "r2": 10.2, "r3": 3.3},
    100: {"r1": 44.6, "r2": 23.2, "r3": 11.7},
    150: {"r1": 52.8, "r2": 33.0, "r3": 20.4},
    200: {"r1": 58.2, "r2": 40.2, "r3": 27.7},
    250: {"r1": 61.9, "r2": 45.6, "r3": 33.7},
    300: {"r1": 64.7, "r2": 49.7, "r3": 38.5},
    350: {"r1": 66.9, "r2": 53.1, "r3": 42.5},
    400: {"r1": 68.7, "r2": 55.8, "r3": 45.8},
    450: {"r1": 70.1, "r2": 58.1, "r3": 48.6},
    500: {"r1": 71.4, "r2": 60.0, "r3": 51.0},
    600: {"r1": 73.3, "r2": 63.1, "r3": 54.9},
    700: {"r1": 74.8, "r2": 65.5, "r3": 58.0},
    800: {"r1": 76.0, "r2": 67.4, "r3": 60.4},
    900: {"r1": 77.0, "r2": 69.0, "r3": 62.5},
    1000: {"r1": 77.8, "r2": 70.3, "r3": 64.2},
    1200: {"r1": 79.0, "r2": 72.5, "r3": 66.9},
    1400: {"r1": 80.0, "r2": 74.1, "r3": 69.1},
    1600: {"r1": 80.7, "r2": 75.4, "r3": 70.8},
    1800: {"r1": 81.4, "r2": 76.4, "r3": 72.2},
    2000: {"r1": 81.9, "r2": 77.2, "r3": 73.3},
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
MAX_ARRAY_SIZE = 520  # 10 channels * 52 weeks
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
