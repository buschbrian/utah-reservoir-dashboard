"""Refresh reservoirs.json for the Utah Reservoir Drought Dashboard.

Pulls daily storage (af) from Reclamation RISE and daily/monthly storage
from USDA NRCS AWDB for the wider Utah reservoir inventory, then computes a
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

WHERE THINGS LIVE. This file is the orchestrator: read it for the sequence,
not for the arithmetic. Each specialised concern is a module in `pipeline/`
and every public name in them is re-exported here, so `import
refresh_reservoirs as R` still reaches all of it:

    pipeline.constants   paths, thresholds, schema and method versions
    pipeline.roster      the committed admissions and capacity evidence
    pipeline.providers   one adapter per provider, and their retry policy
    pipeline.seasonal    the estimator: window, annual votes, normals, rank
    pipeline.numbers     rounding and ratios, decided once
    pipeline.history     a series read at a date, and the last twelve months
    pipeline.freshness   carry-forward, withdrawal threshold, the notice
    pipeline.geography   county and drainage-area assignment

What stays here is what the orchestrator does with them: `summarize` (one
record from one series), the reference-export sections, the CI signals, and
`main`. See docs/architecture/pipeline.md and pipeline/AGENTS.md.
"""

import argparse
import datetime as dt
import json
import os
import sys
import time
from pathlib import Path

import pandas as pd

import huc
import watershed_scopes

# Every module in `pipeline/` is re-exported here, so `import
# refresh_reservoirs as R` still reaches the whole pipeline and a test that
# stubs a provider still stubs the object the fetcher calls (patch
# `R.providers._get_cdec_json`, not a copy of the name).
from pipeline import (  # noqa: F401
    constants, freshness, geography, history, numbers, providers, roster,
    seasonal,
)
from pipeline.constants import (  # noqa: F401
    ADMITTED_CDEC_RESERVOIRS_PATH, ADMITTED_RESERVOIRS_PATH,
    ADMITTED_RISE_RESERVOIRS_PATH, AWDB_DATA_URL,
    AWDB_MONTHLY_STALE_AFTER_DAYS, BASE_AWDB_RESERVOIRS, BASE_RISE_RESERVOIRS,
    CAPACITY_PATH, COUNTIES_PATH, DEFAULT_BASELINE, EXPORT_PATH,
    EXPORT_SCHEMA_VERSION, LOCAL_TZ, METHOD_VERSION, MIN_BASELINE_YEARS,
    NORMALS_PATH, OUTPUT_PATH, RESERVOIR_SCHEMA_VERSION, RISE_RESULT_URL,
    SEASONAL_WINDOW_DAYS, SOURCE_COVERAGE, SOURCE_COVERAGE_REVIEWED,
    STALE_AFTER_DAYS, START_DATE, WITHDRAW_AFTER_DAYS, local_today
)
from pipeline.roster import (  # noqa: F401
    ADMITTED_CDEC_RESERVOIRS, ADMITTED_RESERVOIRS, ADMITTED_RISE_RESERVOIRS,
    ALL_RESERVOIR_IDS, ALL_RESERVOIR_NAMES, AWDB_RESERVOIRS, CDEC_RESERVOIRS,
    REQUIRED_CAPACITY_EVIDENCE, RESERVOIRS, RESERVOIR_NAMES,
    load_admitted_cdec_reservoirs, load_admitted_reservoirs,
    load_admitted_rise_reservoirs, load_capacities,
    validate_capacity_evidence
)
from pipeline.providers import (  # noqa: F401
    CDEC_DATA_URL, CDEC_MISSING_VALUE, CDEC_STORAGE_SENSOR, MAX_PAGES,
    RETRY_ATTEMPTS, RETRY_BACKOFF_SECONDS, _get_awdb_json, _get_cdec_json,
    _get_json, fetch_awdb_series, fetch_cdec_series, fetch_rise_series
)
from pipeline.seasonal import (  # noqa: F401
    CANONICAL_YEAR_DAYS, annual_seasonal_values, canonical_day,
    climate_baseline, load_normals, normal_period,
    prior_annual_seasonal_values, seasonal_percentile, seasonal_rank,
    seasonal_window
)
from pipeline.numbers import (  # noqa: F401
    _pct, _round
)
from pipeline.history import (  # noqa: F401
    monthly_history, value_asof
)
from pipeline.freshness import (  # noqa: F401
    carry_forward, partition_by_age, withdrawal_notice
)
from pipeline.geography import (  # noqa: F401
    attach_counties, attach_watersheds, dam_points
)


