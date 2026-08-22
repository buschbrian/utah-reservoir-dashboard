"""Tests for refresh_reservoirs.py, run against synthetic series.

Deliberately does not touch the network: RISE is slow, rate-limited and
occasionally wrong, and none of that should decide whether CI is green.
_get_json is stubbed where the HTTP path itself is under test.

Run with `pytest tests/` or directly with `python tests/test_refresh.py`.
"""

import gzip
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import huc  # noqa: E402
import refresh_reservoirs as R  # noqa: E402

# The provider adapters live in `pipeline.providers`, re-exported through R.
# A stub has to replace the name the fetcher actually calls, so these tests
# patch `R.providers._get_json` rather than `R._get_json` -- patching the
# re-exported copy would leave the fetcher calling the real service.
PROVIDERS = R.providers


TODAY = R.local_today()


def test_committed_payload_uses_the_current_structure_version():
    """The checked file and the writer must advertise the same contract."""
    root = Path(__file__).resolve().parent.parent
    payload = json.loads((root / "reservoirs.json").read_text())
    assert payload["schema_version"] == R.RESERVOIR_SCHEMA_VERSION


def synthetic_series(stale_days: int = 0, start: str = "2015-01-01",
                     seed: int = 7, with_nulls: bool = False) -> pd.DataFrame:
    """A seasonal, gently declining daily storage series through today-stale_days."""
    rng = np.random.default_rng(seed)
    idx = pd.date_range(start, TODAY - pd.Timedelta(days=stale_days), freq="D")
    doy = idx.dayofyear.to_numpy()
    base = 50000 + 20000 * np.sin((doy - 100) / 365 * 2 * np.pi)
    trend = np.linspace(0, -12000, len(idx))
    values = base + trend + rng.normal(0, 300, len(idx))

    rows = [{"dateTime": d.isoformat(), "result": float(v)} for d, v in zip(idx, values)]
    if with_nulls:
        rows[-1]["result"] = None                 # trailing null
        rows[-2]["result"] = None
        rows.append(dict(rows[-1]))               # duplicate date, also null
    return _clean(rows)


def _clean(rows: list[dict]) -> pd.DataFrame:
    """Mirror of fetch_rise_series' cleaning, minus the HTTP."""
    df = pd.DataFrame(rows)
    df["date"] = pd.to_datetime(df["dateTime"], format="mixed", utc=True) \
                   .dt.tz_localize(None).dt.normalize()
    df["storage_af"] = pd.to_numeric(df["result"], errors="coerce")
    df = df.dropna(subset=["storage_af"])
    df = df[df["date"] <= TODAY]
    df = df.sort_values("date").drop_duplicates(subset="date", keep="last")
    return df[["date", "storage_af"]].reset_index(drop=True)


# --- cleaning -------------------------------------------------------------

def test_trailing_nulls_and_duplicate_dates_are_dropped():
    """A trailing null used to become the 'latest' reading and NaN every metric."""
    df = synthetic_series(with_nulls=True)
    assert df["storage_af"].notna().all()
    assert df["date"].is_unique


# --- headline metrics -----------------------------------------------------

def test_summarize_produces_a_complete_json_serializable_record():
    rec = R.summarize("Testwater", 999, 40.0, -111.0, synthetic_series(), TODAY)
    json.dumps(rec)  # no NaN/Infinity may leak into the output
    assert rec["days_stale"] == 0
    assert rec["is_stale"] is False
    assert rec["fetch_ok"] is True
    assert 0 <= rec["pct_of_record_max"] <= 100
    assert 0 <= rec["seasonal_percentile"] <= 100
    assert rec["change_30d_af"] is not None
    assert rec["change_365d_af"] is not None
    assert rec["pct_of_seasonal_normal"] is not None
    assert rec["peak_this_year_date"] is not None
    assert len(rec["monthly"]) == 12
    assert all(m["mean_af"] is not None for m in rec["monthly"])
    assert rec["monthly"][0]["normal_af"] is not None


def test_stale_series_is_flagged():
    rec = R.summarize("Frozen", 998, 40.0, -111.0, synthetic_series(stale_days=11), TODAY)
    assert rec["days_stale"] == 11
    assert rec["is_stale"] is True


def test_fresh_boundary_is_not_flagged():
    rec = R.summarize("Edge", 997, 40.0, -111.0,
                      synthetic_series(stale_days=R.STALE_AFTER_DAYS), TODAY)
    assert rec["is_stale"] is False


def test_monthly_source_uses_monthly_freshness_and_provenance():
    idx = pd.date_range("2015-01-31", TODAY - pd.offsets.MonthEnd(1), freq="ME")
    df = pd.DataFrame({"date": idx, "storage_af": np.linspace(5000, 4000, len(idx))})
    rec = R.summarize(
        "Monthly", None, 40.0, -111.0, df, TODAY,
        {"capacity_af": 10000, "capacity_basis": "awdb_reservoir_metadata"},
        source_key="awdb", source_label="USDA NRCS AWDB",
        data_frequency="monthly", stale_after_days=R.AWDB_MONTHLY_STALE_AFTER_DAYS,
        change_tolerance_days=45, source_station_id="TEST:UT:BOR")
    assert rec["source_key"] == "awdb"
    assert rec["source_station_id"] == "TEST:UT:BOR"
    assert rec["data_frequency"] == "monthly"
    assert rec["change_7d_af"] is None
    assert rec["change_30d_af"] is not None
    assert rec["is_stale"] is False


# --- metric corrections ---------------------------------------------------

def test_seasonal_percentile_excludes_the_current_year():
    """A record low for this week must be able to read as 0.

    When the current year was part of the comparison population, the value
    was being compared against itself, so the floor was above zero no matter
    how bad the year got.
    """
    idx = pd.date_range("2015-01-01", TODAY, freq="D")
    # Every prior year sits at 1000; the current year collapses to 10.
    values = np.where(idx.year < TODAY.year, 1000.0, 10.0)
    series = pd.Series(values, index=idx)
    assert R.seasonal_percentile(series, TODAY, 10.0) == 0.0


def test_seasonal_percentile_is_none_without_prior_years():
    """A first-year reservoir has nothing to rank against; say so, don't invent."""
    idx = pd.date_range(f"{TODAY.year}-01-01", TODAY, freq="D")
    series = pd.Series(np.linspace(100, 50, len(idx)), index=idx)
    assert np.isnan(R.seasonal_percentile(series, TODAY, 50.0))

    df = pd.DataFrame({"date": idx, "storage_af": series.to_numpy()})
    rec = R.summarize("Brand New", 996, 40.0, -111.0, df, TODAY)
    assert rec["seasonal_percentile"] is None
    assert rec["seasonal_normal_af"] is None
    assert rec["seasonal_sample_years"] == 0
    json.dumps(rec)


def test_seasonal_normal_uses_prior_years_only():
    """The normal is a climatology; this year must not drag it down."""
    idx = pd.date_range("2015-01-01", TODAY, freq="D")
    values = np.where(idx.year < TODAY.year, 1000.0, 10.0)
    series = pd.Series(values, index=idx)
    df = pd.DataFrame({"date": idx, "storage_af": series.to_numpy()})
    rec = R.summarize("Collapsed", 995, 40.0, -111.0, df, TODAY)
    assert rec["seasonal_normal_af"] == 1000.0
    assert rec["pct_of_seasonal_normal"] == 1.0
    assert rec["seasonal_sample_years"] == TODAY.year - 2015


def test_seasonal_window_wraps_correctly_across_a_leap_year():
    """The wrap-around used a flat 365, shifting the window in leap years."""
    idx = pd.date_range("2024-12-20", "2025-01-10", freq="D")  # 2024 is a leap year
    series = pd.Series(1.0, index=idx)
    window = R.seasonal_window(series, pd.Timestamp("2025-01-01"), window_days=3)
    assert set(window.index.date) == {
        d.date() for d in pd.date_range("2024-12-29", "2025-01-04", freq="D")
    }


# --- one calendar date, one position in every year -------------------------

def test_the_same_calendar_date_matches_in_every_year():
    """A window centred on 19 August must hold every 19 August.

    It did not. `dayofyear` makes 19 August day 231 in an ordinary year and
    232 in a leap year, so a zero-width window centred on 19 August 2026
    excluded 19 August 2024 outright, and a seven-day one was centred on 18
    August for every leap year in the record. Every date after February was
    affected, which is most of the year and all of the melt season.
    """
    dates = pd.DatetimeIndex(
        [f"{year}-08-19" for year in range(2015, 2027)])
    series = pd.Series(1.0, index=dates)
    window = R.seasonal_window(series, pd.Timestamp("2026-08-19"), window_days=0)
    assert set(window.index.date) == set(dates.date)


def test_the_canonical_year_is_the_same_length_every_year():
    """Every year has 365 positions, which is what makes the wrap one constant."""
    for year in (2023, 2024, 2100, 2000):
        days = pd.date_range(f"{year}-01-01", f"{year}-12-31", freq="D")
        positions = R.canonical_day(days)
        assert positions.min() == 1
        assert positions.max() == R.CANONICAL_YEAR_DAYS


def test_february_29_takes_february_28s_position():
    """It has to take one. Nothing is dropped and nothing else moves."""
    leap = pd.DatetimeIndex(["2024-02-28", "2024-02-29", "2024-03-01"])
    positions = R.canonical_day(leap)
    assert positions[0] == positions[1], "29 February shares 28 February's slot"
    assert positions[2] == positions[0] + 1, "1 March is still the next position"

    # And both February days reach a window centred on 28 February.
    series = pd.Series([1.0, 2.0, 3.0], index=leap)
    window = R.seasonal_window(series, pd.Timestamp("2026-02-28"), window_days=0)
    assert sorted(window.to_numpy().tolist()) == [1.0, 2.0]


