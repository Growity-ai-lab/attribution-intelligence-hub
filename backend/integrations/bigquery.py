"""BigQuery connector for GA4 session-level touchpoint extraction."""

from __future__ import annotations

import json
import re
from datetime import date, timedelta

import pandas as pd
from google.cloud import bigquery
from google.oauth2 import service_account


# --------------- Channel Mapping ---------------

# source (lowercase) → { medium_pattern: hub_channel }
# "*" medium means any medium from that source maps to the channel.
_SOURCE_MAP: dict[str, dict[str, str]] = {
    "google": {"cpc": "google", "paid": "google", "pmax": "google"},
    "facebook": {"*": "meta"},
    "fb": {"*": "meta"},
    "meta": {"*": "meta"},
    "ig": {"*": "meta"},
    "instagram": {"*": "meta"},
    "tiktok": {"*": "tiktok"},
    "tiktok_int": {"*": "tiktok"},
    "linkedin": {"*": "linkedin"},
    "dv360": {"*": "dv360"},
    "dbm": {"*": "dv360"},
    "youtube": {"*": "youtube"},
}

# medium-only fallbacks (when source doesn't match above)
_MEDIUM_MAP: dict[str, str] = {
    "organic": "organic_search",
    "referral": "referral",
    "email": "email",
    "affiliate": "affiliate",
    "social": "organic_social",
    "video": "youtube",
    "display": "dv360",
}


def map_channel(source: str | None, medium: str | None) -> str:
    """Map GA4 source/medium pair to hub channel taxonomy."""
    src = (source or "").strip().lower()
    med = (medium or "").strip().lower()

    if not src and not med:
        return "direct"
    if src == "(direct)" or (src == "" and med == "(none)"):
        return "direct"

    # Source-based lookup
    if src in _SOURCE_MAP:
        rules = _SOURCE_MAP[src]
        if med in rules:
            return rules[med]
        if "*" in rules:
            return rules["*"]

    # Medium-based fallback
    for pattern, channel in _MEDIUM_MAP.items():
        if pattern in med:
            return channel

    # Google organic (source=google, medium=organic)
    if "google" in src and "organic" in med:
        return "organic_search"

    return "other"


# --------------- Client & Connection ---------------


def get_client(credentials_json: str) -> bigquery.Client:
    """Create BQ client from service account JSON string."""
    info = json.loads(credentials_json)
    creds = service_account.Credentials.from_service_account_info(
        info, scopes=[
            "https://www.googleapis.com/auth/bigquery.readonly",
            "https://www.googleapis.com/auth/cloud-platform",
        ]
    )
    return bigquery.Client(credentials=creds, project=info.get("project_id"))


def test_connection(
    client: bigquery.Client, project: str, dataset: str
) -> dict:
    """Test BQ connectivity: check dataset access, list event tables, date range."""
    ds_ref = f"{project}.{dataset}"
    tables = list(client.list_tables(ds_ref, max_results=500))
    event_tables = sorted(
        [t.table_id for t in tables if re.match(r"events_\d{8}$", t.table_id)]
    )
    if not event_tables:
        return {
            "ok": False,
            "error": f"No events_* tables found in {ds_ref}",
            "tables_found": len(tables),
        }
    return {
        "ok": True,
        "dataset": ds_ref,
        "event_tables": len(event_tables),
        "first_date": event_tables[0].replace("events_", ""),
        "last_date": event_tables[-1].replace("events_", ""),
    }


# --------------- GA4 Query ---------------

_GA4_SESSION_QUERY = """
WITH raw_events AS (
  SELECT
    user_pseudo_id,
    TIMESTAMP_MICROS(event_timestamp) AS event_ts,
    event_name,
    traffic_source.source AS source,
    traffic_source.medium AS medium,
    traffic_source.name AS campaign,
    CASE
      WHEN event_name IN UNNEST(@conversion_events) THEN
        COALESCE(
          ecommerce.purchase_revenue,
          (SELECT value.double_value FROM UNNEST(event_params) WHERE key = 'value'),
          (SELECT CAST(value.int_value AS FLOAT64) FROM UNNEST(event_params) WHERE key = 'value'),
          0
        )
      ELSE 0
    END AS revenue,
    (SELECT value.int_value FROM UNNEST(event_params) WHERE key = 'ga_session_id') AS ga_session_id
  FROM `{project}.{dataset}.events_*`
  WHERE _TABLE_SUFFIX BETWEEN @start_date AND @end_date
    AND (
      traffic_source.source IS NOT NULL
      OR traffic_source.medium IS NOT NULL
      OR event_name IN UNNEST(@conversion_events)
    )
)
SELECT
  user_pseudo_id,
  event_ts,
  event_name,
  source,
  medium,
  campaign,
  revenue,
  ga_session_id
FROM raw_events
ORDER BY user_pseudo_id, event_ts
LIMIT @row_limit
"""


