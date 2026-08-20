"""Audit Bureau of Reclamation storage reservoirs not already on the roster.

R2 is the second western roster pass. R1 admitted storage stations from the
Natural Resources Conservation Service. This pass starts from Reclamation's
location catalogue, keeps Lake/Reservoir points inside the registered western
scope, removes the reservoirs already configured, finds a daily storage item,
and applies the same National Inventory of Dams rules as R1.

The audit writes nothing. JSON output is the review evidence used to build a
committed roster change::

    python tools/audit_rise_reservoirs.py --json > /tmp/rise-r2.json

The catalogue ignores several plausible query filters. Fetch the two small
catalogues in pages and join them by their published relationships instead of
trusting a server-side filter that can answer 200 with unrelated records.
Only the storage items that survive that join fetch their observations.
"""

from __future__ import annotations

import argparse
import concurrent.futures
import datetime as dt
import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from admission import admit_all, discrepancies, distance_km  # noqa: E402
from huc import assign_huc  # noqa: E402
from tools.audit_candidate_capacity import (  # noqa: E402
    STATE_NAMES,
    fetch_dams,
    find_dam_layer,
)
from watershed_scopes import DEFAULT_SCOPE, SCOPES, load_scope_units  # noqa: E402


BASE = "https://data.usbr.gov/rise/api"
RESULT_URL = f"{BASE}/result"
USER_AGENT = "western-water-dashboard/rise-audit (+https://github.com/buschbrian)"
TIMEOUT = 120
PAGE_SIZE = 100  # the catalogue caps a larger request at 100
RESULT_PAGE_SIZE = 2000
MAX_RESULT_PAGES = 50
WORKERS = 6
START_DATE = "2015-01-01"
NON_US_CODES = {"CN", "MX"}

# The R2 measurement used three kilometres for a provider-to-provider point
# duplicate. This is deliberately separate from admission.NEAR_RADIUS_KM:
# that radius confirms a *dam*. Here both points describe the water, and the
# question is only whether another provider already represents the location.
TRACKED_RADIUS_KM = 3.0


def relationship_ids(resource: dict, name: str) -> list[str]:
    """Return numeric relationship ids from one JSON:API resource."""
    relationship = (resource.get("relationships") or {}).get(name) or {}
    target = relationship.get("data")
    entries = target if isinstance(target, list) else [target]
    found = []
    for entry in entries:
        iri = entry.get("id") if isinstance(entry, dict) else None
        if isinstance(iri, str) and iri.rsplit("/", 1)[-1]:
            found.append(iri.rsplit("/", 1)[-1])
    return found


def point_of(resource: dict) -> tuple[float, float] | None:
    coordinates = ((resource.get("attributes") or {}).get("locationCoordinates")
                   or {}).get("coordinates")
    if not isinstance(coordinates, list) or len(coordinates) < 2:
        return None
    try:
        return float(coordinates[0]), float(coordinates[1])
    except (TypeError, ValueError):
        return None


def select_locations(locations: list[dict], units: list[dict],
                     tracked_points: list[tuple[str, str, float, float]]):
    """Select in-scope, untracked Lake/Reservoir locations without network.

    Returns ``(candidates, counts)``. A candidate remains keyed by its RISE
    location until a storage catalog item is found; that catalog item becomes
    the provider identity the refresh fetches and publishes.
    """
    counts = {"locations": len(locations), "reservoir_locations": 0,
              "located": 0, "in_scope": 0, "tracked": 0}
    candidates = []
    for resource in locations:
        attributes = resource.get("attributes") or {}
        if attributes.get("locationTypeName") != "Lake/Reservoir":
            continue
        counts["reservoir_locations"] += 1
        point = point_of(resource)
        if point is None:
            continue
        counts["located"] += 1
        unit = assign_huc(point, units)
        if unit is None:
            continue
        counts["in_scope"] += 1

        nearest = None
        for station, name, lon, lat in tracked_points:
            distance = distance_km(point, (lon, lat))
            if nearest is None or distance < nearest[0]:
                nearest = (distance, station, name)
        if nearest is not None and nearest[0] <= TRACKED_RADIUS_KM:
            counts["tracked"] += 1
            continue

        location_ids = relationship_ids(resource, "catalogRecords")
        state_ids = relationship_ids(resource, "states")
        candidates.append({
            "location_id": str(attributes.get("_id") or resource.get("id", "")).rsplit("/", 1)[-1],
            "name": str(attributes.get("locationName") or "").strip(),
            "lon": point[0],
            "lat": point[1],
            "state": state_ids[0].upper() if state_ids else "",
            "huc6": unit["huc6"],
            "huc6_name": unit["name"],
            # A reservoir point and its dam can sit on opposite sides of a
            # state line. Navajo is the measured case: RISE calls the point
            # Colorado and Navajo Dam is in New Mexico. Fetch every state the
            # drainage area reaches, not only the provider's one state tag.
            "area_states": [state.strip() for state in str(unit.get("states") or "").split(",")
                            if state.strip()],
            "catalog_record_ids": location_ids,
        })
    candidates.sort(key=lambda row: (row["huc6"], row["name"], row["location_id"]))
    return candidates, counts


