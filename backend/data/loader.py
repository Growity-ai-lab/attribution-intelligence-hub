"""CSV/Excel data loading and validation."""

from io import BytesIO
from pathlib import Path

import pandas as pd
from pydantic import ValidationError

from backend.config import MAX_CSV_ROWS
from backend.data.schemas import CRMTouchpoint, SalesStockInput, WeeklyChannelInput

WEEKLY_REQUIRED_COLS = {"week", "channel", "spend", "impressions", "clicks", "leads"}
CRM_REQUIRED_COLS = {"lead_id", "timestamp", "channel", "touchpoint_type"}
SALES_STOCK_REQUIRED_COLS = {"week"}


def _read_dataframe(file_path: str | Path | BytesIO, max_rows: int = MAX_CSV_ROWS) -> tuple[pd.DataFrame, bool]:
    """Read CSV or Excel file into a DataFrame with row limits.

    Returns (dataframe, truncated) where truncated is True if the file had more rows than max_rows.
    """
    try:
        if isinstance(file_path, BytesIO):
            df = pd.read_csv(file_path, nrows=max_rows)
            if len(df) >= max_rows:
                return df, True
            return df, False
        path = Path(file_path)
        if path.suffix in (".xlsx", ".xls"):
            df = pd.read_excel(path, nrows=max_rows)
        else:
            df = pd.read_csv(path, nrows=max_rows)
        return df, len(df) >= max_rows
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


def load_weekly_csv(file_path: str | Path | BytesIO) -> tuple[list[WeeklyChannelInput], bool]:
    """Load and validate weekly channel data from CSV or Excel.

    Returns (records, truncated).
    """
    df, truncated = _read_dataframe(file_path)

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

    return records, truncated


def load_crm_touchpoints(file_path: str | Path | BytesIO) -> tuple[list[CRMTouchpoint], bool]:
    """Load and validate CRM touchpoint data.

    Returns (records, truncated).
    """
    df, truncated = _read_dataframe(file_path)

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

    return records, truncated


def load_sales_stock_csv(file_path: str | Path | BytesIO) -> tuple[list[SalesStockInput], bool]:
    """Load and validate sales/stock data from CSV or Excel.

    Returns (records, truncated).
    """
    df, truncated = _read_dataframe(file_path)

    missing = SALES_STOCK_REQUIRED_COLS - set(df.columns)
    if missing:
        raise ValueError(f"Missing required columns: {', '.join(sorted(missing))}")

    # Fill numeric NaN with 0, string NaN with ""
    numeric_cols = ["sales_units", "sales_revenue", "stock_units", "stock_value",
                    "returns", "new_customers", "repeat_customers"]
    string_cols = ["channel", "product", "region"]

    for col in numeric_cols:
        if col in df.columns:
            df[col] = df[col].fillna(0)
    for col in string_cols:
        if col in df.columns:
            df[col] = df[col].fillna("")

    df = df.fillna("")
    records: list[SalesStockInput] = []
    errors: list[str] = []

    for idx, row in df.iterrows():
        try:
            records.append(SalesStockInput(**row.to_dict()))
        except ValidationError:
            errors.append(f"Row {idx}: invalid data")

    if errors:
        raise ValueError(_format_errors(errors))

    return records, truncated
