"""Optimal / saturation-threshold spends on the media-planning response curve."""

from backend.api.routes_media import _find_optimal_spend, _generate_recommendation

SPENDS = [800_000, 700_000, 600_000, 500_000]


def test_threshold_not_found_within_scan_is_flagged():
    # YouTube (alpha 600K, gamma 1.4): marginal return is still ~16% of the first step at 4×alpha.
    opt, thr, found = _find_optimal_spend(600_000, 1.4, 1.0)
    assert found is False
    assert thr == 2_400_000  # scan limit, not a real saturation point
    assert 1_300_000 < opt < 1_400_000


def test_threshold_found_for_concave_curve():
    opt, thr, found = _find_optimal_spend(300_000, 1.0, 1.0)
    assert found is True
    assert opt < thr < 1_200_000


def test_recommendation_never_claims_saturation_past_scan_limit():
    text = _generate_recommendation("youtube", 3_000_000, 1_344_000, 2_400_000, threshold_found=False)
    assert "aşmıştır" not in text and "2.4M TL" in text


def test_simulate_exposes_threshold_flag(client, auth_headers):
    res = client.post("/api/media-planning/simulate", json={"channel": "youtube", "weekly_spends": SPENDS},
                      headers=auth_headers)
    assert res.status_code == 200, res.text
    optimal = res.json()["optimal"]
    assert optimal["saturation_threshold_found"] is False
    assert optimal["saturation_threshold_spend"] == 2_400_000


def test_planned_clicks_drive_ctr(client, auth_headers):
    res = client.post("/api/media-planning/simulate", json={
        "channel": "google", "weekly_spends": [100_000, 100_000], "planned_clicks": 40_000,
    }, headers=auth_headers).json()
    assert res["summary"]["total_clicks"] == 40_000
    assert res["digital_metrics"]["ctr"] == 40_000 / (200_000 / 60 * 1000)  # default Google CPM 60
    assert res["default_metrics"]["cpm"] == 60


def test_reach_only_line_plan_has_no_clicks(client, auth_headers):
    res = client.post("/api/media-planning/simulate", json={
        "channel": "meta", "weekly_spends": [100_000], "planned_clicks": 0, "traffic_impressions": 0,
    }, headers=auth_headers).json()
    assert res["summary"]["total_clicks"] == 0
    assert res["summary"]["total_impressions"] > 0


def test_traffic_impressions_click_at_channel_ctr(client, auth_headers):
    res = client.post("/api/media-planning/simulate", json={
        "channel": "meta", "weekly_spends": [160_000], "planned_clicks": 1_000, "traffic_impressions": 500_000,
    }, headers=auth_headers).json()
    # 1,000 bought clicks + 500K traffic impressions × Meta's default 1.8% CTR
    assert res["summary"]["total_clicks"] == 1_000 + 9_000


def test_negative_planned_clicks_rejected(client, auth_headers):
    res = client.post("/api/media-planning/simulate", json={
        "channel": "meta", "weekly_spends": [100_000], "planned_clicks": -5,
    }, headers=auth_headers)
    assert res.status_code == 422
