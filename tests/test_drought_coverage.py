"""The drought coverage engine against shapes with known answers, and the
committed weekly output against its own arithmetic.

The synthetic fixtures use squares near the equator so the cosine weighting
is almost uniform and the expected percentages are exact up to sampling
resolution. The committed-file tests stay data-independent: they assert
structure and self-consistency, never this week's drought, so a Thursday
release cannot turn the suite red.
"""

import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))

from compute_drought_coverage import (  # noqa: E402
    HISTORY_WEEKS_KEPT,
    LEVELS,
    build_payload,
    history_entry,
    land_mask_segments,
    merge_history,
    previous_week,
    segments_of,
    unit_coverage,
)


def square(west, south, east, north):
    return [[west, south], [east, south], [east, north], [west, north], [west, south]]


def polygon(*rings):
    return {"type": "Polygon", "coordinates": list(rings)}


def drought_fixture(features):
    return {
        "map_date": "2026-08-11",
        "release_date": "2026-08-13",
        "source": "https://example.com/usdm",
        "attribution": "U.S. Drought Monitor",
        "features": [
            {"properties": {"DM": level}, "geometry": geometry}
            for level, geometry in features
        ],
    }


def boundaries_fixture(geometry):
    return {"features": [
        {"properties": {"huc6": "140100", "name": "Test Unit"}, "geometry": geometry}
    ]}


def coverage(drought_features, unit_geometry, step=0.005):
    payload = build_payload(
        drought_fixture(drought_features), boundaries_fixture(unit_geometry), step)
    return payload["units"][0]


class TestEngine:
    def test_half_covered_square(self):
        unit = polygon(square(0, 0, 1, 1))
        west_half = polygon(square(0, 0, 0.5, 1))
        result = coverage([(2, west_half)], unit)
        assert result["percent_of_area"]["d2"] == pytest.approx(50.0, abs=0.5)
        assert result["percent_of_area"]["none"] == pytest.approx(50.0, abs=0.5)
        assert result["percent_of_area"]["d0"] == 0.0

    def test_uncovered_and_fully_covered(self):
        unit = polygon(square(0, 0, 1, 1))
        elsewhere = polygon(square(5, 5, 6, 6))
        result = coverage([(0, elsewhere)], unit)
        assert result["percent_of_area"]["none"] == 100.0

        result = coverage([(4, polygon(square(-1, -1, 2, 2)))], unit)
        assert result["percent_of_area"]["d4"] == 100.0
        assert result["percent_of_area_at_least"]["d4"] == 100.0

    def test_hole_in_drought_polygon_is_not_covered(self):
        unit = polygon(square(0, 0, 1, 1))
        # Drought everywhere except a quarter-area hole in the middle.
        holed = polygon(square(0, 0, 1, 1), square(0.25, 0.25, 0.75, 0.75))
        result = coverage([(1, holed)], unit)
        assert result["percent_of_area"]["d1"] == pytest.approx(75.0, abs=0.5)
        assert result["percent_of_area"]["none"] == pytest.approx(25.0, abs=0.5)

    def test_exclusive_classes_and_cumulative_sums(self):
        unit = polygon(square(0, 0, 1, 1))
        # The layers are exclusive by contract: D2 is a ring of the west
        # half, D3 the island inside it -- the shape the real payload has.
        d2 = polygon(square(0, 0, 0.5, 1), square(0.1, 0.1, 0.4, 0.4))
        d3 = polygon(square(0.1, 0.1, 0.4, 0.4))
        result = coverage([(2, d2), (3, d3)], unit)
        assert result["percent_of_area"]["d3"] == pytest.approx(9.0, abs=0.5)
        assert result["percent_of_area"]["d2"] == pytest.approx(41.0, abs=0.5)
        at_least = result["percent_of_area_at_least"]
        assert at_least["d3"] == pytest.approx(9.0, abs=0.5)
        assert at_least["d2"] == pytest.approx(50.0, abs=0.5)
        assert at_least["d0"] == pytest.approx(50.0, abs=0.5)

    def test_multipolygon_unit(self):
        two_parts = {
            "type": "MultiPolygon",
            "coordinates": [
                [square(0, 0, 1, 1)],
                [square(2, 0, 3, 1)],
            ],
        }
        covered_part = polygon(square(2, 0, 3, 1))
        result = coverage([(0, covered_part)], two_parts)
        assert result["percent_of_area"]["d0"] == pytest.approx(50.0, abs=0.5)

    def test_missing_class_reads_zero(self):
        unit = polygon(square(0, 0, 1, 1))
        result = coverage([(0, polygon(square(0, 0, 1, 1)))], unit)
        for level in ("d1", "d2", "d3", "d4"):
            assert result["percent_of_area"][level] == 0.0

    def test_duplicate_class_is_refused(self):
        unit = polygon(square(0, 0, 1, 1))
        shape = polygon(square(0, 0, 1, 1))
        with pytest.raises(ValueError, match="duplicate drought intensity"):
            build_payload(
                drought_fixture([(1, shape), (1, shape)]),
                boundaries_fixture(unit), 0.01)

    def test_latitude_weighting_matters_in_the_north(self):
        # A unit spanning 40-48 degrees north, drought on its north half.
        # Unweighted sampling would call this 50%; the true share is smaller
        # because northern cells are narrower.
        unit = polygon(square(0, 40, 1, 48))
        north = polygon(square(0, 44, 1, 48))
        raw, measured = unit_coverage(
            segments_of(unit), {0: segments_of(north)}, 0.01)
        # No mask, so every cell is measured. The shares below are therefore
        # against the whole unit, as they were before the mask existed.
        assert measured == 100.0
        assert raw["d0"] < 49.7
        # (sin 48 - sin 44) / (sin 48 - sin 40) = 48.3%.
        assert raw["d0"] == pytest.approx(48.3, abs=0.5)


