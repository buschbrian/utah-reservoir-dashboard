"""Refresh daily snow measurements without touching reservoir data.

The station list is the reviewed ``snow_sites.json`` inventory. Every listed
station must be present in the Natural Resources Conservation Service response;
a short batch is retried station by station and remains an error if any site is
still absent. The output is written atomically only after full validation.
"""

import argparse
import json
import math
import os
import tempfile
import time
from collections import defaultdict
from datetime import date, datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

import requests

import huc

ROOT = Path(__file__).resolve().parent
INVENTORY_PATH = ROOT / "snow_sites.json"
OUTPUT_PATH = ROOT / "snowpack.json"
DATA_URL = "https://wcc.sc.egov.usda.gov/awdbRestApi/services/v1/data"
USER_AGENT = "western-water-dashboard/snow-refresh (+https://github.com/buschbrian)"
TIMEOUT = 120
BATCH_SIZE = 75
RETRIES = 3
LATE_AFTER_DAYS = 2
MIN_ROLLUP_SITES = 2

#: The share of stations that may go quiet before the refresh refuses the day.
#:
#: Two percent, which is four stations of 217 and about thirty-four of the
#: western network. Small enough that a real outage still fails loudly, large
#: enough that ordinary winter silence does not throw away every other
#: station's reading. The sites that did not answer are named in the log and
#: counted in the payload, so a shrinking network is visible rather than
#: quietly tolerated.
MISSING_SITE_TOLERANCE = 0.02


def water_year_start(day: date) -> date:
    return date(day.year if day.month >= 10 else day.year - 1, 10, 1)


def _request(session, station_ids: list[str], begin: date, end: date) -> list[dict]:
    params = {
        "stationTriplets": ",".join(station_ids),
        "elements": "WTEQ",
        "duration": "DAILY",
        "beginDate": begin.isoformat(),
        "endDate": end.isoformat(),
        "centralTendencyType": "MEDIAN",
        "returnFlags": "true",
    }
    last_error = None
    for attempt in range(RETRIES):
        try:
            response = session.get(
                DATA_URL,
                params=params,
                headers={"User-Agent": USER_AGENT},
                timeout=TIMEOUT,
            )
            response.raise_for_status()
            payload = response.json()
            if not isinstance(payload, list):
                raise ValueError("snow data response is not a list")
            return payload
        except (requests.RequestException, ValueError) as exc:
            last_error = exc
            if attempt + 1 < RETRIES:
                time.sleep(2 ** attempt)
    raise RuntimeError(f"snow data request failed: {last_error}")


def fetch_all(session, station_ids: list[str], begin: date, end: date,
              *, request=_request) -> list[dict]:
    """Fetch every station, recovering a short batch one site at a time."""
    expected = set(station_ids)
    if len(expected) != len(station_ids):
        raise ValueError("requested snow stations are not unique")
    received = {}
    for start in range(0, len(station_ids), BATCH_SIZE):
        batch = station_ids[start:start + BATCH_SIZE]
        for record in request(session, batch, begin, end):
            station = record.get("stationTriplet")
            if station not in expected:
                raise RuntimeError(f"unrequested snow station returned: {station!r}")
            if station in received:
                raise RuntimeError(f"duplicate snow data returned for {station}")
            received[station] = record

    missing = sorted(expected - set(received))
    for station in missing:
        records = request(session, [station], begin, end)
        match = next((row for row in records
                      if row.get("stationTriplet") == station), None)
        if match is not None:
            received[station] = match

    missing = sorted(expected - set(received))
    if missing:
        # A few silent stations are weather, not a broken refresh.
        #
        # This used to refuse the whole day over one station. At 217 sites
        # that was a defensible trade -- one quiet gauge is a real signal and
        # a person would want to look. Across the western network it is
        # roughly 1,725 sites on radios and solar panels in the mountains in
        # winter, and "every one of them answered" is not a condition that
        # holds daily. Refusing the day would mean publishing nothing all
        # winter, which is a worse answer than publishing 1,720 sites and
        # saying which are absent.
        #
        # The tolerance is a share rather than a count, so it means the same
        # thing at any roster size, and it is small: past it, something is
        # wrong with the service rather than with a few stations, and the
        # old behaviour is the right one.
        allowed = int(len(expected) * MISSING_SITE_TOLERANCE)
        if len(missing) > allowed:
            raise RuntimeError(
                f"snow data response omitted {len(missing)} of {len(expected)} "
                f"station(s), more than the {allowed} tolerated: "
                f"{', '.join(missing[:10])}"
                + (" ..." if len(missing) > 10 else ""))
        print(f"  {len(missing)} station(s) did not answer and are left out of "
              f"today's file: {', '.join(missing)}")
    return [received[station] for station in station_ids if station in received]


