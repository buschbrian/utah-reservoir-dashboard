"""The seasonal estimator: what "normal for this date" means here.

Every rule in this module is a property of a published number, so a change to
one changes what the site claims. Read
docs/architecture/hydrology-methods.md first, and follow the
science-method-change procedure -- a change here means `METHOD_VERSION`, a
normals rebuild, and a decision record.

The three rules the arithmetic exists to enforce: a calendar date is one
position in every year, every year gets one vote, and a vote is one window
instance rather than one calendar year.
"""

import datetime as dt
import json

import numpy as np
import pandas as pd

from .constants import (
    METHOD_VERSION, NORMALS_PATH, SEASONAL_WINDOW_DAYS, START_DATE,
)
from .numbers import _pct, _round


#: Positions in the canonical climatological year, 1 through 365.
CANONICAL_YEAR_DAYS = 365


def canonical_day(when) -> "np.ndarray | int":
    """Where a date falls in a year that never has a 29 February.

    A calendar date has to mean one position in every year, and `dayofyear`
    does not give it one: 19 August is day 231 in an ordinary year and day 232
    in a leap year, so a window centred on 19 August 2026 was centred on 18
    August for every leap year in the record. A zero-width window on 19 August
    excluded 19 August 2024 outright. The `+/- 7` day window made the effect
    small and never made it right, and it was present on every date after
    February -- which is most of the year and all of the melt season.

    **29 February takes 28 February's position.** It has to take some
    position, and every choice is a convention; this one keeps the canonical
    year exactly 365 long, keeps every other date where a reader would put it,
    and puts the extra day in the window a reader would expect to find it in.
    Nothing is dropped -- both days contribute to any window covering 28
    February.

    The wrap at the year end is then a flat 365 for every year, because in
    canonical positions every year is the same length. That is what the
    per-year `year_length` here used to be working around.

    Accepts a `DatetimeIndex` or a single `Timestamp` and answers in kind.
    """
    if isinstance(when, pd.Timestamp):
        shift = 1 if (when.is_leap_year and when.dayofyear >= 60) else 0
        return int(when.dayofyear) - shift
    doy = np.asarray(when.dayofyear)
    return doy - np.where(np.asarray(when.is_leap_year) & (doy >= 60), 1, 0)


def seasonal_window(series: pd.Series, ref_date: pd.Timestamp,
                    window_days: int = SEASONAL_WINDOW_DAYS) -> pd.Series:
    """Every observation within +/- window_days of ref_date's calendar date, any year.

    Matched on `canonical_day` rather than `dayofyear`, so the same calendar
    date is the same position in every year and the window means what its name
    says. See `canonical_day` for what that is worth and where 29 February
    goes.
    """
    doy = canonical_day(series.index)
    ref_doy = canonical_day(ref_date)
    raw = np.abs(doy - ref_doy)
    # Every canonical year is 365 long, so one constant serves every year.
    diff = np.minimum(raw, CANONICAL_YEAR_DAYS - raw)
    return series[diff <= window_days]