def test_a_single_timestamp_and_an_index_agree():
    """The two forms are one rule; a reader of either must get the same answer."""
    dates = pd.date_range("2024-01-01", "2025-12-31", freq="D")
    from_index = R.canonical_day(dates)
    for offset in (0, 58, 59, 60, 200, 365, 366, 500):
        moment = dates[offset]
        assert R.canonical_day(moment) == from_index[offset], str(moment.date())


def test_the_normal_table_is_read_at_the_position_it_was_built_at():
    """The table and the lookup were one day apart for most of the year.

    The table was built by iterating a leap year and read by `dayofyear`, so
    entry 231 was built from 18 August and read for every 19 August in an
    ordinary year. Built here from a flat series so the medians cannot hide a
    shift, and checked on the position rather than the value.
    """
    import tools.build_normal_baselines as B
    index = pd.date_range("1991-01-01", "2020-12-31", freq="D")
    # A ramp, so every position has a different value and an off-by-one shows.
    series = pd.Series(range(len(index)), index=index, dtype="float64")
    table = B.day_of_year_normals(series)

    for date in ("2026-08-19", "2026-03-01", "2026-12-31", "2026-01-01"):
        moment = pd.Timestamp(date)
        day = R.canonical_day(moment)
        expected = R.annual_seasonal_values(series, moment).median()
        assert table["median_af"][day] == round(float(expected), 2), date


def test_seasonal_window_default_comes_from_the_published_constant():
    idx = pd.date_range("2025-06-01", "2025-06-30", freq="D")
    series = pd.Series(1.0, index=idx)
    default_window = R.seasonal_window(series, pd.Timestamp("2026-06-15"))
    explicit_window = R.seasonal_window(
        series, pd.Timestamp("2026-06-15"), R.SEASONAL_WINDOW_DAYS)
    pd.testing.assert_series_equal(default_window, explicit_window)


def test_normal_period_follows_the_configured_start_and_run_year():
    assert R.normal_period(pd.Timestamp("2026-08-14")) == {
        "start_year": pd.Timestamp(R.START_DATE).year,
        "end_year": 2025,
    }


def test_local_today_is_mountain_time():
    """days_stale is compared against local dates, so today must be local too."""
    expected = pd.Timestamp.now(R.LOCAL_TZ).normalize().tz_localize(None)
    assert R.local_today() == expected


# --- capacity -------------------------------------------------------------

def test_capacity_produces_percent_full():
    capacity = {"capacity_af": 200000.0, "capacity_basis": "normal_storage"}
    idx = pd.date_range("2015-01-01", TODAY, freq="D")
    series = np.full(len(idx), 100000.0)
    df = pd.DataFrame({"date": idx, "storage_af": series})
    rec = R.summarize("Halffull", 1, 40.0, -111.0, df, TODAY, capacity)
    assert rec["capacity_af"] == 200000.0
    assert rec["capacity_basis"] == "normal_storage"
    assert rec["pct_of_capacity"] == 50.0
    # record max is the observed series, so the two denominators differ
    assert rec["pct_of_record_max"] == 100.0
    json.dumps(rec)


def test_missing_capacity_is_null_not_guessed():
    """No capacity must mean no percent-full, not a silent fallback number."""
    rec = R.summarize("Unknown", 1, 40.0, -111.0, synthetic_series(), TODAY, None)
    assert rec["capacity_af"] is None
    assert rec["pct_of_capacity"] is None
    assert rec["pct_of_record_max"] is not None
    json.dumps(rec)


def test_committed_capacity_table_covers_every_reservoir():
    """Guards the table the dashboards divide by."""
    path = Path(__file__).resolve().parent.parent / "capacities.json"
    payload = json.loads(path.read_text())
    caps = payload["capacities"]
    assert set(R.BASE_RISE_RESERVOIRS) <= set(caps), (
        "capacity table does not cover every original RISE site")
    assert set(R.RESERVOIRS) <= set(R.load_capacities()), (
        "reviewed capacity evidence does not cover every RISE site")
    assert "National Inventory of Dams" in payload["source"]

    published = R.load_previous(R.OUTPUT_PATH)
    for station, entry in caps.items():
        name = entry.get("name", station)
        assert entry["capacity_af"] > 0
        assert entry["capacity_basis"] in {"normal_storage", "max_storage", "nid_storage"}
        assert entry["nid_id"], f"{name} has no NID id to trace back to"
        # The check that catches a mis-matched dam: we have watched these
        # reservoirs since 2015, so a capacity below the storage we have
        # actually seen in one means the wrong row got attached. Looked up by
        # station since ADR-066, so a name shared with another reservoir
        # cannot bring that one's record max to this one's capacity.
        observed = (published.get(station) or {}).get("record_max_af")
        if observed:
            assert entry["capacity_af"] >= observed * 0.9, (
                f"{name}: capacity {entry['capacity_af']:,.0f} af is below the "
                f"observed record max {observed:,.0f} af")


def test_awdb_inventory_has_traceable_capacity_and_cadence():
    assert len(R.BASE_AWDB_RESERVOIRS) == 25
    # 15 before R1; +133 admitted from the AWDB-west pool (137 the rules
    # admitted, minus Lake Mead -- a tool bug, already published -- Lemon
    # Reservoir CO -- D10, self-contradicting source record -- Eden WY and
    # Fruitland Reservoir CO -- both excluded dam matches -- minus Elkhead
    # Reservoir, already on the roster and not a new admission).
    assert len(R.ADMITTED_RESERVOIRS) == 148
    assert len(R.AWDB_RESERVOIRS) == 173
    assert len(R.ADMITTED_RISE_RESERVOIRS) == 25
    assert len(R.RESERVOIRS) == 55
    # R3's first source: 137 the rules admitted, plus five a person admitted
    # against a screen -- Lake Mohave and San Luis on reviewed dam evidence,
    # Martis Creek and Seven Oaks as flood-control dams held empty on
    # purpose, and Morena as a real reservoir that is simply low. Each
    # carries the screen it was admitted against in the file itself.
    assert len(R.ADMITTED_CDEC_RESERVOIRS) == 142
    assert len(R.CDEC_RESERVOIRS) == 142
    assert sum(1 for row in R.ADMITTED_CDEC_RESERVOIRS.values()
               if row.get("review")) == 5
    # R3's second state source: ten of the thirteen in-scope candidates the
    # Colorado audit screened -- three held with findings in the file itself
    # (Ivanhoe and Trout Lake above their own record's largest pool; Garnet
    # Mesa without a usable history yet), and one more candidate refused by
    # the same screens before review. Ninety-four of the service's storage
    # stations sit east of the drawn drainages and are nobody's candidate
    # until the drawn scope reaches the Missouri basin.
    assert len(R.ADMITTED_CDSS_RESERVOIRS) == 10
    assert len(R.CDSS_RESERVOIRS) == 10
    # Seven more with the U.S. Geological Survey's admission (ADR-080):
    # Horseshoe, Bartlett, Weber, Wynoochee, Alder, Mud Mountain, Lake Tapps.
    assert len(R.ALL_RESERVOIR_IDS) == 387
    assert not (set(R.RESERVOIRS) & set(R.AWDB_RESERVOIRS))
    # Five providers, five disjoint sets of station ids. An id in two of
    # them is one reservoir fetched twice and summed twice (ADR-069).
    assert not (set(R.CDEC_RESERVOIRS)
                & (set(R.RESERVOIRS) | set(R.AWDB_RESERVOIRS)))
    assert not (set(R.CDSS_RESERVOIRS)
                & (set(R.RESERVOIRS) | set(R.AWDB_RESERVOIRS)
                   | set(R.CDEC_RESERVOIRS)))
    for triplet, (name, lat, lon, capacity, cadence) in R.AWDB_RESERVOIRS.items():
        assert name
        assert triplet.count(":") == 2
        # west-huc6's own box (`DRAWN_BOUNDS`, src/viz/extent.ts), not the
        # narrower Utah-connected one this bound used before R1: the AWDB
        # west pool reaches Puget Sound and the Upper Sacramento.
        assert 29.5 <= lat <= 53 and -125 <= lon <= -105
        assert capacity > 0
        assert cadence in {"daily", "monthly"}

    # Keyed by station, and every station is its own row: a name-keyed roster
    # silently collapsed two reservoirs sharing one (ADR-066).
    assert len(R.RESERVOIR_NAMES) == len(R.ALL_RESERVOIR_IDS)

    for station, row in R.ADMITTED_RESERVOIRS.items():
        name = row["name"]
        assert row["station_triplet"] == station
        evidence = row["capacity"]
        assert evidence["nid_id"], f"{name} has no dam inventory identifier"
        assert evidence["nid_dam_name"], f"{name} has no matched dam name"
        assert evidence["match_distance_km"] <= 25
        assert evidence["match_confirmed_by"] in {"position", "name and position"}
        assert evidence["capacity_basis"] in {
            "normal_storage", "max_storage", "nid_storage"
        }

    for item_id, row in R.ADMITTED_RISE_RESERVOIRS.items():
        assert str(row["rise_item_id"]) == item_id
        assert row["cadence"] == "daily"
        evidence = row["capacity"]
        assert evidence["nid_id"], f"{row['name']} has no dam inventory identifier"
        assert evidence["nid_dam_name"]
        assert evidence["match_distance_km"] <= 25
        assert evidence["capacity_basis"] in {
            "normal_storage", "max_storage", "nid_storage",
            "reclamation_project_record",
        }
        if evidence["capacity_basis"] == "reclamation_project_record":
            assert evidence["capacity_source_url"].startswith("https://www.usbr.gov/")

    overrides = {
        row["name"]: row["capacity"]
        for row in R.ADMITTED_RISE_RESERVOIRS.values()
        if row["capacity"]["capacity_basis"] == "reclamation_project_record"
    }
    assert set(overrides) == {"Billy Clapp Lake", "Keswick Reservoir", "Lake Cachuma"}
    for evidence in overrides.values():
        assert evidence["capacity_source"]
        assert evidence["capacity_source_checked"] == "2026-08-20"


