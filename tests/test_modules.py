"""Unit tests for alerts, crypto, and bigquery modules."""

import os

os.environ.setdefault("AUTH_SECRET_KEY", "test-secret-key-for-ci")
os.environ.setdefault("AUTH_ADMIN_PASSWORD", "test-password-for-ci")

import pytest
import pandas as pd
from datetime import date, timedelta

from backend.models.alerts import evaluate_alerts, compute_trend_series
from backend.crypto import encrypt, decrypt
from backend.integrations.bigquery import (
    map_channel,
    ga4_to_touchpoints,
    consolidate_channels,
    summarize_touchpoints,
    default_date_range,
)


# ── Alert Rules ──────────────────────────────────────────────────────


def _snap(cr=0.05, total=1000, hybrid=None):
    return {
        "journey_stats": {
            "conversion_rate": cr,
            "total_journeys": total,
            "converted": int(total * cr),
        },
        "hybrid_attribution": hybrid or {"meta": 0.4, "google": 0.35, "tiktok": 0.25},
    }


class TestAlertRules:
    def test_no_alerts_when_identical(self):
        snap = _snap()
        alerts = evaluate_alerts(snap, snap)
        assert alerts == []

    def test_no_alerts_without_previous(self):
        alerts = evaluate_alerts(_snap(), None)
        rule_ids = {a["rule_id"] for a in alerts}
        assert "conversion_drop" not in rule_ids
        assert "volume_drop" not in rule_ids
        assert "channel_disappeared" not in rule_ids

    def test_conversion_drop_triggered(self):
        cur = _snap(cr=0.02)
        prev = _snap(cr=0.05)
        alerts = evaluate_alerts(cur, prev)
        ids = [a["rule_id"] for a in alerts]
        assert "conversion_drop" in ids
        a = next(a for a in alerts if a["rule_id"] == "conversion_drop")
        assert a["severity"] == "critical"

    def test_conversion_drop_not_triggered_small_delta(self):
        cur = _snap(cr=0.048)
        prev = _snap(cr=0.05)
        alerts = evaluate_alerts(cur, prev)
        ids = [a["rule_id"] for a in alerts]
        assert "conversion_drop" not in ids

    def test_volume_drop_triggered(self):
        cur = _snap(total=700)
        prev = _snap(total=1000)
        alerts = evaluate_alerts(cur, prev)
        ids = [a["rule_id"] for a in alerts]
        assert "volume_drop" in ids

    def test_channel_disappeared_triggered(self):
        cur = _snap(hybrid={"meta": 0.6, "google": 0.4})
        prev = _snap(hybrid={"meta": 0.4, "google": 0.35, "tiktok": 0.25})
        alerts = evaluate_alerts(cur, prev)
        ids = [a["rule_id"] for a in alerts]
        assert "channel_disappeared" in ids

    def test_channel_concentration_triggered(self):
        cur = _snap(hybrid={"meta": 0.55, "google": 0.45})
        alerts = evaluate_alerts(cur, None)
        ids = [a["rule_id"] for a in alerts]
        assert "channel_concentration" in ids

    def test_channel_concentration_not_triggered(self):
        cur = _snap(hybrid={"meta": 0.3, "google": 0.3, "tiktok": 0.4})
        alerts = evaluate_alerts(cur, None)
        ids = [a["rule_id"] for a in alerts]
        assert "channel_concentration" not in ids

    def test_sustained_decline_triggered(self):
        trend_data = {
            "channel_trends": {
                "meta": [
                    {"run_date": "d1", "weight": 0.40},
                    {"run_date": "d2", "weight": 0.35},
                    {"run_date": "d3", "weight": 0.30},
                    {"run_date": "d4", "weight": 0.25},
                ],
            }
        }
        cur = _snap(hybrid={"meta": 0.25, "google": 0.75})
        alerts = evaluate_alerts(cur, None, trend_data)
        ids = [a["rule_id"] for a in alerts]
        assert "sustained_decline" in ids

    def test_sustained_decline_not_triggered_short_series(self):
        trend_data = {
            "channel_trends": {
                "meta": [
                    {"run_date": "d1", "weight": 0.40},
                    {"run_date": "d2", "weight": 0.35},
                ],
            }
        }
        alerts = evaluate_alerts(_snap(), None, trend_data)
        ids = [a["rule_id"] for a in alerts]
        assert "sustained_decline" not in ids