def storage_items(items: list[dict], record_ids: set[str]) -> list[dict]:
    """Daily acre-foot storage catalog items belonging to candidate records."""
    found = []
    for resource in items:
        attributes = resource.get("attributes") or {}
        related = set(relationship_ids(resource, "catalogRecord"))
        if not related.intersection(record_ids):
            continue
        if attributes.get("parameterName") != "Lake/Reservoir Storage":
            continue
        if str(attributes.get("parameterUnit") or "").lower() != "af":
            continue
        if str(attributes.get("parameterTimestep") or "").lower() != "daily":
            continue
        found.append({
            "item_id": str(attributes.get("_id") or resource.get("id", "")).rsplit("/", 1)[-1],
            "catalog_record_ids": sorted(related),
            "temporal_start": attributes.get("temporalStartDate"),
            "temporal_end": attributes.get("temporalEndDate"),
        })
    return found


def existing_roster_points() -> list[tuple[str, str, float, float]]:
    """Every pre-R2 point, including reservoirs withdrawn for quiet data.

    The 25 reviewed results now live in ``ADMITTED_RISE_RESERVOIRS``. Leaving
    them in this comparison would make the evidence irreproducible after the
    change it supports: every admitted row would disappear as "already
    tracked" on the next run.
    """
    import refresh_reservoirs as refresh  # local import keeps pure tests light

    rows = []
    baseline = set(refresh.BASE_RISE_RESERVOIRS) | set(refresh.AWDB_RESERVOIRS)
    for station in baseline:
        configured = refresh.RESERVOIRS.get(station) or refresh.AWDB_RESERVOIRS.get(station)
        if configured is None:
            continue
        name, lat, lon = configured[:3]
        rows.append((str(station), str(name), float(lon), float(lat)))
    return rows


def existing_dam_ids() -> dict[str, list[tuple[str, str]]]:
    """The reviewed dam identity behind each pre-R2 reservoir."""
    import refresh_reservoirs as refresh

    by_dam: dict[str, list[tuple[str, str]]] = {}
    baseline = set(refresh.BASE_RISE_RESERVOIRS) | set(refresh.AWDB_RESERVOIRS)
    for station, evidence in refresh.load_capacities().items():
        if station not in baseline:
            continue
        nid_id = str(evidence.get("nid_id") or "").strip()
        if not nid_id:
            continue
        by_dam.setdefault(nid_id, []).append(
            (str(station), str(evidence.get("name") or refresh.RESERVOIR_NAMES.get(station) or "")))
    return by_dam


def existing_dam_points() -> list[tuple[str, str, float, float]]:
    """Every pre-R2 reviewed dam point, including quiet reservoirs."""
    import refresh_reservoirs as refresh

    rows = []
    baseline = set(refresh.BASE_RISE_RESERVOIRS) | set(refresh.AWDB_RESERVOIRS)
    for station, evidence in refresh.load_capacities().items():
        if station not in baseline:
            continue
        lon, lat = evidence.get("dam_lon"), evidence.get("dam_lat")
        if lon is None or lat is None:
            continue
        rows.append((
            str(station),
            str(evidence.get("name") or refresh.RESERVOIR_NAMES.get(station) or ""),
            float(lon), float(lat),
        ))
    return rows


def remove_dam_point_duplicates(
    candidates: list[dict], dam_points: list[tuple[str, str, float, float]],
) -> tuple[list[dict], list[dict]]:
    """Remove provider points sitting on a configured reservoir's dam.

    This is a second position pass after a storage item is known. Lake Mead
    is the measured reason: RISE's storage location is Hoover Dam, 41.9 km
    from this project's published water point and directly on its reviewed
    dam point. It belongs in the storage-series funnel, then leaves here.
    """
    kept, duplicates = [], []
    for candidate in candidates:
        point = (candidate["lon"], candidate["lat"])
        matches = []
        for station, name, lon, lat in dam_points:
            distance = distance_km(point, (lon, lat))
            if distance <= TRACKED_RADIUS_KM:
                matches.append({"source_station_id": station, "name": name,
                                "distance_km": round(distance, 3)})
        if matches:
            duplicates.append({**candidate, "dam_point_duplicates": matches})
        else:
            kept.append(candidate)
    return kept, duplicates


