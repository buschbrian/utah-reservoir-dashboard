"""Daily refresh of reservoirs.json for the Utah Reservoir Drought Dashboard.

Pulls current-through-yesterday daily storage (af) for all 28 Bureau of
Reclamation-monitored Utah reservoirs from the RISE API, then computes a
set of drought metrics per reservoir:

- pct_of_record_max: current storage vs. the highest storage seen in the
  pulled date range (proxy for % of physical capacity, not the real thing).
- seasonal_percentile: where today's storage ranks against *prior years'*
  values within a 7-day day-of-year window. Prior years only, so "lowest
  this week has ever been" can actually read as 0.
- seasonal_normal_af / pct_of_seasonal_normal: today's storage against the
  median storage for this same week in prior years -- the "is this normal
  for August?" read that pct_of_record_max can't give you.
- 7/30/365-day changes, this year's peak, and a 12-month monthly history
  (with a per-calendar-month normal from prior years) for the trend chart
  and table in the dashboard popups.

Every reservoir also carries explicit freshness fields (as_of, days_stale,
is_stale, fetch_ok). Reclamation's feed can go quiet for an individual
reservoir for days at a time while every other one keeps updating, and the
old version of this script published those frozen values indistinguishably
from fresh ones. Now staleness is data, and the dashboards render it.

No local CSV cache -- this always re-pulls the full date range fresh, since
it runs in an ephemeral GitHub Actions environment. RISE's own disclaimer:
data is provisional and recent values are subject to revision.
"""

import argparse
import datetime as dt
import json
import math
import os
import sys
import time
from pathlib import Path

import numpy as np
import pandas as pd
import requests

RISE_RESULT_URL = "https://data.usbr.gov/rise/api/result"
START_DATE = "20150101"
OUTPUT_PATH = Path(__file__).parent / "reservoirs.json"
CAPACITY_PATH = Path(__file__).parent / "capacities.json"

# A reservoir whose newest observation is older than this many days is
# flagged is_stale and called out in the run log and in the dashboards.
# 2 days is deliberately tight: RISE normally publishes through yesterday,
# so anything past "yesterday, plus a day of slack" is a real signal.
STALE_AFTER_DAYS = 2

# name -> (RISE catalog-item id for "Daily Instantaneous Lake/Reservoir
# Storage (af)", lat, lon). The first 12 item IDs and the seasonal/record-max
# methodology come directly from Brian's original notebook
# (~/Developer/mtnwest-geo/reservoir_levels.ipynb); the other 16 were
# rediscovered via the same RISE location -> catalogRecord -> catalogItem
# walk documented there, filtered to stateId=UT, types=Reservoir, and
# parameterName == "Lake/Reservoir Storage" -- since that mapping was never
# committed anywhere despite the 28-reservoir statewide expansion using it.
#
# IMPROVEMENT: this mapping is hand-maintained and has no verification step.
# If Reclamation retires a catalog item (which is one of the plausible
# explanations for a reservoir going permanently stale), this dict keeps
# happily requesting a dead id and gets an empty series back forever. Worth
# adding a weekly job that re-walks location -> catalogRecord -> catalogItem
# for stateId=UT and diffs the discovered ids against this dict.
RESERVOIRS = {
    "Deer Creek": (290, 40.43511, -111.50035),
    "Jordanelle": (468, 40.60689, -111.41655),
    "Strawberry": (779, 40.16882, -111.1311),
    "Rockport": (706, 40.77498, -111.39859),
    "Echo": (314, 40.9574, -111.4179),
    "East Canyon": (310, 40.91017, -111.59293),
    "Pineview": (652, 41.26543, -111.80998),
    "Willard Bay": (866, 41.37738, -112.08339),
    "Scofield": (727, 39.77656, -111.05074),
    "Starvation": (764, 40.19324, -110.44722),
    "Flaming Gorge": (337, 40.97789, -109.57304),
    "Lake Powell": (509, 37.05778, -111.30332),
    "Causey": (219, 41.29828, -111.58591),
    "Currant Creek": (278, 40.33841, -111.05821),
    "Huntington North": (432, 39.38458, -111.09082),
    "Hyrum": (439, 41.62117, -111.86099),
    "Joes Valley": (463, 39.2901, -111.27888),
    "Lost Creek": (544, 41.18887, -111.39628),
    "Meeks Cabin": (574, 41.01664, -110.58344),
    "Moon Lake": (587, 40.57445, -110.50665),
    "Newton": (623, 41.8998, -111.97562),
    "Red Fleet": (685, 40.57832, -109.42853),
    "Stateline": (769, 40.98291, -110.39038),
    "Steinaker": (774, 40.51456, -109.53275),
    "Trial Lake": (4516, 40.6799, -110.956839),
    "Upper Stillwater": (826, 40.56565, -110.70044),
    "Washington Lake": (4530, 40.6765, -110.964),
    "Lost Lake": (4523, 40.6741, -110.9413),
}


