"""Tests for the candidate admission rules.

Network-free and payload-free. Every fixture below is a case the probe of
2026-08-10 actually returned, written down as literal numbers: a dam's storage
figures do not change every morning, so these do not go red on a data refresh.
The reservoir figures they are compared against are observed maxima recorded on
that date, and are used only as fixtures, never read from `reservoirs.json`.

What this guards is a failure with no symptom. A wrong dam attached to a
reservoir does not raise an error and does not empty the map. It publishes a
percentage that is simply not true. Willow Creek is the case in point, and it
has a test of its own below.

Run with `pytest tests/` or directly with `python tests/test_admission.py`.
"""

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from admission import (  # noqa: E402
    NAMED_RADIUS_KM, NEAR_RADIUS_KM, SURCHARGE_ALLOWANCE, Decision, admit,
    admit_all, capacity_of, could_hold, discrepancies, distance_km, find_dam,
    holds_more_than_the_dam, largest_published_pool,
    normalize_name,
)


def dam(name, lon, lat, normal=None, maximum=None, headline=None, nid_id=None):
    return {"name": name, "lon": lon, "lat": lat, "normal_storage_af": normal,
            "max_storage_af": maximum, "nid_storage_af": headline, "nid_id": nid_id}


# The two Willow Creek dams. The near one is the reservoir the gauge measures.
# The far one shares the name and holds nearly three times as much water.
WILLOW_CREEK_NEAR = dam("Willow Creek Bor CO Dam", -106.03911, 40.14556, 10553, 11177)
WILLOW_CREEK_FAR = dam("Willow Creek", -104.5, 40.5, 28668, 30000)

# Named differently by each agency, and 0.04 to 1.05 km from their gauges.
RITSCHARD = dam("Ritschard", -106.61361, 40.03222, 65985, 84639)
ELECTRIC_LAKE = dam("Pacificorp - Electric Lake", -111.22417, 39.60083, 31500, 35500)

# Holds less at the conservation pool than the reservoir has been seen to
# hold, and more at the maximum pool. This is a reservoir run a little full,
# not a wrong dam.
MCPHEE = dam("Mcphee Dam", -108.60083, 37.53389, 381000, 399200)

# No maximum pool published, and a headline figure that only repeats the
# conservation pool. The reservoir has held 35 acre-feet more than that.
STAGECOACH = dam("Stagecoach", -106.86222, 40.29639, 36439, None, 36439)

# Holds much more than the dam can contain at any pool level.
TROUT_LAKE = dam("Trout Lake", -107.87389, 37.83194, 2500, 3200)


def test_distance_is_in_kilometres():
    # One degree of latitude is about 111 km anywhere on the globe.
    assert 110 < distance_km((-111.0, 40.0), (-111.0, 41.0)) < 112
    assert distance_km((-111.0, 40.0), (-111.0, 40.0)) == 0


def test_names_reduce_to_what_two_agencies_agree_on():
    assert normalize_name("Mcphee Reservoir") == normalize_name("Mcphee Dam")
    assert normalize_name("Trout Lake Reservoir") == normalize_name("Trout Lake")
    assert normalize_name("Willow Creek") != normalize_name("Willow Springs")


