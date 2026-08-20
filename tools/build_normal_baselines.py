"""Build normals.json -- a 1991-2020 climate normal for every reservoir.

## Why this is a separate tool rather than part of the daily refresh

The daily pipeline requests from 2015 because that is all it needs to say
what a reservoir is doing now. That start date then became, by accident, the
answer to a much bigger question: every "normal for this week" on the site is
a median over 2015 onward, which is the driest eleven-year stretch in the
modern record of this region. Measuring today against it flatters today. The
snowpack half of the site meanwhile compares against the standard 1991-2020
climate normal, so the two halves of one dashboard were answering "is this
normal?" against different definitions of normal.

The providers were probed before this tool was written, because a baseline
nobody has the data for is not worth building:

    record starts 1991 or earlier : 54 reservoirs   98.2% of combined capacity
    starts 1992 to 2010           :  8 reservoirs    1.5%
    starts after 2010             :  5 reservoirs    0.3%
    no reading returned           :  2 reservoirs    0.0%

So the climate normal is real for essentially all of the water. Lake Powell
reaches 1963, Bear Lake 1911, Utah Lake 1932. Jordanelle starts in 1993 --
that is the dam's own age, not a hole in the record, and the output says so
rather than hiding it.

## Why it is committed rather than fetched each morning

A climate normal over a closed period cannot change. Refetching thirty years
of daily readings for sixty-nine reservoirs every morning would multiply the
refresh's request volume for an answer that is identical every time, and it
would put the whole daily publish at the mercy of a thirty-year query. This
follows the precedent capacities.json already set: a fact that is a property
of the period rather than of today belongs in the repository.

The *recent* baseline stays computed live in refresh_reservoirs.py, because
that one genuinely does move as the record grows.

## What is in it

Per reservoir, per day of the year, the median storage within the same
+/- 7-day window the daily pipeline uses -- deliberately the same window
function, imported rather than reimplemented, so the two baselines differ
only in which years they draw on and can be honestly put side by side.

Each day also carries how many distinct calendar years contributed to it. A
median over three years and a median over thirty are not the same claim, and
the site has to be able to say which one it is showing.

    python tools/build_normal_baselines.py --dry-run       # print, write nothing
    python tools/build_normal_baselines.py                 # write normals.json
    python tools/build_normal_baselines.py --only "Yuba"   # one reservoir
"""

import argparse
import datetime as dt
import json
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from refresh_reservoirs import (  # noqa: E402
    CANONICAL_YEAR_DAYS, SEASONAL_WINDOW_DAYS, annual_seasonal_values,
    fetch_awdb_series, fetch_rise_series, seasonal_window,
)

ROSTER_PATH = ROOT / "reservoirs.json"
#: The committed, reviewed roster. Consulted for reservoirs the payload does
#: not hold, which is a real state rather than an odd one: a reservoir
#: admitted to the roster whose feed is already quiet past
#: ``WITHDRAW_AFTER_DAYS`` is withdrawn on its very first refresh (ADR-056),
#: so it never appears in ``reservoirs.json`` and could never be given a
#: normal. Montpelier Reservoir arrived in exactly that state.
#:
#: A withdrawal notice cannot stand in for this. It carries a name and a
#: reason and deliberately no measurement, so it has no station to fetch
#: with -- the roster is where that lives.
ADMITTED_PATH = ROOT / "admitted_reservoirs.json"
OUTPUT_PATH = ROOT / "normals.json"


def roster_records() -> list[dict]:
    """Every reservoir that exists, published or withdrawn.

    The payload's own records first, because they carry the provider's answer
    for this morning. Then any roster entry the payload does not hold, mapped
    into the same shape: a station triplet is a ``source_station_id`` and a
    cadence is a ``data_frequency``, and every reviewed entry is an AWDB
    station. A thirty-year median is a fact about a reservoir rather than
    about whether its gauge reported this week, so a quiet feed must not be
    what decides it can never have one.
    """
    published = json.loads(ROSTER_PATH.read_text(encoding="utf-8"))["reservoirs"]
    known = {str(record.get("source_station_id")) for record in published}
    records = list(published)
    if not ADMITTED_PATH.exists():
        return records
    admitted = json.loads(ADMITTED_PATH.read_text(encoding="utf-8"))["reservoirs"]
    for station, entry in admitted.items():
        if str(station) in known:
            continue
        records.append({
            "name": entry["name"],
            "source_key": "awdb",
            "source_station_id": entry.get("station_triplet", station),
            "data_frequency": entry["cadence"],
            "lat": entry["lat"],
            "lon": entry["lon"],
        })
    return records