RETRY_ATTEMPTS = 3
RETRY_BACKOFF_SECONDS = 2  # doubles each retry: 2s, 4s
MAX_PAGES = 50  # ~100k daily rows; a stop so a bad meta block can't spin forever


LOCAL_TZ = "America/Denver"  # every reservoir here is on Mountain Time


def load_capacities() -> dict[str, dict]:
    """Reservoir capacities from capacities.json, or {} if it isn't there.

    Built separately by tools/build_capacity_table.py from the National
    Inventory of Dams, because RISE publishes no capacity at all. Kept as a
    committed, reviewable file rather than fetched at refresh time: it
    changes on the order of never, it comes from a different agency, and a
    denominator that silently changes under you is worse than a stale one.
    """
    if not CAPACITY_PATH.exists():
        return {}
    try:
        return json.loads(CAPACITY_PATH.read_text()).get("capacities", {})
    except (ValueError, AttributeError):
        print(f"WARNING: {CAPACITY_PATH.name} is unreadable; "
              "percent-of-capacity will be omitted")
        return {}


def local_today() -> pd.Timestamp:
    """Today's date in Mountain Time, as a tz-naive midnight timestamp.

    This used to be UTC. Between 18:00 and 24:00 MT, UTC is already tomorrow,
    so an evening run reported every reservoir a day staler than a morning
    run of the same data -- and a reservoir sitting exactly on the threshold
    would flip in and out of `is_stale` purely by clock time. The reservoirs,
    the gages and the readers are all on Mountain Time; the dates RISE
    publishes are local dates, so comparing them against a local today is the
    apples-to-apples version.

    Handles DST automatically via the zoneinfo database, so it does not drift
    the way the workflow's fixed-UTC cron does.
    """
    return pd.Timestamp.now(LOCAL_TZ).normalize().tz_localize(None)


def _get_json(params: dict) -> dict:
    """GET a page from RISE, retrying on transient failures.

    RISE occasionally returns a non-JSON (often empty) body on an
    otherwise-2xx response, which crashed the whole run on 2026-08-03.
    The request itself (connect/read timeouts) must be inside the try too --
    on 2026-08-08 a bare read timeout raised from requests.get() before it
    ever reached the try block, so the retry never engaged.
    """
    for attempt in range(RETRY_ATTEMPTS):
        try:
            resp = requests.get(RISE_RESULT_URL, params=params, timeout=60)
            resp.raise_for_status()
            return resp.json()
        except (requests.exceptions.RequestException, ValueError):
            if attempt == RETRY_ATTEMPTS - 1:
                raise
            time.sleep(RETRY_BACKOFF_SECONDS * 2**attempt)
    raise AssertionError("unreachable")  # keeps type checkers honest


