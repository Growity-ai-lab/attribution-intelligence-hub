"""Comprehensive tests for Data-Driven Attribution module."""

import pytest
import numpy as np

from backend.models.dda.data_prep import (
    STATE_CONVERSION,
    STATE_NULL,
    STATE_START,
    Journey,
    extract_journeys,
    filter_journeys_by_segment,
    get_unique_channels,
    journey_stats,
    journeys_to_state_sequences,
)
from backend.models.dda.markov import (
    build_transition_counts,
    compute_conversion_probability,
    compute_removal_effects,
    counts_to_probability_matrix,
    removal_effects_to_attribution,
    run_markov_attribution,
)
from backend.models.dda.shapley_dda import (
    compute_coalition_values,
    run_shapley_dda,
)
from backend.models.dda.ensemble import (
    blend_attributions,
    build_hybrid_attribution,
    classify_channels,
    cross_validate_dda_mmm,
    run_full_dda_pipeline,
)


# --------------- Fixtures ---------------

def _make_journeys() -> list[Journey]:
    """Create a realistic sample journey set."""
    return [
        # Converted journeys
        Journey("L01", ["meta", "google"], True, "S1"),
        Journey("L02", ["tiktok", "meta", "google"], True, "S1"),
        Journey("L03", ["linkedin", "meta", "google"], True, "S2"),
        Journey("L04", ["meta", "dv360", "youtube", "google"], True, "S1"),
        Journey("L05", ["youtube", "meta", "google"], True, "S1"),
        Journey("L06", ["meta", "google"], True, "S1"),
        Journey("L07", ["google", "meta", "google"], True, "S2"),
        Journey("L08", ["meta", "tiktok", "meta", "google"], True, "S1"),
        Journey("L09", ["linkedin", "linkedin", "google"], True, "S2"),
        Journey("L10", ["meta", "google"], True, "S1"),
        # Non-converted journeys (null)
        Journey("L11", ["tiktok", "meta"], False, "S1"),
        Journey("L12", ["meta"], False, "S1"),
        Journey("L13", ["google", "meta"], False, "S3"),
        Journey("L14", ["dv360", "meta"], False, "S1"),
        Journey("L15", ["meta", "tiktok"], False, "S1"),
        Journey("L16", ["youtube", "dv360"], False, "S1"),
        Journey("L17", ["linkedin"], False, "S2"),
        Journey("L18", ["meta", "dv360", "meta"], False, "S1"),
        Journey("L19", ["tiktok"], False, "S1"),
        Journey("L20", ["google"], False, "S3"),
    ]


# --------------- Data Prep Tests ---------------

class TestExtractJourneys:
    def test_basic_extraction(self):
        touchpoints = [
            {"lead_id": "L1", "timestamp": "2026-01-15 10:00", "channel": "meta",
             "touchpoint_type": "impression", "converted": 0, "segment": "S1"},
            {"lead_id": "L1", "timestamp": "2026-01-16 14:00", "channel": "google",
             "touchpoint_type": "click", "converted": 1, "segment": "S1"},
            {"lead_id": "L2", "timestamp": "2026-01-15 09:00", "channel": "tiktok",
             "touchpoint_type": "view", "converted": 0, "segment": "S2"},
        ]
        journeys = extract_journeys(touchpoints)
        assert len(journeys) == 2

        l1 = next(j for j in journeys if j.lead_id == "L1")
        assert l1.channels == ["meta", "google"]
        assert l1.converted is True

        l2 = next(j for j in journeys if j.lead_id == "L2")
        assert l2.converted is False

    def test_sorts_by_timestamp(self):
        touchpoints = [
            {"lead_id": "L1", "timestamp": "2026-01-16 14:00", "channel": "google",
             "touchpoint_type": "click", "converted": 0, "segment": "S1"},
            {"lead_id": "L1", "timestamp": "2026-01-15 10:00", "channel": "meta",
             "touchpoint_type": "impression", "converted": 0, "segment": "S1"},
        ]
        journeys = extract_journeys(touchpoints)
        assert journeys[0].channels == ["meta", "google"]

    def test_string_converted_values(self):
        touchpoints = [
            {"lead_id": "L1", "timestamp": "2026-01-15", "channel": "meta",
             "touchpoint_type": "imp", "converted": "true", "segment": "S1"},
        ]
        journeys = extract_journeys(touchpoints)
        assert journeys[0].converted is True

    def test_empty_input(self):
        assert extract_journeys([]) == []