# ── Compute Trend Series ─────────────────────────────────────────────


class TestComputeTrendSeries:
    def test_empty_snapshots(self):
        result = compute_trend_series([])
        assert result["channel_trends"] == {}
        assert result["conversion_rate_trend"] == []
        assert result["volume_trend"] == []

    def test_single_snapshot(self):
        snap = _snap(cr=0.03, total=500, hybrid={"meta": 0.6, "google": 0.4})
        result = compute_trend_series([snap])
        assert "meta" in result["channel_trends"]
        assert len(result["channel_trends"]["meta"]) == 1
        assert result["conversion_rate_trend"][0]["rate"] == 0.03

    def test_multiple_snapshots_with_dates(self):
        s1 = _snap(cr=0.03, total=500, hybrid={"meta": 0.6, "google": 0.4})
        s2 = _snap(cr=0.05, total=800, hybrid={"meta": 0.5, "google": 0.5})
        result = compute_trend_series([s1, s2], ["2026-05-01", "2026-05-08"])
        assert len(result["conversion_rate_trend"]) == 2
        assert result["conversion_rate_trend"][0]["run_date"] == "2026-05-01"
        assert result["volume_trend"][1]["total"] == 800

    def test_auto_generated_dates(self):
        s1 = _snap()
        s2 = _snap()
        result = compute_trend_series([s1, s2])
        dates = [p["run_date"] for p in result["conversion_rate_trend"]]
        assert dates == ["run_0", "run_1"]

    def test_channel_union(self):
        s1 = _snap(hybrid={"meta": 0.6, "google": 0.4})
        s2 = _snap(hybrid={"meta": 0.5, "tiktok": 0.5})
        result = compute_trend_series([s1, s2])
        channels = set(result["channel_trends"].keys())
        assert channels == {"meta", "google", "tiktok"}


# ── Crypto ────────────────────────────────────────────────────────────


class TestCrypto:
    def test_roundtrip(self):
        plaintext = "hello-world-credentials-json"
        assert decrypt(encrypt(plaintext)) == plaintext

    def test_roundtrip_unicode(self):
        plaintext = "Türkçe şifreleme testi — özel karakterler: İĞÜŞÇ"
        assert decrypt(encrypt(plaintext)) == plaintext

    def test_roundtrip_empty_string(self):
        assert decrypt(encrypt("")) == ""

    def test_different_ciphertexts(self):
        ct1 = encrypt("test")
        ct2 = encrypt("test")
        assert ct1 != ct2

    def test_invalid_ciphertext_raises(self):
        from cryptography.fernet import InvalidToken

        with pytest.raises(InvalidToken):
            decrypt("not-a-valid-ciphertext")


# ── map_channel ───────────────────────────────────────────────────────


class TestMapChannel:
    def test_google_cpc(self):
        assert map_channel("google", "cpc") == "google"

    def test_meta_paid(self):
        result = map_channel("facebook", "paid_social")
        assert result == "meta"

    def test_direct(self):
        assert map_channel("(direct)", "(none)") == "direct"

    def test_none_none(self):
        assert map_channel(None, None) == "direct"

    def test_organic_search(self):
        result = map_channel("google", "organic")
        assert result == "organic_search"

    def test_tiktok(self):
        result = map_channel("tiktok", "cpc")
        assert result == "tiktok"

    def test_unknown_source(self):
        result = map_channel("randomsite", "referral")
        assert result == "referral"

    def test_case_insensitivity(self):
        assert map_channel("Google", "CPC") == "google"


# ── ga4_to_touchpoints ───────────────────────────────────────────────


