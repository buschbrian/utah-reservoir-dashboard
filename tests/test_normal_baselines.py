"""Tests for the selectable baseline: the builder, the lookup and the payload.

Like the rest of the pipeline tests these never touch the network. The
builder's fetch is the only part that does, and it is the part these do not
need: every claim worth testing here is about how a series becomes a normal
and how a normal becomes a published comparison.

The tests that matter most are the ones about *refusing*. A baseline that
quietly substitutes a different period when its own is unavailable is worse
than no baseline, because the number still looks like an answer.
"""

import json
import sys
from pathlib import Path

import pandas as pd
import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "tools"))

import build_normal_baselines as B  # noqa: E402
import refresh_reservoirs as R  # noqa: E402


# --------------------------------------------------------------------------
# The builder
# --------------------------------------------------------------------------

def climate_series(start: str = "1991-01-01", end: str = "2020-12-31",
                   value: float = 1000.0) -> pd.Series:
    """A flat daily series across the climate period."""
    index = pd.date_range(start, end, freq="D")
    return pd.Series([value] * len(index), index=index)


def test_every_day_of_the_year_gets_a_normal_and_a_year_count():
    table = B.day_of_year_normals(climate_series())
    assert len(table["median_af"]) == 367
    # Slot 0 is unused by construction and must stay null, or an off-by-one in
    # the reader would silently read a real value from the wrong day.
    assert table["median_af"][0] is None
    assert all(table["median_af"][day] == 1000.0 for day in range(1, 367))


def test_a_window_that_wraps_the_new_year_draws_on_the_whole_period():
    """The seam is the case a margin year would have quietly broken.

    Day 1's window reaches back to day 359, and it reaches day 359 of *every*
    year in the period, because the window matches on day of the year rather
    than on adjacency in time. Adding 1990 and 2021 to "protect" the seam once
    added two extra calendar years to all 366 days.
    """
    table = B.day_of_year_normals(climate_series())
    assert set(table["years"][1:]) == {30}


def test_month_normals_take_the_median_of_monthly_means():
    """Not the median of every reading, which would weight cadences unequally."""
    index = pd.date_range("1991-01-01", "2020-12-31", freq="D")
    # January 1000, every other month 2000. The January median of monthly means
    # is 1000 whether a station reports daily or once a month.
    values = [1000.0 if date.month == 1 else 2000.0 for date in index]
    table = B.month_normals(pd.Series(values, index=index))
    assert table["median_af"][1] == 1000.0
    assert table["median_af"][7] == 2000.0
    assert table["years"][1] == 30


def test_the_builder_and_the_pipeline_share_one_window():
    """Both baselines must describe the same slice of the year.

    They exist to be compared, so the window is imported rather than
    reimplemented. This test fails if anyone gives the builder its own copy.
    """
    assert B.SEASONAL_WINDOW_DAYS is R.SEASONAL_WINDOW_DAYS
    assert B.seasonal_window is R.seasonal_window


def test_the_climate_period_matches_the_period_the_snow_payload_uses():
    """One dashboard, one definition of normal -- the whole point of the change."""
    snow = json.loads((ROOT / "snowpack.json").read_text(encoding="utf-8"))
    assert snow["normal_period"]["start_year"] == B.CLIMATE_START_YEAR
    assert snow["normal_period"]["end_year"] == B.CLIMATE_END_YEAR


# --------------------------------------------------------------------------
# The lookup
# --------------------------------------------------------------------------

#: The station the fixtures below are about. Indexed by it and not by the
#: name, since ADR-066: a climate normal is a denominator, and two reservoirs
#: sharing a name must not share one.
TEST_STATION = "1"


def normals_table(available: bool = True, years: int = 30,
                  full: bool = True, name: str = "Test",
                  station: str = TEST_STATION) -> dict:
    record = {
        "name": name,
        "source_station_id": station,
        "available": available,
        "covers_full_period": full,
        "first_obs": "1991-01-02",
        "day_of_year": {"median_af": [None] + [2000.0] * 366,
                        "years": [0] + [years] * 366},
        "month": {"median_af": [None] + [2100.0] * 12, "years": [0] + [years] * 12},
    }
    return {"period": {"start_year": 1991, "end_year": 2020},
            "built": "2026-08-16", "window_days": 7,
            "by_station": {station: record}}