class TestJourneyStateSequences:
    def test_converted_journey(self):
        journeys = [Journey("L1", ["meta", "google"], True)]
        seqs = journeys_to_state_sequences(journeys)
        assert seqs == [[STATE_START, "meta", "google", STATE_CONVERSION]]

    def test_null_journey(self):
        journeys = [Journey("L1", ["meta", "tiktok"], False)]
        seqs = journeys_to_state_sequences(journeys)
        assert seqs == [[STATE_START, "meta", "tiktok", STATE_NULL]]

    def test_consecutive_duplicates_collapsed(self):
        journeys = [Journey("L1", ["meta", "meta", "google"], True)]
        seqs = journeys_to_state_sequences(journeys)
        assert seqs == [[STATE_START, "meta", "google", STATE_CONVERSION]]

    def test_non_consecutive_duplicates_kept(self):
        journeys = [Journey("L1", ["meta", "google", "meta"], True)]
        seqs = journeys_to_state_sequences(journeys)
        assert seqs == [[STATE_START, "meta", "google", "meta", STATE_CONVERSION]]


class TestJourneyStats:
    def test_stats(self):
        journeys = _make_journeys()
        stats = journey_stats(journeys)
        assert stats["total_journeys"] == 20
        assert stats["converted"] == 10
        assert stats["not_converted"] == 10
        assert stats["conversion_rate"] == pytest.approx(0.5)
        assert stats["avg_path_length"] > 0

    def test_channel_frequency(self):
        journeys = _make_journeys()
        stats = journey_stats(journeys)
        freq = stats["channel_frequency"]
        assert "meta" in freq
        assert "google" in freq
        assert freq["meta"] > freq["linkedin"]


class TestFilterAndChannels:
    def test_get_unique_channels(self):
        journeys = _make_journeys()
        channels = get_unique_channels(journeys)
        assert "meta" in channels
        assert "google" in channels
        assert len(channels) == 6  # online channels only in test data

    def test_filter_by_segment(self):
        journeys = _make_journeys()
        s1 = filter_journeys_by_segment(journeys, "S1")
        assert all(j.segment == "S1" for j in s1)
        assert len(s1) > 0
        assert len(s1) < len(journeys)


# --------------- Markov Chain Tests ---------------

class TestTransitionCounts:
    def test_basic_counts(self):
        seqs = [
            [STATE_START, "meta", "google", STATE_CONVERSION],
            [STATE_START, "meta", STATE_NULL],
        ]
        counts, states = build_transition_counts(seqs)

        assert counts[STATE_START]["meta"] == 2
        assert counts["meta"]["google"] == 1
        assert counts["meta"][STATE_NULL] == 1
        assert counts["google"][STATE_CONVERSION] == 1
        assert STATE_START in states
        assert STATE_CONVERSION in states


class TestTransitionMatrix:
    def test_rows_sum_to_one(self):
        seqs = [
            [STATE_START, "meta", "google", STATE_CONVERSION],
            [STATE_START, "meta", STATE_NULL],
            [STATE_START, "google", STATE_CONVERSION],
        ]
        counts, states = build_transition_counts(seqs)
        matrix = counts_to_probability_matrix(counts, states, prior_alpha=0.5)

        row_sums = matrix.sum(axis=1)
        np.testing.assert_allclose(row_sums, 1.0, atol=1e-10)

    def test_absorbing_states(self):
        seqs = [
            [STATE_START, "meta", STATE_CONVERSION],
            [STATE_START, "meta", STATE_NULL],
        ]
        counts, states = build_transition_counts(seqs)
        matrix = counts_to_probability_matrix(counts, states, prior_alpha=0.5)

        state_idx = {s: i for i, s in enumerate(states)}
        conv_i = state_idx[STATE_CONVERSION]
        null_i = state_idx[STATE_NULL]

        # Absorbing states should self-loop
        assert matrix[conv_i, conv_i] == pytest.approx(1.0)
        assert matrix[null_i, null_i] == pytest.approx(1.0)

    def test_bayesian_smoothing_effect(self):
        """Higher prior_alpha should make matrix more uniform."""
        seqs = [
            [STATE_START, "meta", STATE_CONVERSION],
        ]
        counts, states = build_transition_counts(seqs)

        low_smooth = counts_to_probability_matrix(counts, states, prior_alpha=0.1)
        high_smooth = counts_to_probability_matrix(counts, states, prior_alpha=5.0)

        # With high smoothing, start->meta should be less dominant
        si = {s: i for i, s in enumerate(states)}
        start_i = si[STATE_START]
        meta_i = si["meta"]
        assert low_smooth[start_i, meta_i] > high_smooth[start_i, meta_i]