def request_json(url: str, params: dict | None = None) -> dict:
    query = f"?{urllib.parse.urlencode(params or {}, doseq=True)}" if params else ""
    request = urllib.request.Request(
        f"{url}{query}",
        headers={"Accept": "application/vnd.api+json", "User-Agent": USER_AGENT},
    )
    last_error: Exception | None = None
    for attempt in range(3):
        try:
            with urllib.request.urlopen(request, timeout=TIMEOUT) as response:
                payload = json.loads(response.read().decode("utf-8"))
            if not isinstance(payload, dict):
                raise ValueError("response is not an object")
            return payload
        except (urllib.error.URLError, TimeoutError, ValueError) as exc:
            last_error = exc
            if attempt < 2:
                time.sleep(2 ** attempt)
    raise RuntimeError(f"{url}: {last_error}")


def fetch_collection(endpoint: str) -> list[dict]:
    """Fetch a complete RISE collection, refusing a partial catalogue."""
    first = request_json(f"{BASE}/{endpoint}", {"itemsPerPage": PAGE_SIZE, "page": 1})
    meta = first.get("meta") or {}
    total = int(meta.get("totalItems") or 0)
    per_page = int(meta.get("itemsPerPage") or 0)
    if total <= 0 or per_page <= 0:
        raise RuntimeError(f"{endpoint}: missing pagination metadata")
    pages = (total + per_page - 1) // per_page
    rows = list(first.get("data") or [])
    if pages > 1:
        with concurrent.futures.ThreadPoolExecutor(max_workers=WORKERS) as executor:
            futures = {
                executor.submit(request_json, f"{BASE}/{endpoint}",
                                {"itemsPerPage": PAGE_SIZE, "page": page}): page
                for page in range(2, pages + 1)
            }
            fetched = {}
            for future in concurrent.futures.as_completed(futures):
                page = futures[future]
                fetched[page] = list(future.result().get("data") or [])
        for page in range(2, pages + 1):
            rows.extend(fetched[page])
    if len(rows) != total:
        raise RuntimeError(f"{endpoint}: received {len(rows)} of {total} records")
    return rows


def top_readings(item_id: str) -> list[float]:
    """The three largest usable readings since 2015 for one catalog item."""
    values = []
    page = 1
    end = (dt.date.today() + dt.timedelta(days=1)).strftime("%Y%m%d")
    while page <= MAX_RESULT_PAGES:
        payload = request_json(RESULT_URL, {
            "itemsPerPage": RESULT_PAGE_SIZE,
            "order[dateTime]": "ASC",
            "itemId": item_id,
            "dateTime[after]": START_DATE.replace("-", ""),
            "dateTime[strictly_before]": end,
            "page": page,
        })
        data = payload.get("data") or []
        for resource in data:
            try:
                result = float((resource.get("attributes") or {}).get("result"))
            except (TypeError, ValueError):
                continue
            values.append(result)
        meta = payload.get("meta") or {}
        per_page = int(meta.get("itemsPerPage") or 0)
        total = int(meta.get("totalItems") or 0)
        if not data or per_page <= 0 or page * per_page >= total:
            break
        page += 1
    if page > MAX_RESULT_PAGES:
        raise RuntimeError(f"item {item_id}: result pagination exceeded the safety limit")
    return sorted(values, reverse=True)[:3]


def attach_storage(candidates: list[dict], items: list[dict]) -> tuple[list[dict], int]:
    """Attach the best observed storage item to each candidate location."""
    record_to_candidate = {
        record_id: candidate
        for candidate in candidates
        for record_id in candidate["catalog_record_ids"]
    }
    candidate_records = set(record_to_candidate)
    available = storage_items(items, candidate_records)

    with concurrent.futures.ThreadPoolExecutor(max_workers=WORKERS) as executor:
        futures = {executor.submit(top_readings, item["item_id"]): item
                   for item in available}
        for future in concurrent.futures.as_completed(futures):
            futures[future]["highest_readings"] = future.result()

    by_location: dict[str, list[dict]] = {}
    for item in available:
        for record_id in item["catalog_record_ids"]:
            candidate = record_to_candidate.get(record_id)
            if candidate is not None:
                by_location.setdefault(candidate["location_id"], []).append(item)

    attached = []
    for candidate in candidates:
        choices = by_location.get(candidate["location_id"], [])
        usable = [item for item in choices if item.get("highest_readings")]
        if not usable:
            continue
        # A location can expose superseded catalog items. Prefer the one whose
        # series ends latest, then the one with more evidence. The chosen item
        # id and temporal range remain in the JSON for review.
        chosen = max(usable, key=lambda item: (
            str(item.get("temporal_end") or ""),
            len(item.get("highest_readings") or []),
            int(item["item_id"]),
        ))
        attached.append({
            **candidate,
            "item_id": chosen["item_id"],
            "temporal_start": chosen.get("temporal_start"),
            "temporal_end": chosen.get("temporal_end"),
            "highest_readings": chosen["highest_readings"],
            "observed_max_af": chosen["highest_readings"][0],
        })
    return attached, len(available)