# The standard climate normal period. 1991-2020 is what the World
# Meteorological Organization defines and what the snowpack payload already
# uses, which is the whole point: one definition of normal across the site.
CLIMATE_START_YEAR = 1991
CLIMATE_END_YEAR = 2020

# The shape of this file, not the numbers in it.
#: 2 since the day-of-year arrays became 365 long rather than 366: a
#: canonical year has no 29 February, so there is no position for one.
SCHEMA_VERSION = 2

#: The estimator behind the numbers, which is a different thing from the shape
#: of the file holding them (ADR-041's periods are a third thing again). A
#: schema version cannot see the change that matters most here: the fields keep
#: their names and types while the statistic under them improves, so a file
#: built before and after are the same shape and are not comparable.
#:
#: "annual" is the median of one representative value per year. "pooled" is
#: what came before it, the median over every reading in the window, which let
#: a densely-reported year outvote a sparsely-reported one. "-2" adds the
#: canonical calendar: the table is built and read at the same position, where
#: it used to be built over a leap year and read by `dayofyear`. "-3"
#: attributes each reading the year-end wrap keeps to the window instance it
#: is evidence about, so positions 1-7 and 359-365 are each a median over
#: single winters rather than over calendar years holding two.
METHOD_VERSION = "storage-normal-annual-3"

#: How many reservoirs to fetch at once. See `build_many` for why it is small.
DEFAULT_WORKERS = 6

# A day of the year whose window draws on fewer than this many distinct
# calendar years is published with its count rather than suppressed, but the
# count is what lets a reader -- and the pipeline -- refuse to lean on it.
MIN_YEARS_FOR_A_NORMAL = 10


def fetch_period(reservoir: dict) -> pd.DataFrame:
    """The reservoir's readings across the climate period, and only those.

    No margin years on either end. A window centred on 1 January reaches back
    to day 359, but it reaches back to day 359 *of every year in the period*,
    because the window matches on day of the year rather than on adjacency in
    time. Adding 1990 and 2021 to make the seam "safe" would instead add two
    extra calendar years to every day of the year in the result.
    """
    start = f"{CLIMATE_START_YEAR}0101"
    end = f"{CLIMATE_END_YEAR + 1}0101"
    if reservoir["source_key"] == "rise":
        return fetch_rise_series(reservoir["rise_item_id"], start, end)
    return fetch_awdb_series(
        reservoir["source_station_id"], reservoir["data_frequency"], start, end)


def day_of_year_normals(series: pd.Series) -> dict:
    """Median storage and contributing-year count for each day of the year.

    Indexed by canonical position 1 through 365 -- `canonical_day` in the
    pipeline -- so the pipeline looks a value up by the same expression that
    built it. Position 0 of each array is unused and holds null, which keeps
    the index arithmetic obvious at the cost of one wasted slot. There is no
    position 366: a canonical year never has one, and 29 February is read at
    28 February's position.

    One representative value per year, then the median across years -- the
    same estimator `month_normals` below has always used, and the same one the
    daily pipeline now uses (`annual_seasonal_values`). This was a median over
    the pooled readings, matched to what the daily pipeline then computed,
    because the two baselines exist to be compared with each other. That
    reasoning was right and its conclusion has moved: both sides changed
    together, so they still match, and they now match on the estimator that
    gives each year one vote instead of the one that let thirty years of daily
    readings drown out a provider reporting once a month.
    """
    medians: list[float | None] = [None] * (CANONICAL_YEAR_DAYS + 1)
    years: list[int] = [0] * (CANONICAL_YEAR_DAYS + 1)
    # An ordinary year, so a position in this loop is already the canonical
    # position and needs no conversion. It used to be a leap year iterated to
    # 366, which put every entry after February one day off the position the
    # pipeline looked it up by: the table said "day 231" meaning 18 August and
    # was read for 19 August. The shift was on one side of the comparison, not
    # both.
    reference_year = 2021
    for day in range(1, CANONICAL_YEAR_DAYS + 1):
        reference = pd.Timestamp(f"{reference_year}-01-01") + pd.Timedelta(days=day - 1)
        yearly = annual_seasonal_values(series, reference, SEASONAL_WINDOW_DAYS)
        if yearly.empty:
            continue
        medians[day] = round(float(yearly.median()), 2)
        years[day] = int(len(yearly))
    return {"median_af": medians, "years": years}