class TestCommittedOutput:
    @pytest.fixture(scope="class")
    def payload(self):
        path = ROOT / "data" / "drought" / "usdm-huc6.json"
        assert path.exists(), "run tools/compute_drought_coverage.py"
        return json.loads(path.read_text(encoding="utf-8"))

    @pytest.fixture(scope="class")
    def source(self):
        return json.loads(
            (ROOT / "data" / "drought" / "usdm-current.geojson")
            .read_text(encoding="utf-8"))

    def test_every_published_drainage_area_is_covered(self, payload):
        boundaries = json.loads((ROOT / "huc6.geojson").read_text(encoding="utf-8"))
        expected = sorted(f["properties"]["huc6"] for f in boundaries["features"])
        assert [unit["huc6"] for unit in payload["units"]] == expected
        assert payload["unit_count"] == len(expected)

    def test_dates_match_the_polygon_file(self, payload, source):
        assert payload["map_date"] == source["map_date"]
        assert payload["release_date"] == source["release_date"]

    def test_percentages_are_complete_and_sum_to_the_whole(self, payload):
        for unit in payload["units"]:
            shares = unit["percent_of_area"]
            assert set(shares) == {"none", *LEVELS}
            for value in shares.values():
                assert 0.0 <= value <= 100.0
            # Six rounded figures may miss 100 by half a rounding step each.
            assert sum(shares.values()) == pytest.approx(100.0, abs=0.3)

    def test_cumulative_figures_agree_with_the_exclusive_ones(self, payload):
        for unit in payload["units"]:
            shares = unit["percent_of_area"]
            at_least = unit["percent_of_area_at_least"]
            assert list(at_least) == list(LEVELS)
            running = 0.0
            for level in reversed(LEVELS):
                running += shares[level]
                assert at_least[level] == pytest.approx(running, abs=0.3)
            previous = 100.1
            for level in LEVELS:
                assert at_least[level] <= previous
                previous = at_least[level]


def week_payload(map_date, release_date="2026-08-13", d4=10.0):
    """The smallest thing shaped like a computed week."""
    return {
        "map_date": map_date,
        "release_date": release_date,
        "source": "s",
        "attribution": "a",
        "method": {"sampling": "even-odd scanline over cell centres"},
        "unit_count": 1,
        "units": [{
            "huc6": "140100",
            "huc6_name": "Colorado Headwaters",
            "percent_of_area": {"none": 0.0, "d0": 0.0, "d1": 0.0,
                                "d2": 0.0, "d3": 100.0 - d4, "d4": d4},
            "percent_of_area_at_least": {"d0": 100.0, "d1": 100.0, "d2": 100.0,
                                         "d3": 100.0, "d4": d4},
        }],
    }