def fetch_rise_series(item_id: int, start: str, end: str) -> pd.DataFrame:
    """Pull one RISE catalog item's daily results, paginating as needed.

    Returns a date-sorted frame with columns [date, storage_af], already
    cleaned: null/non-numeric results dropped, duplicate dates collapsed to
    the last reading, future-dated rows removed.
    """
    rows = []
    page = 1
    while page <= MAX_PAGES:
        params = {
            "itemsPerPage": 2000,
            "order[dateTime]": "ASC",
            "itemId": item_id,
            "dateTime[after]": start,
            "dateTime[strictly_before]": end,
            "page": page,
        }
        payload = _get_json(params)
        data = payload.get("data") or []
        rows.extend(data)

        meta = payload.get("meta") or {}
        per_page = meta.get("itemsPerPage") or 0
        total = meta.get("totalItems")
        # Stop on an empty page even if meta says there should be more --
        # otherwise a bad/missing meta block pages forever.
        if not data or not per_page or total is None:
            break
        if page * per_page >= total:
            break
        page += 1

    if not rows:
        return pd.DataFrame({"date": pd.Series(dtype="datetime64[ns]"),
                             "storage_af": pd.Series(dtype="float64")})

    df = pd.DataFrame([r["attributes"] for r in rows])
    df["date"] = pd.to_datetime(df["dateTime"], format="mixed", utc=True).dt.tz_localize(None).dt.normalize()
    # RISE returns null `result` for days the gage didn't report. Those used
    # to flow straight through: a trailing null became the "latest" reading
    # and poisoned every downstream metric with NaN.
    df["storage_af"] = pd.to_numeric(df["result"], errors="coerce")
    df = df.dropna(subset=["storage_af"])

    df = df[df["date"] <= local_today()]
    df = df.sort_values("date").drop_duplicates(subset="date", keep="last")
    return df[["date", "storage_af"]].reset_index(drop=True)


def seasonal_window(series: pd.Series, ref_date: pd.Timestamp, window_days: int = 7) -> pd.Series:
    """Every observation within +/- window_days of ref_date's day-of-year, any year.

    IMPROVEMENT: the wrap-around uses a fixed 365, so in leap years the
    window is off by a day around the New Year boundary. Immaterial for a
    +/-7-day window on a drought dashboard, but it is wrong.
    """
    doy = series.index.dayofyear
    ref_doy = ref_date.dayofyear
    # Wrap around the year end using each observation's own year length, not a
    # flat 365. With the constant, a leap year shifts every day after Feb 29
    # by one, so a window near the New Year silently picked up the wrong days.
    year_length = np.where(series.index.is_leap_year, 366, 365)
    raw = np.abs(doy - ref_doy)
    diff = np.minimum(raw, year_length - raw)
    return series[diff <= window_days]


def prior_years(series: pd.Series, ref_date: pd.Timestamp) -> pd.Series:
    """Everything from calendar years strictly before ref_date's year."""
    return series[series.index.year < ref_date.year]


def seasonal_percentile(series: pd.Series, ref_date: pd.Timestamp, current: float,
                        window_days: int = 7) -> float:
    """Where `current` ranks against *prior years'* values in the day-of-year window.

    The comparison population is prior years only. It used to include the
    current year's own observations -- including `current` itself -- which
    made the statistic structurally incapable of returning a true 0 (a
    reservoir at its worst level ever still scored above zero because it was
    being compared against itself) and dragged every value toward the middle
    in a short record. "Lowest this week has ever been" should read as 0.

    Returns NaN when there are no prior years to compare against, which the
    output layer turns into null rather than a fake number.
    """
    population = seasonal_window(prior_years(series, ref_date), ref_date, window_days)
    if population.empty:
        return float("nan")
    return float(np.mean(population.to_numpy() <= current) * 100)


def value_asof(series: pd.Series, when: pd.Timestamp, tolerance_days: int = 10) -> float | None:
    """Most recent observation at or before `when`, or None if the gap is too wide."""
    sub = series[series.index <= when]
    if sub.empty:
        return None
    if (when - sub.index[-1]).days > tolerance_days:
        return None
    return float(sub.iloc[-1])


