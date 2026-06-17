"""CSV/Excel data loading and validation."""

from io import BytesIO
from pathlib import Path

import pandas as pd
from pydantic import ValidationError

from backend.config import MAX_CSV_ROWS
from backend.data.schemas import CRMTouchpoint, SalesStockInput, WeeklyChannelInput

WEEKLY_REQUIRED_COLS = {"week", "channel", "spend", "impressions", "clicks", "leads"}
CRM_REQUIRED_COLS = {"lead_id", "timestamp", "channel", "touchpoint_type"}
GA4_REQUIRED_COLS = {"user_pseudo_id", "event_name", "source", "medium"}
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


def _is_ga4_format(df: pd.DataFrame) -> bool:
    """Detect whether a DataFrame uses GA4 export column names."""
    return GA4_REQUIRED_COLS.issubset(set(df.columns))


def _convert_ga4_to_crm(df: pd.DataFrame, conversion_events: list[str] | None = None) -> pd.DataFrame:
    """Convert GA4-format DataFrame to CRM touchpoint format.

    Applies channel mapping (source/medium → hub channel taxonomy) and
    detects conversions from event_name.
    """
    from backend.integrations.bigquery import map_channel

    if conversion_events is None:
        conversion_events = ["purchase", "generate_lead"]

    conv_set = set(conversion_events)
    lead_converted: dict[str, bool] = {}

    rows = []
    for _, row in df.iterrows():
        uid = str(row.get("user_pseudo_id", ""))
        event = str(row.get("event_name", ""))
        source = str(row.get("source", "")) if pd.notna(row.get("source")) else ""
        medium = str(row.get("medium", "")) if pd.notna(row.get("medium")) else ""
        channel = map_channel(source, medium)
        ts = str(row.get("event_timestamp", row.get("event_ts", "")))
        campaign = str(row.get("campaign", "")) if pd.notna(row.get("campaign")) else ""
        converted = event in conv_set

        if converted:
            lead_converted[uid] = True

        rows.append({
            "lead_id": uid,
            "timestamp": ts,
            "channel": channel,
            "touchpoint_type": event,
            "campaign": campaign,
            "segment": "",
            "converted": converted,
            "session_id": "",
        })

    result_df = pd.DataFrame(rows)
    result_df["converted"] = result_df["lead_id"].map(
        lambda uid: lead_converted.get(uid, False)
    )
    return result_df


def load_crm_touchpoints(
    file_path: str | Path | BytesIO,
    conversion_events: list[str] | None = None,
) -> tuple[list[CRMTouchpoint], bool]:
    """Load and validate CRM touchpoint data.

    Auto-detects GA4 export format (user_pseudo_id, event_name, source, medium)
    and converts it to CRM touchpoint format with channel mapping.

    Returns (records, truncated).
    """
    df, truncated = _read_dataframe(file_path)

    ga4_detected = False
    if _is_ga4_format(df):
        df = _convert_ga4_to_crm(df, conversion_events)
        ga4_detected = True

    if not ga4_detected:
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