class TestGa4ToTouchpoints:
    def test_empty_dataframe(self):
        df = pd.DataFrame(
            columns=["user_pseudo_id", "event_ts", "event_name", "source", "medium", "campaign", "revenue", "ga_session_id"]
        )
        result = ga4_to_touchpoints(df)
        assert result == []

    def test_basic_conversion(self):
        df = pd.DataFrame(
            [
                {
                    "user_pseudo_id": "u1",
                    "event_ts": "2026-01-15 10:00:00",
                    "event_name": "page_view",
                    "source": "google",
                    "medium": "cpc",
                    "campaign": "search",
                    "revenue": 0.0,
                    "ga_session_id": "100",
                },
                {
                    "user_pseudo_id": "u1",
                    "event_ts": "2026-01-15 10:05:00",
                    "event_name": "purchase",
                    "source": "google",
                    "medium": "cpc",
                    "campaign": "search",
                    "revenue": 500.0,
                    "ga_session_id": "100",
                },
            ]
        )
        result = ga4_to_touchpoints(df, conversion_events=["purchase"])
        assert len(result) == 2
        conv = [t for t in result if t["converted"]]
        assert len(conv) == 1
        assert conv[0]["revenue"] == 500.0

    def test_channel_uses_source_medium_label(self):
        df = pd.DataFrame(
            [
                {
                    "user_pseudo_id": "u1",
                    "event_ts": "2026-01-15 10:00:00",
                    "event_name": "page_view",
                    "source": "google",
                    "medium": "cpc",
                    "campaign": "search",
                    "revenue": 0.0,
                    "ga_session_id": "100",
                },
            ]
        )
        result = ga4_to_touchpoints(df)
        assert "/" in result[0]["channel"]


# ── consolidate_channels ─────────────────────────────────────────────


class TestConsolidateChannels:
    def test_no_consolidation_under_limit(self):
        tps = [{"channel": f"ch{i}", "lead_id": f"L{i}"} for i in range(5)]
        result = consolidate_channels(tps, max_channels=10)
        channels = {t["channel"] for t in result}
        assert "diger" not in channels

    def test_consolidation_above_limit(self):
        tps = []
        for i in range(15):
            for _ in range(15 - i):
                tps.append({"channel": f"ch{i}", "lead_id": f"L{i}"})
        result = consolidate_channels(tps, max_channels=3)
        channels = {t["channel"] for t in result}
        assert "diger" in channels
        assert len(channels - {"diger"}) == 3

    def test_empty_list(self):
        assert consolidate_channels([], max_channels=5) == []


# ── summarize_touchpoints ────────────────────────────────────────────


class TestSummarizeTouchpoints:
    def test_empty_list(self):
        result = summarize_touchpoints([])
        assert result["total_events"] == 0

    def test_basic_summary(self):
        tps = [
            {"lead_id": "L1", "session_id": "s1", "channel": "meta", "converted": True, "revenue": 100.0},
            {"lead_id": "L1", "session_id": "s2", "channel": "google", "converted": False, "revenue": 0.0},
            {"lead_id": "L2", "session_id": "s3", "channel": "meta", "converted": False, "revenue": 0.0},
        ]
        result = summarize_touchpoints(tps)
        assert result["total_events"] == 3
        assert result["unique_users"] == 2
        assert result["conversions"] == 1
        assert result["total_revenue"] == 100.0

    def test_multiple_conversions_per_user_counted_once(self):
        tps = [
            {"lead_id": "L1", "session_id": "s1", "channel": "meta", "converted": True, "revenue": 50.0},
            {"lead_id": "L1", "session_id": "s2", "channel": "google", "converted": True, "revenue": 75.0},
        ]
        result = summarize_touchpoints(tps)
        assert result["conversions"] == 1

    def test_channels_frequency(self):
        tps = [
            {"lead_id": "L1", "session_id": "s1", "channel": "meta", "converted": False, "revenue": 0},
            {"lead_id": "L2", "session_id": "s2", "channel": "meta", "converted": False, "revenue": 0},
            {"lead_id": "L3", "session_id": "s3", "channel": "google", "converted": False, "revenue": 0},
        ]
        result = summarize_touchpoints(tps)
        assert result["channels"]["meta"] == 2
        assert result["channels"]["google"] == 1

    def test_channel_revenue_split(self):
        # Measured revenue is tied to the channel of each converting session.
        tps = [
            {"lead_id": "L1", "session_id": "s1", "channel": "meta", "converted": True, "revenue": 100.0},
            {"lead_id": "L2", "session_id": "s2", "channel": "google", "converted": True, "revenue": 250.0},
            {"lead_id": "L3", "session_id": "s3", "channel": "meta", "converted": True, "revenue": 50.0},
            {"lead_id": "L4", "session_id": "s4", "channel": "google", "converted": False, "revenue": 0.0},
        ]
        result = summarize_touchpoints(tps)
        assert result["total_revenue"] == 400.0
        assert result["channel_revenue"]["meta"] == 150.0
        assert result["channel_revenue"]["google"] == 250.0

    def test_channel_revenue_excludes_nonconverted(self):
        # Revenue on a non-converted touchpoint must not appear anywhere.
        tps = [
            {"lead_id": "L1", "session_id": "s1", "channel": "meta", "converted": False, "revenue": 999.0},
        ]
        result = summarize_touchpoints(tps)
        assert result["total_revenue"] == 0.0
        assert result["channel_revenue"] == {}


