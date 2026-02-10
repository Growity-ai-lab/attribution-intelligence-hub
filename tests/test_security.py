"""Security tests for API endpoints."""

import io

import pytest
from fastapi.testclient import TestClient

from backend.config import (
    MAX_ARRAY_SIZE,
    MAX_UPLOAD_SIZE_BYTES,
    PRIOR_ALPHA_MAX,
    PRIOR_ALPHA_MIN,
)
from backend.main import app

client = TestClient(app)


class TestSecurityHeaders:
    def test_nosniff_header(self):
        r = client.get("/api/health")
        assert r.headers["X-Content-Type-Options"] == "nosniff"

    def test_frame_deny_header(self):
        r = client.get("/api/health")
        assert r.headers["X-Frame-Options"] == "DENY"

    def test_xss_protection_header(self):
        r = client.get("/api/health")
        assert r.headers["X-XSS-Protection"] == "1; mode=block"

    def test_referrer_policy_header(self):
        r = client.get("/api/health")
        assert r.headers["Referrer-Policy"] == "strict-origin-when-cross-origin"


class TestAuthSecurity:
    def test_protected_endpoint_rejects_no_token(self):
        r = client.post("/api/data/upload", files={"file": ("t.csv", io.BytesIO(b"x"), "text/csv")})
        assert r.status_code == 401

    def test_protected_endpoint_rejects_invalid_token(self):
        r = client.post(
            "/api/data/upload",
            files={"file": ("t.csv", io.BytesIO(b"x"), "text/csv")},
            headers={"Authorization": "Bearer invalid.token.here"},
        )
        assert r.status_code == 401

    def test_public_endpoints_no_auth_required(self):
        assert client.get("/api/health").status_code == 200
        assert client.get("/api/config/channels").status_code == 200
        assert client.get("/api/mmm/decomposition").status_code == 200


class TestFileUploadSecurity:
    def test_reject_unsupported_extension(self, auth_headers):
        file = io.BytesIO(b"test")
        r = client.post(
            "/api/data/upload",
            files={"file": ("test.exe", file, "application/octet-stream")},
            headers=auth_headers,
        )
        assert r.status_code == 400
        assert "Unsupported file type" in r.json()["detail"]

    def test_reject_no_filename(self, auth_headers):
        file = io.BytesIO(b"test")
        r = client.post(
            "/api/data/upload",
            files={"file": ("", file, "text/csv")},
            headers=auth_headers,
        )
        assert r.status_code in (400, 422)

    def test_reject_large_file(self, auth_headers):
        large_content = b"x" * (MAX_UPLOAD_SIZE_BYTES + 100)
        file = io.BytesIO(large_content)
        r = client.post(
            "/api/data/upload",
            files={"file": ("big.csv", file, "text/csv")},
            headers=auth_headers,
        )
        assert r.status_code == 413
        assert "too large" in r.json()["detail"].lower()

    def test_accept_csv_extension(self, auth_headers):
        csv_content = b"week,channel,spend,impressions,clicks,leads\n2026-W06,meta,100,200,30,5"
        file = io.BytesIO(csv_content)
        r = client.post(
            "/api/data/upload",
            files={"file": ("test.csv", file, "text/csv")},
            headers=auth_headers,
        )
        assert r.status_code == 200

    def test_accept_xlsx_extension(self, auth_headers):
        """XLSX extension is allowed (even if content fails parsing)."""
        file = io.BytesIO(b"not real xlsx")
        r = client.post(
            "/api/data/upload",
            files={"file": ("test.xlsx", file, "application/vnd.openxmlformats")},
            headers=auth_headers,
        )
        # 422 means it passed extension check but failed parsing
        assert r.status_code in (200, 422)


class TestArraySizeLimits:
    def test_adstock_too_many_values(self):
        big_spend = ",".join(["100.0"] * (MAX_ARRAY_SIZE + 1))
        r = client.get(f"/api/mmm/adstock/meta?spend={big_spend}")
        assert r.status_code == 400
        assert "Too many values" in r.json()["detail"]

    def test_saturation_too_many_values(self):
        big_vals = ",".join(["50.0"] * (MAX_ARRAY_SIZE + 1))
        r = client.get(f"/api/mmm/saturation/meta?values={big_vals}")
        assert r.status_code == 400
        assert "Too many values" in r.json()["detail"]

    def test_adstock_invalid_float(self):
        r = client.get("/api/mmm/adstock/meta?spend=abc,def")
        assert r.status_code == 400
        assert "must be comma-separated numbers" in r.json()["detail"]

    def test_saturation_invalid_float(self):
        r = client.get("/api/mmm/saturation/meta?values=not,numbers")
        assert r.status_code == 400
        assert "must be comma-separated numbers" in r.json()["detail"]