# --------------------------------------------------------------------------
# Which reservoirs a run builds, and which it leaves alone
# --------------------------------------------------------------------------

def roster(*names):
    """Roster records carry the identity beside the name (ADR-066)."""
    return [{"name": name, "source_station_id": f"sid-{name}"} for name in names]


def test_missing_builds_only_what_the_file_has_no_usable_normal_for():
    """The flag that keeps a growing roster affordable: at western coverage
    the roster gains reservoirs in batches, and re-fetching thirty years for
    the ones already done is the whole cost of the job."""
    existing = {
        "sid-Done": {"name": "Done", "available": True},
        "sid-Failed": {"name": "Failed", "available": False,
                       "reason": "the provider did not answer"},
        "sid-Empty": {"name": "Empty", "available": False,
                      "reason": "no readings in the period"},
    }

    chosen = B.select(roster("Done", "Failed", "Empty", "New"), None, True, existing)

    assert [r["name"] for r in chosen] == ["Failed", "New"]


def test_a_reservoir_with_no_record_is_not_asked_again_every_run():
    """A reservoir built in 2011 will not grow a 1991 record by being asked
    twice, so its absence is a finding rather than a gap. Only a provider
    that did not answer is worth another fetch."""
    reservoir = {"name": "R", "source_station_id": "sid-R"}
    assert B.needs_building(reservoir, {}) is True
    assert B.needs_building(
        reservoir,
        {"sid-R": {"available": False, "reason": "no readings in the period"}}) is False
    assert B.needs_building(
        reservoir,
        {"sid-R": {"available": False,
                   "reason": "the record begins after the period ends"}}
    ) is False
    assert B.needs_building(
        reservoir,
        {"sid-R": {"available": False,
                   "reason": "the provider did not answer"}}) is True
    assert B.needs_building(reservoir, {"sid-R": {"available": True}}) is False


def test_two_reservoirs_sharing_a_name_are_indexed_apart(tmp_path):
    """The index the merge and `--missing` both read is by station (ADR-066):
    a name index would hold one Lost Creek while answering for both."""
    path = tmp_path / "normals.json"
    path.write_text(json.dumps({"reservoirs": [
        {"name": "Lost Creek", "source_station_id": "sid-UT", "available": True},
        {"name": "Lost Creek", "source_station_id": "sid-OR", "available": False,
         "reason": "the provider did not answer"},
    ]}), encoding="utf-8")

    existing = B.already_built(path)

    assert len(existing) == 2
    assert B.needs_building(
        {"name": "Lost Creek", "source_station_id": "sid-UT"}, existing) is False
    assert B.needs_building(
        {"name": "Lost Creek", "source_station_id": "sid-OR"}, existing) is True


def test_a_rebuild_of_one_twin_keeps_the_other_twins_normal():
    """Always a merge, never a replacement -- by station, not by name: a
    name-keyed merge that rebuilt one Lost Creek would silently delete the
    untouched twin's thirty-year normal."""
    previous = [
        {"name": "Lost Creek", "source_station_id": "sid-UT", "available": True},
        {"name": "Lost Creek", "source_station_id": "sid-OR", "available": True},
    ]
    rebuilt = [{"name": "Lost Creek", "source_station_id": "sid-UT",
                "available": True}]

    kept, merged = B.merged_reservoirs(previous, rebuilt)

    assert [r["source_station_id"] for r in kept] == ["sid-OR"]
    assert sorted(r["source_station_id"] for r in merged) == ["sid-OR", "sid-UT"]


def test_only_takes_several_names_and_keeps_roster_order():
    chosen = B.select(roster("A", "B", "C"), ["C", "A"], False, {})

    assert [r["name"] for r in chosen] == ["A", "C"]