# ── default_date_range ───────────────────────────────────────────────


class TestDefaultDateRange:
    def test_format(self):
        start, end = default_date_range(6)
        assert len(start) == 8
        assert len(end) == 8
        assert start.isdigit()
        assert end.isdigit()

    def test_six_months_back(self):
        start, end = default_date_range(6)
        end_date = date(int(end[:4]), int(end[4:6]), int(end[6:]))
        start_date = date(int(start[:4]), int(start[4:6]), int(start[6:]))
        delta = (end_date - start_date).days
        assert delta == 180

    def test_one_month(self):
        start, end = default_date_range(1)
        end_date = date(int(end[:4]), int(end[4:6]), int(end[6:]))
        start_date = date(int(start[:4]), int(start[4:6]), int(start[6:]))
        assert (end_date - start_date).days == 30


# ── Loader truncation ──────────────────────────────────────────────


class TestLoaderTruncation:
    def test_small_csv_not_truncated(self):
        from io import BytesIO
        from backend.data.loader import load_weekly_csv

        csv = (
            "week,channel,spend,impressions,clicks,leads\n"
            "2026-W06,meta,100,200,30,5\n"
        )
        records, truncated = load_weekly_csv(BytesIO(csv.encode()))
        assert len(records) == 1
        assert truncated is False

    def test_truncation_flag_on_exact_limit(self):
        from io import BytesIO
        from backend.data.loader import _read_dataframe

        rows = "a,b\n" + "".join(f"{i},{i}\n" for i in range(10))
        df, truncated = _read_dataframe(BytesIO(rows.encode()), max_rows=5)
        assert len(df) == 5
        assert truncated is True

    def test_no_truncation_below_limit(self):
        from io import BytesIO
        from backend.data.loader import _read_dataframe

        rows = "a,b\n" + "".join(f"{i},{i}\n" for i in range(3))
        df, truncated = _read_dataframe(BytesIO(rows.encode()), max_rows=100)
        assert len(df) == 3
        assert truncated is False

    def test_crm_touchpoints_returns_tuple(self):
        from io import BytesIO
        from backend.data.loader import load_crm_touchpoints

        csv = (
            "lead_id,timestamp,channel,touchpoint_type\n"
            "L1,2026-01-15 10:00,meta,impression\n"
        )
        records, truncated = load_crm_touchpoints(BytesIO(csv.encode()))
        assert len(records) == 1
        assert truncated is False


# ── GA4 CSV Auto-detect ────────────────────────────────────────────