class TestHistory:
    """Retaining the weekly maps, so a change can be reported at all."""

    def test_an_entry_keeps_only_the_cumulative_shares(self):
        """The exclusive shares are recoverable by differencing, so storing
        both would store one fact twice with two chances to disagree."""
        entry = history_entry(week_payload("2026-08-11"))
        unit = entry["units"][0]
        assert set(unit) == {"huc6", "percent_of_area_at_least"}
        assert "huc6_name" not in unit
        assert unit["percent_of_area_at_least"]["d4"] == 10.0

    def test_the_first_run_starts_a_history_of_one(self):
        history = merge_history(None, week_payload("2026-08-11"))
        assert history["week_count"] == 1
        assert history["first_map_date"] == history["last_map_date"] == "2026-08-11"

    def test_a_later_week_is_added_oldest_first(self):
        history = merge_history(None, week_payload("2026-08-11"))
        history = merge_history(history, week_payload("2026-08-18"))
        assert [week["map_date"] for week in history["weeks"]] == [
            "2026-08-11", "2026-08-18"]
        assert history["week_count"] == 2

    def test_rerunning_a_week_replaces_it_rather_than_repeating_it(self):
        """The tool has to be safe to run twice, and the monitor revises a
        published week occasionally -- a rerun after a revision must correct
        the entry, not leave the file carrying both readings of one Thursday."""
        history = merge_history(None, week_payload("2026-08-11", d4=10.0))
        history = merge_history(history, week_payload("2026-08-11", d4=42.0))
        assert history["week_count"] == 1
        assert (history["weeks"][0]["units"][0]["percent_of_area_at_least"]["d4"]
                == 42.0)

    def test_an_out_of_order_week_still_lands_in_order(self):
        history = merge_history(None, week_payload("2026-08-18"))
        history = merge_history(history, week_payload("2026-08-11"))
        assert [week["map_date"] for week in history["weeks"]] == [
            "2026-08-11", "2026-08-18"]

    def test_the_history_is_bounded_and_drops_the_oldest_first(self):
        history = None
        for day in range(1, 8):
            history = merge_history(history, week_payload(f"2026-01-{day:02d}"), keep=3)
        assert history["week_count"] == 3
        assert [week["map_date"] for week in history["weeks"]] == [
            "2026-01-05", "2026-01-06", "2026-01-07"]

    def test_an_entry_never_carries_the_week_before_it(self):
        """Otherwise the archive stores every week twice, and doubles again on
        the next release."""
        payload = week_payload("2026-08-18")
        payload["previous"] = {"map_date": "2026-08-11", "units": []}
        assert "previous" not in history_entry(payload)

    def test_the_default_bound_is_a_decade_of_thursdays(self):
        assert HISTORY_WEEKS_KEPT == 520


class TestPreviousWeek:
    """The one week a week-over-week comparison needs, carried in the current
    file so no page fetches an archive to find one subtraction."""

    @pytest.fixture()
    def history(self):
        history = merge_history(None, week_payload("2026-08-04", d4=1.0))
        return merge_history(history, week_payload("2026-08-11", d4=2.0))

    def test_it_finds_the_week_before_this_one(self, history):
        found = previous_week(history, "2026-08-18")
        assert found["map_date"] == "2026-08-11"
        assert found["units"][0]["percent_of_area_at_least"]["d4"] == 2.0

    def test_a_rerun_compares_against_the_week_before_rather_than_itself(self, history):
        """Strictly older. Otherwise a rerun publishes a change of zero for
        every area and calls it a measurement."""
        found = previous_week(history, "2026-08-11")
        assert found["map_date"] == "2026-08-04"

    def test_the_first_week_ever_has_nothing_before_it(self):
        assert previous_week(None, "2026-08-11") is None
        assert previous_week({"weeks": []}, "2026-08-11") is None
        history = merge_history(None, week_payload("2026-08-11"))
        assert previous_week(history, "2026-08-11") is None