class TestChannelValidation:
    def test_unknown_channel_adstock(self):
        r = client.get("/api/mmm/adstock/fake_channel")
        assert r.status_code == 404
        assert "Unknown channel" in r.json()["detail"]

    def test_unknown_channel_saturation(self):
        r = client.get("/api/mmm/saturation/fake_channel")
        assert r.status_code == 404
        assert "Unknown channel" in r.json()["detail"]

    def test_unknown_channel_decomposition(self):
        r = client.get("/api/mmm/decomposition?spend=fake_channel:1000")
        assert r.status_code == 400
        assert "Unknown channel" in r.json()["detail"]

    def test_invalid_decomposition_spend_value(self):
        r = client.get("/api/mmm/decomposition?spend=meta:abc")
        assert r.status_code == 400
        assert "Invalid spend value" in r.json()["detail"]


class TestDDAValidation:
    def test_prior_alpha_too_low(self, auth_headers):
        r = client.post(
            "/api/dda/run",
            json={
                "journeys": [{"lead_id": "L1", "channels": ["meta"], "converted": True}],
                "prior_alpha": PRIOR_ALPHA_MIN - 0.001,
            },
            headers=auth_headers,
        )
        assert r.status_code == 400
        assert "prior_alpha" in r.json()["detail"]

    def test_prior_alpha_too_high(self, auth_headers):
        r = client.post(
            "/api/dda/run",
            json={
                "journeys": [{"lead_id": "L1", "channels": ["meta"], "converted": True}],
                "prior_alpha": PRIOR_ALPHA_MAX + 1.0,
            },
            headers=auth_headers,
        )
        assert r.status_code == 400
        assert "prior_alpha" in r.json()["detail"]

    def test_empty_journey_list(self, auth_headers):
        r = client.post(
            "/api/dda/run",
            json={"journeys": [], "prior_alpha": 0.5},
            headers=auth_headers,
        )
        assert r.status_code == 422

    def test_invalid_journey_format(self, auth_headers):
        r = client.post(
            "/api/dda/run",
            json={
                "journeys": [{"bad_key": "x"}],
                "prior_alpha": 0.5,
            },
            headers=auth_headers,
        )
        assert r.status_code == 422
        assert "Invalid journey" in r.json()["detail"]

    def test_journey_stats_invalid_format(self, auth_headers):
        r = client.post(
            "/api/dda/journey-stats",
            json=[{"bad_key": "x"}],
            headers=auth_headers,
        )
        assert r.status_code == 422


class TestCSVEndpointSecurity:
    def test_run_from_csv_rejects_bad_extension(self, auth_headers):
        file = io.BytesIO(b"data")
        r = client.post(
            "/api/dda/run-from-csv",
            files={"file": ("test.txt", file, "text/plain")},
            headers=auth_headers,
        )
        assert r.status_code == 400
        assert "Unsupported file type" in r.json()["detail"]

    def test_run_from_csv_rejects_large_file(self, auth_headers):
        large = b"x" * (MAX_UPLOAD_SIZE_BYTES + 100)
        r = client.post(
            "/api/dda/run-from-csv",
            files={"file": ("big.csv", io.BytesIO(large), "text/csv")},
            headers=auth_headers,
        )
        assert r.status_code == 413

    def test_run_from_csv_invalid_csv(self, auth_headers):
        file = io.BytesIO(b"not,valid,csv\n1,2,3")
        r = client.post(
            "/api/dda/run-from-csv",
            files={"file": ("test.csv", file, "text/csv")},
            headers=auth_headers,
        )
        # Should fail with missing columns
        assert r.status_code == 422


class TestSampleEndpoint:
    def test_sample_journeys_exists(self):
        r = client.get("/api/data/sample/journeys")
        # Either 200 (file exists) or 404 (file not found)
        assert r.status_code in (200, 404)