class TestGA4AutoDetect:
    def test_ga4_format_detected(self):
        from backend.data.loader import _is_ga4_format
        df = pd.DataFrame({
            "user_pseudo_id": ["u1"],
            "event_name": ["page_view"],
            "source": ["google"],
            "medium": ["cpc"],
        })
        assert _is_ga4_format(df) is True

    def test_crm_format_not_detected_as_ga4(self):
        from backend.data.loader import _is_ga4_format
        df = pd.DataFrame({
            "lead_id": ["L1"],
            "timestamp": ["2026-01-01"],
            "channel": ["meta"],
            "touchpoint_type": ["click"],
        })
        assert _is_ga4_format(df) is False

    def test_ga4_csv_conversion(self):
        from backend.data.loader import load_crm_touchpoints
        from io import BytesIO
        csv_data = (
            "user_pseudo_id,event_timestamp,event_name,source,medium,campaign,revenue\n"
            "u1,2026-01-15 10:00,page_view,google,cpc,brand,0\n"
            "u1,2026-01-16 11:00,purchase,google,cpc,brand,1500\n"
            "u2,2026-01-15 09:00,page_view,facebook,paid_social,retarget,0\n"
            "u2,2026-01-17 14:00,page_view,tiktok,cpc,video,0\n"
        )
        records, truncated = load_crm_touchpoints(BytesIO(csv_data.encode()))
        assert truncated is False
        assert len(records) == 4
        # Channel mapping applied
        channels = {r.channel for r in records}
        assert "google" in channels
        assert "meta" in channels
        assert "tiktok" in channels

    def test_ga4_conversion_detection(self):
        from backend.data.loader import load_crm_touchpoints
        from io import BytesIO
        csv_data = (
            "user_pseudo_id,event_timestamp,event_name,source,medium,campaign,revenue\n"
            "u1,2026-01-15 10:00,page_view,google,cpc,,0\n"
            "u1,2026-01-16 11:00,purchase,google,cpc,,1500\n"
        )
        records, _ = load_crm_touchpoints(BytesIO(csv_data.encode()))
        # u1 has a purchase → all u1 touchpoints should be converted=True
        assert all(r.converted for r in records)

    def test_ga4_custom_conversion_events(self):
        from backend.data.loader import load_crm_touchpoints
        from io import BytesIO
        csv_data = (
            "user_pseudo_id,event_timestamp,event_name,source,medium,campaign,revenue\n"
            "u1,2026-01-15 10:00,page_view,google,cpc,,0\n"
            "u1,2026-01-16 11:00,generate_lead,google,cpc,,0\n"
        )
        records, _ = load_crm_touchpoints(
            BytesIO(csv_data.encode()),
            conversion_events=["generate_lead"],
        )
        assert all(r.converted for r in records)

    def test_ga4_direct_channel_mapping(self):
        from backend.data.loader import load_crm_touchpoints
        from io import BytesIO
        csv_data = (
            "user_pseudo_id,event_timestamp,event_name,source,medium,campaign,revenue\n"
            "u1,2026-01-15 10:00,page_view,(direct),(none),,0\n"
        )
        records, _ = load_crm_touchpoints(BytesIO(csv_data.encode()))
        assert records[0].channel == "direct"

    def test_crm_format_still_works(self):
        from backend.data.loader import load_crm_touchpoints
        from io import BytesIO
        csv_data = (
            "lead_id,timestamp,channel,touchpoint_type,converted\n"
            "L1,2026-01-15,meta,click,1\n"
            "L1,2026-01-16,google,click,0\n"
        )
        records, _ = load_crm_touchpoints(BytesIO(csv_data.encode()))
        assert len(records) == 2
        assert records[0].channel == "meta"


# ── Config validation ──────────────────────────────────────────────


class TestConfigValidation:
    def test_config_validates_on_import(self):
        from backend.config import validate_config
        validate_config()

    def test_channels_set_consistency(self):
        from backend.config import (
            CHANNELS_SET, ADSTOCK_PARAMS, SATURATION_PARAMS,
            MAX_LIFT, DIGITAL_CHANNEL_METRICS, DIGITAL_PRESETS,
        )
        assert set(ADSTOCK_PARAMS) == CHANNELS_SET
        assert set(SATURATION_PARAMS) == CHANNELS_SET
        assert set(MAX_LIFT) == CHANNELS_SET
        assert set(DIGITAL_CHANNEL_METRICS) == CHANNELS_SET
        assert set(DIGITAL_PRESETS) == CHANNELS_SET

    def test_dda_blend_weights_sum_to_one(self):
        from backend.config import DDA_BLEND_WEIGHTS
        assert abs(sum(DDA_BLEND_WEIGHTS.values()) - 1.0) < 1e-6

    def test_unified_weights_sum_to_one(self):
        from backend.config import UNIFIED_WEIGHTS
        assert abs(sum(UNIFIED_WEIGHTS.values()) - 1.0) < 1e-6
