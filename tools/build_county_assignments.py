"""Build counties.json: the county each reservoir sits in.

Counties are a *search* axis, not an aggregation one. That was measured before
this was written: 68 reservoirs fall in 34 counties and 19 of those hold
exactly one, so a chart of county storage is a chart of individual reservoirs
wearing a county's name. What counties are good for is the question people
actually ask -- "how is Washington County doing" -- which is a filter.

The assignment is committed rather than computed each morning, for the reason
capacities.json is: an assignment that can change underneath you is not
reproducible, and a reservoir that silently moves county between two runs is
the kind of error nobody would catch by looking.

**Built from the committed roster, never from reservoirs.json.** A reservoir
whose feed goes quiet for two months is withdrawn from the payload entirely
(ADR-056) -- Elkhead Reservoir is withdrawn today -- and it has not moved
county by going quiet. Reading the payload would drop it here, and it would
come back months later with no county and nothing to say so. This is the rule
CLAUDE.md already states for tests about where a reservoir is, reaching the
tool that decides it.

**The point is the waterbody, not the dam** (ADR-058). The drainage assignment
deliberately uses the dam -- a drainage area is where the stored water leaves
-- and a county deliberately does not. Two reservoirs differ, and Lake Powell
is the one that settles it: Glen Canyon Dam is in Coconino County, Arizona,
and the lake a Utah reader is asking about is in San Juan County, Utah.

Geometry is queried, never committed. The service resolves the point against
its own full-resolution polygons and answers with a code; there is nothing to
store and nothing to keep in step. That is ADR-048's rule -- the roster, not
the polygons -- reaching a second geography.

    python tools/build_county_assignments.py --dry-run   # print, write nothing
    python tools/build_county_assignments.py             # write counties.json
"""

import argparse
import datetime as dt
import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from refresh_reservoirs import (  # noqa: E402
    ALL_RESERVOIR_NAMES, AWDB_RESERVOIRS, RESERVOIRS,
)

ROOT = Path(__file__).resolve().parent.parent
OUTPUT_PATH = ROOT / "counties.json"

# Esri Living Atlas, "USA Census Counties", marked authoritative and carrying
# the Census Bureau's 2020 boundaries. Layer `dtl_cnty` is the detailed copy,
# and the detail is the point: the generalized boundaries beside it -- the ones
# the drought map already draws as optional context -- put Lost Lake outside
# Wasatch County entirely. Drawing tolerates a shifted line; assigning a point
# does not.
COUNTY_LAYER = ("https://services.arcgis.com/P3ePLMYs2RVChkJx/arcgis/rest/"
                "services/USA_Census_Counties/FeatureServer/0")

# `FIPS` is the five-digit state-plus-county code and is the key. The name is
# not: this roster alone holds two Summit Counties, two Carbon Counties and
# two Garfield Counties, in different states, so keying on the name would
# merge six reservoirs into three groups that do not exist.
FIELDS = "FIPS,NAME,STATE_ABBR,STATE_NAME"

USER_AGENT = "utah-water-dashboard/county-assignment (+https://github.com/buschbrian)"
TIMEOUT = 60