def test_a_run_with_no_selection_builds_the_whole_roster():
    assert len(B.select(roster("A", "B"), None, False, {})) == 2


def test_the_default_worker_count_is_neighbourly():
    """Both providers are public services this project does not pay for, and
    the daily refresh asks for one series at a time. A handful of concurrent
    thirty-year queries is a different request pattern from a hundred."""
    assert 2 <= B.DEFAULT_WORKERS <= 8


def test_a_station_that_fails_does_not_fail_the_run():
    """One bad station is not a bad run -- the rule the sequential builder
    followed, kept now that the work is concurrent. The record it yields is
    the retryable one, so `--missing` asks again."""
    def explode(reservoir):
        raise RuntimeError("provider said no")

    original = B.build_one
    B.build_one = explode
    try:
        results = list(B.build_many([{
            "name": "Broken", "source_key": "rise",
            "source_station_id": "x", "data_frequency": "daily"}], workers=1))
    finally:
        B.build_one = original

    record, error = results[0]
    assert error == "provider said no"
    assert record["available"] is False
    assert record["reason"] in B.RETRYABLE_REASONS


def test_the_lookup_reads_the_day_the_reading_was_taken():
    found = R.climate_baseline(
        normals_table(), TEST_STATION, pd.Timestamp("2026-08-16"), 1000.0)
    assert found["normal_af"] == 2000.0
    assert found["pct_of_normal"] == 50.0
    assert found["sample_years"] == 30


@pytest.mark.parametrize("table,reason", [
    ({}, "no normals file at all"),
    (normals_table(available=False), "the reservoir has no usable record"),
    (normals_table(station="another-station"), "the reservoir is not in the table"),
    (normals_table(name="Somewhere else", station="another-station"),
     "a reservoir sharing this one's name is not this one"),
])
def test_the_lookup_answers_nothing_rather_than_something_else(table, reason):
    """It must never fall back to the other baseline behind the reader's back,
    and since ADR-066 it must not answer for a reservoir that merely shares a
    name -- the two Lost Creeks' records differ by a factor of twenty."""
    assert R.climate_baseline(
        table, TEST_STATION, pd.Timestamp("2026-08-16"), 1000.0) is None, reason


# --------------------------------------------------------------------------
# The published record
# --------------------------------------------------------------------------

def daily_frame() -> pd.DataFrame:
    index = pd.date_range("2015-01-01", R.local_today(), freq="D")
    return pd.DataFrame({"date": index, "storage_af": [1000.0] * len(index)})


def summarize_with(table: dict, name: str = "Test") -> dict:
    return R.summarize(name, 1, 40.0, -111.0, daily_frame(), R.local_today(),
                       None, normals=table)


def test_both_baselines_are_published_with_their_own_sample_size():
    record = summarize_with(normals_table())
    baselines = record["baselines"]
    assert baselines["recent"]["sample_years"] > 0
    assert baselines["climate"]["sample_years"] == 30
    # Two periods, two different answers to the same question. If these were
    # ever equal the control would be decoration.
    assert (baselines["recent"]["normal_af"]
            != baselines["climate"]["normal_af"])


def test_the_recent_baseline_still_matches_the_field_that_was_always_there():
    """Nothing that already reads this payload may change meaning."""
    record = summarize_with(normals_table())
    assert record["baselines"]["recent"]["normal_af"] == record["seasonal_normal_af"]
    assert (record["baselines"]["recent"]["pct_of_normal"]
            == record["pct_of_seasonal_normal"])
    assert (record["baselines"]["recent"]["sample_years"]
            == record["seasonal_sample_years"])


def test_a_reservoir_with_a_full_climate_record_opens_on_the_climate_baseline():
    assert summarize_with(normals_table())["baselines"]["default"] == "climate"