def month_normals(series: pd.Series) -> dict:
    """Median of each calendar month's mean storage, indexed 1 through 12.

    This is the figure the twelve-month chart draws its normal line from, and
    it is computed the same way `monthly_history` computes its own: mean
    within a month first, then median across years. Averaging every reading in
    the period instead would weight a month with daily readings thirty times
    heavier than one with a single month-end reading, which is exactly the
    difference between the daily and monthly reservoirs here.
    """
    monthly_means = series.resample("MS").mean()
    medians: list[float | None] = [None] * 13
    years: list[int] = [0] * 13
    for month in range(1, 13):
        same_month = monthly_means[monthly_means.index.month == month].dropna()
        if same_month.empty:
            continue
        medians[month] = round(float(same_month.median()), 2)
        years[month] = int(same_month.index.year.nunique())
    return {"median_af": medians, "years": years}


def build_one(reservoir: dict) -> dict:
    """One reservoir's climate normal, or an honest record of why there is none."""
    frame = fetch_period(reservoir)
    record: dict = {
        "name": reservoir["name"],
        "source_key": reservoir["source_key"],
        "source_station_id": reservoir["source_station_id"],
        "data_frequency": reservoir["data_frequency"],
    }
    if frame.empty:
        record.update({
            "available": False,
            "reason": "no readings in the period",
            "first_obs": None, "last_obs": None, "n_obs": 0,
            "years_in_period": 0, "covers_full_period": False,
            "day_of_year": None, "month": None,
        })
        return record

    series = frame.set_index("date")["storage_af"].sort_index()
    inside = series[(series.index.year >= CLIMATE_START_YEAR)
                    & (series.index.year <= CLIMATE_END_YEAR)]
    if inside.empty:
        record.update({
            "available": False,
            "reason": "the record begins after the period ends",
            "first_obs": series.index[0].date().isoformat(),
            "last_obs": series.index[-1].date().isoformat(),
            "n_obs": 0, "years_in_period": 0, "covers_full_period": False,
            "day_of_year": None, "month": None,
        })
        return record

    years_in_period = int(inside.index.year.nunique())
    record.update({
        "available": True,
        "reason": None,
        "first_obs": inside.index[0].date().isoformat(),
        "last_obs": inside.index[-1].date().isoformat(),
        "n_obs": int(inside.size),
        "years_in_period": years_in_period,
        # 30 calendar years is the whole period. Anything less is a real
        # reservoir with a shorter life, and the site says which.
        "covers_full_period":
            years_in_period == (CLIMATE_END_YEAR - CLIMATE_START_YEAR + 1),
        "day_of_year": day_of_year_normals(inside),
        "month": month_normals(inside),
    })
    return record


def already_built(path: Path = OUTPUT_PATH) -> dict:
    """The committed normals, by station id (ADR-066). Empty when no file.

    By station and never by name: the west holds two Lost Creeks, and a
    name index would hold one of them while answering for both -- which is
    how a `--missing` run comes to skip a reservoir that has no normal.
    """
    if not path.exists():
        return {}
    payload = json.loads(path.read_text(encoding="utf-8"))
    return {record["source_station_id"]: record
            for record in payload.get("reservoirs") or []}


#: Why a record with no normal has none, and whether asking again could
#: change the answer.
#:
#: "the provider did not answer" is a network fault: the station may well have
#: thirty years behind it and the run simply failed to reach them. The other
#: two are findings -- a reservoir built in 2011 will not grow a 1991 record
#: by being asked twice -- so `--missing` leaves them alone rather than
#: spending a fetch on each of them on every run.
RETRYABLE_REASONS = frozenset({"the provider did not answer"})


def needs_building(reservoir: dict, existing: dict) -> bool:
    """Whether this reservoir has no usable normal in the committed file.

    The question `--missing` answers, and the reason a roster that grows by a
    hundred reservoirs does not cost a rebuild of the ones already done.
    """
    record = existing.get(reservoir["source_station_id"])
    if record is None:
        return True
    if record.get("available"):
        return False
    return record.get("reason") in RETRYABLE_REASONS