def summarize(name: str, item_id: int | None, lat: float, lon: float,
              df: pd.DataFrame, today: pd.Timestamp,
              capacity: dict | None = None, *, source_key: str = "rise",
              source_label: str = "Bureau of Reclamation RISE",
              source_url: str = "https://data.usbr.gov/rise-api",
              data_frequency: str = "daily", stale_after_days: int = STALE_AFTER_DAYS,
              change_tolerance_days: int = 10,
              source_station_id: str | None = None,
              normals: dict | None = None) -> dict:
    """Turn one storage series into the record the dashboards consume."""
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
    #
    # One value per prior year, then the median across years. Pooling every
    # reading in the window let a year with daily readings outvote a year with
    # month-end ones about thirty to one, so the "normal" leaned on whichever
    # years the provider happened to report densely (`annual_seasonal_values`).
    population = prior_annual_seasonal_values(series, last_date)
    seasonal_normal = float(population.median()) if not population.empty else None
    seasonal_years = int(len(population))
    rank = seasonal_rank(series, last_date, current)

    # The two baselines, side by side and each carrying its own coverage.
    #
    # They are published together rather than one being chosen here, because
    # which one is right depends on the question. "Is this a normal year for
    # this reservoir?" wants the climate normal. "How does this compare with
    # the rest of the drought?" wants the recent one. The site lets the reader
    # ask either, and neither can be mistaken for the other because both name
    # their period and their sample size.
    station = source_station_id or (str(item_id) if item_id is not None else None)
    climate = climate_baseline(normals or {}, station, last_date, current)
    climate_record = ((normals or {}).get("by_station") or {}).get(str(station)) or {}
    climate_month_medians = ((climate_record.get("month") or {}).get("median_af")
                             if climate_record.get("available") else None)
    baselines = {
        "recent": {
            "normal_af": _round(seasonal_normal),
            "pct_of_normal": _pct(current, seasonal_normal),
            "sample_years": seasonal_years,
            # The recent baseline is every prior year we hold, so it always
            # covers its own period by construction. The field exists so both
            # baselines have the same shape and the client needs one code path.
            "covers_full_period": True,
            "first_obs": series.index[0].date().isoformat(),
        } if seasonal_normal is not None else None,
        "climate": climate,
    }
    # A reservoir younger than the climate period, or one with too few years in
    # it, falls back to the recent baseline rather than opening on a median
    # over three winters.
    usable_climate = (climate is not None
                      and climate["sample_years"] >= MIN_BASELINE_YEARS)
    baselines["default"] = (DEFAULT_BASELINE if DEFAULT_BASELINE != "climate"
                            or usable_climate else "recent")

    this_year = series[series.index.year == last_date.year]
    peak_af = float(this_year.max()) if not this_year.empty else None
    peak_date = this_year.idxmax().date().isoformat() if not this_year.empty else None

    changes = {}
    for label, days in (("7d", 7), ("30d", 30), ("365d", 365)):
        # A monthly series cannot support a seven-day claim. For 30-day and
        # annual comparisons, month-end observations are close enough when
        # a leap day or calendar-month length shifts the target slightly.
        found = (None if data_frequency == "monthly" and days == 7 else
                 value_asof(series, last_date - pd.Timedelta(days=days),
                            tolerance_days=change_tolerance_days))
        past, past_date = found if found else (None, None)
        changes[f"change_{label}_af"] = _round(None if past is None else current - past)
        changes[f"change_{label}_pct"] = None if not past else _round((current - past) / past * 100, 1)
        # What the change is actually a change from. The name is a target, not
        # a measurement: the tolerance is 10 days for a daily feed and 45 for a
        # month-end one, so "365-day change" has covered 320 days to 410.
        changes[f"change_{label}_reference_date"] = (
            None if past_date is None else past_date.date().isoformat())
        changes[f"change_{label}_elapsed_days"] = (
            None if past_date is None else int((last_date - past_date).days))

    capacity = capacity or {}
    capacity_af = capacity.get("capacity_af")

    return {
        "name": name,
        "rise_item_id": item_id,
        "source_key": source_key,
        "source_label": source_label,
        "source_url": source_url,
        "source_station_id": station,
        "data_frequency": data_frequency,
        "stale_after_days": stale_after_days,
        "lat": lat,
        "lon": lon,

        # --- freshness ---
        "as_of": last_date.date().isoformat(),
        "days_stale": days_stale,
        "is_stale": days_stale > stale_after_days,
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
        # The same comparison as an ordinal, which carries its own sample size.
        # "Third-lowest of eleven" cannot be read as more precise than it is;
        # "18th percentile" can, and was.
        "seasonal_rank": rank[0] if rank else None,
        "seasonal_rank_of": rank[1] if rank else None,

        # --- "is this normal for the season?" ---
        "seasonal_normal_af": _round(seasonal_normal),
        "pct_of_seasonal_normal": _pct(current, seasonal_normal),
        # How many prior years the normal and the percentile are built from.
        # A percentile drawn from three years means something very different
        # from one drawn from eleven, and the dashboard should be able to say
        # so rather than presenting both as equally solid.
        "seasonal_sample_years": seasonal_years,

        # --- the same question, asked against a choice of period ---
        # `seasonal_normal_af` above is the recent baseline and stays exactly
        # what it was, so nothing that already reads this payload changes
        # meaning. `baselines` is the addition.
        "baselines": baselines,

        # --- trend ---
        **changes,
        "peak_this_year_af": _round(peak_af),
        "peak_this_year_date": peak_date,
        "pct_of_peak_this_year": _pct(current, peak_af),
        "monthly": monthly_history(series, climate_months=climate_month_medians),

        # --- provenance ---
        "first_obs": series.index[0].date().isoformat(),
        "n_obs": int(series.size),
        "years_of_record": _round((last_date - series.index[0]).days / 365.25, 1),

        # Watershed membership is attached in main() rather than here: it is
        # pure geometry against a committed boundary file, it applies equally
        # to records carried forward from a failed fetch, and loading the
        # boundaries once for the whole run beats loading them 53 times.
    }