class TestCommittedHistory:
    """The file in the repository, checked for shape rather than for values."""

    @pytest.fixture(scope="class")
    def history(self):
        path = ROOT / "data" / "drought" / "usdm-huc6-history.json"
        if not path.exists():
            pytest.skip("no drought history has been built in this checkout")
        return json.loads(path.read_text(encoding="utf-8"))

    def test_the_weeks_are_unique_and_in_order(self, history):
        dates = [week["map_date"] for week in history["weeks"]]
        assert dates == sorted(dates)
        assert len(dates) == len(set(dates))

    def test_it_agrees_with_its_own_summary(self, history):
        assert history["week_count"] == len(history["weeks"])
        assert history["first_map_date"] == history["weeks"][0]["map_date"]
        assert history["last_map_date"] == history["weeks"][-1]["map_date"]
        assert history["week_count"] <= history["weeks_kept"]

    def test_it_covers_the_areas_the_current_week_publishes(self, history):
        current = json.loads(
            (ROOT / "data" / "drought" / "usdm-huc6.json").read_text(encoding="utf-8"))
        published = {unit["huc6"] for unit in current["units"]}
        for week in history["weeks"]:
            assert {unit["huc6"] for unit in week["units"]} == published

    def test_the_current_week_names_the_week_it_was_compared_with(self, history):
        """`previous` is either a real earlier week or null. It is never this
        week, which would make every change zero."""
        current = json.loads(
            (ROOT / "data" / "drought" / "usdm-huc6.json").read_text(encoding="utf-8"))
        previous = current.get("previous")
        if previous is None:
            assert history["week_count"] == 1
            return
        assert previous["map_date"] < current["map_date"]
        assert ({unit["huc6"] for unit in previous["units"]}
                == {unit["huc6"] for unit in current["units"]})


def land_fixture(*geometries):
    """A land mask in the shape `build_payload` reads."""
    return {"features": [{"properties": {"STUSAB": "XX"}, "geometry": g}
                         for g in geometries]}