def merged_reservoirs(previous: list[dict],
                      records: list[dict]) -> tuple[list[dict], list[dict]]:
    """What a merge keeps, and the whole merged roster, ordered.

    By station id and never by name (ADR-066): with two Lost Creeks in the
    file, a name-keyed merge that rebuilt one would silently delete the
    untouched twin's thirty-year normal -- a replacement wearing a merge's
    name.
    """
    built = {record["source_station_id"] for record in records}
    kept = [r for r in previous if r["source_station_id"] not in built]
    merged = sorted(kept + records,
                    key=lambda r: (r["name"], r["source_station_id"]))
    return kept, merged


def select(roster: list[dict], names: list[str] | None, missing: bool,
           existing: dict) -> list[dict]:
    """The reservoirs a run will fetch, in roster order."""
    if names:
        wanted = set(names)
        return [r for r in roster if r["name"] in wanted]
    if missing:
        return [r for r in roster if needs_building(r, existing)]
    return list(roster)


def build_many(reservoirs: list[dict], workers: int):
    """Build several reservoirs at once, yielding each as it finishes.

    Concurrent because the work is not the arithmetic. Measured on one
    reservoir: 12.2 seconds of wall clock for 0.8 seconds of processor, so
    fifteen sixteenths of a sequential run is this machine waiting for a
    provider. At western coverage that is the difference between a job someone
    schedules and one they can watch finish.

    Deliberately modest. Both providers are public services this project does
    not pay for, and the daily refresh asks them for one series at a time; a
    handful of concurrent thirty-year queries is a different request pattern
    from a hundred, and only one of them is neighbourly.

    A station that fails is yielded with its error rather than raised, so one
    bad station is not a bad run -- the same rule the sequential version
    followed.
    """
    def attempt(reservoir: dict) -> tuple[dict, str | None]:
        try:
            return build_one(reservoir), None
        except Exception as error:  # noqa: BLE001 - one bad station is not a bad run
            return {
                "name": reservoir["name"],
                "source_key": reservoir["source_key"],
                "source_station_id": reservoir["source_station_id"],
                "data_frequency": reservoir["data_frequency"],
                "available": False,
                "reason": "the provider did not answer",
                "first_obs": None, "last_obs": None, "n_obs": 0,
                "years_in_period": 0, "covers_full_period": False,
                "day_of_year": None, "month": None,
            }, str(error)

    if workers <= 1:
        for reservoir in reservoirs:
            yield attempt(reservoir)
        return
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = [pool.submit(attempt, reservoir) for reservoir in reservoirs]
        for future in as_completed(futures):
            yield future.result()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true",
                        help="print the summary and write nothing")
    parser.add_argument("--only", nargs="+", default=None, metavar="NAME",
                        help="build these reservoirs by name, for checking a "
                             "fix or adding a few to a built file")
    parser.add_argument("--missing", action="store_true",
                        help="build only the reservoirs the committed file has "
                             "no usable normal for; this is also how an "
                             "interrupted run is resumed")
    parser.add_argument("--workers", type=int, default=DEFAULT_WORKERS,
                        help="how many reservoirs to fetch at once")
    args = parser.parse_args()

    roster = roster_records()
    existing = already_built()
    if args.only and args.missing:
        print("ERROR: --only names the reservoirs and --missing works them out; "
              "pass one or the other", file=sys.stderr)
        return 1
    chosen = select(roster, args.only, args.missing, existing)
    if args.only:
        unknown = sorted(set(args.only) - {r["name"] for r in chosen})
        if unknown:
            print(f"No reservoir named {', '.join(repr(n) for n in unknown)} "
                  f"in {ROSTER_PATH.name}", file=sys.stderr)
            return 1
    if not chosen:
        print(f"Nothing to build: every reservoir in {ROSTER_PATH.name} already "
              f"has a normal in {OUTPUT_PATH.name}.")
        return 0
    merging = bool(args.only or args.missing)
    #: Whether this run *asked* to be partial. An interrupted full run is also
    #: a merge, and the two want opposite things when the committed file was
    #: built by an older estimator: a partial run must refuse rather than mix,
    #: while an interrupted one has already paid for its fetches and must not
    #: throw them away.
    interrupted = False

    records = []
    failures = []
    started = time.monotonic()
    print(f"building {len(chosen)} of {len(roster)} reservoirs, "
          f"{args.workers} at a time")
    try:
        for record, error in build_many(chosen, args.workers):
            if error is not None:
                failures.append((record["name"], error))
            records.append(record)
            state = ("full" if record.get("covers_full_period")
                     else f"{record['years_in_period']}y" if record["available"]
                     else "none")
            print(f"  [{len(records):>3}/{len(chosen)}] {record['name']:<28} "
                  f"{state:>5}  {record['n_obs']:>6} readings")
    except KeyboardInterrupt:
        # What was fetched is kept. Thirty years for a hundred reservoirs is
        # a long enough run that throwing away the finished half because the
        # rest was interrupted is its own fault; `--missing` picks up the
        # remainder.
        print(f"\ninterrupted after {len(records)} of {len(chosen)}; "
              "keeping what was built", file=sys.stderr)
        merging = True
        interrupted = True
    elapsed = time.monotonic() - started

    available = [r for r in records if r["available"]]
    full = [r for r in available if r["covers_full_period"]]
    thin = [r for r in available
            if r["years_in_period"] < MIN_YEARS_FOR_A_NORMAL]
    print()
    print(f"reservoirs               : {len(records)}")
    print(f"with a climate normal    : {len(available)}")
    print(f"spanning all 30 years    : {len(full)}")
    print(f"fewer than {MIN_YEARS_FOR_A_NORMAL} years      : {len(thin)}"
          + (f"  ({', '.join(r['name'] for r in thin)})" if thin else ""))
    if failures:
        print(f"providers did not answer : {len(failures)}"
              "  (re-run with --missing to ask again)")
        for name, error in failures:
            print(f"    {name}: {error}")
    print(f"elapsed                  : {elapsed / 60:.1f} min "
          f"({elapsed / max(1, len(records)):.1f} s per reservoir)")

    # Completion order is arrival order under concurrency, so the file is
    # sorted here rather than left to record which station answered first.
    records.sort(key=lambda record: (record["name"], record["source_station_id"]))
    payload = {
        "schema_version": SCHEMA_VERSION,
        "built": dt.date.today().isoformat(),
        "period": {"start_year": CLIMATE_START_YEAR, "end_year": CLIMATE_END_YEAR},
        "window_days": SEASONAL_WINDOW_DAYS,
        "minimum_years": MIN_YEARS_FOR_A_NORMAL,
        "method_version": METHOD_VERSION,
        "method": (
            "One representative value per year -- the median of the readings "
            "within a plus or minus 7 day window around the same calendar "
            "date -- then the median of those across 1991 through 2020, so "
            "every year carries the same weight whether its provider reported "
            "daily or monthly. The window matches on a calendar of 365 days "
            "in which 29 February shares 28 February's place, so a date means "
            "one position in every year. Monthly values are the median of "
            "each calendar month's mean storage across the same years. Built "
            "once and committed, because a normal over a closed period does "
            "not change."
        ),
        "sources": {
            "rise": "https://data.usbr.gov/rise-api",
            "awdb": "https://wcc.sc.egov.usda.gov/awdbRestApi",
        },
        "reservoirs": records,
    }

    # Always a merge, never a replacement.
    #
    # Two reasons, and the second is the one that cost something. `--only`
    # used to write its records as the whole file, so building one reservoir
    # silently deleted the other sixty-eight.
    #
    # And the roster this reads is `reservoirs.json`, which is what the
    # providers answered *this morning*: a reservoir withdrawn for a quiet
    # feed (ADR-056) is not in it. A full build that replaced the file would
    # therefore throw away the climate normal of every reservoir having a bad
    # month -- a thirty-year fact deleted over a fortnight of silence, and
    # refetched the day the feed came back. Elkhead Reservoir is in exactly
    # that state as this is written. Nothing is deleted here for the same
    # reason nothing is deleted from the roster: the judgement is remade every
    # run, and a normal over a closed period cannot go stale.
    if True:  # noqa: SIM108 - kept as a block so the reasoning above stays put
        #
        if merging and not OUTPUT_PATH.exists():
            print(f"ERROR: a partial run merges into {OUTPUT_PATH.name} and it "
                  "does not exist; run a full build first", file=sys.stderr)
            return 1
        previous = (json.loads(OUTPUT_PATH.read_text(encoding="utf-8"))
                    if OUTPUT_PATH.exists() else {"reservoirs": []})
        kept, payload["reservoirs"] = merged_reservoirs(
            previous["reservoirs"], records)
        # A merge must not mix estimators into one file, and *every* path
        # here is a merge -- a completed full run included, because `kept`
        # holds the reservoirs absent from today's payload (an ADR-056
        # withdrawal), and those records are whatever estimator the committed
        # file was built by.
        #
        # The fields keep their names when the statistic under them changes,
        # so merging a reservoir built one way into a file built the other
        # produces a file that looks entirely consistent and is not. What to
        # do about it depends on which kind of merge this is.
        built_under = previous.get("method_version")
        if not merging and kept and built_under != METHOD_VERSION:
            # A completed full run against a file built by another estimator.
            # The header is stamped with today's METHOD_VERSION, so keeping
            # the old-method records would publish the exact mix the
            # partial-run refusal below exists to stop -- while claiming one
            # method, which is worse, because `load_normals`' warning is
            # keyed on the header and could then never fire. Same policy as
            # the interrupted run: keep what this run built, say what was
            # dropped, and each dropped reservoir is rebuilt the day its
            # feed returns and `--missing` can reach it.
            names = ", ".join(sorted(r["name"] for r in kept))
            print(f"WARNING: {OUTPUT_PATH.name} was built by "
                  f"{built_under or 'an unversioned method'}; dropping "
                  f"{len(kept)} normal(s) kept for reservoirs not in today's "
                  f"payload ({names}) rather than mixing them into a "
                  f"{METHOD_VERSION} file.", file=sys.stderr)
            kept = []
            payload["reservoirs"] = sorted(
                records, key=lambda r: (r["name"], r["source_station_id"]))
        if merging:
            if built_under != METHOD_VERSION and not interrupted:
                # A run that asked to be partial. Refusing is cheap -- a full
                # build is a few minutes -- and mixing is not recoverable by
                # inspection afterwards.
                print(f"ERROR: {OUTPUT_PATH.name} was built by "
                      f"{built_under or 'an unversioned method'} and this is "
                      f"{METHOD_VERSION}; a partial run would mix the two. "
                      "Run a full build.", file=sys.stderr)
                return 1
            if built_under != METHOD_VERSION:
                # An interrupted full build. Its fetches are already paid for
                # and are the new estimator; the records it did not reach are
                # the old one and cannot stay beside them. Keeping only what
                # this run built shrinks the file, which is the honest state:
                # `--missing` refills it, and until then every record in the
                # file was computed the same way.
                dropped = len(previous["reservoirs"]) - len(records)
                print(f"WARNING: {OUTPUT_PATH.name} was built by "
                      f"{built_under or 'an unversioned method'}; keeping the "
                      f"{len(records)} this run built and dropping "
                      f"{max(0, dropped)} that predate {METHOD_VERSION}. "
                      "Run --missing to rebuild them.", file=sys.stderr)
                payload["reservoirs"] = sorted(
                    records, key=lambda r: (r["name"], r["source_station_id"]))
            else:
                # The period and method belong to the whole file; a partial run
                # must not restate them from today's constants if the committed
                # file was built under different ones.
                for field in ("period", "window_days", "minimum_years", "method",
                              "method_version", "schema_version"):
                    if field in previous:
                        payload[field] = previous[field]
        print(f"\nmerging {len(records)} into {len(previous['reservoirs'])} "
              f"existing -> {len(payload['reservoirs'])}")
        # Named rather than counted: a reader of this run's output should be
        # able to see that a reservoir kept its normal without being asked
        # for one, and why.
        absent = sorted(r["name"] for r in kept
                        if r["source_station_id"] not in
                        {res["source_station_id"] for res in roster})
        if absent:
            print(f"kept {len(absent)} normal(s) for reservoirs not in today's "
                  f"payload: {', '.join(absent)}")

    if args.dry_run:
        print(f"\n--dry-run: {OUTPUT_PATH.name} not written")
        return 0
    OUTPUT_PATH.write_text(
        json.dumps(payload, separators=(",", ":")) + "\n", encoding="utf-8")
    size = OUTPUT_PATH.stat().st_size
    print(f"\nwrote {OUTPUT_PATH.name} ({size / 1024:.0f} KB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