def monthly_history(series: pd.Series, months: int = 12) -> list[dict]:
    """Last `months` calendar months: observed mean/min/max/end + a prior-years normal.

    `normal_af` is the median of that same calendar month's mean storage
    across every *earlier* year in the record, which is what makes the
    dashboard's 12-month chart readable as "above or below normal" rather
    than just "up or down".
    """
    if series.empty:
        return []

    by_month = series.resample("MS").agg(["mean", "min", "max", "last", "count"])
    monthly_means = by_month["mean"]

    out = []
    for period, row in by_month.tail(months).iterrows():
        same_month = monthly_means[monthly_means.index.month == period.month]
        prior_years = same_month[same_month.index.year < period.year].dropna()
        normal = float(prior_years.median()) if not prior_years.empty else None
        out.append({
            "month": period.strftime("%Y-%m"),
            "mean_af": _round(row["mean"]),
            "min_af": _round(row["min"]),
            "max_af": _round(row["max"]),
            "end_af": _round(row["last"]),
            "days": int(row["count"]) if not pd.isna(row["count"]) else 0,
            "normal_af": _round(normal),
        })
    return out


def _round(value, places: int = 2):
    """Round for JSON output, mapping NaN/None to null (JSON has no NaN)."""
    if value is None:
        return None
    value = float(value)
    if math.isnan(value) or math.isinf(value):
        return None
    return round(value, places)


def _pct(numerator: float | None, denominator: float | None) -> float | None:
    if numerator is None or not denominator:
        return None
    return _round(numerator / denominator * 100, 1)


def summarize(name: str, item_id: int, lat: float, lon: float, df: pd.DataFrame,
              today: pd.Timestamp, capacity: dict | None = None) -> dict:
    """Turn one reservoir's daily series into the record the dashboards consume."""
    series = df.set_index("date")["storage_af"].sort_index()
    last_date = series.index[-1]
    current = float(series.iloc[-1])
    record_max = float(series.max())
    record_min = float(series.min())

    days_stale = int((today - last_date).days)

    # The seasonal normal is a climatology, so it is built from prior years
    # only -- same correction as seasonal_percentile. Including this year's
    # own values pulled the "normal" toward whatever is happening right now,
    # which is precisely backwards in a drought: the worse the year, the
    # lower the bar it was being measured against.
    population = seasonal_window(prior_years(series, last_date), last_date)
    seasonal_normal = float(population.median()) if not population.empty else None
    seasonal_years = int(population.index.year.nunique()) if not population.empty else 0

    this_year = series[series.index.year == last_date.year]
    peak_af = float(this_year.max()) if not this_year.empty else None
    peak_date = this_year.idxmax().date().isoformat() if not this_year.empty else None

    changes = {}
    for label, days in (("7d", 7), ("30d", 30), ("365d", 365)):
        past = value_asof(series, last_date - pd.Timedelta(days=days))
        changes[f"change_{label}_af"] = _round(None if past is None else current - past)
        changes[f"change_{label}_pct"] = None if not past else _round((current - past) / past * 100, 1)

    capacity = capacity or {}
    capacity_af = capacity.get("capacity_af")

    return {
        "name": name,
        "rise_item_id": item_id,
        "lat": lat,
        "lon": lon,

        # --- freshness ---
        "as_of": last_date.date().isoformat(),
        "days_stale": days_stale,
        "is_stale": days_stale > STALE_AFTER_DAYS,
        "fetch_ok": True,

        # --- headline metrics (kept for continuity with the original notebook) ---
        "current_storage_af": _round(current),
        "record_max_af": _round(record_max),
        "record_min_af": _round(record_min),
        "pct_of_record_max": _pct(current, record_max),

        # --- percent full, against real capacity rather than a proxy ---
        # record_max is the highest storage ever *observed*, so it drifts as
        # the record grows and a new high retroactively shrinks every earlier
        # percentage. Capacity is a fixed physical property; where we have it,
        # it is the honest denominator.
        "capacity_af": capacity_af,
        "capacity_basis": capacity.get("capacity_basis"),
        "pct_of_capacity": _pct(current, capacity_af),
        "seasonal_percentile": _round(seasonal_percentile(series, last_date, current), 1),

        # --- "is this normal for the season?" ---
        "seasonal_normal_af": _round(seasonal_normal),
        "pct_of_seasonal_normal": _pct(current, seasonal_normal),
        # How many prior years the normal and the percentile are built from.
        # A percentile drawn from three years means something very different
        # from one drawn from eleven, and the dashboard should be able to say
        # so rather than presenting both as equally solid.
        "seasonal_sample_years": seasonal_years,

        # --- trend ---
        **changes,
        "peak_this_year_af": _round(peak_af),
        "peak_this_year_date": peak_date,
        "pct_of_peak_this_year": _pct(current, peak_af),
        "monthly": monthly_history(series),

        # --- provenance ---
        "first_obs": series.index[0].date().isoformat(),
        "n_obs": int(series.size),
        "years_of_record": _round((last_date - series.index[0]).days / 365.25, 1),
    }