def get_json(url: str, params: dict) -> dict | None:
    request = urllib.request.Request(
        url, data=urllib.parse.urlencode(params).encode(),
        headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except (urllib.error.URLError, TimeoutError, ValueError) as exc:
        print(f"    !! {exc}", file=sys.stderr)
        return None
    if isinstance(payload, dict) and payload.get("error"):
        print(f"    !! service error: {payload['error'].get('message')}", file=sys.stderr)
        return None
    return payload


def county_at(lon: float, lat: float) -> dict | None:
    """The county containing one point, resolved by the service.

    One query per reservoir rather than one bulk fetch of polygons. It is
    slower and it is the whole design: the full-resolution boundaries are tens
    of megabytes, this project would have to commit them to stay reproducible,
    and it needs 68 answers rather than 3,143 shapes.
    """
    payload = get_json(f"{COUNTY_LAYER}/query", {
        "geometry": f"{lon},{lat}", "geometryType": "esriGeometryPoint",
        "inSR": "4326", "spatialRel": "esriSpatialRelIntersects",
        "outFields": FIELDS, "returnGeometry": "false", "f": "json",
    })
    features = (payload or {}).get("features") or []
    if not features:
        return None
    attributes = features[0]["attributes"]
    # A point on a shared boundary can intersect two counties. It is reported
    # rather than resolved: picking the first would be a silent decision about
    # a reservoir's location, and nothing in this roster needs it yet.
    if len(features) > 1:
        names = ", ".join(f["attributes"]["NAME"] for f in features)
        print(f"    !! point falls on a boundary between {names}", file=sys.stderr)
    return {
        "county_fips": attributes["FIPS"],
        "county_name": attributes["NAME"],
        "county_state": attributes["STATE_ABBR"],
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    missing_config: list[str] = []

    # `ALL_RESERVOIR_NAMES` is the roster the refresh itself works from -- the
    # Reclamation table plus every AWDB station, which already includes the
    # reviewed connected sites. Both tables put lat at 1 and lon at 2; taken
    # by name rather than by unpacking, because the two tuples are different
    # lengths and only their first three fields line up.
    roster: dict[str, tuple[float, float]] = {}
    for name in ALL_RESERVOIR_NAMES:
        row = RESERVOIRS.get(name) or AWDB_RESERVOIRS.get(name)
        if row is None:
            missing_config.append(name)
            continue
        roster[name] = (row[2], row[1])

    assignments, missing = {}, []
    print(f"{'reservoir':<34} county")
    for name, (lon, lat) in sorted(roster.items()):
        if lon is None or lat is None:
            missing.append(f"{name}: no configured point")
            continue
        found = county_at(lon, lat)
        if found is None:
            missing.append(f"{name}: no county contains ({lon}, {lat})")
            continue
        assignments[name] = found
        print(f"{name:<34} {found['county_name']}, {found['county_state']}")
        # The service is somebody else's, and 68 queries in a burst is rude.
        time.sleep(0.1)

    distinct = {v["county_fips"] for v in assignments.values()}
    print(f"\n{len(assignments)}/{len(roster)} reservoirs assigned "
          f"across {len(distinct)} counties.")
    for name in missing_config:
        missing.append(f"{name}: on the roster with no configured point")
    for problem in missing:
        print(f"    !! {problem}")

    # A partial file would publish a county filter that quietly omits
    # reservoirs, which reads as "none there" rather than "not known".
    # "Every reservoir on the roster" includes the withdrawn ones on purpose.
    if missing:
        print("\nRefusing to write: every published reservoir must resolve.",
              file=sys.stderr)
        return 1

    payload = {
        "source": "Esri Living Atlas, USA Census Counties "
                  "(U.S. Census Bureau 2020 boundaries)",
        "source_layer": COUNTY_LAYER,
        "retrieved": dt.date.today().isoformat(),
        "assignment_point": "published_point",
        "roster": "the refresh's own roster, not reservoirs.json -- a reservoir withdrawn for going quiet (ADR-056) has not moved county",
        "note": "The county holding each reservoir's published waterbody "
                "point. Deliberately not the dam point the drainage area is "
                "assigned from (ADR-058): Glen Canyon Dam is in Coconino "
                "County, Arizona, and Lake Powell is in San Juan County, "
                "Utah. Keyed on the five-digit FIPS code, because this "
                "roster holds two Summit Counties in different states.",
        "counties": dict(sorted(assignments.items())),
    }

    if args.dry_run:
        print("\nDry run: nothing written.")
        return 0
    OUTPUT_PATH.write_text(json.dumps(payload, indent=2) + "\n")
    print(f"\nWrote {OUTPUT_PATH.name}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