def load_capacity_catalog() -> dict:
    """capacities.json whole, provenance included.

    `load_capacities()` returns only the per-reservoir table, because the
    daily refresh needs nothing but the denominators. The export carries the
    file's header too -- which National Inventory of Dams layer the numbers
    came from, when it was retrieved, and which of the several storage
    figures the denominator is. A capacity without that is a number the
    reader has no way to check.

    Unreadable is fatal here, unlike in `load_capacities()`. Skipping the
    capacities costs the daily refresh one derived field; skipping them in a
    file whose whole purpose is to carry them ships something that looks
    complete and is not.
    """
    catalog = json.loads(CAPACITY_PATH.read_text(encoding="utf-8"))
    catalog["capacities"] = load_capacities()
    # Said out loud in the file rather than left for a reader to infer from a
    # key that looks like a name for 30 of them and a triplet for the rest
    # (ADR-066).
    catalog["keyed_by"] = "source_station_id"
    catalog["admitted_reservoirs"] = ADMITTED_RESERVOIRS_PATH.name
    catalog["admitted_rise_reservoirs"] = ADMITTED_RISE_RESERVOIRS_PATH.name
    catalog["admitted_cdec_reservoirs"] = ADMITTED_CDEC_RESERVOIRS_PATH.name
    catalog["dam_points"]["count"] = sum(
        1 for entry in catalog["capacities"].values()
        if entry.get("dam_lon") is not None and entry.get("dam_lat") is not None)
    return catalog


def _feature_collection(path: Path) -> dict:
    """Read a committed boundary file, refusing an empty or wrong-shaped one."""
    payload = json.loads(path.read_text(encoding="utf-8"))
    if payload.get("type") != "FeatureCollection" or not payload.get("features"):
        raise ValueError(f"{path.name} is not a populated FeatureCollection")
    return payload


def build_watershed_sections() -> dict:
    """Every named scope's units, validated, plus which one is published.

    Names and codes, not polygons. The geometry used to travel here -- 982 KB
    of it, which was 98% of this file -- and every map page fetched the whole
    thing and then walked it coordinate by coordinate on the main thread to
    type-check it. The maps take their outlines from the hosted Watershed
    Boundary Dataset now, quantized to whatever the reader is looking at, so
    what this file still owes them is the roster: which areas are in scope,
    what each is called, which states it touches, and a box to open a map on
    (`bbox`, `huc.outer_bbox`) -- four numbers rather than the ring itself,
    coarsened outward so it still contains what it is a box of. Publishing
    that is what lets `src/viz/extent.ts` build an opening view for any set
    of units a reader chooses (state, region, subregion) without shipping
    the polygons a view like that would otherwise need in the browser.

    The committed GeoJSON does not go away. `source_file` still names it, the
    pipeline still assigns every reservoir with it, and it stays reviewable in
    the repository -- it simply stops being published, exactly as normals.json
    already is. That is what keeps the outlines from disagreeing with the
    assignments: the codes published here are read out of that same file.

    All of them, not just the drawn one: the scopes exist to be compared
    (docs/UPPER-COLORADO-PIPELINE.md), and a research scope that ships only
    as a file on disk cannot be compared against anything. `default_scope`
    is what keeps that from changing the dashboard -- the extra scopes are
    available, and one of them is the accepted geography.

    Two of them are named. `default_scope` is what the maps draw, 75 basins
    since 2026-08-18; `roster_scope` is the geography the reservoir roster was
    admitted from, still the fourteen areas that touch Utah, and it is what
    the storage map opens on (ADR-063). They were the same name for as long
    as coverage and roster moved together.

    A *published* scope that is missing, short, duplicated or out of region
    raises rather than exporting quietly. This is reference data assembled
    from committed files, not a network fetch that might come back thin;
    there is no partial answer here that is better than a loud failure.

    A registered scope that is not published is skipped, and that is not the
    same thing as tolerating a missing file. A geography gets registered,
    fetched, measured and reviewed before anything draws it -- the western
    scopes are in that state now -- and until it is marked for publication
    there is nothing for this export to be missing.
    """
    offered = watershed_scopes.DRAWN_SCOPES
    if watershed_scopes.DEFAULT_SCOPE not in offered.values():
        raise ValueError(
            f"the drawn scope {watershed_scopes.DEFAULT_SCOPE!r} is not one of the "
            f"levels on offer: {sorted(offered)}")
    for level, name in offered.items():
        scope = watershed_scopes.get_scope(name)
        if scope.level != level:
            raise ValueError(
                f"{name!r} is registered at level {scope.level} and offered at {level}")
        if not scope.published:
            raise ValueError(
                f"{name!r} is offered as a drawn level and is not published, so its "
                "roster would be missing from this file")

    scopes = {}
    for name, scope in sorted(watershed_scopes.SCOPES.items()):
        if not scope.published:
            continue
        boundaries = _feature_collection(watershed_scopes.ROOT / scope.output)
        field = watershed_scopes.huc_field(scope.level)
        codes = watershed_scopes.validate_huc_codes(
            [feature["properties"][field] for feature in boundaries["features"]],
            scope.level, scope.region)
        if scope.expected_count is not None and len(codes) != scope.expected_count:
            raise ValueError(f"expected {scope.expected_count} units for {name}, "
                             f"received {len(codes)}")
        # Bounds per unit, exact, keyed by the code every unit below reads by.
        # `huc.units_from_collection` already computes this for the point-in-
        # polygon assignment (`assign_huc`'s bounding-box prefilter), and it
        # is the same committed geometry the export reads -- so this is a
        # second read of the ring coordinates, not a second measurement of
        # them, and the two can never disagree about where a unit sits.
        exact_bounds = {unit["huc6"]: unit["bounds"]
                        for unit in huc.units_from_collection(boundaries)}
        scopes[name] = {
            "name": scope.name,
            "description": scope.description,
            "source_file": scope.output,
            "level": scope.level,
            "unit_count": len(codes),
            field: codes,
            "units": [
                {
                    field: feature["properties"][field],
                    "name": feature["properties"].get("name", ""),
                    "states": feature["properties"].get("states", ""),
                    # [west, south, east, north] in decimal degrees, rounded
                    # outward (`huc.outer_bbox`) so a reader who opens a map
                    # on this box gets the whole area and not a hairline of
                    # it cut off by a coarsened edge. This is what
                    # `src/viz/extent.ts`'s opening-box chooser (S2) unions
                    # over a set of units, and what `extent.test.ts` holds
                    # `HUC6_BOUNDS` against for the roster scope.
                    "bbox": huc.outer_bbox(exact_bounds[feature["properties"][field]]),
                }
                for feature in boundaries["features"]
            ],
        }

    return {
        "default_scope": watershed_scopes.DEFAULT_SCOPE,
        # Which areas are drawn and which areas hold reservoirs stopped being
        # one question when the coverage moved west (ADR-063). A client that
        # wants the geography the roster covers -- the storage map's opening
        # extent is the one that does -- reads this rather than assuming the
        # drawn scope, and `src/viz/extent.ts` is held against the file it
        # names so the box cannot drift from the reservoirs.
        "roster_scope": watershed_scopes.ROSTER_SCOPE,
        # The levels a reader may choose between and the scope drawn at each
        # (ADR-064), as strings because JSON object keys are strings. Every
        # one of them is a scope published above, and `default_scope` is one
        # of them -- both asserted, because a level offered with no roster
        # behind it is a control that empties the map.
        "drawn_scopes": {str(level): name
                         for level, name in sorted(watershed_scopes.DRAWN_SCOPES.items())},
        "scopes": scopes,
    }