class TestFindingTheDam:
    """Position first, name second."""

    def test_takes_the_dam_at_the_gauge(self):
        station = (-106.03950, 40.14600)
        match = find_dam(station, "Willow Creek Reservoir",
                         [WILLOW_CREEK_FAR, WILLOW_CREEK_NEAR])
        assert match.dam is WILLOW_CREEK_NEAR
        assert match.confirmed_by == "position"

    def test_refuses_a_dam_that_is_only_named_the_same(self):
        """The failure this rule exists for.

        Matching by name alone gives Willow Creek a capacity of 28,668
        acre-feet. That is a believable number, it passes every other check,
        and it belongs to a different reservoir 120 km away. The site would
        publish as 30% full when it is 82% full.
        """
        station = (-106.03950, 40.14600)
        match = find_dam(station, "Willow Creek Reservoir", [WILLOW_CREEK_FAR])
        assert match is None

    def test_matches_a_dam_the_inventory_calls_something_else(self):
        match = find_dam((-106.61350, 40.03230), "Wolford Mountain Reservoir", [RITSCHARD])
        assert match.dam is RITSCHARD
        assert match.confirmed_by == "position"
        assert match.distance_km < NEAR_RADIUS_KM

        match = find_dam((-111.22200, 39.59600), "Electric Lake", [ELECTRIC_LAKE])
        assert match.dam is ELECTRIC_LAKE

    def test_refuses_a_distant_dam_rather_than_taking_the_nearest_one(self):
        """Lake Mead, measured.

        Its own dam is in a state the dam search did not cover, so the nearest
        dam in the search was 88 km away and held 66 acre-feet. Refusing is
        the only correct answer; a nearest-match rule would have published it.
        """
        far = dam("Mineral Park Flood Control", -114.15, 35.4, None, 66)
        assert find_dam((-114.73800, 36.01700), "Lake Mead", [far]) is None

    def test_accepts_a_far_dam_when_the_name_agrees_as_well(self):
        """Measured: a published point can be 20.87 km from its own dam.

        Lake Powell's point is in the middle of the reservoir and Glen Canyon
        Dam is 20.87 km away. Lake Granby's gauge is 3.85 km from Granby Dam.
        Six matches known to be right are beyond the near radius, so name and
        position together confirm what neither would confirm alone.
        """
        glen_canyon = dam("Glen Canyon", -111.48389, 36.93694, 27000000, None)
        match = find_dam((-111.30332, 37.05778), "Glen Canyon", [glen_canyon])
        assert match.confirmed_by == "name and position"
        assert NEAR_RADIUS_KM < match.distance_km < NAMED_RADIUS_KM

    def test_a_far_dam_with_a_different_name_proves_nothing(self):
        """Distance alone cannot confirm anything at that range."""
        other = dam("Some Other Dam", -111.48389, 36.93694, 27000000, None)
        assert find_dam((-111.30332, 37.05778), "Glen Canyon", [other]) is None

    def test_refuses_a_same_named_dam_beyond_even_the_wide_radius(self):
        """Willow Creek's namesake is 120 km away, well past any radius."""
        assert find_dam((-106.03950, 40.14600), "Willow Creek Reservoir",
                        [WILLOW_CREEK_FAR]) is None

    def test_a_distant_name_match_never_overrides_the_dam_at_the_gauge(self):
        at_gauge = dam("Ritschard", -106.9001, 40.1001, 5000, 6000)
        namesake = dam("Yamcolo", -106.86, 40.1, 9621, 12140)
        match = find_dam((-106.9002, 40.1002), "Yamcolo Reservoir",
                         [at_gauge, namesake])
        assert match.dam is at_gauge
        assert match.confirmed_by == "position"

    def test_says_nothing_rather_than_guessing_with_no_dams(self):
        assert find_dam((-111.0, 40.0), "Anywhere", []) is None

    def test_a_matching_name_picks_among_structures_all_near_enough(self):
        # Hyrum's gauge has Hyrum Dike at 0.93 km and Hyrum Dam at 1.06 km.
        # Both are the same impoundment and hold the same water, and the dam
        # is the structure this project means; nearest-wins would take the
        # dike.
        gauge = (-111.852, 41.617)
        dike = dam("Hyrum Dike", -111.852, 41.617 + 0.00836, 18685, 30300)
        hyrum = dam("Hyrum Dam", -111.852, 41.617 + 0.00953, 18685, 30300)
        assert distance_km(gauge, (hyrum["lon"], hyrum["lat"])) < NEAR_RADIUS_KM
        match = find_dam(gauge, "Hyrum Reservoir", [dike, hyrum])
        assert match.dam is hyrum
        assert match.confirmed_by == "name and position"


