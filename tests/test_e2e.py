"""End-to-end integration tests for Time's Hub | Attribution Intelligence.

These tests exercise the full API pipeline from HTTP request through to
model computation and response serialization.
"""

import io
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from backend.main import app

client = TestClient(app)

SAMPLE_CSV_PATH = Path(__file__).resolve().parent.parent / "data" / "sample" / "journeys_sample.csv"


# --------------- Auth Endpoints ---------------


class TestAuthEndpoints:
    def test_login_success(self):
        r = client.post(
            "/api/auth/login",
            data={"username": "admin", "password": "attribution2026"},
        )
        assert r.status_code == 200
        data = r.json()
        assert "access_token" in data
        assert data["token_type"] == "bearer"

    def test_login_wrong_password(self):
        r = client.post(
            "/api/auth/login",
            data={"username": "admin", "password": "wrong"},
        )
        assert r.status_code == 401

    def test_login_wrong_username(self):
        r = client.post(
            "/api/auth/login",
            data={"username": "nobody", "password": "attribution2026"},
        )
        assert r.status_code == 401

    def test_me_with_valid_token(self, auth_headers):
        r = client.get("/api/auth/me", headers=auth_headers)
        assert r.status_code == 200
        data = r.json()
        assert data["username"] == "admin"
        assert data["role"] == "admin"

    def test_me_without_token(self):
        r = client.get("/api/auth/me")
        assert r.status_code == 401

    def test_protected_endpoint_without_token(self):
        r = client.post("/api/dda/run", json={"journeys": [], "prior_alpha": 0.5})
        assert r.status_code == 401


# --------------- Config Endpoint ---------------


class TestConfigEndpoint:
    def test_channels_list(self):
        r = client.get("/api/config/channels")
        assert r.status_code == 200
        data = r.json()
        assert "channels" in data
        assert "meta" in data["channels"]
        assert len(data["channels"]) == 10

    def test_config_contains_model_params(self):
        r = client.get("/api/config/channels")
        data = r.json()
        assert "adstock_params" in data
        assert "saturation_params" in data
        assert "unified_weights" in data
        assert "dda_blend_weights" in data
        assert data["unified_weights"]["dda"] == 0.50


# --------------- Weekly Upload Flow ---------------


class TestWeeklyUploadFlow:
    def test_upload_valid_csv(self, sample_weekly_csv, auth_headers):
        r = client.post(
            "/api/data/upload",
            files={"file": ("weekly.csv", io.BytesIO(sample_weekly_csv), "text/csv")},
            headers=auth_headers,
        )
        assert r.status_code == 200
        data = r.json()
        assert data["rows"] == 2
        assert "meta" in data["channels"]
        assert "google" in data["channels"]

    def test_upload_returns_weeks(self, sample_weekly_csv, auth_headers):
        r = client.post(
            "/api/data/upload",
            files={"file": ("weekly.csv", io.BytesIO(sample_weekly_csv), "text/csv")},
            headers=auth_headers,
        )
        data = r.json()
        assert "2026-W06" in data["weeks"]


# --------------- MMM Endpoints ---------------


class TestMMMEndpoints:
    def test_adstock_computation(self):
        r = client.get("/api/mmm/adstock/meta?spend=1000000,500000,250000")
        assert r.status_code == 200
        data = r.json()
        assert data["channel"] == "meta"
        assert len(data["adstocked"]) == 3
        # Adstock carry-over means second value > raw spend
        assert data["adstocked"][1] > 500000

    def test_saturation_computation(self):
        r = client.get("/api/mmm/saturation/google?values=0,500000,1000000")
        assert r.status_code == 200
        data = r.json()
        assert data["channel"] == "google"
        assert len(data["saturated_values"]) == 3
        assert data["saturated_values"][0] == 0.0  # saturation(0) = 0

    def test_decomposition_returns_all_channels(self):
        r = client.get("/api/mmm/decomposition")
        assert r.status_code == 200
        data = r.json()
        assert len(data) == 10
        channels = {d["channel"] for d in data}
        assert "meta" in channels
        assert "tv_match" in channels


# --------------- DDA from CSV Flow ---------------