def test_admitted_inventory_lands_at_its_reviewed_dam_point():
    """Every admitted station's stored drainage area has to match where its
    reviewed dam point actually sits -- a roster entry with the wrong huc6
    is a reservoir the map opens away from (`src/viz/extent.ts`), and the
    only way to notice is to check the geography directly rather than trust
    a hand-copied field. San Carlos Reservoir (AZ) is why this checks the
    raw assignment rather than `describe()`'s divide-aware one: its dam
    point sits 66 m from the Upper Gila/Middle Gila line, inside `huc.
    MIN_ASSIGNMENT_MARGIN_KM`, and its published point is too close to the
    same line for the fallback to resolve it either -- see BOUNDARY_MARGIN_
    EXCEPTIONS in tests/test_huc.py.

    Before R1 this fit in one dict: three areas, fifteen reservoirs, matching
    the admission review word for word (ADR-023). R1's AWDB-west pool spans
    dozens of areas across five hydrologic regions, so a literal count per
    area would just be a second copy of the roster -- the per-row assignment
    check above is what actually catches a wrong huc6, and the area count
    below is a loose regression guard rather than a re-statement of the
    roster.
    """
    units = R.huc.load_units()
    seen_areas = set()
    for roster in (R.ADMITTED_RESERVOIRS, R.ADMITTED_RISE_RESERVOIRS):
        for row in roster.values():
            capacity = row["capacity"]
            assigned = R.huc.assign_huc(
                (capacity["dam_lon"], capacity["dam_lat"]), units)
            assert assigned and assigned["huc6"] == row["huc6"], row["name"]
            seen_areas.add(row["huc6"])
    # 3 areas before R1; 36 after, well above this bound -- a drop back
    # toward the old count would mean the admitted pool stopped being
    # western, not that the roster shrank a little.
    assert len(seen_areas) >= 30


# --- degenerate inputs ----------------------------------------------------

def test_short_series_has_no_year_over_year_change_and_no_normals():
    df = synthetic_series()
    df = df[df["date"] >= TODAY - pd.Timedelta(days=120)]
    rec = R.summarize("Newish", 994, 40.0, -111.0, df, TODAY)
    json.dumps(rec)
    assert rec["change_365d_af"] is None
    assert len(rec["monthly"]) <= 5
    assert all(m["normal_af"] is None for m in rec["monthly"])


def test_single_observation_series_does_not_crash():
    df = synthetic_series().tail(1).reset_index(drop=True)
    rec = R.summarize("OnePoint", 993, 40.0, -111.0, df, TODAY)
    json.dumps(rec)
    assert rec["pct_of_record_max"] == 100.0
    assert len(rec["monthly"]) == 1


# --- carry-forward --------------------------------------------------------

def test_carry_forward_preserves_values_and_marks_the_failure():
    """A reservoir we can't fetch keeps its last record instead of vanishing."""
    previous = R.summarize("Frozen", 992, 40.0, -111.0,
                           synthetic_series(stale_days=11), TODAY)
    carried = R.carry_forward(previous, TODAY, "fetch failed: boom")
    assert carried["current_storage_af"] == previous["current_storage_af"]
    assert carried["fetch_ok"] is False
    assert carried["is_stale"] is True
    assert carried["days_stale"] == 11
    assert "boom" in carried["fetch_error"]


# --- withdrawal for age (ADR-056) ----------------------------------------

def test_a_record_inside_the_window_is_published_and_one_past_it_is_not():
    """The boundary is exclusive: exactly WITHDRAW_AFTER_DAYS still counts."""
    window = R.WITHDRAW_AFTER_DAYS
    records = [
        {"name": "Fresh", "days_stale": 0},
        {"name": "Late", "days_stale": window - 1},
        {"name": "On the line", "days_stale": window},
        {"name": "A season behind", "days_stale": window + 1},
    ]
    published, withdrawn = R.partition_by_age(records)
    assert [r["name"] for r in published] == ["Fresh", "Late", "On the line"]
    assert [r["name"] for r in withdrawn] == ["A season behind"]


def test_withdrawal_sorts_the_worst_first():
    records = [{"name": "A", "days_stale": 70}, {"name": "B", "days_stale": 400},
               {"name": "C", "days_stale": 90}]
    _, withdrawn = R.partition_by_age(records)
    assert [r["name"] for r in withdrawn] == ["B", "C", "A"]


def test_a_reservoir_that_never_fetched_is_published_not_withdrawn():
    """A missing age is a different fault with a different remedy.

    Withdrawing on a null would hide a configuration error behind the
    mechanism built for a quiet feed, and `fetch_ok` already reports it.
    """
    published, withdrawn = R.partition_by_age([{"name": "Never", "days_stale": None}])
    assert [r["name"] for r in published] == ["Never"]
    assert withdrawn == []


def test_the_withdrawal_notice_carries_no_measurement():
    """The whole point is that this figure is not published."""
    record = R.summarize("Gone", 993, 40.0, -111.0,
                         synthetic_series(stale_days=200), TODAY)
    notice = R.withdrawal_notice(record)
    assert notice["name"] == "Gone"
    assert notice["days_stale"] == 200
    for key in ("current_storage_af", "pct_of_record_max", "monthly",
                "record_max_af", "baselines"):
        assert key not in notice, key


# --- previous-output loading ---------------------------------------------


# --- carrying a withdrawal through a partial refresh (ADR-056) -----------

RISE = "Bureau of Reclamation RISE"
AWDB = "USDA NRCS AWDB"

AWDB_NOTICE = {
    "name": "Montpelier Reservoir",
    "as_of": "2025-04-30",
    "days_stale": 477,
    "source_label": AWDB,
    "reason": "no reading inside the publication window",
}


def _previous_payload(path, reservoirs, withdrawn):
    """Write the shape a morning's run leaves behind: roster, then notices."""
    path.write_text(json.dumps({
        "withdraw_after_days": R.WITHDRAW_AFTER_DAYS,
        "withdrawn_count": len(withdrawn),
        "withdrawn": withdrawn,
        "reservoirs": reservoirs,
    }))
    return path


def _single_source_run(path, fetched, refreshed=(RISE,), today=TODAY):
    """Replay what `--source <one>` does: merge, partition, carry, state.

    These are main()'s own steps in main()'s order, ending where the envelope
    does -- with notices rather than records -- so a failure here is the
    failure the pipeline would publish. `refreshed` is what main() reads off
    the records it fetched: the labels of the feeds it actually spoke to.
    """
    previous = R.load_previous(path)
    stations = {r["source_station_id"] for r in fetched}
    records = list(fetched)
    records.extend(record for station, record in previous.items()
                   if station not in stations)
    records, withdrawn = R.partition_by_age(records)
    withdrawn.extend(R.carry_withdrawals(
        R.load_previous_withdrawals(path), set(refreshed), today))
    withdrawn.sort(key=lambda r: -(r.get("days_stale") or 0))
    return records, [R.withdrawal_notice(r) for r in withdrawn]


def test_a_single_source_merge_keeps_the_other_sources_withdrawal_notices(tmp_path):
    """ADR-056: a withdrawal is always stated, partial refresh or not.

    A withdrawn reservoir is not in `reservoirs`, so the merge that carries
    the unrefreshed source cannot see it, and `partition_by_age` cannot
    re-derive the notice from a record that is not there -- the notice holds
    no reading, which is the point of it. Until it was carried here, a
    single-source run wrote `withdrawn_count: 0` and silently stopped naming
    five reservoirs with nothing having happened to them, which is precisely
    the silence ADR-056 exists to prevent.
    """
    path = _previous_payload(
        tmp_path / "reservoirs.json",
        reservoirs=[{"name": "Deer Creek", "source_station_id": "919",
                     "source_label": RISE, "days_stale": 1}],
        withdrawn=[AWDB_NOTICE])

    records, withdrawn = _single_source_run(
        path,
        fetched=[{"name": "Deer Creek", "source_station_id": "919",
                  "source_label": RISE, "days_stale": 0, "fetch_ok": True}],
        refreshed=[RISE])

    assert [r["name"] for r in records] == ["Deer Creek"]
    assert [n["name"] for n in withdrawn] == ["Montpelier Reservoir"]
    assert withdrawn[0]["source_label"] == AWDB
    assert withdrawn[0]["days_stale"] > R.WITHDRAW_AFTER_DAYS


def test_a_carried_notice_still_carries_no_measurement(tmp_path):
    """Carrying it forward must not smuggle back what withdrawing removed."""
    path = _previous_payload(
        tmp_path / "reservoirs.json", reservoirs=[],
        withdrawn=[{**AWDB_NOTICE, "current_storage_af": 1200.0,
                    "pct_of_record_max": 12.0}])

    _, withdrawn = _single_source_run(path, fetched=[])

    assert withdrawn[0]["name"] == "Montpelier Reservoir"
    for key in ("current_storage_af", "pct_of_record_max"):
        assert key not in withdrawn[0], key