class TestTheCapacityCheck:
    """Reject a match only when the reservoir holds more than the dam can."""

    def test_a_reservoir_run_above_its_conservation_pool_is_kept(self):
        # Mcphee: 382,522 acre-feet seen, 381,000 at the conservation pool,
        # 399,200 at the maximum pool.
        assert holds_more_than_the_dam(MCPHEE, 382522) is False

    def test_a_reservoir_over_every_published_pool_is_refused(self):
        # Trout Lake: 4,180 acre-feet seen against a 3,200 maximum pool.
        assert holds_more_than_the_dam(TROUT_LAKE, 4180) is True

    def test_the_allowance_applies_where_no_maximum_pool_is_published(self):
        # Stagecoach: 36,474 seen, 36,439 at the conservation pool, no maximum
        # pool, and a headline figure that repeats the conservation pool.
        assert holds_more_than_the_dam(STAGECOACH, 36474) is False
        # The allowance is small enough to still catch a real mismatch.
        assert holds_more_than_the_dam(STAGECOACH, 36439 * (1 + SURCHARGE_ALLOWANCE) + 1)

    def test_the_ceiling_is_the_largest_figure_the_record_holds(self):
        """Not the maximum pool alone, which is not always the largest
        (ADR-065). Deadwood Dam publishes a maximum pool of 153,992 and a
        headline figure of 191,600, and the reservoir has held 157,590 --
        inside its own record's larger number and refused by the smaller."""
        deadwood = dam("Deadwood Dam", -115.63, 44.29, None, 153992, 191600)

        assert largest_published_pool(deadwood) == 191600
        assert holds_more_than_the_dam(deadwood, 157590) is False

    def test_a_reservoir_surcharged_above_every_pool_is_kept(self):
        """A few percent over is an operating condition, not a wrong dam.
        American Falls has held 1,688,737 against 1,671,300 -- 1% over, at a
        dam 0.15 km away whose name agrees."""
        american_falls = dam("American Falls Dam", -112.87, 42.78, 1671300, None, 1671300)

        assert holds_more_than_the_dam(american_falls, 1688737) is False

    def test_a_reservoir_several_times_over_is_still_a_wrong_dam(self):
        """What the rule is for, and the size the signal really has. Lake
        Havasu matched a 6,300 acre-foot dam called Gene Wash while its water
        sits behind Parker Dam."""
        gene_wash = dam("Gene Wash", -114.31, 34.29, None, 6300, 6300)

        assert holds_more_than_the_dam(gene_wash, 613000) is True
        # Trout Lake stays refused too: 4,180 seen against 3,200 is 31% over,
        # which no operating allowance explains.
        assert holds_more_than_the_dam(TROUT_LAKE, 4180) is True

    def test_no_observed_storage_is_not_evidence_of_a_bad_match(self):
        assert holds_more_than_the_dam(MCPHEE, None) is False


class TestTheLenientScreen:
    """could_hold chooses between candidate structures.

    It used to be deliberately weaker than `holds_more_than_the_dam`. Since
    ADR-065 they ask one question of one set of figures, and this is that
    question's complement -- which is the right way round: a screen stricter
    than the acceptance test can throw away a dam that would have been
    accepted, and that is how Trial Lake ended up matched to Washington Lake
    Dam.
    """

    def test_a_reservoir_run_a_little_over_its_maximum_pool_qualifies_either_way(self):
        # Echo: 74,791 acre-feet seen against a 73,940 maximum pool, 1.2%
        # over. The reviewed capacity table accepts it, and the strict test
        # used to disagree with the reviewed table -- which was the defect,
        # not the screen being lenient.
        echo = dam("Echo", -111.44, 40.97, 65000, 73940)
        assert holds_more_than_the_dam(echo, 74791) is False
        assert could_hold(echo, 74791) is True

    def test_a_structure_an_order_of_magnitude_too_small_is_screened_out(self):
        pond = dam("Settling Pond", -111.0, 39.35, 360)
        assert could_hold(pond, 4259) is False

    def test_a_dam_with_no_figures_is_not_screened_on_size(self):
        assert could_hold(dam("Nameless", 0, 0), 4259) is True

    def test_no_observed_storage_screens_nothing(self):
        assert could_hold(dam("Any", 0, 0, 100), None) is True


class TestTheDenominator:
    """Which storage figure the percentage divides by. See ADR-003."""

    def test_prefers_the_conservation_pool(self):
        assert capacity_of(MCPHEE) == (381000, "normal_storage")

    def test_uses_the_maximum_pool_only_when_there_is_no_conservation_pool(self):
        assert capacity_of(dam("X", 0, 0, None, 5000)) == (5000, "max_storage")

    def test_falls_back_to_the_headline_figure_last(self):
        assert capacity_of(dam("X", 0, 0, None, None, 7000)) == (7000, "nid_storage")

    def test_reads_zero_and_blank_as_unknown(self):
        assert capacity_of(dam("X", 0, 0, 0, None, None)) == (None, None)
        assert capacity_of(dam("X", 0, 0, None, "", None)) == (None, None)


