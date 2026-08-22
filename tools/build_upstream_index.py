"""Build the upstream index: what drains to each published reservoir.

For every published reservoir, ask the USGS Network-Linked Data Index (NLDI)
for the contributing basin above its point, then test which of this project's
own published points -- reservoirs and snow sites -- sit inside it. The
output is a committed reference file keyed by station id (ADR-066), holding
for each reservoir the upstream reservoir stations, the upstream snow
stations, and the NLDI COMID the trace was taken from.

    python tools/build_upstream_index.py            # build or rebuild
    python tools/build_upstream_index.py --only "Flaming Gorge"
    python tools/build_upstream_index.py --json     # machine-readable report

It writes nothing else, and it never publishes geometry: the basin polygon is
the tool's input and stops there (ADR-048). The scoping behind this --
endpoint shapes measured live, cost, why precompute rather than fetch at
runtime, and what a trace cannot say -- is
docs/UPSTREAM-TRACE-SCOPING.md.

Three decisions the tool encodes, each its own screen:

**The dam sits inside its own basin.** A reservoir's own point lands inside
its contributing area by construction, so every trace begins by excluding
itself. That is a deliberate one-line rule rather than an accident of
geometry, and the file says so.

**A trace is evidence, and evidence can fail.** A station whose point
answers no flowline (`no_flowline`), or whose COMID answers no basin
(`no_basin`), is recorded as screened out with the reason -- never as an
empty upstream set, which would read as "nothing drains here" when the truth
is "we could not trace".

**Size is screened too.** Lake Powell's contributing area is most of the
Upper Colorado, about 108,000 square miles, and that is a correct answer. A
basin several times that size means the trace matched the wrong kind of
river -- a trunk stream draining far beyond the western scope -- and the
trace is flagged for review rather than trusted.

The area is approximate on purpose: a spherical excess summed around the
ring, good enough to separate 100,000 square miles from 500,000, labelled in
the file as what it is.
"""

import argparse
import json
import math
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from huc import in_polygon  # noqa: E402

OUTPUT_PATH = ROOT / "upstream_index.json"

#: The service and its two endpoints, measured 2026-08-21 against real roster
#: points. The position call wants WKT without the SRID prefix -- `SRID=4326;
#' POINT(...)` answers 400 -- and wants longitude first.
NLDI_BASE = "https://api.water.usgs.gov/nldi"
POSITION_URL = f"{NLDI_BASE}/linked-data/comid/position"
BASIN_URL = f"{NLDI_BASE}/linked-data/comid"

USER_AGENT = "western-water-dashboard/upstream-index (+https://github.com/buschbrian)"
TIMEOUT = 120
POLITENESS_SECONDS = 0.3

#: Square miles. Powell's whole Upper Colorado contribution measures near
#: 108,000 by the same rough arithmetic this tool uses; three times that is
#: not a western headwater any more. Flagged for review, not deleted: the
#: trace itself is kept in the file either way.
REVIEW_AREA_SQ_MI = 300_000.0

SQ_METERS_PER_SQ_MILE = 2_589_988.11
EARTH_RADIUS_M = 6_371_000.0


class RateLimited(RuntimeError):
    """The service refused the request for quota, not for content.

    Distinct on purpose. A 429 recorded as `no_flowline` would fill the
    index with screens that look like findings -- 357 reservoirs whose
    upstream set "could not be traced" on one morning and might be traceable
    the next is not evidence, it is exhaustion wearing evidence's clothes.
    This error ends the run instead: nothing is written, and the tool says
    to come back later.
    """

    def __init__(self, seconds: int | None = None):
        self.seconds = seconds
        super().__init__(
            f"the service answered 429 OVER_RATE_LIMIT"
            + (f", retry after {seconds}s" if seconds else ""))


RETRY_ATTEMPTS = 3