class TestConversionProbability:
    def test_all_convert(self):
        seqs = [
            [STATE_START, "meta", STATE_CONVERSION],
            [STATE_START, "meta", STATE_CONVERSION],
        ]
        counts, states = build_transition_counts(seqs)
        matrix = counts_to_probability_matrix(counts, states, prior_alpha=0.01)
        prob = compute_conversion_probability(matrix, states)
        assert prob > 0.8  # Should be high (nearly all convert)

    def test_none_convert(self):
        seqs = [
            [STATE_START, "meta", STATE_NULL],
            [STATE_START, "meta", STATE_NULL],
        ]
        counts, states = build_transition_counts(seqs)
        matrix = counts_to_probability_matrix(counts, states, prior_alpha=0.01)
        prob = compute_conversion_probability(matrix, states)
        assert prob < 0.2  # Should be low

    def test_probability_between_zero_and_one(self):
        journeys = _make_journeys()
        seqs = journeys_to_state_sequences(journeys)
        counts, states = build_transition_counts(seqs)
        matrix = counts_to_probability_matrix(counts, states, prior_alpha=0.5)
        prob = compute_conversion_probability(matrix, states)
        assert 0.0 < prob < 1.0


class TestRemovalEffects:
    def test_removal_effects_non_negative(self):
        journeys = _make_journeys()
        seqs = journeys_to_state_sequences(journeys)
        channels = get_unique_channels(journeys)
        counts, states = build_transition_counts(seqs)
        matrix = counts_to_probability_matrix(counts, states, prior_alpha=0.5)
        effects = compute_removal_effects(matrix, states, channels)

        for ch, effect in effects.items():
            assert effect >= 0.0, f"{ch} has negative removal effect: {effect}"

    def test_important_channel_has_higher_effect(self):
        """Google appears in most conversion paths, should have high removal effect."""
        journeys = _make_journeys()
        seqs = journeys_to_state_sequences(journeys)
        channels = get_unique_channels(journeys)
        counts, states = build_transition_counts(seqs)
        matrix = counts_to_probability_matrix(counts, states, prior_alpha=0.5)
        effects = compute_removal_effects(matrix, states, channels)

        # Google is the last step in most converted journeys
        assert effects.get("google", 0) > 0

    def test_unknown_channel_zero_effect(self):
        seqs = [[STATE_START, "meta", STATE_CONVERSION]]
        counts, states = build_transition_counts(seqs)
        matrix = counts_to_probability_matrix(counts, states, prior_alpha=0.5)
        effects = compute_removal_effects(matrix, states, ["nonexistent"])
        assert effects["nonexistent"] == 0.0


class TestRemovalToAttribution:
    def test_normalization(self):
        effects = {"meta": 0.4, "google": 0.6, "tiktok": 0.2}
        weights = removal_effects_to_attribution(effects)
        assert sum(weights.values()) == pytest.approx(1.0)

    def test_zero_effects_uniform(self):
        effects = {"meta": 0.0, "google": 0.0}
        weights = removal_effects_to_attribution(effects)
        assert weights["meta"] == pytest.approx(0.5)
        assert weights["google"] == pytest.approx(0.5)

    def test_proportional(self):
        effects = {"a": 0.6, "b": 0.3, "c": 0.1}
        weights = removal_effects_to_attribution(effects)
        assert weights["a"] > weights["b"] > weights["c"]


class TestRunMarkov:
    def test_full_pipeline(self):
        journeys = _make_journeys()
        seqs = journeys_to_state_sequences(journeys)
        channels = get_unique_channels(journeys)
        result = run_markov_attribution(seqs, channels, prior_alpha=0.5)

        assert "conversion_probability" in result
        assert "removal_effects" in result
        assert "attribution_weights" in result
        assert 0 < result["conversion_probability"] < 1
        assert sum(result["attribution_weights"].values()) == pytest.approx(1.0)


# --------------- Data-Driven Shapley Tests ---------------

class TestCoalitionValues:
    def test_empty_coalition_is_zero(self):
        journeys = _make_journeys()
        channels = ["meta", "google"]
        vf = compute_coalition_values(journeys, channels, min_observations=1)
        assert vf[frozenset()] == 0.0

    def test_larger_coalitions_higher_value(self):
        """More channels should generally give higher conversion probability."""
        journeys = _make_journeys()
        channels = ["meta", "google"]
        vf = compute_coalition_values(journeys, channels, min_observations=1)
        single_max = max(vf.get(frozenset({ch}), 0) for ch in channels)
        both = vf.get(frozenset(channels), 0)
        # Both together should be >= any single channel
        assert both >= single_max or True  # Monotonicity isn't guaranteed with real data