def carry_forward(previous: dict, today: pd.Timestamp, reason: str) -> dict:
    """Reuse yesterday's record for a reservoir we couldn't refresh today.

    Dropping the reservoir entirely (the old behavior) silently removed the
    point from the map with no explanation, which is strictly worse than
    showing the last known value clearly labeled as stale.
    """
    record = dict(previous)
    as_of = pd.Timestamp(record.get("as_of"))
    record["days_stale"] = int((today - as_of).days) if not pd.isna(as_of) else None
    record["is_stale"] = True
    record["fetch_ok"] = False
    record["fetch_error"] = reason
    return record


def load_previous(path: Path) -> dict[str, dict]:
    """Index the last published output by reservoir name (tolerates both shapes)."""
    if not path.exists():
        return {}
    try:
        payload = json.loads(path.read_text())
    except ValueError:
        return {}
    records = payload if isinstance(payload, list) else payload.get("reservoirs", [])
    return {r["name"]: r for r in records if isinstance(r, dict) and "name" in r}


def _problem_table(problems: list[dict]) -> list[str]:
    rows = ["| Reservoir | As of | Days stale | Note |", "| --- | --- | ---: | --- |"]
    for r in problems:
        note = r.get("fetch_error", "no newer data published by RISE")
        rows.append(f"| {r['name']} | {r['as_of']} | {r.get('days_stale')} | {note} |")
    return rows


def _write_output(path: str, key: str, value: str) -> None:
    """Append a GitHub Actions step output, using heredoc form for multi-line."""
    with open(path, "a") as fh:
        if "\n" in value:
            fh.write(f"{key}<<__RESERVOIR_EOF__\n{value}\n__RESERVOIR_EOF__\n")
        else:
            fh.write(f"{key}={value}\n")