def query_ga4_sessions(
    client: bigquery.Client,
    project: str,
    dataset: str,
    start_date: str,
    end_date: str,
    conversion_events: list[str] | None = None,
    row_limit: int = 500_000,
) -> pd.DataFrame:
    """Pull session-level touchpoint data from GA4 BQ export.

    Parameters
    ----------
    start_date, end_date : YYYYMMDD strings
    conversion_events : e.g. ["purchase", "generate_lead"]
    row_limit : max rows to return (default 500k, keeps query fast)

    Returns DataFrame with columns:
      user_pseudo_id, event_ts, event_name, source, medium, campaign, revenue
    """
    if conversion_events is None:
        conversion_events = ["purchase"]

    sql = _GA4_SESSION_QUERY.format(project=project, dataset=dataset)
    job_config = bigquery.QueryJobConfig(
        query_parameters=[
            bigquery.ScalarQueryParameter("start_date", "STRING", start_date),
            bigquery.ScalarQueryParameter("end_date", "STRING", end_date),
            bigquery.ArrayQueryParameter("conversion_events", "STRING", conversion_events),
            bigquery.ScalarQueryParameter("row_limit", "INT64", row_limit),
        ]
    )
    df = client.query(sql, job_config=job_config).to_dataframe()
    return df


# --------------- Transform to Touchpoints ---------------


def _source_medium_label(source: str | None, medium: str | None) -> str:
    """Build a 'source / medium' channel label from GA4 fields."""
    src = (source or "(direct)").strip()
    med = (medium or "(none)").strip()
    if not src:
        src = "(direct)"
    if not med:
        med = "(none)"
    _unavailable = {"data not available", "(not set)", "not available", ""}
    if src.lower() in _unavailable:
        src = "(bilinmeyen)"
    if med.lower() in _unavailable:
        med = "(bilinmeyen)"
    return f"{src} / {med}"


def ga4_to_touchpoints(df: pd.DataFrame, conversion_events: list[str] | None = None) -> list[dict]:
    """Convert GA4 DataFrame to CRMTouchpoint-compatible dicts.

    Uses raw source/medium as channel name for maximum transparency.
    Revenue is only assigned to conversion events (handled in SQL CASE).
    """
    if conversion_events is None:
        conversion_events = ["purchase"]

    conv_set = set(conversion_events)
    results: list[dict] = []

    for _, row in df.iterrows():
        channel = _source_medium_label(row.get("source"), row.get("medium"))
        event = str(row.get("event_name", ""))
        converted = event in conv_set
        revenue = float(row.get("revenue", 0) or 0) if converted else 0.0
        ga_sid = row.get("ga_session_id")
        session_id = (
            f"{row['user_pseudo_id']}_{int(ga_sid)}"
            if ga_sid is not None and str(ga_sid) not in ("", "None", "nan")
            else str(row["user_pseudo_id"])
        )

        results.append({
            "lead_id": str(row["user_pseudo_id"]),
            "timestamp": str(row["event_ts"]),
            "channel": channel,
            "touchpoint_type": event,
            "campaign": str(row.get("campaign") or ""),
            "segment": "",
            "converted": converted,
            "session_id": session_id,
            "revenue": revenue,
        })

    return results


def consolidate_channels(touchpoints: list[dict], max_channels: int = 12) -> list[dict]:
    """Group low-frequency source/medium pairs into 'diger' to keep channel count manageable.

    Keeps the top N channels by touchpoint count, merges the rest into 'diger'.
    This is critical for Shapley computation which is O(2^n) on channel count.
    """
    freq: dict[str, int] = {}
    for tp in touchpoints:
        freq[tp["channel"]] = freq.get(tp["channel"], 0) + 1

    top_channels = {ch for ch, _ in sorted(freq.items(), key=lambda x: -x[1])[:max_channels]}

    for tp in touchpoints:
        if tp["channel"] not in top_channels:
            tp["channel"] = "diger"

    return touchpoints


def summarize_touchpoints(touchpoints: list[dict]) -> dict:
    """Quick summary stats for UI display before running DDA."""
    if not touchpoints:
        return {"total_events": 0}

    channels: dict[str, int] = {}
    conversions = 0
    total_revenue = 0.0
    users = set()
    sessions = set()
    converted_users = set()

    for tp in touchpoints:
        ch = tp["channel"]
        channels[ch] = channels.get(ch, 0) + 1
        users.add(tp["lead_id"])
        sessions.add(tp.get("session_id", tp["lead_id"]))
        if tp.get("converted"):
            uid = tp["lead_id"]
            if uid not in converted_users:
                conversions += 1
                converted_users.add(uid)
            total_revenue += tp.get("revenue", 0)

    return {
        "total_events": len(touchpoints),
        "unique_users": len(users),
        "sessions": len(sessions),
        "conversions": conversions,
        "total_revenue": round(total_revenue, 2),
        "channels": dict(sorted(channels.items(), key=lambda x: -x[1])),
    }


def default_date_range(months: int = 6) -> tuple[str, str]:
    """Return (start_date, end_date) as YYYYMMDD strings for last N months."""
    end = date.today()
    start = end - timedelta(days=months * 30)
    return start.strftime("%Y%m%d"), end.strftime("%Y%m%d")