class TestUnmeasuredLand:
    """The drought monitor stops at the border (ADR-059).

    Without a mask the engine counted every cell outside a drought polygon as
    land with no drought on it, so a basin's Canadian or Mexican half became
    a drought-free share. Measured against the western basins, Kootenai
    reported 75.2 points of drought-free area that is really British Columbia,
    and Upper Columbia 51.8.
    """

    def covered(self, drought_features, unit_geometry, land=None, step=0.005):
        payload = build_payload(
            drought_fixture(drought_features), boundaries_fixture(unit_geometry),
            step, land)
        return payload["units"][0]

    def test_land_outside_the_mask_is_not_counted_as_drought_free(self):
        """The defect, at the smallest scale that shows it.

        A unit whose west half is off the map entirely, with drought over the
        whole of the half that is on it. The honest answer is 100% -- every
        acre anyone can see is in drought -- not 50%.
        """
        unit = polygon(square(0, 0, 1, 1))
        east_half = polygon(square(0.5, 0, 1, 1))
        land = land_fixture(east_half)

        without = self.covered([(2, east_half)], unit)
        assert without["percent_of_area"]["d2"] == pytest.approx(50.0, abs=0.5)
        assert without["percent_of_area"]["none"] == pytest.approx(50.0, abs=0.5)
        assert "measured" not in without

        with_mask = self.covered([(2, east_half)], unit, land)
        assert with_mask["percent_of_area"]["d2"] == pytest.approx(100.0, abs=0.5)
        assert with_mask["percent_of_area"]["none"] == pytest.approx(0.0, abs=0.5)
        assert with_mask["measured"]["percent_of_area"] == pytest.approx(50.0, abs=0.5)

    def test_a_wholly_measured_area_carries_no_measured_block(self):
        """Every drainage area published today is inside the country.

        The block is absent rather than set to 100, so the committed payload
        is byte-for-byte what it was before the mask existed -- which is how
        this change was verified against the real inputs.
        """
        unit = polygon(square(0, 0, 1, 1))
        result = self.covered([(1, polygon(square(0, 0, 0.5, 1)))], unit,
                              land_fixture(polygon(square(-1, -1, 2, 2))))
        assert "measured" not in result
        assert result["percent_of_area"]["d1"] == pytest.approx(50.0, abs=0.5)

    def test_the_measured_share_is_kept_out_of_the_class_shares(self):
        """ADR-046, structurally rather than by convention.

        The class shares divide by measured area and the measured share
        divides by the whole area. Two denominators must not sit in one dict
        where something could sum them.
        """
        unit = polygon(square(0, 0, 1, 1))
        east_half = polygon(square(0.5, 0, 1, 1))
        result = self.covered([(2, east_half)], unit, land_fixture(east_half))

        assert "measured" not in result["percent_of_area"]
        assert "measured" not in result["percent_of_area_at_least"]
        # The class shares still close on their own denominator.
        assert sum(result["percent_of_area"].values()) == pytest.approx(100.0, abs=0.2)

    def test_an_area_the_monitor_cannot_see_at_all_reports_no_drought_share(self):
        """Not zero drought -- no denominator, so no share.

        Rio De La Concepcion is 1.3% United States land. A basin that fell to
        zero would have no honest figure to publish, and publishing zeros
        would read as "no drought here".
        """
        unit = polygon(square(0, 0, 1, 1))
        elsewhere = polygon(square(10, 10, 11, 11))
        result = self.covered([(3, polygon(square(0, 0, 1, 1)))], unit,
                              land_fixture(elsewhere))

        assert result["measured"]["percent_of_area"] == 0.0
        # No share blocks at all: zeros here would publish "not measured"
        # as "no drought", and a "none" of 100 is the same lie made total.
        assert "percent_of_area" not in result
        assert "percent_of_area_at_least" not in result
        # And no share means nothing to difference: the history skips it.
        payload = build_payload(
            drought_fixture([(3, polygon(square(0, 0, 1, 1)))]),
            boundaries_fixture(unit), 0.005, land_fixture(elsewhere))
        assert history_entry(payload)["units"] == []

    def test_the_mask_is_read_as_one_union(self):
        """Adjacent states must not cancel each other out.

        The states are simplified one feature at a time, so their shared
        border overlaps by slivers in the committed mask. Under pooled
        even-odd parity a point inside two states crosses an even number of
        edges and reads as outside the country; each state answering alone
        means an overlap can only add land, never remove it.
        """
        segments = land_mask_segments(land_fixture(
            polygon(square(0, 0, 1, 1)), polygon(square(1, 0, 2, 1))))
        assert segments is not None
        assert [len(part) for part in segments] == [4, 4]
        assert land_mask_segments(None) is None

    def test_overlapping_states_still_read_as_land(self):
        """The sliver case itself, at the smallest scale that shows it.

        Two states overlapping on [0.9, 1.1]: every cell of a unit spanning
        both is on land, so the whole unit is measured. Pooled parity read
        the overlap as a hole in the country and dropped its cells from the
        denominators.
        """
        unit = polygon(square(0, 0, 2, 1))
        land = land_fixture(
            polygon(square(0, 0, 1.1, 1)), polygon(square(0.9, 0, 2, 1)))
        result = self.covered([(2, polygon(square(0, 0, 2, 1)))], unit, land)
        assert "measured" not in result
        assert result["percent_of_area"]["d2"] == pytest.approx(100.0, abs=0.5)

    def test_the_history_does_not_carry_the_measured_share(self):
        """A border does not move from week to week.

        The measured share is a property of the geography, so storing it in
        every weekly entry would store one static fact 520 times per area --
        in the one file the western scoping already identified as the thing
        that does not scale.
        """
        unit = polygon(square(0, 0, 1, 1))
        east_half = polygon(square(0.5, 0, 1, 1))
        payload = build_payload(
            drought_fixture([(2, east_half)]), boundaries_fixture(unit),
            0.005, land_fixture(east_half))

        assert "measured" in payload["units"][0]
        entry = history_entry(payload)
        assert "measured" not in entry["units"][0]
        assert set(entry["units"][0]) == {"huc6", "percent_of_area_at_least"}
