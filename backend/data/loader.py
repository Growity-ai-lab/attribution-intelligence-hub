"""CSV/Excel data loading and validation."""

from io import BytesIO
from pathlib import Path

import pandas as pd
from pydantic import ValidationError

from backend.config import MAX_CSV_ROWS
from backend.data.schemas import CRMTouchpoint, WeeklyChannelInput

WEEKLY_REQUIRED_COLS = {"week", "channel", "spend", "impressions", "clicks", "leads"}
CRM_REQUIRED_COLS = {"lead_id", "timestamp", "channel", "touchpoint_type"}


def _read_dataframe(file_path: str | Path | BytesIO, max_rows: int = MAX_CSV_ROWS) -> pd.DataFrame:
    """Read CSV or Excel file into a DataFrame with row limits."""
    try:
        if isinstance(file_path, BytesIO):
            return pd.read_csv(file_path, nrows=max_rows)
        path = Path(file_path)
        if path.suffix in (".xlsx", ".xls"):
            return pd.read_excel(path, nrows=max_rows)
        return pd.read_csv(path, nrows=max_rows)
    except Exception as e:
        raise ValueError(f"Unable to parse file: {type(e).__name__}")


def _format_errors(errors: list[str]) -> str:
    """Format validation errors, limiting detail exposure."""
    count = len(errors)
    sample = errors[:5]
    msg = f"{count} validation error(s). First issues: " + "; ".join(sample)
    if count > 5:
        msg += f" ... and {count - 5} more"
    return msg


def load_weekly_csv(file_path: str | Path | BytesIO) -> list[WeeklyChannelInput]:
    """Load and validate weekly channel data from CSV or Excel."""
    df = _read_dataframe(file_path)

    missing = WEEKLY_REQUIRED_COLS - set(df.columns)
    if missing:
        raise ValueError(f"Missing required columns: {', '.join(sorted(missing))}")

    df = df.fillna(0)
    records: list[WeeklyChannelInput] = []
    errors: list[str] = []

    for idx, row in df.iterrows():
        try:
            records.append(WeeklyChannelInput(**row.to_dict()))
        except ValidationError:
            errors.append(f"Row {idx}: invalid data")

    if errors:
        raise ValueError(_format_errors(errors))

    return records


def load_crm_touchpoints(file_path: str | Path | BytesIO) -> list[CRMTouchpoint]:
    """Load and validate CRM touchpoint data."""
    df = _read_dataframe(file_path)

    missing = CRM_REQUIRED_COLS - set(df.columns)
    if missing:
        raise ValueError(f"Missing required columns: {', '.join(sorted(missing))}")

    df = df.fillna("")
    records: list[CRMTouchpoint] = []
    errors: list[str] = []

    for idx, row in df.iterrows():
        try:
            records.append(CRMTouchpoint(**row.to_dict()))
        except ValidationError:
            errors.append(f"Row {idx}: invalid data")

    if errors:
        raise ValueError(_format_errors(errors))

    return records