def audit(scope: str) -> dict:
    units = load_scope_units(scope)
    locations = fetch_collection("location")
    candidates, counts = select_locations(locations, units, existing_roster_points())
    catalog_items = fetch_collection("catalog-item")
    storage_candidates, storage_item_count = attach_storage(candidates, catalog_items)
    decision_candidates, dam_point_duplicates = remove_dam_point_duplicates(
        storage_candidates, existing_dam_points())

    state_codes = sorted({state
                          for candidate in decision_candidates
                          for state in ([candidate.get("state", "")]
                                        + candidate.get("area_states", []))
                          if state})
    unknown_states = [state for state in state_codes
                      if state not in STATE_NAMES and state not in NON_US_CODES]
    if unknown_states:
        raise RuntimeError(
            f"no dam-inventory state name for {', '.join(unknown_states)}")
    states = [STATE_NAMES[state] for state in state_codes if state in STATE_NAMES]
    layer_url, fields, where, expected = find_dam_layer(states)
    if not layer_url:
        raise RuntimeError("the dam inventory did not answer with a usable schema")
    dams = fetch_dams(layer_url, fields, where)
    if expected is not None and len(dams) != expected:
        raise RuntimeError(f"dam inventory returned {len(dams)} of {expected} rows")

    decisions = admit_all(decision_candidates, dams)
    configured_dams = existing_dam_ids()
    rows = []
    rule_admitted = 0
    final_admitted = 0
    for candidate, decision in zip(decision_candidates, decisions):
        evidence = decision.evidence()
        if decision.admitted:
            rule_admitted += 1
        nid_id = str(evidence.get("nid_id") or "")
        duplicates = configured_dams.get(nid_id, []) if nid_id else []
        admitted = bool(decision.admitted and not duplicates)
        disagreements = [
            {"screen": screen, "detail": detail}
            for screen, detail in discrepancies(
                decision, highest_readings=candidate.get("highest_readings"))
            # A refusal is already represented by `rule_admitted` and
            # `reason`; retain only the additional cross-source screens here.
            if screen != "no confirmed dam"
        ]
        if admitted:
            final_admitted += 1
        rows.append({
            **candidate,
            **evidence,
            "rule_admitted": bool(decision.admitted),
            "admitted": admitted,
            "discrepancies": disagreements,
            "duplicate_of": [
                {"source_station_id": station, "name": name}
                for station, name in duplicates
            ],
        })

    return {
        "run_date": dt.date.today().isoformat(),
        "scope": scope,
        "counts": {
            **counts,
            "candidates": len(candidates),
            "storage_catalog_items": storage_item_count,
            "storage_candidates": len(storage_candidates),
            "after_dam_point_dedupe": len(decision_candidates),
            "rule_admitted": rule_admitted,
            "admitted_after_dam_identity": final_admitted,
        },
        "dam_point_duplicates": dam_point_duplicates,
        "reservoirs": rows,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--json", action="store_true")
    parser.add_argument("--output", type=Path,
                        help="write the complete JSON evidence to this path")
    parser.add_argument("--scope", choices=tuple(sorted(SCOPES)), default=DEFAULT_SCOPE)
    args = parser.parse_args()
    try:
        result = audit(args.scope)
    except RuntimeError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1

    rendered = json.dumps(result, indent=2) + "\n"
    if args.output:
        args.output.write_text(rendered, encoding="utf-8")
        print(f"wrote {args.output}", file=sys.stderr)
    if args.json:
        if not args.output:
            print(rendered, end="")
        return 0

    counts = result["counts"]
    print(f"{counts['locations']} locations; {counts['reservoir_locations']} reservoirs; "
          f"{counts['in_scope']} in scope; {counts['tracked']} already tracked")
    print(f"{counts['candidates']} candidates; {counts['storage_candidates']} publish "
          f"storage; {counts['after_dam_point_dedupe']} remain after the reviewed dam "
          f"points; {counts['rule_admitted']} pass the rules; "
          f"{counts['admitted_after_dam_identity']} are new dam identities\n")
    for row in result["reservoirs"]:
        mark = "ADMIT" if row["admitted"] else "refuse"
        duplicate = (f"; duplicate of {', '.join(item['name'] for item in row['duplicate_of'])}"
                     if row["duplicate_of"] else "")
        print(f"{mark:<6} {row['name']:<48} item {row['item_id']:<7} "
              f"{row.get('nid_id') or '-':<10} {row['reason']}{duplicate}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