def build_coverage(records: list[dict]) -> dict:
    """How complete this roster is, state by state, and what is missing.

    Two halves that answer to different authorities. The counts are the
    payload's own arithmetic over the records it holds, so they cannot drift
    from it. The gaps are a reviewed judgement about the world outside the
    payload, which no amount of counting could produce
    (`SOURCE_COVERAGE`).

    Grouped on `waterbody_states` rather than the point's own state, the same
    question the state filter asks (ADR-060): a reader looking at Utah's list
    should see the completeness of the list they are looking at.

    Reference volume as well as count, because the two disagree and the
    disagreement is the point. Colorado's missing reservoirs are numerous and
    individually small; a state can be most of the way there by volume and a
    third of the way there by count.
    """
    coverage: dict[str, dict] = {}
    for record in records:
        states = record.get("waterbody_states") or (
            [record["state"]] if record.get("state") else [])
        for state in states:
            entry = coverage.setdefault(state, {
                "tracked_reservoir_count": 0,
                "tracked_reference_capacity_af": 0.0,
                "daily_count": 0,
                "monthly_count": 0,
                "current_count": 0,
                "climate_baseline_count": 0,
            })
            entry["tracked_reservoir_count"] += 1
            entry["tracked_reference_capacity_af"] += float(
                record.get("capacity_af") or record.get("record_max_af") or 0.0)
            if record.get("data_frequency") == "monthly":
                entry["monthly_count"] += 1
            else:
                entry["daily_count"] += 1
            if not record.get("is_stale"):
                entry["current_count"] += 1
            if (record.get("baselines") or {}).get("climate"):
                entry["climate_baseline_count"] += 1

    for state, entry in coverage.items():
        entry["tracked_reference_capacity_af"] = _round(
            entry["tracked_reference_capacity_af"])
        # A state with no reviewed entry says so rather than being given a
        # verdict the review never reached.
        reviewed = SOURCE_COVERAGE.get(state)
        entry["status"] = (reviewed or {}).get("status", "not reviewed")
        entry["known_additional_source"] = (reviewed or {}).get("source")
        entry["known_additional_source_url"] = (reviewed or {}).get("url")
        entry["known_additional_about"] = (reviewed or {}).get("adds_about")
        entry["note"] = (reviewed or {}).get(
            "note", "This state has not been reviewed for other sources.")
    return {
        "reviewed": SOURCE_COVERAGE_REVIEWED,
        "basis": "waterbody_states",
        "note": ("These are the reservoirs this site tracks, not all the "
                 "stored water in a state."),
        "states": dict(sorted(coverage.items())),
    }