def annual_seasonal_values(series: pd.Series, ref_date: pd.Timestamp,
                           window_days: int = SEASONAL_WINDOW_DAYS) -> pd.Series:
    """One representative value per window instance, indexed by its year.

    The unit of inference here is the *year*, not the reading. A window over
    thirty years of daily readings holds about 450 values; the same window
    over thirty years of month-end readings holds about 15. Taking a median
    across the pooled readings lets a year with dense readings outvote a year
    with sparse ones, and lets one provider's reporting habit outvote another's
    entirely -- so the same statistic meant different things for a Reclamation
    reservoir and a Natural Resources Conservation Service one.

    This gives every year one vote. `sample_years` then counts the actual
    statistical sample rather than a number of readings that happens to be
    grouped into years, an ordinal rank has something to be ordinal *of*, and
    the serial correlation inside one year's fortnight stops being treated as
    independent evidence.

    `month_normals` in `tools/build_normal_baselines.py` has always worked this
    way, for the same reason and in the same words. This brings the day-of-year
    statistics into line with it.

    A vote is a *window instance*, not a calendar year. Away from 1 January
    the two are the same thing. At the year end the window wraps
    (`seasonal_window`), and grouping the wrapped readings by their own
    calendar year medianed a year's early-January readings -- the winter
    before -- with its late-December ones -- the winter after -- into one
    "year" that described neither: two winters about 360 days apart in one
    vote. Each reading kept by the wrap therefore votes with the instance
    whose reference date it is days away from: a late-December reading sits
    just before the *next* year's reference and votes there, an early-January
    reading just after the *previous* year's. The index label is the
    instance's own calendar year.

    Empty when no instance has a reading in the window.
    """
    window = seasonal_window(series, ref_date, window_days)
    if window.empty:
        return pd.Series(dtype="float64")
    doy = canonical_day(window.index)
    delta = doy - canonical_day(ref_date)
    # Only a wrapped reading has |delta| beyond the window; everything else
    # was already inside it, so the adjustment is exactly the wrap direction.
    votes = (window.index.year.to_numpy()
             + (delta > window_days).astype(int)
             - (delta < -window_days).astype(int))
    return window.groupby(votes).median()


def prior_annual_seasonal_values(series: pd.Series, ref_date: pd.Timestamp,
                                 window_days: int = SEASONAL_WINDOW_DAYS
                                 ) -> pd.Series:
    """One vote per window instance strictly before ref_date's own.

    The cut is on the vote's instance year, never on the reading's calendar
    year: near 1 January the window wraps, and cutting on calendar years both
    admitted the current winter's December as "prior" evidence and dropped a
    completed winter's January half. The current instance carries the
    reading being compared, so it is excluded whole.
    """
    values = annual_seasonal_values(series, ref_date, window_days)
    return values[values.index < ref_date.year]


def normal_period(run_date: pd.Timestamp) -> dict[str, int]:
    """Calendar years that can contribute to a prior-year comparison."""
    return {
        "start_year": dt.datetime.strptime(START_DATE, "%Y%m%d").year,
        "end_year": int(run_date.year) - 1,
    }


def load_normals() -> dict:
    """The committed 1991-2020 climate normals, or an empty table.

    Missing is not fatal. A run without normals.json publishes the recent
    baseline alone and every reservoir says the climate baseline is
    unavailable, which is a smaller failure than not publishing at all. It is
    reported loudly, because the file not being there is a mistake rather than
    a state anyone wants.
    """
    if not NORMALS_PATH.exists():
        print(f"WARNING: {NORMALS_PATH.name} is missing -- publishing the recent "
              "baseline only. Build it with tools/build_normal_baselines.py")
        return {}
    try:
        payload = json.loads(NORMALS_PATH.read_text(encoding="utf-8"))
    except (OSError, ValueError) as error:
        print(f"WARNING: {NORMALS_PATH.name} could not be read ({error}) -- "
              "publishing the recent baseline only")
        return {}
    # Two medians taken different ways are not a comparison.
    #
    # The site publishes both baselines so a reader can put them side by side,
    # and that only means anything while both were computed the same way. The
    # estimator changed once already, without a single field name moving, so
    # this says out loud when the committed file predates the change rather
    # than letting the two periods quietly disagree about what a median is.
    built_under = payload.get("method_version")
    if built_under != METHOD_VERSION:
        print(f"WARNING: {NORMALS_PATH.name} was built by "
              f"{built_under or 'an unversioned method'} and this pipeline is "
              f"{METHOD_VERSION}. The two baselines are not comparable until "
              "it is rebuilt with tools/build_normal_baselines.py")
    return {
        "period": payload.get("period", {}),
        "window_days": payload.get("window_days"),
        "built": payload.get("built"),
        "method_version": built_under,
        # By station id, not by name (ADR-066). A climate normal is a
        # denominator like a capacity, and two reservoirs sharing a name must
        # not share one: the west holds two Lost Creeks whose records differ
        # by a factor of twenty.
        "by_station": {str(r["source_station_id"]): r
                       for r in payload.get("reservoirs", [])
                       if r.get("source_station_id")},
    }


