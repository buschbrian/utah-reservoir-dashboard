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
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from refresh_reservoirs import (  # noqa: E402
    SEASONAL_WINDOW_DAYS, fetch_awdb_series, fetch_rise_series, seasonal_window,
)

ROSTER_PATH = ROOT / "reservoirs.json"
OUTPUT_PATH = ROOT / "normals.json"

# The standard climate normal period. 1991-2020 is what the World
# Meteorological Organization defines and what the snowpack payload already
# uses, which is the whole point: one definition of normal across the site.
CLIMATE_START_YEAR = 1991
CLIMATE_END_YEAR = 2020

# The shape of this file, not the numbers in it.
SCHEMA_VERSION = 1

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

    Indexed by day of the year 1 through 366 so the pipeline can look a value
    up with the same `dayofyear` expression it already computes. Position 0 of
    each array is unused and holds null, which keeps the index arithmetic
    obvious at the cost of one wasted slot.

    Note this is the *median of the observations* in the window, not the
    median of yearly means. That matches what the daily pipeline computes, and
    matching matters more here than any argument for the alternative: the two
    baselines exist to be compared with each other.
    """
    medians: list[float | None] = [None] * 367
    years: list[int] = [0] * 367
    # A leap year so every one of the 366 reference days exists. seasonal_window
    # reads only the day of the year off this date.
    reference_year = 2020
    for day in range(1, 367):
        reference = pd.Timestamp(f"{reference_year}-01-01") + pd.Timedelta(days=day - 1)
        window = seasonal_window(series, reference, SEASONAL_WINDOW_DAYS)
        if window.empty:
            continue
        medians[day] = round(float(window.median()), 2)
        years[day] = int(window.index.year.nunique())
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


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true",
                        help="print the summary and write nothing")
    parser.add_argument("--only", default=None,
                        help="build one reservoir by name, for checking a fix")
    args = parser.parse_args()

    roster = json.loads(ROSTER_PATH.read_text(encoding="utf-8"))["reservoirs"]
    if args.only:
        roster = [r for r in roster if r["name"] == args.only]
        if not roster:
            print(f"No reservoir named {args.only!r} in {ROSTER_PATH.name}")
            return 1

    records = []
    failures = []
    for reservoir in roster:
        try:
            record = build_one(reservoir)
        except Exception as error:  # noqa: BLE001 - one bad station is not a bad run
            failures.append((reservoir["name"], str(error)))
            record = {
                "name": reservoir["name"],
                "source_key": reservoir["source_key"],
                "source_station_id": reservoir["source_station_id"],
                "data_frequency": reservoir["data_frequency"],
                "available": False,
                "reason": "the provider did not answer",
                "first_obs": None, "last_obs": None, "n_obs": 0,
                "years_in_period": 0, "covers_full_period": False,
                "day_of_year": None, "month": None,
            }
        records.append(record)
        state = ("full" if record.get("covers_full_period")
                 else f"{record['years_in_period']}y" if record["available"]
                 else "none")
        print(f"  {record['name']:<28} {state:>5}  {record['n_obs']:>6} readings")

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
        print(f"providers did not answer : {len(failures)}")
        for name, error in failures:
            print(f"    {name}: {error}")

    payload = {
        "schema_version": SCHEMA_VERSION,
        "built": dt.date.today().isoformat(),
        "period": {"start_year": CLIMATE_START_YEAR, "end_year": CLIMATE_END_YEAR},
        "window_days": SEASONAL_WINDOW_DAYS,
        "minimum_years": MIN_YEARS_FOR_A_NORMAL,
        "method": (
            "Median storage within a plus or minus 7 day window around the same "
            "day of the year, across 1991 through 2020. Monthly values are the "
            "median of each calendar month's mean storage across the same years. "
            "Built once and committed, because a normal over a closed period "
            "does not change."
        ),
        "sources": {
            "rise": "https://data.usbr.gov/rise-api",
            "awdb": "https://wcc.sc.egov.usda.gov/awdbRestApi",
        },
        "reservoirs": records,
    }

    if args.only:
        # Merge, never replace.
        #
        # `--only` used to write `records` as the whole file, so building one
        # reservoir silently deleted the other sixty-eight -- a thirty-year,
        # twenty-minute job to undo, and nothing said it had happened. The
        # flag exists so a roster addition does not cost a full rebuild, which
        # is the thing it was destroying.
        #
        # This matters more as the roster grows: at western coverage a full
        # rebuild is about an hour, so adding one reservoir has to be cheap.
        if not OUTPUT_PATH.exists():
            print(f"ERROR: --only merges into {OUTPUT_PATH.name} and it does not "
                  "exist; run a full build first", file=sys.stderr)
            return 1
        existing = json.loads(OUTPUT_PATH.read_text(encoding="utf-8"))
        built = {record["name"] for record in records}
        kept = [r for r in existing["reservoirs"] if r["name"] not in built]
        payload["reservoirs"] = sorted(kept + records, key=lambda r: r["name"])
        # The period and method belong to the whole file; a one-reservoir run
        # must not restate them from today's constants if the committed file
        # was built under different ones.
        for field in ("period", "window_days", "minimum_years", "method",
                      "schema_version"):
            if field in existing:
                payload[field] = existing[field]
        print(f"\nmerging {len(records)} into {len(existing['reservoirs'])} "
              f"existing -> {len(payload['reservoirs'])}")

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