def test_the_refreshed_sources_own_notices_are_not_carried(tmp_path):
    """This run attempted every station of the feed it refreshed.

    Whatever those reservoirs did, they have been answered for: published if
    they came back, written into `withdrawn` from today's reading if they did
    not. Carrying the old notice would state one of them twice.
    """
    path = _previous_payload(
        tmp_path / "reservoirs.json", reservoirs=[],
        withdrawn=[AWDB_NOTICE, {**AWDB_NOTICE, "name": "Elkhead Reservoir",
                                 "source_label": RISE}])

    _, only_awdb = _single_source_run(path, fetched=[], refreshed=[RISE])
    _, only_rise = _single_source_run(path, fetched=[], refreshed=[AWDB])

    assert [n["name"] for n in only_awdb] == ["Montpelier Reservoir"]
    assert [n["name"] for n in only_rise] == ["Elkhead Reservoir"]


def test_a_reservoir_this_run_republished_is_not_also_withdrawn(tmp_path):
    """The station came back, so its old notice is history, not news."""
    path = _previous_payload(
        tmp_path / "reservoirs.json", reservoirs=[], withdrawn=[AWDB_NOTICE])

    records, withdrawn = _single_source_run(
        path,
        fetched=[{"name": "Montpelier Reservoir", "source_label": AWDB,
                  "source_station_id": "10069500:ID:BOR", "days_stale": 0,
                  "fetch_ok": True}],
        refreshed=[AWDB])

    assert [r["name"] for r in records] == ["Montpelier Reservoir"]
    assert withdrawn == []


def test_a_reservoir_this_run_refetched_and_still_withdrew_is_stated_once(tmp_path):
    """Re-derived from today's reading, not stated twice from two places."""
    path = _previous_payload(
        tmp_path / "reservoirs.json", reservoirs=[], withdrawn=[AWDB_NOTICE])

    age = R.WITHDRAW_AFTER_DAYS + 9
    records, withdrawn = _single_source_run(
        path,
        fetched=[{"name": "Montpelier Reservoir", "source_label": AWDB,
                  "source_station_id": "10069500:ID:BOR",
                  "as_of": str((TODAY - pd.Timedelta(days=age)).date()),
                  "days_stale": age}],
        refreshed=[AWDB])

    assert records == []
    assert [n["name"] for n in withdrawn] == ["Montpelier Reservoir"]
    assert withdrawn[0]["days_stale"] == age


def test_a_carried_notice_names_the_age_its_own_date_implies(tmp_path):
    """`as_of` and `days_stale` are one fact printed twice.

    Left at the value the notice was written with, a reservoir carried for a
    week says it is 477 days late beside a date 484 days ago. Recomputing is
    a subtraction over a date the notice already publishes; the reading it
    was withdrawn for is still not published.
    """
    path = _previous_payload(
        tmp_path / "reservoirs.json", reservoirs=[], withdrawn=[AWDB_NOTICE])

    _, withdrawn = _single_source_run(path, fetched=[])

    expected = int((TODAY - pd.Timestamp("2025-04-30")).days)
    assert withdrawn[0]["days_stale"] == expected
    assert withdrawn[0]["as_of"] == "2025-04-30"


def test_the_worst_withdrawal_is_stated_first_however_it_arrived(tmp_path):
    """A carried notice and a re-derived one sort together, not in blocks."""
    path = _previous_payload(
        tmp_path / "reservoirs.json", reservoirs=[],
        withdrawn=[{**AWDB_NOTICE, "name": "Carried far",
                    "as_of": "2016-09-30"},
                   {**AWDB_NOTICE, "name": "Carried near",
                    "as_of": "2025-04-30"}])

    # Measured from the near notice's own date rather than written down, so
    # the ordering this asserts cannot come apart as the calendar moves.
    between = int((TODAY - pd.Timestamp("2025-04-30")).days) + 1
    _, withdrawn = _single_source_run(
        path,
        fetched=[{"name": "Refetched", "source_station_id": "c",
                  "source_label": RISE,
                  "as_of": str((TODAY - pd.Timedelta(days=between)).date()),
                  "days_stale": between}],
        refreshed=[RISE])

    assert [n["name"] for n in withdrawn] == [
        "Carried far", "Refetched", "Carried near"]


def test_a_notice_naming_a_source_this_run_cannot_see_is_kept(tmp_path):
    """An older payload, or a feed since renamed.

    Kept, because the cost of holding one notice too long is a reader told
    about a reservoir that is not there, and the cost of dropping it is the
    silence ADR-056 was written against.
    """
    path = _previous_payload(
        tmp_path / "reservoirs.json", reservoirs=[],
        withdrawn=[{**AWDB_NOTICE, "source_label": "A feed since renamed"},
                   {k: v for k, v in AWDB_NOTICE.items() if k != "source_label"}])

    _, withdrawn = _single_source_run(path, fetched=[], refreshed=[RISE, AWDB])

    assert len(withdrawn) == 2


def test_the_partial_refresh_path_actually_carries_the_notices():
    """The helper above replays main()'s steps; this holds main() to them.

    Every test in this section drives the functions rather than the run, which
    is what makes them fast and free of the network -- and would let the whole
    behaviour be correct while `main` never called it. A source check, for the
    same reason `deploy.test.ts` reads a workflow: the property is that the
    partial-refresh branch reaches the carry, and nothing else can see it.
    """
    source = (Path(__file__).resolve().parent.parent
              / "refresh_reservoirs.py").read_text(encoding="utf-8")
    body = source[source.index("def main("):]
    partial = body[body.index("records, withdrawn = partition_by_age(records)"):]

    assert "carry_withdrawals(" in partial
    assert "load_previous_withdrawals(OUTPUT_PATH)" in partial
    # Sorted after the carry, or the worst withdrawal is not stated first
    # whenever a carried notice is the worst one.
    assert partial.index("carry_withdrawals(") < partial.index("withdrawn.sort(")


def test_load_previous_withdrawals_survives_every_shape_it_may_meet(tmp_path):
    """It reads the file `load_previous` reads, and fails the same way."""
    broken = tmp_path / "broken.json"
    broken.write_text("{not json")
    array_shaped = tmp_path / "array.json"
    array_shaped.write_text(json.dumps([{"name": "A"}]))
    pre_adr = tmp_path / "old.json"
    pre_adr.write_text(json.dumps({"reservoirs": []}))
    stated = tmp_path / "stated.json"
    _previous_payload(stated, reservoirs=[], withdrawn=[AWDB_NOTICE])

    assert R.load_previous_withdrawals(tmp_path / "missing.json") == []
    assert R.load_previous_withdrawals(broken) == []
    assert R.load_previous_withdrawals(array_shaped) == []
    assert R.load_previous_withdrawals(pre_adr) == []
    assert [n["name"] for n in R.load_previous_withdrawals(stated)] == [
        "Montpelier Reservoir"]

def test_load_previous_accepts_both_file_shapes_and_survives_garbage(tmp_path):
    """Indexed by station id since ADR-066. This is what `carry_forward`
    reads, so a name index would republish one reservoir's last reading under
    another reservoir's name the morning a same-named station failed."""
    array_file = tmp_path / "array.json"
    array_file.write_text(json.dumps(
        [{"name": "A", "source_station_id": "1", "as_of": "2026-01-01"}]))
    envelope_file = tmp_path / "envelope.json"
    envelope_file.write_text(json.dumps({"reservoirs": [
        {"name": "B", "source_station_id": "2:UT:BOR", "as_of": "2026-01-01"}]}))
    broken_file = tmp_path / "broken.json"
    broken_file.write_text("{not json")

    assert set(R.load_previous(array_file)) == {"1"}
    assert set(R.load_previous(envelope_file)) == {"2:UT:BOR"}
    assert R.load_previous(broken_file) == {}
    assert R.load_previous(tmp_path / "missing.json") == {}


def test_two_reservoirs_sharing_a_name_keep_their_own_last_reading(tmp_path):
    """The failure a name index cannot even represent: both records survive,
    and each carries its own storage rather than the last one written."""
    payload = tmp_path / "both.json"
    payload.write_text(json.dumps({"reservoirs": [
        {"name": "Lost Creek", "source_station_id": "544",
         "current_storage_af": 22510.0},
        {"name": "Lost Creek", "source_station_id": "14335040:OR:BOR",
         "current_storage_af": 465000.0},
    ]}))

    previous = R.load_previous(payload)

    assert set(previous) == {"544", "14335040:OR:BOR"}
    assert previous["544"]["current_storage_af"] == 22510.0
    assert previous["14335040:OR:BOR"]["current_storage_af"] == 465000.0


# --- pagination -----------------------------------------------------------

def test_pagination_stops_on_an_empty_page_despite_lying_meta(monkeypatch):
    """meta claiming a million rows must not out-vote an empty page."""
    calls = {"n": 0}

    def fake_get(params):
        calls["n"] += 1
        data = [] if params["page"] > 3 else [
            {"attributes": {"dateTime": f"2015-01-{i + 1:02d}T00:00:00Z", "result": 1.0}}
            for i in range(3)
        ]
        return {"data": data, "meta": {"itemsPerPage": 2000, "totalItems": 999999}}

    monkeypatch.setattr(R.providers, "_get_json", fake_get)
    frame = R.fetch_rise_series(1, "20150101", "20260810")
    assert calls["n"] == 4
    assert len(frame) == 3


