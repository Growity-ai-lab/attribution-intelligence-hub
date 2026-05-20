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
    COALESCE(
      ecommerce.purchase_revenue,
      (SELECT value.double_value FROM UNNEST(event_params) WHERE key = 'value'),
      0
    ) AS revenue
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
  revenue
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


def ga4_to_touchpoints(df: pd.DataFrame, conversion_events: list[str] | None = None) -> list[dict]:
    """Convert GA4 DataFrame to CRMTouchpoint-compatible dicts.

    Each row becomes a touchpoint dict with:
      lead_id (= user_pseudo_id), timestamp, channel, touchpoint_type,
      campaign, converted, revenue
    """
    if conversion_events is None:
        conversion_events = ["purchase"]

    conv_set = set(conversion_events)
    results: list[dict] = []

    for _, row in df.iterrows():
        channel = map_channel(row.get("source"), row.get("medium"))
        event = str(row.get("event_name", ""))
        revenue = float(row.get("revenue", 0) or 0)
        converted = event in conv_set and revenue > 0

        results.append({
            "lead_id": str(row["user_pseudo_id"]),
            "timestamp": str(row["event_ts"]),
            "channel": channel,
            "touchpoint_type": event,
            "campaign": str(row.get("campaign") or ""),
            "segment": "",
            "converted": converted,
            "session_id": str(row["user_pseudo_id"]),
            "revenue": revenue,
        })

    return results


def summarize_touchpoints(touchpoints: list[dict]) -> dict:
    """Quick summary stats for UI display before running DDA."""
    if not touchpoints:
        return {"total_events": 0}

    channels: dict[str, int] = {}
    conversions = 0
    total_revenue = 0.0
    users = set()

    for tp in touchpoints:
        ch = tp["channel"]
        channels[ch] = channels.get(ch, 0) + 1
        users.add(tp["lead_id"])
        if tp.get("converted"):
            conversions += 1
            total_revenue += tp.get("revenue", 0)

    return {
        "total_events": len(touchpoints),
        "unique_users": len(users),
        "conversions": conversions,
        "total_revenue": round(total_revenue, 2),
        "channels": dict(sorted(channels.items(), key=lambda x: -x[1])),
    }


def default_date_range(months: int = 6) -> tuple[str, str]:
    """Return (start_date, end_date) as YYYYMMDD strings for last N months."""
    end = date.today()
    start = end - timedelta(days=months * 30)
    return start.strftime("%Y%m%d"), end.strftime("%Y%m%d")
