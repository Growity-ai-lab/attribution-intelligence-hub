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