class TestWholeDecisions:
    def test_admits_a_confirmed_reservoir_and_records_its_evidence(self):
        candidate = {"name": "Wolford Mountain Reservoir", "lon": -106.61350,
                     "lat": 40.03230, "observed_max_af": 67560}
        decision = admit(candidate, [RITSCHARD])
        assert decision.admitted is True
        evidence = decision.evidence()
        assert evidence["capacity_af"] == 65985
        assert evidence["capacity_basis"] == "normal_storage"
        assert evidence["nid_dam_name"] == "Ritschard"
        assert evidence["match_confirmed_by"] == "position"
        assert evidence["match_distance_km"] < 0.1

    def test_refuses_a_candidate_with_no_storage_series(self):
        # Great Salt Lake Rise publishes water level, not stored volume.
        decision = admit({"name": "Great Salt Lake Rise", "lon": -112.2, "lat": 41.0,
                          "observed_max_af": None}, [RITSCHARD])
        assert decision.admitted is False
        assert decision.reason == "no storage series"
        assert decision.evidence()["reason"] == "no storage series"

    def test_refuses_a_dam_with_no_storage_figure_at_all(self):
        empty = dam("Nameless", -111.0, 40.0)
        decision = admit({"name": "Nameless", "lon": -111.0, "lat": 40.0,
                          "observed_max_af": 100}, [empty])
        assert decision.admitted is False
        assert "no storage figure" in decision.reason

    def test_refuses_the_reservoir_that_holds_too_much(self):
        decision = admit({"name": "Trout Lake Reservoir", "lon": -107.87400,
                          "lat": 37.83200, "observed_max_af": 4180}, [TROUT_LAKE])
        assert decision.admitted is False
        assert "more water than the dam can contain" in decision.reason
        # The evidence survives the refusal, so the case can be reviewed.
        assert decision.evidence()["nid_dam_name"] == "Trout Lake"

    def test_screens_out_a_structure_that_could_not_hold_the_water(self):
        # Huntington North: a settling pond 0.29 km from the gauge holding
        # 360 acre-feet, its own dam 13.49 km away holding 5,420, and 4,259
        # observed. Position alone picks the pond, and the strict ceiling
        # then refuses the reservoir itself. The screen lets the dam win.
        gauge_lon, gauge_lat = -111.04, 39.35
        pond = dam("Pacificorp Settling Pond", gauge_lon, gauge_lat + 0.00261, 360)
        real = dam("Huntington North Dam", gauge_lon, gauge_lat + 0.12131, 5420)
        decision = admit({"name": "Huntington North Reservoir",
                          "lon": gauge_lon, "lat": gauge_lat,
                          "observed_max_af": 4259}, [pond, real])
        assert decision.admitted is True
        assert decision.evidence()["nid_dam_name"] == "Huntington North Dam"
        assert decision.evidence()["match_confirmed_by"] == "name and position"

    def test_keeps_the_order_it_was_given(self):
        candidates = [
            {"name": "Mcphee Reservoir", "lon": -108.60090, "lat": 37.53390,
             "observed_max_af": 382522},
            {"name": "Trout Lake Reservoir", "lon": -107.87400, "lat": 37.83200,
             "observed_max_af": 4180},
        ]
        decisions = admit_all(candidates, [MCPHEE, TROUT_LAKE])
        assert [d.name for d in decisions] == [c["name"] for c in candidates]
        assert [d.admitted for d in decisions] == [True, False]