def get_json(url: str):
    """GET JSON, with retries for transient failures.

    A 429 is not transient here: the quota that produced it will outlive any
    backoff this tool can afford, so it raises `RateLimited` immediately and
    the caller stops the run rather than recording three hundred fake
    screens.
    """
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    for attempt in range(RETRY_ATTEMPTS):
        try:
            with urllib.request.urlopen(request, timeout=TIMEOUT) as response:
                return json.loads(response.read())
        except urllib.error.HTTPError as error:
            if error.code == 429:
                retry_after = error.headers.get("Retry-After")
                raise RateLimited(
                    int(retry_after) if retry_after
                    and retry_after.isdigit() else None) from error
            if attempt == RETRY_ATTEMPTS - 1:
                raise
            time.sleep(2 * 2**attempt)
    raise AssertionError("unreachable")


def comid_for(lon: float, lat: float) -> str | None:
    """The NHDPlus COMID of the flowline nearest a point, or None."""
    coords = urllib.parse.quote(f"POINT({lon} {lat})")
    payload = get_json(f"{POSITION_URL}?coords={coords}")
    features = payload.get("features") if isinstance(payload, dict) else None
    if not features:
        return None
    identifier = features[0].get("properties", {}).get("comid")
    return str(identifier) if identifier is not None else None


def basin_polygons(comid: str) -> list[list[tuple[float, float]]]:
    """The contributing basin, kept as polygons of rings (outer first).

    Structure is retained because area needs it -- a hole subtracts, which
    only the grouping can say -- while point tests want the flat ring list
    that `polygons_to_rings` produces.
    """
    payload = get_json(f"{BASIN_URL}/{comid}/basin")
    features = payload.get("features") if isinstance(payload, dict) else []
    polygons = []
    for feature in features:
        geometry = feature.get("geometry") or {}
        kind = geometry.get("type")
        if kind == "Polygon":
            polygons.append(geometry.get("coordinates") or [])
        elif kind == "MultiPolygon":
            polygons.extend(geometry.get("coordinates") or [])
    return [
        [[(float(x), float(y)) for x, y in ring] for ring in polygon]
        for polygon in polygons
    ]


def polygons_to_rings(polygons) -> list[tuple]:
    """Every ring of every polygon, flattened for point-in-basin tests."""
    return [tuple(ring) for polygon in polygons for ring in polygon]


def bounds_of(rings) -> tuple[float, float, float, float]:
    """(west, south, east, north) across every ring."""
    lons = [x for ring in rings for x, _ in ring]
    lats = [y for ring in rings for _, y in ring]
    return min(lons), min(lats), max(lons), max(lats)


def _ring_area_sq_km(ring) -> float:
    accumulated = 0.0
    for (lon1, lat1), (lon2, lat2) in zip(ring, ring[1:] + ring[:1]):
        accumulated += math.radians(lon2 - lon1) * (
            2 + math.sin(math.radians(lat1))
            + math.sin(math.radians(lat2)))
    return abs(accumulated) * EARTH_RADIUS_M**2 / 2 / 1_000_000


def basin_area_sq_km(polygons) -> float:
    """Approximate area, holes subtracted, whatever the source winding.

    Each ring's absolute contribution is computed on its own, so the answer
    does not depend on the publisher following RFC 7946's winding rules: the
    first ring of a polygon is treated as its exterior and every later ring
    as a hole inside it.
    """
    total = 0.0
    for rings in polygons:
        if not rings:
            continue
        total += _ring_area_sq_km(rings[0])
        total -= sum(_ring_area_sq_km(hole) for hole in rings[1:])
    return max(total, 0.0)


def points_in_basin(point, polygons, box) -> bool:
    """Bounding-box prefilter, then the shared even-odd ray cast per polygon.

    The polygons stay separate on purpose: `huc.in_polygon` reads every ring
    after the first as a hole of the one before it, so a flattened
    MultiPolygon would reject exactly the points that sit in its second
    lobe -- most of the Upper Colorado, for Lake Powell.
    """
    west, south, east, north = box
    x, y = point
    if not (west <= x <= east and south <= y <= north):
        return False
    return any(in_polygon((x, y), polygon) for polygon in polygons)