def test_pagination_stops_when_meta_is_missing(monkeypatch):
    calls = {"n": 0}

    def fake_get(params):
        calls["n"] += 1
        return {"data": [{"attributes": {"dateTime": "2015-01-01T00:00:00Z", "result": 5.0}}]}

    monkeypatch.setattr(R.providers, "_get_json", fake_get)
    R.fetch_rise_series(1, "20150101", "20260810")
    assert calls["n"] == 1


def test_pagination_is_bounded(monkeypatch):
    """Even a server that always claims more must not loop forever."""
    calls = {"n": 0}

    def fake_get(params):
        calls["n"] += 1
        return {
            "data": [{"attributes": {"dateTime": "2015-01-01T00:00:00Z", "result": 5.0}}],
            "meta": {"itemsPerPage": 1, "totalItems": 10 ** 9},
        }

    monkeypatch.setattr(R.providers, "_get_json", fake_get)
    R.fetch_rise_series(1, "20150101", "20260810")
    assert calls["n"] == R.MAX_PAGES


def test_awdb_monthly_values_become_month_end_rows(monkeypatch):
    monkeypatch.setattr(R.providers, "_get_awdb_json", lambda params: [{
        "stationTriplet": "TEST:UT:BOR",
        "data": [{"values": [
            {"year": 2026, "month": 6, "value": 1234},
            {"year": 2026, "month": 7, "value": 1100},
        ]}],
    }])
    frame = R.fetch_awdb_series("TEST:UT:BOR", "monthly", "20260101", "20260810")
    assert frame["date"].dt.strftime("%Y-%m-%d").tolist() == ["2026-06-30", "2026-07-31"]
    assert frame["storage_af"].tolist() == [1234, 1100]


# --- California Data Exchange Center --------------------------------------

def cdec_row(date, value, dur="D"):
    return {"stationId": "SHA", "durCode": dur, "SENSOR_NUM": 15,
            "sensorType": "STORAGE", "date": date, "obsDate": date,
            "value": value, "dataFlag": " ", "units": "AF"}


def test_cdec_drops_the_missing_sentinel_rather_than_reading_it(monkeypatch):
    """`-9999` is a number, and it is the most dangerous fact about this source.

    Measured on 2026-08-20 across a week and all 238 storage stations, 537 of
    1,435 values were this and none were null -- 37%, the ordinary shape of
    the data. A reader that treats the field as a measurement subtracts ten
    thousand acre-feet from whatever total it lands in.
    """
    monkeypatch.setattr(R.providers, "_get_cdec_json", lambda params: [
        cdec_row("2026-8-10 00:00", 2897658),
        cdec_row("2026-8-11 00:00", R.CDEC_MISSING_VALUE),
        cdec_row("2026-8-12 00:00", 2865715),
    ])
    frame = R.fetch_cdec_series("SHA", "daily", "20260801", "20260821")

    assert frame["date"].dt.strftime("%Y-%m-%d").tolist() == ["2026-08-10", "2026-08-12"]
    assert frame["storage_af"].tolist() == [2897658.0, 2865715.0]
    # Dropped, never converted: a row for the 11th at any value would mean the
    # sentinel had been read as a measurement.
    assert R.CDEC_MISSING_VALUE not in frame["storage_af"].tolist()
    assert 0 not in frame["storage_af"].tolist()


def test_cdec_keeps_a_true_zero(monkeypatch):
    """An empty reservoir is a reading. Only the sentinel is not."""
    monkeypatch.setattr(R.providers, "_get_cdec_json", lambda params: [
        cdec_row("2026-8-10 00:00", 0),
    ])
    frame = R.fetch_cdec_series("SHA", "daily", "20260801", "20260821")
    assert frame["storage_af"].tolist() == [0.0]


def test_cdec_reads_the_unpadded_dates_this_service_writes(monkeypatch):
    """They arrive as `2026-8-10 00:00`, which is neither ISO nor padded.

    Both a one-digit and a two-digit month, because an unpadded format is
    where a fixed-width parse quietly reads the wrong field. Dated in the past
    on purpose -- a future row is dropped by a different rule, asserted below.
    """
    monkeypatch.setattr(R.providers, "_get_cdec_json", lambda params: [
        cdec_row("2025-1-5 00:00", 100),
        cdec_row("2025-11-5 00:00", 200),
    ])
    frame = R.fetch_cdec_series("SHA", "daily", "20250101", "20251231")
    assert frame["date"].dt.strftime("%Y-%m-%d").tolist() == ["2025-01-05", "2025-11-05"]


def test_cdec_answers_the_same_contract_as_the_other_providers(monkeypatch):
    """Sorted, deduplicated to the last reading, and nothing after today."""
    later = (R.local_today() + pd.Timedelta(days=3)).strftime("%Y-%-m-%-d 00:00")
    monkeypatch.setattr(R.providers, "_get_cdec_json", lambda params: [
        cdec_row("2026-8-12 00:00", 300),
        cdec_row("2026-8-10 00:00", 100),
        cdec_row("2026-8-10 00:00", 111),
        cdec_row(later, 999),
    ])
    frame = R.fetch_cdec_series("SHA", "daily", "20260801", "20261231")
    assert frame["date"].dt.strftime("%Y-%m-%d").tolist() == ["2026-08-10", "2026-08-12"]
    assert frame["storage_af"].tolist() == [111.0, 300.0], "last reading wins"


def test_a_cdec_monthly_reading_is_dated_the_end_of_the_month_it_measures(monkeypatch):
    """The stamp names the month; the value is that month's last day.

    Verified against the service itself: Oroville's monthly value dated
    `2026-6-1` is 3,082,292 acre-feet, which is its daily reading for 30 June
    -- 1 June was 3,327,054. Every date this pipeline publishes means when the
    water was measured, and ADR-056 withdraws a record 60 days past it, so
    left at the month's start all 33 monthly California stations read 50 days
    late on the day they were admitted and would have been withdrawn as quiet
    feeds inside a fortnight.
    """
    monkeypatch.setattr(R.providers, "_get_cdec_json", lambda params: [
        cdec_row("2026-5-1 00:00", 3331618, "M"),
        cdec_row("2026-6-1 00:00", 3082292, "M"),
        cdec_row("2026-7-1 00:00", 2512790, "M"),
    ])
    frame = R.fetch_cdec_series("ORO", "monthly", "20260501", "20260821")
    assert frame["date"].dt.strftime("%Y-%m-%d").tolist() == [
        "2026-05-31", "2026-06-30", "2026-07-31"]
    assert frame["storage_af"].tolist() == [3331618.0, 3082292.0, 2512790.0], \
        "the calendar is corrected, never the reading"


def test_a_cdec_daily_reading_keeps_its_own_day(monkeypatch):
    """The correction is the monthly convention's and must not reach a day."""
    monkeypatch.setattr(R.providers, "_get_cdec_json", lambda params: [
        cdec_row("2026-8-10 00:00", 100),
    ])
    frame = R.fetch_cdec_series("SHA", "daily", "20260801", "20260821")
    assert frame["date"].dt.strftime("%Y-%m-%d").tolist() == ["2026-08-10"]


def test_a_cdec_month_still_in_progress_is_not_dated_in_the_future(monkeypatch):
    """Moving the stamp to the month's end must not publish a date ahead of
    today. It costs the current month's row, which is the conservative half of
    the trade and only arises if the service ever stamps one early."""
    today = R.local_today()
    monkeypatch.setattr(R.providers, "_get_cdec_json", lambda params: [
        cdec_row(today.strftime("%Y-%-m-1 00:00"), 500, "M"),
    ])
    frame = R.fetch_cdec_series("ORO", "monthly", "20260801", "20260831")
    assert frame.empty or frame["date"].max() <= today


def test_cdec_with_nothing_to_say_answers_an_empty_frame(monkeypatch):
    """The shape the caller expects, so a quiet station is not a crash."""
    monkeypatch.setattr(R.providers, "_get_cdec_json", lambda params: [
        cdec_row("2026-8-10 00:00", R.CDEC_MISSING_VALUE),
    ])
    frame = R.fetch_cdec_series("SHA", "daily", "20260801", "20260821")
    assert frame.empty
    assert list(frame.columns) == ["date", "storage_af"]


def test_cdec_asks_for_the_cadence_it_was_given(monkeypatch):
    """Monthly stations must not be asked for a daily series."""
    seen = {}
    monkeypatch.setattr(R.providers, "_get_cdec_json",
                        lambda params: seen.update(params) or [])
    R.fetch_cdec_series("SHA", "monthly", "20150101", "20260820")
    assert seen["dur_code"] == "M"
    assert seen["SensorNums"] == str(R.CDEC_STORAGE_SENSOR)
    assert seen["Start"] == "2015-01-01" and seen["End"] == "2026-08-20"
    R.fetch_cdec_series("SHA", "daily", "20150101", "20260820")
    assert seen["dur_code"] == "D"


# --- published output -----------------------------------------------------