class TestDDAFromCSVFlow:
    def test_run_from_csv_with_fixture(self, sample_journeys_csv, auth_headers):
        r = client.post(
            "/api/dda/run-from-csv",
            files={"file": ("journeys.csv", io.BytesIO(sample_journeys_csv), "text/csv")},
            headers=auth_headers,
        )
        assert r.status_code == 200
        data = r.json()
        assert "journey_stats" in data
        assert "markov" in data
        assert "hybrid_attribution" in data
        assert "unified_report" in data

    def test_conversion_count_correct(self, sample_journeys_csv, auth_headers):
        """Verify the conversion bug fix — form channel filtering must not lose conversions."""
        r = client.post(
            "/api/dda/run-from-csv",
            files={"file": ("journeys.csv", io.BytesIO(sample_journeys_csv), "text/csv")},
            headers=auth_headers,
        )
        data = r.json()
        stats = data["journey_stats"]
        # L1 and L2 convert, L3 and L4 do not
        assert stats["converted"] == 2
        assert stats["not_converted"] == 2
        assert stats["total_journeys"] == 4

    def test_cross_validation_is_list(self, sample_journeys_csv, auth_headers):
        """Verify cross_validation serialization fix — must be a list of dicts."""
        r = client.post(
            "/api/dda/run-from-csv",
            files={"file": ("journeys.csv", io.BytesIO(sample_journeys_csv), "text/csv")},
            headers=auth_headers,
        )
        data = r.json()
        cv = data["cross_validation"]
        assert isinstance(cv, list)
        if cv:
            assert "channel" in cv[0]
            assert "flagged" in cv[0]

    def test_markov_conversion_probability_positive(self, sample_journeys_csv, auth_headers):
        r = client.post(
            "/api/dda/run-from-csv",
            files={"file": ("journeys.csv", io.BytesIO(sample_journeys_csv), "text/csv")},
            headers=auth_headers,
        )
        data = r.json()
        assert data["markov"]["conversion_probability"] > 0

    def test_unified_report_has_scores(self, sample_journeys_csv, auth_headers):
        r = client.post(
            "/api/dda/run-from-csv",
            files={"file": ("journeys.csv", io.BytesIO(sample_journeys_csv), "text/csv")},
            headers=auth_headers,
        )
        data = r.json()
        report = data["unified_report"]
        assert len(report) > 0
        # DDA-only attribution: unified_score == dda_score, no MMM/incrementality
        for ch_scores in report.values():
            assert "unified_score" in ch_scores
            assert "dda_score" in ch_scores
            assert ch_scores["unified_score"] == ch_scores["dda_score"]


# --------------- DDA from JSON ---------------


class TestDDAFromJSON:
    def test_basic_run(self, minimal_journeys, auth_headers):
        r = client.post(
            "/api/dda/run",
            json={"journeys": minimal_journeys, "prior_alpha": 0.5},
            headers=auth_headers,
        )
        assert r.status_code == 200
        data = r.json()
        assert "markov" in data
        assert "shapley_dda" in data
        assert "hybrid_attribution" in data

    def test_attribution_sums_to_one(self, minimal_journeys, auth_headers):
        r = client.post(
            "/api/dda/run",
            json={"journeys": minimal_journeys, "prior_alpha": 0.5},
            headers=auth_headers,
        )
        data = r.json()
        hybrid = data["hybrid_attribution"]
        assert sum(hybrid.values()) == pytest.approx(1.0, abs=0.01)


# --------------- Journey Stats ---------------


class TestJourneyStats:
    def test_journey_stats_endpoint(self, minimal_journeys, auth_headers):
        r = client.post("/api/dda/journey-stats", json=minimal_journeys, headers=auth_headers)
        assert r.status_code == 200
        data = r.json()
        assert data["total_journeys"] == 5
        assert data["converted"] == 3
        assert data["not_converted"] == 2
        assert 0 < data["conversion_rate"] < 1


# --------------- Reallocation Flow ---------------