def load_roster_and_sites() -> tuple[list[dict], list[dict]]:
    """Published reservoirs and inventoried snow sites, points only.

    The trace starts at the **reviewed dam point** where one exists
    (`capacities.json`), and at the published point otherwise -- measured,
    not preferred: Lake Powell's published point sits on the water by
    decision (ADR-062), a position snap there answers with a 40-square-mile
    tributary instead of the whole Upper Colorado, and the scoping's own
    measurements were taken at dams.
    """
    payload = json.loads((ROOT / "reservoirs.json").read_text(encoding="utf-8"))
    catalog = json.loads((ROOT / "capacities.json").read_text(encoding="utf-8"))
    capacities = catalog.get("capacities", {})
    reservoirs = []
    for r in payload["reservoirs"]:
        if not r.get("source_station_id"):
            continue
        entry = capacities.get(r["source_station_id"]) or {}
        has_dam = entry.get("dam_lon") is not None and entry.get("dam_lat") is not None
        reservoirs.append({
            "station": r["source_station_id"], "name": r["name"],
            # Membership is tested at the published waterbody point -- the
            # question is whether the *water* sits on the upstream land.
            "lon": r["lon"], "lat": r["lat"],
            # The trace itself starts at the dam, for the measured reason in
            # the docstring above.
            "trace_lon": entry["dam_lon"] if has_dam else r["lon"],
            "trace_lat": entry["dam_lat"] if has_dam else r["lat"],
            "trace_point": "reviewed dam point" if has_dam
            else "published point",
        })
    sites_doc = json.loads((ROOT / "snow_sites.json").read_text(encoding="utf-8"))
    sites = [
        {"station": s["station"], "name": s["name"], "lon": s["lon"],
         "lat": s["lat"]}
        for s in sites_doc["sites"]]
    return reservoirs, sites


def trace_one(reservoir: dict, others: list[dict], sites: list[dict]) -> dict:
    """One reservoir's upstream set, or the screen that refused it."""
    record: dict = {"name": reservoir["name"],
                    "trace_point": reservoir["trace_point"]}
    try:
        comid = comid_for(reservoir["trace_lon"], reservoir["trace_lat"])
    except urllib.error.HTTPError as error:
        # Not a 429 (that escapes as RateLimited) and not a 404: a service
        # answer this tool did not predict is recorded for what it is rather
        # than folded into "no flowline", which is a finding about the river
        # and not about the service.
        return {**record, "screen": "service_error",
                "detail": f"HTTP {error.code} from the position service"}
    except urllib.error.URLError as error:
        return {**record, "screen": "service_unavailable",
                "detail": f"the position service failed: {error}"}
    if not comid:
        return {**record, "screen": "no_flowline",
                "detail": "no NHDPlus flowline at this point"}
    record["comid"] = comid

    try:
        polygons = basin_polygons(comid)
    except urllib.error.HTTPError as error:
        return {**record, **{"comid": comid}, "screen": "service_error",
                "detail": f"HTTP {error.code} from the basin service"}
    except (urllib.error.URLError, ValueError) as error:
        return {**record, **{"comid": comid}, "screen": "no_basin",
                "detail": f"the basin service failed: {error}"}
    if not polygons:
        return {**record, "screen": "no_basin",
                "detail": "the basin service answered no geometry"}
    rings = polygons_to_rings(polygons)
    record["basin_vertices"] = sum(len(ring) for ring in rings)

    area = basin_area_sq_km(polygons)
    record["basin_area_sq_mi"] = round(
        area * 1_000_000 / SQ_METERS_PER_SQ_MILE)

    box = bounds_of(rings)
    # Self-exclusion is the deliberate rule, not a geometric accident: a dam
    # point lands inside its own contributing area by construction.
    upstream_reservoirs = sorted(
        other["station"] for other in others
        if other["station"] != reservoir["station"]
        and points_in_basin((other["lon"], other["lat"]), polygons, box))
    upstream_sites = sorted(
        site["station"] for site in sites
        if points_in_basin((site["lon"], site["lat"]), polygons, box))
    record["upstream_reservoirs"] = upstream_reservoirs
    record["upstream_snow_sites"] = upstream_sites

    if record["basin_area_sq_mi"] > REVIEW_AREA_SQ_MI:
        record["review"] = (
            f"the contributing basin measures about "
            f"{record['basin_area_sq_mi']:,} square miles, past the "
            f"{REVIEW_AREA_SQ_MI:,.0f} a western headwater reaches")
    return record


