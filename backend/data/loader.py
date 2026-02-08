"""CSV/Excel data loading and validation."""

from io import BytesIO
from pathlib import Path

import pandas as pd
from pydantic import ValidationError

from backend.data.schemas import CRMTouchpoint, WeeklyChannelInput

WEEKLY_REQUIRED_COLS = {"week", "channel", "spend", "impressions", "clicks", "leads"}
CRM_REQUIRED_COLS = {"lead_id", "timestamp", "channel", "touchpoint_type"}


def load_weekly_csv(file_path: str | Path | BytesIO) -> list[WeeklyChannelInput]:
    """Load and validate weekly channel data from CSV or Excel."""
    if isinstance(file_path, BytesIO):
        df = pd.read_csv(file_path)
    else:
        path = Path(file_path)
        if path.suffix in (".xlsx", ".xls"):
            df = pd.read_excel(path)
        else:
            df = pd.read_csv(path)

    missing = WEEKLY_REQUIRED_COLS - set(df.columns)
    if missing:
        raise ValueError(f"Missing required columns: {missing}")

    df = df.fillna(0)
    records: list[WeeklyChannelInput] = []
    errors: list[str] = []

    for idx, row in df.iterrows():
        try:
            records.append(WeeklyChannelInput(**row.to_dict()))
        except ValidationError as e:
            errors.append(f"Row {idx}: {e}")

    if errors:
        raise ValueError(f"Validation errors:\n" + "\n".join(errors))

    return records


def load_crm_touchpoints(file_path: str | Path | BytesIO) -> list[CRMTouchpoint]:
    """Load and validate CRM touchpoint data."""
    if isinstance(file_path, BytesIO):
        df = pd.read_csv(file_path)
    else:
        path = Path(file_path)
        if path.suffix in (".xlsx", ".xls"):
            df = pd.read_excel(path)
        else:
            df = pd.read_csv(path)

    missing = CRM_REQUIRED_COLS - set(df.columns)
    if missing:
        raise ValueError(f"Missing required columns: {missing}")

    df = df.fillna("")
    records: list[CRMTouchpoint] = []
    errors: list[str] = []

    for idx, row in df.iterrows():
        try:
            records.append(CRMTouchpoint(**row.to_dict()))
        except ValidationError as e:
            errors.append(f"Row {idx}: {e}")

    if errors:
        raise ValueError(f"Validation errors:\n" + "\n".join(errors))

    return records