class TestReallocationFlow:
    def test_dda_to_reallocation_e2e(self, sample_journeys_csv, auth_headers):
        """Full flow: CSV → DDA → unified_report → reallocation."""
        # Step 1: Run DDA
        r1 = client.post(
            "/api/dda/run-from-csv",
            files={"file": ("journeys.csv", io.BytesIO(sample_journeys_csv), "text/csv")},
            headers=auth_headers,
        )
        assert r1.status_code == 200
        unified_report = r1.json()["unified_report"]

        # Step 2: Run reallocation
        current_budgets = {ch: 100_000 for ch in unified_report}
        r2 = client.post(
            "/api/unified/reallocation",
            json={"unified_report": unified_report, "current_budgets": current_budgets},
            headers=auth_headers,
        )
        assert r2.status_code == 200
        data = r2.json()
        total_suggested = sum(s["suggested"] for s in data["suggestions"].values())
        assert total_suggested == pytest.approx(data["total_budget"])

    def test_reallocation_higher_score_gets_more(self, sample_journeys_csv, auth_headers):
        """Channel with higher unified_score should get more budget."""
        r1 = client.post(
            "/api/dda/run-from-csv",
            files={"file": ("journeys.csv", io.BytesIO(sample_journeys_csv), "text/csv")},
            headers=auth_headers,
        )
        unified_report = r1.json()["unified_report"]

        current_budgets = {ch: 100_000 for ch in unified_report}
        r2 = client.post(
            "/api/unified/reallocation",
            json={"unified_report": unified_report, "current_budgets": current_budgets},
            headers=auth_headers,
        )
        suggestions = r2.json()["suggestions"]

        # Find highest and lowest unified_score channels
        scores = {ch: unified_report[ch]["unified_score"] for ch in unified_report}
        top_ch = max(scores, key=scores.get)
        bottom_ch = min(scores, key=scores.get)

        if scores[top_ch] != scores[bottom_ch]:
            assert suggestions[top_ch]["suggested"] > suggestions[bottom_ch]["suggested"]


# --------------- Channel Benchmarks (Media-Planning Validation) ---------------


class TestChannelBenchmarks:
    def _make_campaign(self, auth_headers):
        """Create a client + campaign, return campaign_id."""
        rc = client.post(
            "/api/clients",
            json={"name": "Benchmark Test Co", "year": 2026},
            headers=auth_headers,
        )
        assert rc.status_code == 200
        client_id = rc.json()["id"]
        rcamp = client.post(
            f"/api/clients/{client_id}/campaigns",
            json={"name": "Benchmark Campaign"},
            headers=auth_headers,
        )
        assert rcamp.status_code == 200
        return rcamp.json()["id"]

    def test_no_dda_run_returns_unavailable(self, auth_headers):
        """Benchmark endpoint returns available=False when no DDA run is stored."""
        campaign_id = self._make_campaign(auth_headers)
        r = client.get(
            f"/api/benchmarks/channel-metrics?campaign_id={campaign_id}",
            headers=auth_headers,
        )
        assert r.status_code == 200
        data = r.json()
        assert data["available"] is False

    def test_dda_run_populates_benchmarks(self, sample_journeys_csv, auth_headers):
        """After a DDA run with campaign_id, benchmarks become available."""
        campaign_id = self._make_campaign(auth_headers)

        # Run DDA bound to the campaign — should persist a DDAResult
        r1 = client.post(
            f"/api/dda/run-from-csv?campaign_id={campaign_id}",
            files={"file": ("journeys.csv", io.BytesIO(sample_journeys_csv), "text/csv")},
            headers=auth_headers,
        )
        assert r1.status_code == 200
        assert r1.json()["persisted"] is True

        # Benchmarks should now be available with per-channel metrics
        r2 = client.get(
            f"/api/benchmarks/channel-metrics?campaign_id={campaign_id}",
            headers=auth_headers,
        )
        assert r2.status_code == 200
        data = r2.json()
        assert data["available"] is True
        assert data["data_source"] == "csv"
        assert "channels" in data and len(data["channels"]) > 0
        # Every channel carries the benchmark signal fields
        for metrics in data["channels"].values():
            assert "dda_weight" in metrics
            assert "assist_ratio" in metrics
            assert "touchpoints" in metrics
        assert 0 <= data["overall_conversion_rate"] <= 1

    def test_benchmark_requires_auth(self):
        r = client.get("/api/benchmarks/channel-metrics?campaign_id=1")
        assert r.status_code == 401

    def test_plan_reconciliation(self, sample_journeys_csv, auth_headers):
        """A saved plan reconciled against a stored DDA run returns deviations."""
        campaign_id = self._make_campaign(auth_headers)

        # Stored DDA run for the campaign
        r1 = client.post(
            f"/api/dda/run-from-csv?campaign_id={campaign_id}",
            files={"file": ("journeys.csv", io.BytesIO(sample_journeys_csv), "text/csv")},
            headers=auth_headers,
        )
        assert r1.status_code == 200

        # Save a digital media plan for the 'meta' channel
        rsave = client.post(
            "/api/media-planning/save",
            json={
                "name": "Meta Plan",
                "channel": "meta",
                "weekly_grps": [1_000_000, 1_000_000],
                "response_snapshot": {
                    "summary": {
                        "total_spend": 2_000_000,
                        "total_leads": 500,
                        "total_funnel_leads": 540,
                        "avg_cpl": 4000,
                    }
                },
                "campaign_id": campaign_id,
                "mode": "digital",
            },
            headers=auth_headers,
        )
        assert rsave.status_code == 200
        plan_id = rsave.json()["id"]

        # Reconcile
        r2 = client.post(
            "/api/benchmarks/plan-reconciliation",
            json={"plan_id": plan_id},
            headers=auth_headers,
        )
        assert r2.status_code == 200
        data = r2.json()
        assert data["available"] is True
        assert data["channel"] == "meta"
        assert "planned" in data and "actual" in data and "deviations" in data
        assert data["planned"]["total_spend"] == 2_000_000
        assert "verdict" in data["deviations"]

    def test_reconciliation_unavailable_without_dda(self, auth_headers):
        """Reconciliation returns available=False when no DDA run is stored."""
        campaign_id = self._make_campaign(auth_headers)
        rsave = client.post(
            "/api/media-planning/save",
            json={
                "name": "Orphan Plan",
                "channel": "google",
                "weekly_grps": [500_000],
                "response_snapshot": {"summary": {"total_spend": 500_000, "total_leads": 100}},
                "campaign_id": campaign_id,
                "mode": "digital",
            },
            headers=auth_headers,
        )
        plan_id = rsave.json()["id"]
        r = client.post(
            "/api/benchmarks/plan-reconciliation",
            json={"plan_id": plan_id},
            headers=auth_headers,
        )
        assert r.status_code == 200
        assert r.json()["available"] is False