class TestTheDisagreementScreens:
    """`discrepancies` -- the second question, asked after the dam is found.

    Every fixture is a California candidate measured on 2026-08-20, written
    down as literal numbers for the same reason the rest of this file is.
    """

    def clean(self, capacity=100000.0, basis="normal_storage"):
        return Decision("Somewhere", True, "confirmed by name and position",
                        None, capacity, basis)

    def test_a_candidate_nothing_disagrees_about_is_reported_clean(self):
        # Shasta: the inventory's 4,552,090 against the service's 4,552,000,
        # and 4,476,827 observed under both.
        decision = self.clean(4552090.0)
        assert discrepancies(decision,
                             highest_readings=[4476827, 4470000, 4460000],
                             service_capacity_af=4552000.0) == []

    def test_a_refusal_is_itself_a_disagreement(self):
        decision = Decision("San Luis Reservoir", False,
                            "no dam close enough to confirm")
        screens = [screen for screen, _ in discrepancies(decision)]
        assert screens == ["no confirmed dam"]

    def test_one_extreme_reading_is_read_as_a_spike(self):
        # O'Neill Forebay: 443,348 once, and 55,049 the next time.
        decision = self.clean(2094900.0)
        found = dict(discrepancies(decision,
                                   highest_readings=[443348, 55049, 54535]))
        assert "unstable maximum" in found
        assert "443,348" in found["unstable maximum"]

    def test_two_spikes_do_not_agree_with_each_other(self):
        # Lake Havasu carries two, so a rule reading the second highest would
        # have found them in agreement and published a ten-fold error.
        decision = self.clean(619400.0)
        screens = dict(discrepancies(decision,
                                     highest_readings=[5913000, 5775421, 601300]))
        assert "unstable maximum" in screens

    def test_a_flood_is_not_a_spike(self):
        # Terminus: a flood-control reservoir's high readings come in runs.
        decision = self.clean(185600.0)
        found = dict(discrepancies(decision,
                                   highest_readings=[185801, 178000, 176000],
                                   service_capacity_af=185600.0))
        assert "unstable maximum" not in found

    def test_a_series_too_short_to_judge_is_not_judged(self):
        decision = self.clean(100000.0)
        found = dict(discrepancies(decision, highest_readings=[90000, 10000]))
        assert "unstable maximum" not in found

    def test_the_two_capacity_sources_are_compared(self):
        # Keswick: 7,470 against 23,772, the widest disagreement measured.
        decision = self.clean(7470.0)
        found = dict(discrepancies(decision, highest_readings=[22928, 22000, 21000],
                                   service_capacity_af=23772.0))
        assert "the two capacity sources disagree" in found
        assert "-69%" in found["the two capacity sources disagree"]

    def test_capacity_sources_inside_the_allowance_agree(self):
        # Folsom: 894,000 against 977,000, 8.5% apart.
        decision = self.clean(894000.0)
        found = dict(discrepancies(decision, highest_readings=[854601, 850000, 840000],
                                   service_capacity_af=977000.0))
        assert "the two capacity sources disagree" not in found

    def test_a_provider_with_no_full_level_is_not_reported_as_disagreeing(self):
        decision = self.clean(100000.0)
        found = dict(discrepancies(decision, highest_readings=[90000, 89000, 88000],
                                   service_capacity_af=None))
        assert "the two capacity sources disagree" not in found

    def test_water_above_the_denominator_is_a_disagreement(self):
        # San Gabriel: the right dam, and a conservation pool of 3,378 that
        # the reservoir has stood twelve times above.
        decision = self.clean(3378.0)
        found = dict(discrepancies(decision, highest_readings=[41978, 40000, 39000]))
        assert "seen above the capacity it would be divided by" in found

    def test_a_reservoir_run_a_little_full_is_not_one(self):
        # Drews at 6% over is the case SURCHARGE_ALLOWANCE was measured for.
        decision = self.clean(100000.0)
        found = dict(discrepancies(decision, highest_readings=[106000, 105000, 104000]))
        assert "seen above the capacity it would be divided by" not in found

    def test_a_reservoir_never_seen_a_third_full_is_referred(self):
        # Martis Creek, a flood-control dam operated empty, and O'Neill
        # Forebay, whose denominator belongs to San Luis Reservoir. The screen
        # cannot tell them apart, which is why it refers rather than decides.
        decision = self.clean(22000.0)
        found = dict(discrepancies(decision, highest_readings=[1136, 1070, 1050]))
        assert "never seen a third full" in found

    def test_the_two_capacity_screens_cannot_both_fire(self):
        decision = self.clean(100000.0)
        for readings in ([200000, 190000, 180000], [1000, 900, 800]):
            screens = [screen for screen, _ in discrepancies(
                decision, highest_readings=readings)]
            assert len(set(screens) & {"seen above the capacity it would be divided by",
                                       "never seen a third full"}) == 1

    def test_nothing_is_repaired(self):
        # The screen reports; it never rewrites the decision it read. A
        # correction here would be a guess about which source is wrong.
        decision = self.clean(7470.0)
        discrepancies(decision, highest_readings=[22928, 22000, 21000],
                      service_capacity_af=23772.0)
        assert decision.admitted is True
        assert decision.capacity_af == 7470.0
        assert decision.reason == "confirmed by name and position"


if __name__ == "__main__":
    import pytest
    raise SystemExit(pytest.main([__file__, "-v"]))