def test_committed_reservoirs_json_is_well_formed():
    """Guards the file the dashboards actually read."""
    payload = json.loads((Path(__file__).resolve().parent.parent / "reservoirs.json").read_text())
    assert isinstance(payload, dict), "expected the envelope shape"
    records = payload["reservoirs"]
    assert len(records) == payload["reservoir_count"]
    assert payload["stale_count"] == sum(1 for r in records if r["is_stale"])

    # The roster is conserved: withdrawing a reservoir for old data takes it
    # out of `reservoirs` and puts it in `withdrawn`, and never loses it
    # (ADR-056). Asserting the union rather than the published count is what
    # keeps a silent drop -- a name that falls out of both -- from passing.
    withdrawn = payload.get("withdrawn", [])
    assert len(withdrawn) == payload.get("withdrawn_count", 0)
    published_names = {r["name"] for r in records}
    withdrawn_names = {entry["name"] for entry in withdrawn}
    assert published_names.isdisjoint(withdrawn_names), (
        "a reservoir is both published and withdrawn")
    assert published_names | withdrawn_names == set(R.ALL_RESERVOIR_NAMES)

    for entry in withdrawn:
        assert entry["days_stale"] > payload["withdraw_after_days"], entry["name"]
        # A withdrawn reservoir must not carry the figure it was withdrawn
        # for. Publishing it in a quieter shape is still publishing it.
        assert "current_storage_af" not in entry, entry["name"]
        assert "monthly" not in entry, entry["name"]

    for record in records:
        for key in ("name", "as_of", "days_stale", "is_stale", "fetch_ok",
                    "current_storage_af", "record_max_af", "pct_of_record_max",
                    "lat", "lon", "monthly"):
            assert key in record, f"{record.get('name')} missing {key}"
        assert -180 <= record["lon"] <= 0 and 0 <= record["lat"] <= 90
        assert record["monthly"], f"{record['name']} has no monthly history"

    # Watershed membership, once the refresh has run at least once with it.
    # Asserted on the committed file because a reservoir with no basin
    # silently disappears from every drainage-area total rather than failing.
    watersheds = payload["watersheds"]
    assert watersheds["unassigned"] == 0, "some reservoirs have no drainage area"
    assert watersheds["assigned"] == len(records)
    assert watersheds["intersects_utah"] == sum(
        1 for record in records if record["intersects_utah"])
    for record in records:
        assert record["huc6"], f"{record['name']} has no drainage area"
        assert record["huc6_name"] and record["huc_assignment_source"]
        assert isinstance(record["in_utah"], bool)
        assert isinstance(record["intersects_utah"], bool)


def test_one_export_contains_capacity_and_every_visualization_geography():
    sections = R.build_export_sections()

    # 4 since ADR-067 dropped the state outline. 3 rekeyed the capacity
    # catalog by station id (ADR-066). Both are breaks, versioned rather
    # than slipped in.
    assert sections["schema_version"] == 4
    # Keyed by the station the capacity belongs to, not the name it is called
    # by (ADR-066). Deer Creek is RISE item 290.
    assert sections["capacity_catalog"]["capacities"]["290"]["nid_id"] == "UT10117"
    assert sections["capacity_catalog"]["capacities"]["290"]["name"] == "Deer Creek"
    assert sections["capacity_catalog"]["keyed_by"] == "source_station_id"
    geography = sections["geography"]
    # No state outline here (ADR-067): no map draws a mask from it any more,
    # so `geography` is watersheds and nothing else.
    assert set(geography) == {"watersheds"}
    watersheds = geography["watersheds"]
    assert watersheds["default_scope"] == "west-huc6"
    # R1 moved the roster scope to the whole west (ADR-063's supersession):
    # admitting the AWDB west means the box the storage map opens on has to
    # follow the reservoirs out past the fourteen Utah-connected areas.
    assert watersheds["roster_scope"] == "west-huc6"
    assert watersheds["scopes"]["west-huc6"]["unit_count"] == 75
    assert watersheds["scopes"]["utah-connected"]["unit_count"] == 14
    assert watersheds["scopes"]["upper-colorado"]["unit_count"] == 10


def test_the_committed_reference_export_matches_the_files_it_is_built_from():
    """The published copy is derived data, and derived data drifts.

    reference.json is committed so the deploy needs no Python step, which
    means a change to capacities.json or a boundary file leaves a published
    file describing the previous version of the geography until someone
    remembers to re-run the generator. This is the reminder: it fails until
    the export is rebuilt in the same commit.
    """
    from tools.build_reference_export import render

    committed = R.EXPORT_PATH.read_text(encoding="utf-8")
    assert committed == render(R.build_export_sections()), (
        "reference.json no longer matches its sources; "
        "re-run python tools/build_reference_export.py")


def test_the_export_publishes_the_committed_roster_unchanged():
    """One geography, not a second copy of it that can disagree.

    Two files naming the same areas is how the maps come to disagree about
    which drainage area a reservoir is in. The export is a repackaging of
    the committed boundary files and must name exactly the areas they hold,
    in their order -- that is the ADR-018 guarantee, and it survives the
    polygons leaving the payload because the codes still come out of the
    same file the pipeline assigns reservoirs with.

    The state outline used to be republished whole for the same reason: it
    was 19 KB, both maps masked with it, and no hosted service published the
    reviewed UGRC polygon. ADR-067 retired the mask -- a dashboard drawing 75
    basins across 11 states has no single state to grey the rest of the map
    around -- so `utah-boundary.geojson` stays committed and reviewed for
    Python's own `in_utah` and `intersects_utah` classification and stops
    travelling in this export.
    """
    geography = R.build_export_sections()["geography"]
    root = Path(__file__).resolve().parent.parent

    def roster(path):
        # Reuses `huc.units_from_collection` and `huc.outer_bbox` rather than
        # reimplementing the bounds arithmetic here: this test is checking
        # that the export repackages the committed file, not re-deriving a
        # second answer for what a unit's box is and hoping it agrees.
        boundaries = json.loads((root / path).read_text())
        exact_bounds = {unit["huc6"]: unit["bounds"]
                        for unit in huc.units_from_collection(boundaries)}
        return [{"huc6": feature["properties"]["huc6"],
                 "name": feature["properties"].get("name", ""),
                 "states": feature["properties"].get("states", ""),
                 "bbox": huc.outer_bbox(exact_bounds[feature["properties"]["huc6"]])}
                for feature in boundaries["features"]]

    scopes = geography["watersheds"]["scopes"]
    assert scopes["utah-connected"]["units"] == roster("huc6.geojson")
    assert scopes["upper-colorado"]["units"] == roster(
        "data/watersheds/upper-colorado-huc6.geojson")
    assert scopes["west-huc6"]["units"] == roster(
        "data/watersheds/west-huc6.geojson")

    # Two scopes are named. They stopped being the same name when the
    # coverage moved west (ADR-063) and started being the same name again
    # when R1 admitted the AWDB west and moved the roster scope to match the
    # drawn one. Both must still be scopes this file publishes, or a client
    # following either name has nothing to follow -- and `utah-connected`
    # stays published in its own right: 16 of the 137 R1 candidates land
    # inside it, and an old link naming it must keep resolving.
    watersheds = geography["watersheds"]
    assert watersheds["default_scope"] == "west-huc6"
    assert watersheds["roster_scope"] == "west-huc6"
    assert set(scopes) >= {watersheds["default_scope"], watersheds["roster_scope"]}
    assert scopes["west-huc6"]["unit_count"] == 75
    assert scopes["utah-connected"]["unit_count"] == 14


def test_the_export_carries_no_polygons_but_the_state_outline():
    """The 982 KB that used to travel in this file, asserted gone.

    Every map page fetches this file whole on every load, and the drainage
    polygons in it were 98% of its bytes -- then walked coordinate by
    coordinate on the main thread to type-check them. The maps take their
    outlines from the hosted Watershed Boundary Dataset now. This is the
    guard that keeps the geometry from drifting back in: a scope entry that
    quietly regained a `boundaries` key would restore the whole cost without
    changing a single rendered pixel.
    """
    from tools.build_reference_export import render

    sections = R.build_export_sections()
    for name, scope in sections["geography"]["watersheds"]["scopes"].items():
        assert "boundaries" not in scope, f"{name} is publishing polygons again"
        # The code arrives under the attribute the level names, so a HUC-4
        # scope publishes `huc4` (ADR-050). `bbox` joined the roster in S1
        # (OPENING-SCOPE-AND-THE-WESTERN-ROSTER.md) -- four numbers, not a
        # ring, and the length check below is what keeps it that way: a
        # `bbox` that quietly grew into a polygon would restore the whole
        # cost this test exists to keep out, under a name that reads as safe.
        field = f"huc{scope['level']}"
        assert all(set(unit) == {field, "name", "states", "bbox"} for unit in scope["units"])
        assert all(len(unit["bbox"]) == 4
                   and all(isinstance(value, float) for value in unit["bbox"])
                   for unit in scope["units"])

    # Measured on the wire, never raw (ADR-051, ADR-052). GitHub Pages
    # compresses this file and every map page fetches it whole on every
    # load, so the raw count overstates what a reader pays by five and a
    # half times -- 129,607 bytes raw against 23,008 gzipped on 2026-08-20,
    # when R3 put 142 California reservoirs into the capacity catalogue.
    # The budget is what keeps the polygons out: they were 982 KB raw and
    # would not fit under this compressed either, and the structural
    # assertions above are what say so directly.
    assert len(gzip.compress(render(sections).encode("utf-8"), 9)) < 30_000


# --- watershed enrichment -------------------------------------------------

