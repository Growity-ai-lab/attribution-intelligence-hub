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
WITH base_events AS (
  SELECT
    user_pseudo_id,
    event_timestamp,
    event_name,
    COALESCE(
      collected_traffic_source.manual_source,
      (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'source'),
      traffic_source.source
    ) AS source,
    COALESCE(
      collected_traffic_source.manual_medium,
      (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'medium'),
      traffic_source.medium
    ) AS medium,
    traffic_source.name AS campaign,
    IF(
      event_name IN UNNEST(@conversion_events),
      COALESCE(ecommerce.purchase_revenue, 0),
      0
    ) AS revenue,
    (SELECT value.int_value FROM UNNEST(event_params) WHERE key = 'ga_session_id') AS ga_session_id,
    ecommerce.transaction_id
  FROM `{project}.{dataset}.events_*`
  WHERE _TABLE_SUFFIX BETWEEN @start_date AND @end_date
    AND (
      collected_traffic_source.manual_source IS NOT NULL
      OR collected_traffic_source.manual_medium IS NOT NULL
      OR traffic_source.source IS NOT NULL
      OR traffic_source.medium IS NOT NULL
      OR event_name IN UNNEST(@conversion_events)
    )
),
-- Dedup revenue per transaction: assign revenue only to the first row
-- per (user, transaction_id) so the same purchase isn't double-counted
-- across multiple conversion event names.
txn_revenue AS (
  SELECT
    user_pseudo_id,
    transaction_id,
    event_timestamp,
    revenue,
    IF(
      transaction_id IS NOT NULL,
      ROW_NUMBER() OVER (
        PARTITION BY user_pseudo_id, transaction_id
        ORDER BY event_timestamp
      ),
      1
    ) AS _txn_rn
  FROM base_events
  WHERE event_name IN UNNEST(@conversion_events)
    AND revenue > 0
),
-- Aggregate to one row per (user, session). This reduces 100K+ event rows
-- to ~4K session rows, cutting memory from ~500MB to ~20MB.
session_grain AS (
  SELECT
    b.user_pseudo_id,
    b.ga_session_id,
    TIMESTAMP_MICROS(MIN(b.event_timestamp)) AS event_ts,
    -- Session acquisition = the session's first event that carries a real
    -- source. Events whose source is NULL/(not set)/data-not-available are
    -- ordered last, so a session only collapses to "unknown" when EVERY event
    -- lacks a source. This matches GA4's session-scoped attribution and stops
    -- ANY_VALUE from arbitrarily picking a null source over a real one.
    ARRAY_AGG(
      STRUCT(b.source, b.medium, b.campaign)
      ORDER BY
        CASE
          WHEN b.source IS NULL
            OR LOWER(b.source) IN ('(not set)', 'data not available', 'not available')
          THEN 1 ELSE 0
        END,
        b.event_timestamp
      LIMIT 1
    )[OFFSET(0)] AS first_touch,
    MAX(IF(b.event_name IN UNNEST(@conversion_events), 1, 0)) AS is_conversion,
    -- Pick one conversion event name for converted sessions (ga4_to_touchpoints
    -- checks event_name membership in conv_set).
    MAX(IF(b.event_name IN UNNEST(@conversion_events), b.event_name, NULL)) AS conv_event_name,
    -- Sum only transaction-deduped revenue for this session
    COALESCE(SUM(
      IF(t._txn_rn = 1, t.revenue, 0)
    ), 0) AS session_revenue
  FROM base_events b
  LEFT JOIN txn_revenue t
    ON b.user_pseudo_id = t.user_pseudo_id
    AND b.event_timestamp = t.event_timestamp
    AND b.transaction_id = t.transaction_id
  GROUP BY b.user_pseudo_id, b.ga_session_id
)
SELECT
  user_pseudo_id,
  event_ts,
  IF(is_conversion = 1, conv_event_name, 'session') AS event_name,
  first_touch.source AS source,
  first_touch.medium AS medium,
  first_touch.campaign AS campaign,
  session_revenue AS revenue,
  ga_session_id
FROM session_grain
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
    row_limit: int = 200_000,
) -> pd.DataFrame:
    """Pull session-level touchpoint data from GA4 BQ export.

    After session-grain aggregation the row count equals unique sessions
    (typically 2-10K), not raw events (100K+).
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
    df = client.query(sql, job_config=job_config).to_dataframe(
        create_bqstorage_client=False,
    )
    return df


# --------------- Transform to Touchpoints ---------------


def _clean_source(raw: str) -> str:
    """Strip URL query params and path fragments from GA4 source values."""
    s = raw.split("?", 1)[0]
    s = s.split("/", 1)[0]
    return s.strip() or raw


_SOURCE_ALIASES: dict[str, str] = {
    "l.instagram.com": "instagram",
    "lm.instagram.com": "instagram",
    "m.instagram.com": "instagram",
    "instagram.com": "instagram",
    "l.facebook.com": "facebook",
    "lm.facebook.com": "facebook",
    "m.facebook.com": "facebook",
    "facebook.com": "facebook",
    "youtube.com": "youtube",
    "m.youtube.com": "youtube",
    "t.co": "twitter",
    "linkedin.com": "linkedin",
    "lnkd.in": "linkedin",
}


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
    src = _clean_source(src)
    src = _SOURCE_ALIASES.get(src.lower(), src)
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

    cols = list(df.columns)
    for row in df.itertuples(index=False):
        row_dict = dict(zip(cols, row))
        channel = _source_medium_label(row_dict.get("source"), row_dict.get("medium"))
        event = str(row_dict.get("event_name", ""))
        converted = event in conv_set
        revenue = float(row_dict.get("revenue", 0) or 0) if converted else 0.0
        ga_sid = row_dict.get("ga_session_id")
        try:
            sid_int = int(ga_sid)
            session_id = f"{row_dict['user_pseudo_id']}_{sid_int}"
        except (TypeError, ValueError):
            session_id = str(row_dict["user_pseudo_id"])

        results.append({
            "lead_id": str(row_dict["user_pseudo_id"]),
            "timestamp": str(row_dict["event_ts"]),
            "channel": channel,
            "touchpoint_type": event,
            "campaign": str(row_dict.get("campaign") or ""),
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
    channel_revenue: dict[str, float] = {}
    conversions = 0
    total_revenue = 0.0
    users = set()
    sessions = set()
    converted_users = set()
    conversion_events_with_revenue = 0

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
            rev = tp.get("revenue", 0) or 0
            total_revenue += rev
            if rev:
                conversion_events_with_revenue += 1
                channel_revenue[ch] = channel_revenue.get(ch, 0.0) + rev

    return {
        "total_events": len(touchpoints),
        "unique_users": len(users),
        "sessions": len(sessions),
        "conversions": conversions,
        "conversion_events_with_revenue": conversion_events_with_revenue,
        "total_revenue": round(total_revenue, 2),
        "channel_revenue": {
            k: round(v, 2)
            for k, v in sorted(channel_revenue.items(), key=lambda x: -x[1])
        },
        "channels": dict(sorted(channels.items(), key=lambda x: -x[1])),
    }


def default_date_range(months: int = 6) -> tuple[str, str]:
    """Return (start_date, end_date) as YYYYMMDD strings for last N months."""
    end = date.today()
    start = end - timedelta(days=months * 30)
    return start.strftime("%Y%m%d"), end.strftime("%Y%m%d")