def climate_baseline(normals: dict, station_id: str | None, ref_date: pd.Timestamp,
                     current: float) -> dict | None:
    """One reservoir's 1991-2020 normal for today, read out of the committed table.

    The lookup is `canonical_day(ref_date)` against a table built by iterating
    the same positions, so the daily and climate baselines describe the same
    window of the year and a calendar date means one position in both.

    It was `ref_date.dayofyear` against a table built over a leap year, and
    the claim written here was that the shift was "present on both sides of
    the comparison rather than on one". It was present on one: the table's
    entry 231 was built from 18 August and was read for every 19 August in an
    ordinary year. Every date after February was read one day early.

    Returns None when this reservoir has no usable climate normal -- a dam
    younger than the period, or a station the provider would not answer for.
    The site says so instead of falling back to the other baseline behind the
    reader's back, because a comparison silently swapping its own denominator
    is the failure this whole change exists to fix.
    """
    record = (normals.get("by_station") or {}).get(str(station_id))
    if not record or not record.get("available"):
        return None
    table = record.get("day_of_year") or {}
    medians = table.get("median_af") or []
    counts = table.get("years") or []
    day = int(canonical_day(ref_date))
    if day >= len(medians) or medians[day] is None:
        return None
    normal = float(medians[day])
    years = int(counts[day]) if day < len(counts) else 0
    return {
        "normal_af": _round(normal),
        "pct_of_normal": _pct(current, normal),
        "sample_years": years,
        "covers_full_period": bool(record.get("covers_full_period")),
        "first_obs": record.get("first_obs"),
    }


def seasonal_percentile(series: pd.Series, ref_date: pd.Timestamp, current: float,
                        window_days: int = SEASONAL_WINDOW_DAYS) -> float:
    """Where `current` ranks against *prior years'* values in the day-of-year window.

    The comparison population is prior years only. It used to include the
    current year's own observations -- including `current` itself -- which
    made the statistic structurally incapable of returning a true 0 (a
    reservoir at its worst level ever still scored above zero because it was
    being compared against itself) and dragged every value toward the middle
    in a short record. "Lowest this week has ever been" should read as 0.

    It ranks against one value per prior year (`annual_seasonal_values`), not
    against every reading those years hold. Ranking readings made the sample
    look far larger than the evidence: eleven years of daily readings gave a
    population of about 160, so "14th percentile" read as a fine-grained
    measurement of something eleven observations support. The number of years
    is published beside it, and `seasonal_rank` says the same thing in a form
    that cannot be over-read.

    A tie counts as not-below, on both sides. `seasonal_rank` counts the
    years strictly below `current`, so a year at exactly the current value
    does not push the rank up -- and it must not push the percentile up
    either, or the pair contradicts itself in one details-panel row: a
    reading that ties the lowest year on record published "lowest of 12"
    beside a percentile of 9.1. Counting strictly below keeps both ends
    honest: lowest ever, tied or not, reads 0, and 100 appears exactly when
    the rank reads highest.

    Returns NaN when there are no prior years to compare against, which the
    output layer turns into null rather than a fake number.
    """
    population = prior_annual_seasonal_values(series, ref_date, window_days)
    if population.empty:
        return float("nan")
    return float(np.mean(population.to_numpy() < current) * 100)


def seasonal_rank(series: pd.Series, ref_date: pd.Timestamp, current: float,
                  window_days: int = SEASONAL_WINDOW_DAYS) -> tuple[int, int] | None:
    """Where `current` sits among the prior years, counting from the lowest.

    Returns `(rank, of)` where `of` is the prior years plus this reading, so
    `(3, 11)` reads "third-lowest of eleven" and needs no further explanation.
    A percentile does need it: two ranks a few points apart are not different
    when eleven years stand behind them, and a reader has no way to know that
    from "18th percentile" alone. The percentile stays published for anything
    that wants a continuous value.

    None when there are no prior years, which is the same answer
    `seasonal_percentile` gives as NaN.
    """
    population = prior_annual_seasonal_values(series, ref_date, window_days)
    if population.empty:
        return None
    below = int(np.sum(population.to_numpy() < current))
    return below + 1, len(population) + 1