# --------------- Sample Data Flow ---------------


class TestSampleDataFlow:
    @pytest.mark.skipif(not SAMPLE_CSV_PATH.exists(), reason="Sample CSV not found")
    def test_sample_csv_download(self):
        r = client.get("/api/data/sample/journeys")
        assert r.status_code == 200
        assert len(r.content) > 0
        # Should be valid CSV with header
        text = r.content.decode()
        assert "lead_id" in text
        assert "channel" in text

    @pytest.mark.skipif(not SAMPLE_CSV_PATH.exists(), reason="Sample CSV not found")
    def test_full_sample_pipeline(self, auth_headers):
        """Download sample → run DDA → verify 13 conversions + unified report."""
        # Fetch sample CSV
        r1 = client.get("/api/data/sample/journeys")
        assert r1.status_code == 200
        csv_bytes = r1.content

        # Run DDA from that CSV
        r2 = client.post(
            "/api/dda/run-from-csv",
            files={"file": ("journeys_sample.csv", io.BytesIO(csv_bytes), "text/csv")},
            headers=auth_headers,
        )
        assert r2.status_code == 200
        data = r2.json()

        # Verify conversion count (13/20 in sample data)
        assert data["journey_stats"]["total_journeys"] == 20
        assert data["journey_stats"]["converted"] == 13

        # Verify Markov conversion probability is meaningful
        assert data["markov"]["conversion_probability"] > 0.3

        # Verify unified report
        assert "unified_report" in data
        report = data["unified_report"]
        assert len(report) >= 6  # At least online + offline channels

        # Verify cross_validation is a list
        assert isinstance(data["cross_validation"], list)

        # Verify hybrid attribution sums to ~1
        hybrid = data["hybrid_attribution"]
        assert sum(hybrid.values()) == pytest.approx(1.0, abs=0.01)