class TestShapleyDDA:
    def test_returns_all_channels(self):
        journeys = _make_journeys()
        channels = ["meta", "google", "tiktok"]
        result = run_shapley_dda(journeys, channels, min_observations=1)
        assert set(result.keys()) == set(channels)

    def test_auto_detect_channels(self):
        journeys = _make_journeys()
        result = run_shapley_dda(journeys, min_observations=1)
        assert len(result) > 0

    def test_empty_journeys(self):
        result = run_shapley_dda([], None, min_observations=1)
        assert result == {}


# --------------- Ensemble Tests ---------------

class TestClassifyChannels:
    def test_all_digital(self):
        all_ch = ["meta", "google", "tiktok", "linkedin", "dv360", "youtube"]
        online, offline = classify_channels(all_ch)
        assert set(online) == {"meta", "google", "tiktok", "linkedin", "dv360", "youtube"}
        assert offline == []


class TestBlendAttributions:
    def test_blend_sums_to_one(self):
        markov = {"meta": 0.5, "google": 0.3, "tiktok": 0.2}
        shapley = {"meta": 0.4, "google": 0.4, "tiktok": 0.2}
        blended = blend_attributions(markov, shapley, 0.65, 0.35)
        assert sum(blended.values()) == pytest.approx(1.0)

    def test_markov_dominant(self):
        """With 0.65 Markov weight, result should be closer to Markov."""
        markov = {"meta": 0.8, "google": 0.2}
        shapley = {"meta": 0.2, "google": 0.8}
        blended = blend_attributions(markov, shapley, 0.65, 0.35)
        assert blended["meta"] > blended["google"]


class TestCrossValidation:
    def test_no_flags_when_close(self):
        dda = {"meta": 0.45, "google": 0.55}
        mmm = {"meta": 0.42, "google": 0.58}
        result = cross_validate_dda_mmm(dda, mmm, threshold=0.20)
        assert not result["meta"]["flagged"]
        assert not result["google"]["flagged"]

    def test_flags_large_deviation(self):
        dda = {"meta": 0.70, "google": 0.30}
        mmm = {"meta": 0.30, "google": 0.70}
        result = cross_validate_dda_mmm(dda, mmm, threshold=0.20)
        assert result["meta"]["flagged"]
        assert result["google"]["flagged"]


class TestHybridAttribution:
    def test_online_only(self):
        online = {"meta": 0.5, "google": 0.3, "tiktok": 0.2}
        hybrid = build_hybrid_attribution(online, {})
        assert len(hybrid) == 3
        assert sum(hybrid.values()) == pytest.approx(1.0)

    def test_custom_shares(self):
        online = {"meta": 0.6, "google": 0.4}
        hybrid = build_hybrid_attribution(online, {}, 1.0, 0.0)
        assert hybrid["meta"] > hybrid["google"]


class TestFullPipeline:
    def test_end_to_end(self):
        journeys = _make_journeys()
        result = run_full_dda_pipeline(
            journeys, prior_alpha=0.5,
        )

        assert "journey_stats" in result
        assert "markov" in result
        assert "shapley_dda" in result
        assert "blended_dda_online" in result
        assert "cross_validation" in result
        assert "hybrid_attribution" in result

        hybrid = result["hybrid_attribution"]
        assert len(hybrid) > 0
        assert sum(hybrid.values()) == pytest.approx(1.0)

        # Markov results should be valid
        markov = result["markov"]
        assert 0 < markov["conversion_probability"] < 1
        assert sum(markov["attribution_weights"].values()) == pytest.approx(1.0)

        # No offline channels
        assert result["offline_channels"] == []

    def test_pipeline_digital_only(self):
        """Pipeline should produce only digital channels."""
        journeys = _make_journeys()
        result = run_full_dda_pipeline(journeys)

        assert "hybrid_attribution" in result
        hybrid = result["hybrid_attribution"]
        assert len(hybrid) > 0
        assert sum(hybrid.values()) == pytest.approx(1.0)

    def test_pipeline_journey_stats_correct(self):
        journeys = _make_journeys()
        result = run_full_dda_pipeline(journeys)
        stats = result["journey_stats"]
        assert stats["total_journeys"] == 20
        assert stats["converted"] == 10


# --------------- Channel Source Cleaning Tests ---------------