def test_the_cross_border_review_is_keyed_by_stations_on_the_roster():
    """A waterbody review is a fact about one reservoir, so its key is the
    station id the roster is keyed by and its name is that station's label
    (ADR-066). A key that drifts from the roster is a review of nothing:
    the lookup misses and the entry quietly defaults to the point's state,
    which is exactly the wrong answer for every reservoir in this table.
    """
    for station, entry in huc.CROSS_BORDER_WATERBODIES.items():
        assert station in R.ALL_RESERVOIR_IDS, entry.get("name", station)
        assert entry["name"] == R.RESERVOIR_NAMES[station], station


def test_every_record_gets_a_watershed_and_the_summary_agrees():
    # Each record carries the station it was fetched with, which is what the
    # reviewed dam point is looked up by (ADR-066).
    records = [{"name": "Deer Creek", "source_station_id": "290",
                "lat": 40.43511, "lon": -111.50035},
               {"name": "Bear Lake", "source_station_id": "10055500:ID:BOR",
                "lat": 42.11667, "lon": -111.30000}]
    summary = R.attach_watersheds(records)
    # Deer Creek has a dam in the National Inventory of Dams and Bear Lake
    # does not, so exactly one of the two is assigned by its dam -- and each
    # record says which kind of point produced it.
    assert summary == {"unit_count": 75, "assigned": 2, "unassigned": 0,
                       "assigned_by_dam": 1}
    assert records[0]["huc6"] == "160202" and records[0]["in_utah"] is True
    assert records[0]["huc_assignment_source"] == "nid_dam_point"
    # Bear Lake's gage is on the Idaho side, and the dashboard should say so
    # rather than rounding it into the state to keep a tidy count.
    assert records[1]["huc6"] == "160102" and records[1]["in_utah"] is False
    assert records[1]["intersects_utah"] is True
    assert records[1]["huc_assignment_source"] == "published_point"


def test_a_carried_forward_record_still_gets_its_watershed():
    """A reservoir whose feed went quiet has not moved. Leaving it without a
    basin would drop it out of every watershed total on the day it most needs
    to be visible as late data."""
    records = [{"name": "Steinaker", "lat": 40.51456, "lon": -109.53275,
                "fetch_ok": False, "is_stale": True}]
    R.attach_watersheds(records)
    assert records[0]["huc6"] == "140600"
    assert records[0]["fetch_ok"] is False


def test_a_record_without_coordinates_is_counted_not_crashed_on():
    records = [{"name": "Nowhere"}, {"name": "Deer Creek", "lat": 40.43511,
                                     "lon": -111.50035}]
    summary = R.attach_watersheds(records)
    assert summary["assigned"] == 1 and summary["unassigned"] == 1
    assert "huc6" not in records[0]


def test_a_missing_boundary_file_does_not_lose_the_days_data(monkeypatch, tmp_path):
    """HUC fields are optional, but Utah scope does not need the HUC file."""
    monkeypatch.setattr(R.huc, "BOUNDARY_PATH", tmp_path / "absent.geojson")
    records = [{"name": "Deer Creek", "lat": 40.43511, "lon": -111.50035}]
    summary = R.attach_watersheds(records)
    assert summary == {"unit_count": 0, "assigned": 0, "unassigned": 1}
    assert records[0] == {
        "name": "Deer Creek",
        "lat": 40.43511,
        "lon": -111.50035,
        "in_utah": True,
        "intersects_utah": True,
    }


if __name__ == "__main__":
    sys.exit(pytest.main([__file__, "-v"]))


def test_the_refresh_hour_puts_every_western_zone_on_one_date():
    """`LOCAL_TZ` is a safe simplification only because of when this runs.

    Staleness is `today - as_of`, and `today` is decided in one zone while
    the west spans three. That only matters if the refresh runs near a date
    boundary somewhere -- so this asserts it does not, from the workflow's
    own cron rather than from a comment.
    """
    import re
    from datetime import datetime, timezone
    from zoneinfo import ZoneInfo

    workflow = (Path(__file__).resolve().parent.parent
                / ".github/workflows/refresh-data.yml").read_text(encoding="utf-8")
    hours = {int(match) for match in re.findall(r'cron:\s*"\d+\s+(\d+)', workflow)}
    assert hours, "no cron hour found in the refresh workflow"

    western = ("America/Los_Angeles", "America/Denver", "America/Chicago",
               "America/Phoenix")
    # Both sides of the daylight-saving change, since the cron does not move.
    for month, day in ((1, 15), (7, 15)):
        for hour in hours:
            moment = datetime(2026, month, day, hour, tzinfo=timezone.utc)
            dates = {moment.astimezone(ZoneInfo(zone)).date() for zone in western}
            assert len(dates) == 1, (
                f"at {hour:02d}:00 UTC on {month}/{day} the western zones "
                f"disagree about the date ({sorted(dates)}), so LOCAL_TZ "
                "would change how stale a reading looks")
            # And far enough from midnight that a slow start cannot drift over.
            local = moment.astimezone(ZoneInfo("America/Los_Angeles"))
            assert 1 <= local.hour <= 22, (
                f"the refresh starts at {local.hour:02d}:00 Pacific, close "
                "enough to a date boundary that the zone choice matters")


# --- every year gets one vote ---------------------------------------------

def test_a_dense_year_does_not_outvote_a_sparse_one():
    """The estimator's whole point, in the case that motivated it.

    Ten years at 1000 reported once a month, one year at 100 reported every
    day. Pooling the readings gives the dense year about thirty times the
    weight of each sparse one, so it drags the median down and the "normal"
    becomes a fact about who reports often. One value per year puts the median
    back where the years say it is.
    """
    dense_year = TODAY.year - 1
    rows = []
    for year in range(TODAY.year - 11, TODAY.year):
        if year == dense_year:
            for day in pd.date_range(f"{year}-06-08", f"{year}-06-22", freq="D"):
                rows.append((day, 100.0))
        else:
            rows.append((pd.Timestamp(f"{year}-06-15"), 1000.0))
    index = pd.DatetimeIndex([row[0] for row in rows])
    series = pd.Series([row[1] for row in rows], index=index)

    yearly = R.annual_seasonal_values(series, pd.Timestamp(f"{TODAY.year}-06-15"))
    assert len(yearly) == 11
    assert yearly[dense_year] == 100.0
    # Ten years at 1000 and one at 100: the years say 1000.
    assert float(yearly.median()) == 1000.0
    # Pooled, the fifteen daily readings would have pulled it well below.
    window = R.seasonal_window(series, pd.Timestamp(f"{TODAY.year}-06-15"))
    assert float(window.median()) < 1000.0


def test_the_sample_size_is_years_not_readings():
    """`sample_years` must count the sample the statistic actually has."""
    index = pd.date_range("2015-01-01", TODAY, freq="D")
    series = pd.Series(np.linspace(900, 1100, len(index)), index=index)
    frame = pd.DataFrame({"date": index, "storage_af": series.to_numpy()})
    record = R.summarize("Daily", 994, 40.0, -111.0, frame, TODAY)

    prior = R.prior_annual_seasonal_values(series, TODAY)
    assert record["seasonal_sample_years"] == len(prior)
    assert record["seasonal_sample_years"] == TODAY.year - 2015


def test_the_rank_is_ordinal_and_names_what_it_is_of():
    """"Third-lowest of eleven" cannot be read as more precise than it is."""
    index = pd.date_range("2015-01-01", TODAY, freq="D")
    # Each prior year flat at its own level, rising with the year, so the
    # ordering of the annual representatives is known exactly.
    values = np.where(index.year < TODAY.year,
                      (index.year - 2014) * 100.0, 250.0)
    series = pd.Series(values, index=index)

    prior_count = TODAY.year - 2015
    rank = R.seasonal_rank(series, TODAY, 250.0)
    assert rank is not None
    # Prior years sit at 100, 200, 300, ...; 250 is above exactly two of them.
    assert rank == (3, prior_count + 1)

    # The lowest reading ever must read as first of its own population, and
    # the percentile beside it as a true zero.
    lowest = R.seasonal_rank(series, TODAY, 1.0)
    assert lowest == (1, prior_count + 1)
    assert R.seasonal_percentile(series, TODAY, 1.0) == 0.0


def test_a_reservoir_with_no_prior_years_has_no_rank():
    """No years to be ordinal of; say so rather than invent a first place."""
    index = pd.date_range(f"{TODAY.year}-01-01", TODAY, freq="D")
    series = pd.Series(np.linspace(100, 50, len(index)), index=index)
    assert R.seasonal_rank(series, TODAY, 50.0) is None

    frame = pd.DataFrame({"date": index, "storage_af": series.to_numpy()})
    record = R.summarize("Brand New", 993, 40.0, -111.0, frame, TODAY)
    assert record["seasonal_rank"] is None
    assert record["seasonal_rank_of"] is None
    json.dumps(record)


def test_the_rank_and_the_percentile_agree_about_direction():
    """Two forms of one comparison. They may not disagree about which way."""
    index = pd.date_range("2015-01-01", TODAY, freq="D")
    values = np.where(index.year < TODAY.year,
                      (index.year - 2014) * 100.0, 250.0)
    series = pd.Series(values, index=index)
    for current in (50.0, 250.0, 450.0, 10_000.0):
        rank, of = R.seasonal_rank(series, TODAY, current)
        percentile = R.seasonal_percentile(series, TODAY, current)
        assert 1 <= rank <= of
        # Both count the same prior years, so the highest rank and a
        # percentile of 100 have to arrive together.
        assert (rank == of) == (percentile == 100.0)


