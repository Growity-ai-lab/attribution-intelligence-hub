"""Media-planning-only channels (X, Maçkolik, news-site mastheads, TV Ekstra)."""

import pytest

from backend import config

EXTRA = ["x", "mackolik", "news", "tvekstra"]
SPENDS = [300_000, 250_000, 200_000, 150_000]


def test_planning_channels_do_not_leak_into_attribution_channels():
    # Attribution, MMM endpoints and the core baseline split use these; they must stay the six.
    assert set(config.CHANNELS) == set(config.CHANNELS_SET) == {
        "meta", "google", "tiktok", "linkedin", "dv360", "youtube"}
    assert set(EXTRA) <= config.PLANNING_CHANNELS_SET
    assert not set(EXTRA) & set(config.CHANNELS)


@pytest.mark.parametrize("channel", EXTRA)
def test_extra_channel_simulates_with_placeholder_flag(client, auth_headers, channel):
    res = client.post("/api/media-planning/simulate", json={"channel": channel, "weekly_spends": SPENDS},
                      headers=auth_headers)
    assert res.status_code == 200, res.text
    data = res.json()
    assert data["assumed_metrics"] is True
    assert data["summary"]["total_impressions"] > 0


def test_agency_cpm_clears_placeholder_flag_and_drives_impressions(client, auth_headers):
    res = client.post("/api/media-planning/simulate", json={
        "channel": "news", "weekly_spends": SPENDS, "cpm_override": 25,
    }, headers=auth_headers).json()
    assert res["assumed_metrics"] is False
    assert res["summary"]["total_impressions"] == pytest.approx(sum(SPENDS) / 25 * 1000, rel=1e-3)


def test_core_channel_is_never_flagged(client, auth_headers):
    res = client.post("/api/media-planning/simulate", json={"channel": "meta", "weekly_spends": SPENDS},
                      headers=auth_headers).json()
    assert res["assumed_metrics"] is False


def test_extra_channel_presets_have_no_spend_curve(client, auth_headers):
    data = client.get("/api/media-planning/presets/mackolik", headers=auth_headers).json()
    assert data["preset_spends"] == [] and data["assumed_metrics"] is True
    assert data["metrics"]["cpm"] > 0


def test_extra_channel_plan_can_be_saved(client, auth_headers):
    sim = client.post("/api/media-planning/simulate", json={"channel": "x", "weekly_spends": SPENDS},
                      headers=auth_headers).json()
    res = client.post("/api/media-planning/save", json={
        "name": "X plan", "channel": "x", "weekly_spends": SPENDS, "response_snapshot": sim,
    }, headers=auth_headers)
    assert res.status_code == 200, res.text


def test_unknown_channel_still_rejected(client, auth_headers):
    res = client.post("/api/media-planning/simulate", json={"channel": "myspace", "weekly_spends": SPENDS},
                      headers=auth_headers)
    assert res.status_code == 400