def build_export_sections() -> dict:
    """The reference half of the dashboard's data, in one payload.

    Capacity and geography are the parts that change on the order of never,
    and they are the parts every surface needs before it can draw anything:
    a percentage needs its denominator, and a map needs its outlines. Today
    they are four separate committed files that each page fetches by name, so
    every new surface re-learns which files exist and what shape each one is
    in, and a reader has no single thing to check for whether the reference
    data is the version it expects -- which is what `schema_version` is for.

    Deliberately separate from reservoirs.json, which is the other half: that
    file is rewritten every morning and its commit is the deploy (ADR-002).
    Folding never-changing geometry into a daily payload would put a megabyte
    of unchanged polygons in every day's diff and make the storage numbers
    harder to review, which is the one thing that diff is for.

    No state boundary here since ADR-067. `huc.UTAH_BOUNDARY_PATH` still
    exists and is still committed, but nothing draws a mask from it any
    more, so `in_utah` and `intersects_utah` are the only readers left --
    and both are computed here in the pipeline, from the file directly,
    rather than from anything this export publishes.
    """
    return {
        "schema_version": EXPORT_SCHEMA_VERSION,
        "capacity_catalog": load_capacity_catalog(),
        "geography": {
            "watersheds": build_watershed_sections(),
        },
    }


def load_previous(path: Path) -> dict[str, dict]:
    """Index the last published output by station id (tolerates both shapes).

    By station since ADR-066. This is what `carry_forward` reads when a feed
    goes quiet, so a name index would republish one reservoir's last reading
    under another reservoir's name on the morning a same-named station failed.
    """
    if not path.exists():
        return {}
    try:
        payload = json.loads(path.read_text())
    except ValueError:
        return {}
    records = payload if isinstance(payload, list) else payload.get("reservoirs", [])
    return {str(r["source_station_id"]): r for r in records
            if isinstance(r, dict) and r.get("source_station_id")}


def _problem_table(problems: list[dict]) -> list[str]:
    rows = ["| Reservoir | As of | Days stale | Note |", "| --- | --- | ---: | --- |"]
    for r in problems:
        note = r.get("fetch_error", "no newer data published by the source")
        rows.append(f"| {r['name']} | {r['as_of']} | {r.get('days_stale')} | {note} |")
    return rows


def _write_output(path: str, key: str, value: str) -> None:
    """Append a GitHub Actions step output, using heredoc form for multi-line."""
    with open(path, "a") as fh:
        if "\n" in value:
            fh.write(f"{key}<<__RESERVOIR_EOF__\n{value}\n__RESERVOIR_EOF__\n")
        else:
            fh.write(f"{key}={value}\n")