def test_a_tie_reads_the_same_in_both_forms():
    """A year at exactly the current value counts as not-below in both.

    The percentile counted ties as at-or-below while the rank counted
    strictly below, so a reading that tied the lowest year on record
    published "lowest of 12" beside a percentile of 9.1 -- one comparison,
    two answers, printed in one details-panel row. Thief Valley did exactly
    that in a committed payload.
    """
    index = pd.date_range("2015-01-01", TODAY, freq="D")
    values = np.where(index.year < TODAY.year,
                      (index.year - 2014) * 100.0, 100.0)
    series = pd.Series(values, index=index)
    prior_count = TODAY.year - 2015

    # Current ties the lowest prior year: lowest ever, and a true zero.
    assert R.seasonal_rank(series, TODAY, 100.0) == (1, prior_count + 1)
    assert R.seasonal_percentile(series, TODAY, 100.0) == 0.0

    # Current ties the highest prior year: not above it, so not the highest
    # rank and not the hundredth percentile.
    highest = prior_count * 100.0
    rank, of = R.seasonal_rank(series, TODAY, highest)
    assert rank == of - 1
    assert R.seasonal_percentile(series, TODAY, highest) < 100.0


def test_a_vote_near_the_new_year_is_one_winter():
    """The wrapped window groups by instance, not by calendar year.

    Grouping by calendar year medianed a year's early-January readings --
    the winter before -- with its late-December ones -- the winter after --
    into one vote, and counted the current winter's December as "prior"
    evidence. Each winter here sits at its own constant level, so a vote
    that blends two of them is visible immediately.
    """
    index = pd.date_range("2020-12-01", "2026-01-05", freq="D")
    # Winter W runs December W through January W+1 and holds 1000 + 100*W-ish;
    # the current winter (December 2025 into January 2026) collapses to 55.
    winter = np.where(index.month == 12, index.year, index.year - 1)
    values = np.where(winter == 2025, 55.0, (winter - 2020) * 100.0 + 1000.0)
    series = pd.Series(values, index=index)
    ref = pd.Timestamp("2026-01-02")

    yearly = R.annual_seasonal_values(series, ref)
    # Each instance, labelled by its January year, is exactly its winter's
    # level -- nothing blended from the winter before or after.
    for year, level in ((2021, 1000.0), (2022, 1100.0), (2023, 1200.0),
                        (2024, 1300.0), (2025, 1400.0), (2026, 55.0)):
        assert yearly[year] == level

    # The current winter's December is current-winter evidence, not a prior
    # year, so it is excluded whole -- December half included.
    prior = R.prior_annual_seasonal_values(series, ref)
    assert list(prior.index) == [2021, 2022, 2023, 2024, 2025]
    assert 55.0 not in set(prior.to_numpy())
    assert R.seasonal_rank(series, ref, 55.0) == (1, 6)
    assert R.seasonal_percentile(series, ref, 55.0) == 0.0


def test_the_pipeline_publishes_the_estimator_it_used():
    """A field can keep its name while the statistic under it changes."""
    assert R.METHOD_VERSION
    import tools.build_normal_baselines as B
    assert B.METHOD_VERSION == R.METHOD_VERSION, (
        "the two baselines are published to be compared with each other, so "
        "they must be built by the same estimator")


def test_a_change_says_what_it_is_a_change_from():
    """"30-day change" is the date asked for, not the date used.

    The nearest usable reading is taken within a tolerance -- ten days for a
    daily feed and forty-five for a month-end one -- so a row headed "Change
    in 1 year" has covered anything from 320 days to 410, and the payload
    published no way to tell which.
    """
    index = pd.date_range("2015-01-01", TODAY, freq="D")
    series = pd.Series(range(len(index)), index=index, dtype="float64")
    frame = pd.DataFrame({"date": index, "storage_af": series.to_numpy()})
    record = R.summarize("Daily", 992, 40.0, -111.0, frame, TODAY)

    for label, days in (("7d", 7), ("30d", 30), ("365d", 365)):
        reference = record[f"change_{label}_reference_date"]
        elapsed = record[f"change_{label}_elapsed_days"]
        assert reference is not None, label
        # A daily series has the exact day, so the interval is the named one.
        assert elapsed == days, label
        assert (pd.Timestamp(record["as_of"]) - pd.Timestamp(reference)).days == elapsed


def test_a_gappy_series_reports_the_interval_it_actually_used():
    """The point of the field: the reading used is not the one asked for."""
    # Month-end readings only, so a 30-day target lands between two of them.
    index = pd.DatetimeIndex(
        pd.date_range("2015-01-31", TODAY, freq="ME"))
    series = pd.Series(range(len(index)), index=index, dtype="float64")
    frame = pd.DataFrame({"date": index, "storage_af": series.to_numpy()})
    record = R.summarize("Monthly", 991, 40.0, -111.0, frame, TODAY,
                         data_frequency="monthly", change_tolerance_days=45)

    # A monthly series cannot support a seven-day claim and does not make one.
    assert record["change_7d_af"] is None
    assert record["change_7d_reference_date"] is None
    assert record["change_7d_elapsed_days"] is None

    for label in ("30d", "365d"):
        if record[f"change_{label}_af"] is None:
            continue
        elapsed = record[f"change_{label}_elapsed_days"]
        reference = record[f"change_{label}_reference_date"]
        assert elapsed is not None and reference is not None, label
        # Whatever it is, it is stated rather than assumed from the name.
        assert elapsed > 0, label
        assert (pd.Timestamp(record["as_of"])
                - pd.Timestamp(reference)).days == elapsed


def test_a_change_that_cannot_be_made_names_no_reference():
    """Absent is not zero, and an interval for a change that does not exist
    would be a date with nothing measured from it."""
    index = pd.date_range(f"{TODAY.year}-06-01", TODAY, freq="D")
    series = pd.Series(1.0, index=index)
    frame = pd.DataFrame({"date": index, "storage_af": series.to_numpy()})
    record = R.summarize("Young", 990, 40.0, -111.0, frame, TODAY)

    assert record["change_365d_af"] is None
    assert record["change_365d_reference_date"] is None
    assert record["change_365d_elapsed_days"] is None
    json.dumps(record)


# --- the fourth provider: Colorado's telemetry service ----------------------

def cdss_row(day, value):
    """A series row as the service writes it: ISO date, no zone."""
    return {"abbrev": "GRARESCO", "parameter": "STORAGE",
            "measDate": f"{day}T00:00:00", "measValue": value,
            "measUnit": "ACFT", "flagA": "O", "flagB": None, "measCount": 96}


def test_cdss_answers_the_same_contract_as_the_other_providers(monkeypatch):
    """Sorted, deduplicated to the last reading, and nothing after today."""
    later = (R.local_today() + pd.Timedelta(days=3)).strftime("%Y-%m-%d")
    monkeypatch.setattr(R.providers, "_get_cdss_json", lambda url, params: [
        cdss_row("2026-08-12", 300),
        cdss_row("2026-08-10", 100),
        cdss_row("2026-08-10", 111),
        cdss_row(later, 999),
    ])
    frame = R.fetch_cdss_series("GRARESCO", "20260801", "20261231")
    assert frame["date"].dt.strftime("%Y-%m-%d").tolist() == ["2026-08-10", "2026-08-12"]
    assert frame["storage_af"].tolist() == [111.0, 300.0], "last reading wins"


def test_cdss_drops_a_negative_rather_than_reading_it(monkeypatch):
    """No sentinel has been observed on this service -- a quiet station
    answers 404 instead -- but a value below zero is no more a measurement
    here than it is anywhere else."""
    monkeypatch.setattr(R.providers, "_get_cdss_json", lambda url, params: [
        cdss_row("2026-08-10", -1),
        cdss_row("2026-08-11", 0),
        cdss_row("2026-08-12", None),
        cdss_row("2026-08-13", 250),
    ])
    frame = R.fetch_cdss_series("GRARESCO", "20260801", "20260831")
    assert frame["date"].dt.strftime("%Y-%m-%d").tolist() == ["2026-08-11", "2026-08-13"]
    assert frame["storage_af"].tolist() == [0.0, 250.0]


def test_cdss_reads_an_empty_window_as_an_answer_not_a_failure(monkeypatch):
    """A station with no rows answers HTTP 404 whose body says zero records.
    Gross Reservoir's whole recent history arrives that way; it is an empty
    series, not an error to retry three times and raise."""

    class Response:
        status_code = 404
        content = b'"This URL is properly formatted, but returns zero records from CDSS."'

        def raise_for_status(self):
            raise AssertionError("a zero-records 404 must not raise")

    monkeypatch.setattr(R.providers.requests, "get",
                        lambda url, params=None, timeout=None: Response())
    rows = R.providers._get_cdss_json(R.providers.CDSS_SERIES_URL,
                                      {"abbrev": "GROSRECO"})
    assert rows == []


def test_the_colorado_roster_is_keyed_by_the_station_and_carries_evidence():
    """The same shape every other admitted file is held to (ADR-066)."""
    for abbrev, row in R.ADMITTED_CDSS_RESERVOIRS.items():
        assert row["station"] == abbrev
        assert row["cadence"] == "daily"
        assert R.REQUIRED_CAPACITY_EVIDENCE <= row["capacity"].keys(), abbrev


def test_every_colorado_admission_names_its_dam():
    """This provider publishes no full level, so every denominator is the
    inventory's -- and a percentage without its dam behind it is not published
    over just because the state changed."""
    for abbrev, row in R.ADMITTED_CDSS_RESERVOIRS.items():
        capacity = row["capacity"]
        assert capacity["nid_id"], abbrev
        assert capacity["capacity_basis"] in {
            "normal_storage", "max_storage", "nid_storage"}, abbrev