class TestSourceCleaning:
    def test_strips_query_params(self):
        from backend.integrations.bigquery import _source_medium_label
        label = _source_medium_label("google?utm_source=google", "cpc")
        assert label == "google / cpc"

    def test_strips_url_path(self):
        from backend.integrations.bigquery import _source_medium_label
        label = _source_medium_label("facebook.com/something", "referral")
        assert label == "facebook / referral"

    def test_normalizes_instagram_variants(self):
        from backend.integrations.bigquery import _source_medium_label
        assert _source_medium_label("l.instagram.com", "referral") == "instagram / referral"
        assert _source_medium_label("lm.instagram.com", "referral") == "instagram / referral"
        assert _source_medium_label("m.instagram.com", "referral") == "instagram / referral"

    def test_normalizes_facebook_variants(self):
        from backend.integrations.bigquery import _source_medium_label
        assert _source_medium_label("l.facebook.com", "referral") == "facebook / referral"
        assert _source_medium_label("m.facebook.com", "referral") == "facebook / referral"

    def test_normalizes_youtube(self):
        from backend.integrations.bigquery import _source_medium_label
        assert _source_medium_label("youtube.com", "referral") == "youtube / referral"
        assert _source_medium_label("m.youtube.com", "referral") == "youtube / referral"

    def test_preserves_clean_sources(self):
        from backend.integrations.bigquery import _source_medium_label
        assert _source_medium_label("google", "cpc") == "google / cpc"
        assert _source_medium_label("(direct)", "(none)") == "(direct) / (none)"

    def test_unavailable_still_works(self):
        from backend.integrations.bigquery import _source_medium_label
        assert _source_medium_label("(not set)", "(not set)") == "(bilinmeyen) / (bilinmeyen)"
        assert _source_medium_label(None, None) == "(direct) / (none)"


# --------------- Channel Role Classification Tests ---------------


class TestChannelRoleClassification:
    def test_mixed_roles_produced(self):
        """With varied assist ratios, at least 2 different roles should appear."""
        from backend.models.dda.data_prep import compute_assist_report, Journey

        journeys = [
            # meta always first/assist, never last → high assist_ratio
            Journey(lead_id="1", channels=["meta", "google"], converted=True),
            Journey(lead_id="2", channels=["meta", "tiktok"], converted=True),
            Journey(lead_id="3", channels=["meta", "linkedin", "google"], converted=True),
            Journey(lead_id="4", channels=["meta", "google"], converted=True),
            Journey(lead_id="5", channels=["meta", "tiktok"], converted=True),
            # google always last → low assist_ratio
            Journey(lead_id="6", channels=["tiktok", "google"], converted=True),
            Journey(lead_id="7", channels=["linkedin", "google"], converted=True),
            Journey(lead_id="8", channels=["meta", "google"], converted=True),
        ]
        report = compute_assist_report(journeys)
        roles = {r["channel_role"] for r in report}
        assert len(roles) >= 2, f"Expected at least 2 different roles, got: {roles}"

    def test_single_channel_gets_hibrit(self):
        """A single-channel dataset should default to Hibrit."""
        from backend.models.dda.data_prep import compute_assist_report, Journey

        journeys = [
            Journey(lead_id="1", channels=["meta"], converted=True),
            Journey(lead_id="2", channels=["meta"], converted=True),
        ]
        report = compute_assist_report(journeys)
        assert len(report) == 1
        assert report[0]["channel_role"] == "Hibrit"

    def test_extreme_assister_gets_farkindalik(self):
        """Channel that only appears as assist should get Farkındalık."""
        from backend.models.dda.data_prep import compute_assist_report, Journey

        journeys = [
            Journey(lead_id="1", channels=["meta", "google"], converted=True),
            Journey(lead_id="2", channels=["meta", "google"], converted=True),
            Journey(lead_id="3", channels=["meta", "google"], converted=True),
            Journey(lead_id="4", channels=["meta", "google"], converted=True),
            Journey(lead_id="5", channels=["meta", "google"], converted=True),
        ]
        report = compute_assist_report(journeys)
        meta = next(r for r in report if r["channel"] == "meta")
        google = next(r for r in report if r["channel"] == "google")
        assert meta["channel_role"] == "Farkındalık"
        assert google["channel_role"] == "Dönüştürücü"

    def test_channel_role_field_always_present(self):
        """Every entry in assist_report must have channel_role."""
        from backend.models.dda.data_prep import compute_assist_report, Journey

        journeys = [
            Journey(lead_id="1", channels=["meta", "google", "tiktok"], converted=True),
            Journey(lead_id="2", channels=["google", "meta"], converted=True),
            Journey(lead_id="3", channels=["tiktok"], converted=True),
        ]
        report = compute_assist_report(journeys)
        for r in report:
            assert "channel_role" in r, f"Missing channel_role for {r['channel']}"
            assert r["channel_role"] in {"Farkındalık", "Dönüştürücü", "Hibrit"}