def emit_ci_signals(records: list[dict],
                    withdrawn: list[dict] | None = None) -> None:
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
        detail = r.get("fetch_error", "no newer data published by the source")
        print(f"::warning title=Stale reservoir::{r['name']} last updated "
              f"{r['as_of']} ({r.get('days_stale')} days ago) -- {detail}")

    summary_path = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary_path:
        lines = [f"### Reservoir refresh: {len(records)} reservoirs\n"]
        if withdrawn:
            lines.append(
                f"**{len(withdrawn)} withdrawn** -- older than "
                f"{WITHDRAW_AFTER_DAYS} days, so not published at all:\n")
            lines.extend(_problem_table(withdrawn))
            lines.append("")
        if problems:
            lines.append(f"**{len(problems)} stale or failed:**\n")
            lines.extend(_problem_table(problems))
        elif not withdrawn:
            lines.append("All reservoirs fresh. :white_check_mark:")
        with open(summary_path, "a") as fh:
            fh.write("\n".join(lines) + "\n")

    for r in withdrawn or ():
        print(f"::error title=Withdrawn reservoir::{r['name']} last updated "
              f"{r['as_of']} ({r.get('days_stale')} days ago) -- past the "
              f"{WITHDRAW_AFTER_DAYS}-day publication window, so it is not in "
              "this morning's payload")

    output_path = os.environ.get("GITHUB_OUTPUT")
    if output_path:
        _write_output(output_path, "stale_count", str(len(problems)))
        _write_output(output_path, "stale_names",
                      ", ".join(r["name"] for r in problems))
        _write_output(output_path, "stale_table",
                      "\n".join(_problem_table(problems)) if problems else "")
        _write_output(output_path, "withdrawn_count", str(len(withdrawn or ())))
        _write_output(output_path, "withdrawn_names",
                      ", ".join(r["name"] for r in withdrawn or ()))
        _write_output(output_path, "withdrawn_table",
                      "\n".join(_problem_table(withdrawn)) if withdrawn else "")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--only", nargs="*", metavar="NAME",
                        help="debugging aid: fetch only these reservoirs and print the "
                             "resulting records to stdout. Never writes reservoirs.json, "
                             "since a partial run would drop every other reservoir.")
    parser.add_argument("--dry-run", action="store_true",
                        help="compute everything but don't write reservoirs.json")
    parser.add_argument("--source", choices=("all", "rise", "awdb", "cdec"), default="all",
                        help="refresh one source and merge the other source's previously "
                             "published records (default: all)")
    args = parser.parse_args()

    today = local_today()
    end = (today + pd.Timedelta(days=1)).strftime("%Y%m%d")
    previous = load_previous(OUTPUT_PATH)
    capacities = load_capacities()
    normals = load_normals()
    if normals:
        available = sum(1 for r in normals["by_station"].values() if r.get("available"))
        period = normals["period"]
        print(f"Climate normals available: {available} of {len(normals['by_station'])} "
              f"reservoirs, {period.get('start_year')} through {period.get('end_year')} "
              f"(built {normals.get('built')})")
    print(f"NID capacity records available: {len(capacities)} "
          f"({len(RESERVOIRS)} Reclamation, {len(ADMITTED_RESERVOIRS)} admitted, "
          f"{len(ADMITTED_CDEC_RESERVOIRS)} California)")

    rise_targets = RESERVOIRS if args.source in {"all", "rise"} else {}
    awdb_targets = AWDB_RESERVOIRS if args.source in {"all", "awdb"} else {}
    cdec_targets = CDEC_RESERVOIRS if args.source in {"all", "cdec"} else {}
    if args.only:
        # Named, because a person types a name and not a station triplet. The
        # roster is keyed by station since ADR-066, so a name is resolved to
        # the stations that carry it -- plural on purpose: asking for "Lost
        # Creek" where two exist probes both rather than silently picking one.
        wanted = set(args.only)
        chosen = {station for station, name in RESERVOIR_NAMES.items()
                  if name in wanted} | (wanted & set(RESERVOIR_NAMES))
        rise_targets = {k: v for k, v in RESERVOIRS.items() if k in chosen}
        awdb_targets = {k: v for k, v in AWDB_RESERVOIRS.items() if k in chosen}
        cdec_targets = {k: v for k, v in CDEC_RESERVOIRS.items() if k in chosen}
        found = {RESERVOIR_NAMES.get(station, station)
                 for station in set(rise_targets) | set(awdb_targets)
                 | set(cdec_targets)}
        missing = (wanted - found - set(rise_targets) - set(awdb_targets)
                   - set(cdec_targets))
        if missing:
            print(f"ERROR: unknown reservoir(s): {', '.join(sorted(missing))}", file=sys.stderr)
            return 2

    records = []
    for station_id, (name, lat, lon) in rise_targets.items():
        # The key is the identity and the value carries the label (ADR-066).
        item_id = int(station_id)
        try:
            df = fetch_rise_series(item_id, START_DATE, end)
        # Broad on purpose: the old handler only caught RequestException, so a
        # malformed payload (KeyError) or a schema change (TypeError) took the
        # entire 28-reservoir run down instead of costing one reservoir.
        except Exception as exc:  # noqa: BLE001
            reason = f"fetch failed after {RETRY_ATTEMPTS} attempts: {type(exc).__name__}: {exc}"
            print(f"WARNING: {name} (item {item_id}) -- {reason}")
            if station_id in previous:
                records.append(carry_forward(previous[station_id], today, reason))
            continue

        if df.empty:
            reason = "RISE returned no usable rows for the requested range"
            print(f"WARNING: {name} (item {item_id}) -- {reason}")
            if station_id in previous:
                records.append(carry_forward(previous[station_id], today, reason))
            continue

        records.append(summarize(name, item_id, lat, lon, df, today,
                                 capacities.get(station_id), normals=normals))
        time.sleep(0.5)  # be polite to RISE's server

    for station_triplet, (name, lat, lon, capacity_af, cadence) in awdb_targets.items():
        try:
            df = fetch_awdb_series(station_triplet, cadence, START_DATE, end)
        except Exception as exc:  # noqa: BLE001
            reason = (f"AWDB fetch failed after {RETRY_ATTEMPTS} attempts: "
                      f"{type(exc).__name__}: {exc}")
            print(f"WARNING: {name} ({station_triplet}) -- {reason}")
            if station_triplet in previous:
                records.append(carry_forward(previous[station_triplet], today, reason))
            continue

        if df.empty:
            reason = f"AWDB returned no usable {cadence} RESC rows"
            print(f"WARNING: {name} ({station_triplet}) -- {reason}")
            if station_triplet in previous:
                records.append(carry_forward(previous[station_triplet], today, reason))
            continue

        stale_after = (AWDB_MONTHLY_STALE_AFTER_DAYS
                       if cadence == "monthly" else STALE_AFTER_DAYS)
        capacity = (ADMITTED_RESERVOIRS.get(station_triplet) or {}).get("capacity") or {
            "capacity_af": capacity_af,
            "capacity_basis": "awdb_reservoir_metadata",
        }
        records.append(summarize(
            name, None, lat, lon, df, today,
            capacity,
            source_key="awdb", source_label="USDA NRCS AWDB",
            source_url="https://wcc.sc.egov.usda.gov/awdbWebService/",
            data_frequency=cadence, stale_after_days=stale_after,
            change_tolerance_days=45 if cadence == "monthly" else 10,
            source_station_id=station_triplet,
            normals=normals,
        ))
        time.sleep(0.1)

    for station, (name, lat, lon, capacity_af, cadence) in cdec_targets.items():
        try:
            df = fetch_cdec_series(station, cadence, START_DATE, end)
        except Exception as exc:  # noqa: BLE001
            reason = (f"CDEC fetch failed after {RETRY_ATTEMPTS} attempts: "
                      f"{type(exc).__name__}: {exc}")
            print(f"WARNING: {name} ({station}) -- {reason}")
            if station in previous:
                records.append(carry_forward(previous[station], today, reason))
            continue

        if df.empty:
            reason = f"CDEC returned no usable {cadence} storage rows"
            print(f"WARNING: {name} ({station}) -- {reason}")
            if station in previous:
                records.append(carry_forward(previous[station], today, reason))
            continue

        stale_after = (AWDB_MONTHLY_STALE_AFTER_DAYS
                       if cadence == "monthly" else STALE_AFTER_DAYS)
        records.append(summarize(
            name, None, lat, lon, df, today,
            ADMITTED_CDEC_RESERVOIRS[station]["capacity"],
            source_key="cdec", source_label="California Data Exchange Center",
            source_url="https://cdec.water.ca.gov/",
            data_frequency=cadence, stale_after_days=stale_after,
            # A month-end feed's "30-day change" is the nearest reading inside
            # a wider tolerance, exactly as AWDB's is.
            change_tolerance_days=45 if cadence == "monthly" else 10,
            source_station_id=station,
            normals=normals,
        ))
        time.sleep(0.2)

    if args.only:
        print(json.dumps(records, indent=2))
        return 0 if records else 1

    # A source-specific refresh is useful for the slower, independently
    # scheduled feeds. Preserve the other source instead of turning a partial
    # refresh into a partial dashboard.
    selected_stations = set(rise_targets) | set(awdb_targets) | set(cdec_targets)
    if args.source != "all":
        records.extend(record for station, record in previous.items()
                       if station not in selected_stations)

    if not records:
        print("ERROR: no reservoir data at all -- refusing to overwrite reservoirs.json",
              file=sys.stderr)
        return 1

    # By station id, which is what `rise_targets` and `awdb_targets` are keyed
    # by since ADR-066. Matching on the name here counted nothing at all and
    # refused every run -- the guard doing its job against itself.
    attempted = [r for r in records
                 if str(r.get("source_station_id")) in selected_stations]
    fresh = [r for r in attempted if r.get("fetch_ok")]
    if len(fresh) < len(selected_stations) / 2:
        print(f"ERROR: only {len(fresh)}/{len(selected_stations)} reservoirs refreshed "
              "successfully -- refusing to overwrite reservoirs.json", file=sys.stderr)
        return 1

    # Older committed RISE records predate mixed-source provenance. A
    # source-specific AWDB refresh merges them unchanged numerically, but the
    # newly written envelope should still be self-describing without relying
    # on browser-side defaults.
    for record in records:
        if not record.get("source_key"):
            record["source_key"] = "rise"
            record["source_label"] = "Bureau of Reclamation RISE"
            record["source_url"] = "https://data.usbr.gov/rise-api"
            record["source_station_id"] = str(record.get("rise_item_id"))
            record["data_frequency"] = "daily"
            record["stale_after_days"] = STALE_AFTER_DAYS

    records, withdrawn = partition_by_age(records)

    watersheds = attach_watersheds(records)
    counties = attach_counties(records)

    # Physical size is the primary browse order in every surface.
    records.sort(key=lambda r: (r.get("capacity_af") is None,
                                -(r.get("capacity_af") or 0), r.get("name", "")))

    payload = {
        "schema_version": RESERVOIR_SCHEMA_VERSION,
        # What computed the numbers, which a schema version cannot see.
        #
        # A field can keep its name, its type and its units while the estimator
        # under it changes -- `seasonal_normal_af` went from a median over
        # every reading in the window to a median over one value per year, and
        # nothing about the shape of the file moved. Anyone comparing two of
        # these files across that change needs to be able to tell.
        "method_version": METHOD_VERSION,
        "generated_at": dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat(),
        "start_date": dt.datetime.strptime(START_DATE, "%Y%m%d").date().isoformat(),
        "normal_period": normal_period(today),
        "normal_window_days": SEASONAL_WINDOW_DAYS,
        # The periods a reader can measure against, and which one the site
        # opens on. The recent period's end year moves with the calendar; the
        # climate period is fixed, which is the point of it.
        "baselines": [
            {
                "id": "recent",
                "label": "Recent years",
                "period_label": (f"{normal_period(today)['start_year']} through "
                                 f"{normal_period(today)['end_year']}"),
                **normal_period(today),
                "note": ("Every earlier year this site holds. It begins in 2015 "
                         "because that is when this site starts collecting, and "
                         "those years have been unusually dry, so a reservoir "
                         "can look ordinary against them and still be low."),
            },
            {
                "id": "climate",
                "label": "Standard climate period",
                "period_label": (
                    f"{(normals.get('period') or {}).get('start_year', 1991)} through "
                    f"{(normals.get('period') or {}).get('end_year', 2020)}"),
                "start_year": (normals.get("period") or {}).get("start_year", 1991),
                "end_year": (normals.get("period") or {}).get("end_year", 2020),
                "note": ("The thirty year period the World Meteorological "
                         "Organization defines as standard, and the same period "
                         "the mountain snow measurements use. Not every reservoir "
                         "existed for all of it, and each one reports how many "
                         "years it has."),
            },
        ],
        "default_baseline": DEFAULT_BASELINE,
        "climate_normals": {
            "built": normals.get("built"),
            "file": NORMALS_PATH.name,
            # The committed file's own estimator, published rather than
            # assumed. The two baselines are only comparable while they agree,
            # and `load_normals` says so loudly when they do not.
            "method_version": normals.get("method_version"),
            "available_count": sum(
                1 for r in records if (r.get("baselines") or {}).get("climate")),
            "minimum_years": MIN_BASELINE_YEARS,
        },
        # What this roster is, and what it is not. See `build_coverage`.
        "coverage": build_coverage(records),
        "stale_after_days": STALE_AFTER_DAYS,
        "stale_after_days_by_cadence": {"daily": STALE_AFTER_DAYS,
                                         "monthly": AWDB_MONTHLY_STALE_AFTER_DAYS},
        "source": ("Bureau of Reclamation RISE API, USDA NRCS AWDB and the "
                   "California Data Exchange Center"),
        "sources": [
            {"key": "rise", "label": "Bureau of Reclamation RISE",
             "url": "https://data.usbr.gov/rise-api", "cadence": "daily"},
            {"key": "awdb", "label": "USDA NRCS AWDB",
             "url": "https://wcc.sc.egov.usda.gov/awdbWebService/",
             "cadence": "daily or monthly by station"},
            {"key": "cdec", "label": "California Data Exchange Center",
             "url": "https://cdec.water.ca.gov/",
             "cadence": "daily or monthly by station"},
        ],
        "source_counts": {
            "rise": sum(1 for r in records if r.get("source_key", "rise") == "rise"),
            "awdb": sum(1 for r in records if r.get("source_key") == "awdb"),
            "cdec": sum(1 for r in records if r.get("source_key") == "cdec"),
        },
        "reservoir_count": len(records),
        "stale_count": sum(1 for r in records if r.get("is_stale")),
        "capacity_count": sum(1 for r in records if r.get("capacity_af")),
        # What this run declined to publish, and the line it was judged
        # against. A withdrawn reservoir leaves `reservoirs` entirely, so
        # without these fields the roster would just be quietly shorter and
        # a reader comparing two mornings could not tell a withdrawal from a
        # reservoir that had never been here (ADR-056).
        "withdraw_after_days": WITHDRAW_AFTER_DAYS,
        "withdrawn_count": len(withdrawn),
        "withdrawn": [withdrawal_notice(r) for r in withdrawn],
        # Drainage areas are described in the envelope so a reader can tell
        # a run that assigned nothing (a missing boundary file) from one
        # where nothing needed assigning.
        "watersheds": {
            "source": "USGS Watershed Boundary Dataset",
            # How big the drainage areas are, as the length of their code.
            # Stated rather than assumed: the codes are fixed-width, so a
            # reader who knows the level knows the size, and a payload that
            # ever carries another one says so instead of looking like a
            # six-digit payload with odd codes in it.
            "level": watershed_scopes.get_scope(
                watershed_scopes.DEFAULT_SCOPE).level,
            "boundaries": huc.BOUNDARY_PATH.name,
            "assignment_rule": "the dam or outlet point, not the middle of the water",
            **watersheds,
            "in_utah": sum(1 for r in records if r.get("in_utah")),
            "intersects_utah": sum(1 for r in records
                                    if r.get("intersects_utah")),
            # The coarser grouping, for a reader who wants subregions rather
            # than the fourteen areas. Derived from the codes in this payload,
            # so it can never name an area the payload does not contain.
            "subregions": huc.subregion_roster(r.get("huc6") for r in records),
        },
        # Counties are described in the envelope for the same reason, and
        # carry their assignment rule for the opposite one: it is deliberately
        # *not* the drainage rule above. A reader comparing the two lines is
        # meant to see that they differ (ADR-058).
        "counties": {
            "source": "Esri Living Atlas, USA Census Counties",
            "assignment_rule": "the published waterbody point, not the dam",
            **counties,
        },
        "reservoirs": records,
    }

    print(f"\nFreshness report ({today.date()}):")
    for r in sorted(records, key=lambda r: -(r.get("days_stale") or 0)):
        flag = "STALE" if r.get("is_stale") else "ok   "
        print(f"  {flag} {r['name']:<18} as_of={r['as_of']} "
              f"({r.get('days_stale')}d) n={r.get('n_obs')}")

    emit_ci_signals(records, withdrawn)

    if args.dry_run:
        print("\nPayload comparison metadata:")
        print(json.dumps({
            "normal_period": payload["normal_period"],
            "normal_window_days": payload["normal_window_days"],
        }, indent=2))
        print("\n--dry-run: not writing reservoirs.json")
        return 0

    OUTPUT_PATH.write_text(json.dumps(payload, indent=2) + "\n")
    print(f"\nWrote {len(records)} reservoirs ({payload['stale_count']} stale) to {OUTPUT_PATH}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