#: How many quota waits one run may sit through. Each wait honours the
#: service's own Retry-After, capped at ten minutes; past this many the run
#: gives up rather than babysitting a quota that will not close today.
MAX_QUOTA_WAITS = 40


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--only", metavar="NAME", action="append", default=[],
                        help="trace these reservoirs by name; print and write nothing")
    parser.add_argument("--json", action="store_true",
                        help="print the report as JSON instead of a table")
    args = parser.parse_args()

    reservoirs, sites = load_roster_and_sites()
    print(f"{len(reservoirs)} published reservoirs, {len(sites)} snow sites",
          file=sys.stderr)
    wanted = reservoirs
    if args.only:
        lowered = {name.lower() for name in args.only}
        wanted = [r for r in reservoirs if r["name"].lower() in lowered]
        if not wanted:
            print("ERROR: no published reservoir matches --only",
                  file=sys.stderr)
            return 1

    traces: dict[str, dict] = {}
    quota_waits = 0
    for index, reservoir in enumerate(wanted, start=1):
        while True:
            try:
                record = trace_one(reservoir, reservoirs, sites)
                break
            except RateLimited as error:
                quota_waits += 1
                if error.seconds is None or quota_waits > MAX_QUOTA_WAITS:
                    print(f"\nERROR: {error}", file=sys.stderr)
                    print("Nothing written -- the traces this run completed "
                          "are thrown away rather than committed as "
                          "screens. Run the tool again later.", file=sys.stderr)
                    return 1
                print(f"  [{index:>4}/{len(wanted)}] rate limited; waiting "
                      f"{error.seconds}s (wait {quota_waits} of "
                      f"{MAX_QUOTA_WAITS})", file=sys.stderr)
                time.sleep(min(error.seconds, 600) + 1)
        traces[reservoir["station"]] = record
        label = record.get("screen") or (
            f"{len(record['upstream_reservoirs'])} upstream reservoirs, "
            f"{len(record['upstream_snow_sites'])} upstream snow sites")
        print(f"  [{index:>4}/{len(wanted)}] {reservoir['name']:<34} {label}",
              file=sys.stderr)
        time.sleep(POLITENESS_SECONDS)

    if args.only:
        print(json.dumps(traces, indent=1))
        return 0

    screened = {station: record for station, record in traces.items()
                if record.get("screen")}
    reviewed = {station: record for station, record in traces.items()
                if record.get("review")}
    document = {
        "source": "USGS Network-Linked Data Index over NHDPlus",
        "source_url": NLDI_BASE,
        "retrieved": time.strftime("%Y-%m-%d"),
        "keyed_by": "source_station_id",
        "selection": ("every published reservoir, traced from its published "
                      "point against every other published reservoir and "
                      "snow-site point"),
        "self_exclusion": "deliberate: a dam point lies inside its own basin",
        "area_method": ("spherical excess around the ring; approximate, for "
                        "screening rather than measurement"),
        "review_area_sq_mi": REVIEW_AREA_SQ_MI,
        "traced_count": len(traces),
        "screened_count": len(screened),
        "review_count": len(reviewed),
        "traces": dict(sorted(traces.items())),
    }
    OUTPUT_PATH.write_text(json.dumps(document, indent=1,
                                      sort_keys=False) + "\n")
    print(f"\nwrote {OUTPUT_PATH.name}: {len(traces)} traced, "
          f"{len(screened)} screened out, {len(reviewed)} flagged for review",
          file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