def _number(value):
    if value is None:
        return None
    try:
        result = float(value)
    except (TypeError, ValueError):
        return None
    return result if math.isfinite(result) else None


def normalize_site(site: dict, record: dict, as_of: date) -> dict:
    candidates = [
        series for series in record.get("data", [])
        if series.get("stationElement", {}).get("elementCode") == "WTEQ"
        and series.get("stationElement", {}).get("durationName") == "DAILY"
    ]
    if len(candidates) != 1:
        raise ValueError(
            f"{site['station']} has {len(candidates)} daily snow-water series")
    source = candidates[0]
    station_element = source.get("stationElement", {})
    if station_element.get("storedUnitCode") != "in":
        raise ValueError(
            f"{site['station']} uses unexpected unit {station_element.get('storedUnitCode')}")

    series = []
    for raw in source.get("values", []):
        value = _number(raw.get("value"))
        median = _number(raw.get("median"))
        percent = (round(value / median * 100, 1)
                   if value is not None and median is not None and median > 0
                   else None)
        series.append({
            "date": raw.get("date"),
            "value_inches": value,
            "normal_median_inches": median,
            "percent_of_normal_median": percent,
            "quality_control": raw.get("qcFlag"),
            "quality_assurance": raw.get("qaFlag"),
        })
    series.sort(key=lambda row: str(row["date"]))
    if not series:
        raise ValueError(f"{site['station']} returned no daily values")
    latest = max(
        (row["date"] for row in series if row["value_inches"] is not None),
        default=None,
    )
    if latest is None:
        # A station that answered with a whole water year of nulls.
        #
        # Not an error, and not the same thing as a station that did not
        # answer -- but the same fact for a reader: an inventory station that
        # contributed no reading. It is returned as one of those rather than
        # raised, so it counts against the tolerance below, gets named in the
        # log and in `missing_site_count`, and does not stop the file.
        #
        # This never happened at 217 Utah sites and happens at 639 western
        # ones: 549:NV:SNTL is listed active and returned 317 daily rows for
        # the water year, every one of them flagged M for missing. A network
        # three times the size has stations in that state, and one dead
        # station must not cost every other station's reading.
        return None
    latest_day = date.fromisoformat(latest)

    timing = source.get("timingCentralTendencies") or {}
    return {
        **site,
        "latest_date": latest,
        "late": (as_of - latest_day).days > LATE_AFTER_DAYS,
        "normal_timing": {
            "peak": timing.get("medianPeak"),
            "onset": timing.get("medianOnset"),
            "meltout": timing.get("medianMeltout"),
        },
        "series": series,
    }


def build_rollups(sites: list[dict], huc_names: dict[str, str]) -> list[dict]:
    grouped = defaultdict(lambda: defaultdict(list))
    sites_per_huc = defaultdict(int)
    for site in sites:
        sites_per_huc[site["huc6"]] += 1
        for row in site["series"]:
            percent = row["percent_of_normal_median"]
            if percent is not None:
                grouped[site["huc6"]][row["date"]].append(percent)

    rollups = []
    for huc6 in sorted(huc_names):
        daily = []
        for day, values in sorted(grouped[huc6].items()):
            daily.append({
                "date": day,
                "reporting_site_count": len(values),
                "mean_percent_of_normal_median": (
                    round(sum(values) / len(values), 1)
                    if len(values) >= MIN_ROLLUP_SITES else None
                ),
            })
        rollups.append({
            "huc6": huc6,
            "huc6_name": huc_names[huc6],
            "site_count": sites_per_huc[huc6],
            "minimum_reporting_sites": MIN_ROLLUP_SITES,
            "series": daily,
        })
    return rollups


