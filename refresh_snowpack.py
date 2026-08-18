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
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

import requests

ROOT = Path(__file__).resolve().parent
INVENTORY_PATH = ROOT / "snow_sites.json"
OUTPUT_PATH = ROOT / "snowpack.json"
DATA_URL = "https://wcc.sc.egov.usda.gov/awdbRestApi/services/v1/data"
USER_AGENT = "utah-reservoir-dashboard/snow-refresh (+https://github.com/buschbrian)"
TIMEOUT = 120
BATCH_SIZE = 75
RETRIES = 3
LATE_AFTER_DAYS = 2
MIN_ROLLUP_SITES = 2


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
        raise RuntimeError(
            f"snow data response omitted {len(missing)} station(s): {', '.join(missing)}")
    return [received[station] for station in station_ids]


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
        raise ValueError(f"{site['station']} returned no numeric daily values")
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
        normalize_site(sites_by_station[record["stationTriplet"]], record, as_of)
        for record in records
    ]
    if {site["station"] for site in normalized} != set(sites_by_station):
        raise ValueError("normalized snow data does not cover the complete inventory")
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
        "rollups": rollups,
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