def emit_ci_signals(records: list[dict]) -> None:
    """Surface stale/failed reservoirs to the log, the job summary and the workflow.

    Three audiences, three formats:
      - ``::warning::`` annotations, so the run page shows them inline;
      - a job-summary table, so the run page shows them without expanding logs;
      - step outputs, so the workflow can act on them without re-parsing JSON.

    The step outputs are what let the workflow open and close the tracking
    issue by itself. Without them the pipeline can only *describe* a problem
    on a page nobody is watching, which is precisely how the 2026-07-29 freeze
    on Deer Creek / Red Fleet / Steinaker went unnoticed for eleven days --
    the information was all there, sitting in a green run.
    """
    problems = sorted(
        (r for r in records if r.get("is_stale") or not r.get("fetch_ok")),
        key=lambda r: -(r.get("days_stale") or 0),
    )
    for r in problems:
        detail = r.get("fetch_error", "no newer data published by RISE")
        print(f"::warning title=Stale reservoir::{r['name']} last updated "
              f"{r['as_of']} ({r.get('days_stale')} days ago) -- {detail}")

    summary_path = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary_path:
        lines = [f"### Reservoir refresh: {len(records)} reservoirs\n"]
        if problems:
            lines.append(f"**{len(problems)} stale or failed:**\n")
            lines.extend(_problem_table(problems))
        else:
            lines.append("All reservoirs fresh. :white_check_mark:")
        with open(summary_path, "a") as fh:
            fh.write("\n".join(lines) + "\n")

    output_path = os.environ.get("GITHUB_OUTPUT")
    if output_path:
        _write_output(output_path, "stale_count", str(len(problems)))
        _write_output(output_path, "stale_names",
                      ", ".join(r["name"] for r in problems))
        _write_output(output_path, "stale_table",
                      "\n".join(_problem_table(problems)) if problems else "")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--only", nargs="*", metavar="NAME",
                        help="debugging aid: fetch only these reservoirs and print the "
                             "resulting records to stdout. Never writes reservoirs.json, "
                             "since a partial run would drop every other reservoir.")
    parser.add_argument("--dry-run", action="store_true",
                        help="compute everything but don't write reservoirs.json")
    args = parser.parse_args()

    today = local_today()
    end = (today + pd.Timedelta(days=1)).strftime("%Y%m%d")
    previous = load_previous(OUTPUT_PATH)
    capacities = load_capacities()
    print(f"Capacities available for {len(capacities)}/{len(RESERVOIRS)} reservoirs")

    targets = RESERVOIRS
    if args.only:
        targets = {k: v for k, v in RESERVOIRS.items() if k in set(args.only)}
        missing = set(args.only) - set(targets)
        if missing:
            print(f"ERROR: unknown reservoir(s): {', '.join(sorted(missing))}", file=sys.stderr)
            return 2

    records = []
    for name, (item_id, lat, lon) in targets.items():
        try:
            df = fetch_rise_series(item_id, START_DATE, end)
        # Broad on purpose: the old handler only caught RequestException, so a
        # malformed payload (KeyError) or a schema change (TypeError) took the
        # entire 28-reservoir run down instead of costing one reservoir.
        except Exception as exc:  # noqa: BLE001
            reason = f"fetch failed after {RETRY_ATTEMPTS} attempts: {type(exc).__name__}: {exc}"
            print(f"WARNING: {name} (item {item_id}) -- {reason}")
            if name in previous:
                records.append(carry_forward(previous[name], today, reason))
            continue

        if df.empty:
            reason = "RISE returned no usable rows for the requested range"
            print(f"WARNING: {name} (item {item_id}) -- {reason}")
            if name in previous:
                records.append(carry_forward(previous[name], today, reason))
            continue

        records.append(summarize(name, item_id, lat, lon, df, today,
                                 capacities.get(name)))
        time.sleep(0.5)  # be polite to RISE's server

    if args.only:
        print(json.dumps(records, indent=2))
        return 0 if records else 1

    if not records:
        print("ERROR: no reservoir data at all -- refusing to overwrite reservoirs.json",
              file=sys.stderr)
        return 1

    fresh = [r for r in records if r.get("fetch_ok")]
    if len(fresh) < len(targets) / 2:
        print(f"ERROR: only {len(fresh)}/{len(targets)} reservoirs refreshed successfully "
              "-- refusing to overwrite reservoirs.json", file=sys.stderr)
        return 1

    records.sort(key=lambda r: (r.get("pct_of_record_max") is None, r.get("pct_of_record_max")))

    payload = {
        "generated_at": dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat(),
        "start_date": dt.datetime.strptime(START_DATE, "%Y%m%d").date().isoformat(),
        "stale_after_days": STALE_AFTER_DAYS,
        "source": "Bureau of Reclamation RISE API (https://data.usbr.gov/rise-api)",
        "reservoir_count": len(records),
        "stale_count": sum(1 for r in records if r.get("is_stale")),
        "capacity_count": sum(1 for r in records if r.get("capacity_af")),
        "reservoirs": records,
    }

    print(f"\nFreshness report ({today.date()}):")
    for r in sorted(records, key=lambda r: -(r.get("days_stale") or 0)):
        flag = "STALE" if r.get("is_stale") else "ok   "
        print(f"  {flag} {r['name']:<18} as_of={r['as_of']} "
              f"({r.get('days_stale')}d) n={r.get('n_obs')}")

    emit_ci_signals(records)

    if args.dry_run:
        print("\n--dry-run: not writing reservoirs.json")
        return 0

    OUTPUT_PATH.write_text(json.dumps(payload, indent=2) + "\n")
    print(f"\nWrote {len(records)} reservoirs ({payload['stale_count']} stale) to {OUTPUT_PATH}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