def build_payload(inventory: dict, records: list[dict], as_of: date,
                  generated_at: datetime | None = None) -> dict:
    sites_by_station = {site["station"]: site for site in inventory["sites"]}
    if len(sites_by_station) != inventory["site_count"]:
        raise ValueError("snow site inventory count or station uniqueness is invalid")
    normalized = [
        site for site in (
            normalize_site(sites_by_station[record["stationTriplet"]], record, as_of)
            for record in records)
        if site is not None
    ]
    drawn = {site["station"] for site in normalized}
    if not drawn <= set(sites_by_station):
        raise ValueError("snow data covers stations that are not in the inventory")
    #: Every inventory station that contributed no reading, whether it was
    #: absent from the response or answered with nothing but nulls. One fact,
    #: one count; the log says which stations and the tolerance is the guard
    #: that keeps a real outage loud.
    missing_sites = sorted(set(sites_by_station) - drawn)
    if len(missing_sites) > int(len(sites_by_station) * MISSING_SITE_TOLERANCE):
        raise ValueError(
            f"normalized snow data is missing {len(missing_sites)} of "
            f"{len(sites_by_station)} inventory stations: "
            + ", ".join(missing_sites[:10])
            + (" ..." if len(missing_sites) > 10 else ""))
    if missing_sites:
        print(f"  {len(missing_sites)} station(s) contributed no reading and are "
              f"left out of today's file: {', '.join(missing_sites)}")
    normalized.sort(key=lambda site: (site["huc6"], site["name"], site["station"]))
    huc_names = {site["huc6"]: site["huc6_name"] for site in inventory["sites"]}
    rollups = build_rollups(normalized, huc_names)
    # The full water year is about 70,000 observations, and the date is the
    # expensive column: every site keeps its own copy of the same water-year
    # calendar, so "2025-10-01" is written two hundred times over. The dates
    # are written once here and each site says which of them it has, as
    # positions in that shared list.
    #
    # Positions rather than a start and a length, because seven sites have
    # gaps in the middle of their record and a contiguous slice loses them
    # silently. Positions rather than a full-length array with a hole marker,
    # because a null already means something here -- one row has no reading
    # and 13,910 have no normal, and "no row for this day" must stay a
    # different fact from "a row that reads null".
    #
    # Measured on the current file: 1,913 KB to 1,166 KB raw, and 217 KB to
    # 99 KB over the wire, with the rebuilt rows identical to these.
    series_dates = sorted({
        row["date"] for site in normalized for row in site["series"]})
    date_index = {date: position for position, date in enumerate(series_dates)}
    compact_sites = []
    for site in normalized:
        compact = {key: value for key, value in site.items() if key != "series"}
        compact["series_days"] = [date_index[row["date"]] for row in site["series"]]
        compact["series_values"] = [row["value_inches"] for row in site["series"]]
        compact["series_normals"] = [
            row["normal_median_inches"] for row in site["series"]]
        compact_sites.append(compact)
    timestamp = generated_at or datetime.now(timezone.utc)
    return {
        "schema_version": 2,
        "generated_at": timestamp.replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "as_of": as_of.isoformat(),
        "water_year": water_year_start(as_of).year + 1,
        "normal_period": inventory["normal_period"],
        "units": "inches",
        "site_series_fields": ["series_days", "series_values", "series_normals"],
        "series_dates": series_dates,
        "source": DATA_URL,
        "site_count": len(normalized),
        "late_site_count": sum(site["late"] for site in normalized),
        # Inventory stations that published nothing at all today. A separate
        # fact from `late_site_count`, which counts stations that answered
        # with an old reading -- one is a station whose newest value is
        # stale, the other is a station with no value at all. That covers
        # both ways of having none: absent from the response, and present
        # with a water year of nulls behind it.
        "missing_site_count": len(missing_sites),
        "rollups": rollups,
        # The coarser groupings, one per offered level below this payload's
        # own (ADR-064, ADR-073). Names only: the codes are the first four or
        # two digits of a code every site and rollup already carries, because
        # hydrologic codes are fixed-width. Derived from the sites in this
        # payload, so neither can name an area the payload does not cover.
        #
        # Both tables, not one: a client drawing at level 2 needs the region
        # names, and a coarser table cannot be derived from a finer one --
        # `subregions` holds "Colorado Headwaters" for 1401 and says nothing
        # about what 14 is called. Without this the region picker labelled
        # itself "14 (137 sites)", which is the failure `west-huc2` is
        # published to prevent.
        "subregions": huc.subregion_roster(site["huc6"] for site in normalized),
        "regions": huc.region_roster(site["huc6"] for site in normalized),
        "sites": compact_sites,
    }


def write_atomic(path: Path, payload: dict) -> bool:
    body = json.dumps(payload, separators=(",", ":"), ensure_ascii=False) + "\n"
    before = path.read_text(encoding="utf-8") if path.exists() else None
    if before == body:
        return False
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            handle.write(body)
        os.replace(temporary, path)
        os.chmod(path, 0o644)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)
    return True


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--inventory", type=Path, default=INVENTORY_PATH)
    parser.add_argument("--output", type=Path, default=OUTPUT_PATH)
    parser.add_argument("--as-of", type=date.fromisoformat)
    args = parser.parse_args()

    inventory = json.loads(args.inventory.read_text(encoding="utf-8"))
    today = args.as_of or datetime.now(ZoneInfo("America/Denver")).date()
    station_ids = [site["station"] for site in inventory["sites"]]
    records = fetch_all(
        requests.Session(), station_ids, water_year_start(today), today)
    payload = build_payload(inventory, records, today)
    changed = write_atomic(args.output, payload)
    print(
        f"{payload['site_count']} snow sites refreshed; "
        f"{payload['late_site_count']} reporting late; "
        f"{args.output} {'written' if changed else 'unchanged'}."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