def test_a_reservoir_with_too_few_years_opens_on_the_recent_baseline():
    """A median over three winters is not a climate normal, and is not offered
    as one. The value is still published, with its year count, so the reader
    can choose it deliberately."""
    record = summarize_with(normals_table(years=3, full=False))
    assert record["baselines"]["default"] == "recent"
    assert record["baselines"]["climate"]["sample_years"] == 3
    assert record["baselines"]["climate"]["covers_full_period"] is False


def test_a_reservoir_with_no_climate_record_says_so_rather_than_going_quiet():
    record = summarize_with(normals_table(available=False))
    assert record["baselines"]["climate"] is None
    assert record["baselines"]["default"] == "recent"
    assert record["baselines"]["recent"] is not None


def test_the_monthly_chart_carries_both_normals():
    record = summarize_with(normals_table())
    month = record["monthly"][-1]
    assert month["normal_af"] is not None
    assert month["climate_normal_af"] == 2100.0


def test_the_monthly_chart_leaves_the_climate_line_empty_when_there_is_none():
    record = summarize_with(normals_table(available=False))
    assert all(month["climate_normal_af"] is None for month in record["monthly"])


def test_a_missing_normals_file_costs_the_climate_baseline_and_nothing_else():
    """The daily publish must survive the reference file being absent."""
    record = summarize_with({})
    assert record["baselines"]["climate"] is None
    assert record["baselines"]["default"] == "recent"
    assert record["current_storage_af"] == 1000.0


# --------------------------------------------------------------------------
# The committed file
# --------------------------------------------------------------------------

@pytest.mark.skipif(not (ROOT / "normals.json").exists(),
                    reason="normals.json has not been built in this checkout")
def test_the_committed_normals_file_matches_the_builder_that_writes_it():
    payload = json.loads((ROOT / "normals.json").read_text(encoding="utf-8"))
    assert payload["schema_version"] == B.SCHEMA_VERSION
    assert payload["period"]["start_year"] == B.CLIMATE_START_YEAR
    assert payload["period"]["end_year"] == B.CLIMATE_END_YEAR
    assert payload["window_days"] == R.SEASONAL_WINDOW_DAYS


@pytest.mark.skipif(not (ROOT / "normals.json").exists(),
                    reason="normals.json has not been built in this checkout")
def test_the_committed_normals_cover_every_reservoir_on_the_roster():
    """Covered means named, not necessarily available. A reservoir the builder
    could not reach must appear with its reason, so a silent omission and a
    known gap cannot look the same.

    Against the roster rather than `reservoirs.json`, and by station id
    rather than name (ADR-066): a reservoir withdrawn for a quiet feed
    (ADR-056) leaves the payload and keeps its thirty-year normal, and a
    test reading the payload would let that assertion retire with it."""
    normals = json.loads((ROOT / "normals.json").read_text(encoding="utf-8"))
    named = {str(r["source_station_id"]) for r in normals["reservoirs"]}
    for station in R.ALL_RESERVOIR_IDS:
        assert str(station) in named, R.RESERVOIR_NAMES[station]
    for record in normals["reservoirs"]:
        if not record["available"]:
            assert record["reason"], record["name"]


@pytest.mark.skipif(not (ROOT / "normals.json").exists(),
                    reason="normals.json has not been built in this checkout")
def test_the_climate_normals_hold_the_water():
    """The measurement that justified building this at all: the climate
    baseline has to cover the reservoirs that actually store the water, not
    just a majority of the names."""
    normals = json.loads((ROOT / "normals.json").read_text(encoding="utf-8"))
    published = json.loads((ROOT / "reservoirs.json").read_text(encoding="utf-8"))
    # By station id (ADR-066): a name-keyed capacity dict would keep only
    # the last of two reservoirs sharing a name.
    available = {str(r["source_station_id"])
                 for r in normals["reservoirs"] if r["available"]}
    capacity = {str(r["source_station_id"]): (r.get("capacity_af") or 0)
                for r in published["reservoirs"]}
    total = sum(capacity.values())
    covered = sum(size for station, size in capacity.items()
                  if station in available)
    assert total > 0
    assert covered / total > 0.95
