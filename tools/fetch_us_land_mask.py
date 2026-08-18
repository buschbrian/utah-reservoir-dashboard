"""Fetch the land mask the drought engine measures against.

The U.S. Drought Monitor maps the United States and stops at both borders. The
coverage engine samples a grid over each drainage area and treats every cell
that is not inside a drought polygon as *not in drought* -- which is right for
a basin wholly inside the country and wrong for one that is not.

Twelve of the 75 western basins cross a border, and the error is not small:
Kootenai is 24.8% United States land and Upper Columbia 48.1%, so without this
mask they would report roughly 75 and 52 points of drought-free area that is
really Canada. Rio De La Concepcion is 1.3%. Nothing published today is
affected -- all fourteen current drainage areas are wholly inside the country
-- so this is a defect caught before the geography that triggers it ships.

The mask is the union of state polygons, which is what the monitor's own
extent follows. It is committed and never published: the engine reads it
offline, exactly like `huc6.geojson`, and no browser has any use for it.

    python tools/fetch_us_land_mask.py
    python tools/fetch_us_land_mask.py --dry-run
"""

import argparse
import json
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUTPUT_PATH = ROOT / "data" / "us-land.geojson"

# Census TIGERweb, layer 0 of the States and Counties service -- the same
# owner-operated service the county assignment reads (ADR-058), one layer up.
STATE_LAYER = ("https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/"
               "State_County/MapServer/0")

# The states every western scope can reach. Scoped rather than national
# because the mask only has to be right where this project measures, and the
# eastern states would double the file for ground no drainage area touches.
WESTERN_STATES = ("AZ", "CA", "CO", "ID", "MT", "NM", "NV", "OR", "UT", "WA", "WY")

# The project default under rule 5 of the source inventory, about 100 metres.
# No exception is needed and none is claimed: the engine samples on a grid an
# order of magnitude coarser than this, so a finer mask could not move a
# published figure.
MAX_ALLOWABLE_OFFSET = "0.001"

USER_AGENT = "utah-water-dashboard/us-land-mask (+https://github.com/buschbrian)"
TIMEOUT = 180


def fetch() -> dict:
    where = "STUSAB IN (" + ",".join(f"'{s}'" for s in WESTERN_STATES) + ")"
    body = urllib.parse.urlencode({
        "where": where, "outFields": "STUSAB", "returnGeometry": "true",
        "maxAllowableOffset": MAX_ALLOWABLE_OFFSET, "outSR": "4326",
        "f": "geojson",
    }).encode()
    request = urllib.request.Request(
        f"{STATE_LAYER}/query", data=body, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=TIMEOUT) as response:
        payload = json.loads(response.read().decode("utf-8"))
    if payload.get("error"):
        raise RuntimeError(f"service error: {payload['error']}")
    return payload


def validate(collection: dict) -> None:
    features = collection.get("features") or []
    found = sorted(str((f.get("properties") or {}).get("STUSAB") or "")
                   for f in features)
    missing = sorted(set(WESTERN_STATES) - set(found))
    if missing:
        raise ValueError(f"the mask is missing states: {', '.join(missing)}")
    if len(found) != len(set(found)):
        raise ValueError("the mask returned a state twice")
    for feature in features:
        geometry = feature.get("geometry") or {}
        if geometry.get("type") not in {"Polygon", "MultiPolygon"}:
            raise ValueError(
                f"{feature['properties']['STUSAB']} is not a polygon")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    collection = fetch()
    validate(collection)

    def vertices(value) -> int:
        if isinstance(value, list) and len(value) >= 2 \
                and all(isinstance(item, (int, float)) for item in value[:2]):
            return 1
        return sum(vertices(item) for item in value) if isinstance(value, list) else 0

    total = sum(vertices(f["geometry"]["coordinates"]) for f in collection["features"])
    print(f"{len(collection['features'])} states, {total:,} vertices")

    # Recorded in the file, so the tolerance a figure rests on travels with it
    # rather than living only in this tool -- the same arrangement the
    # watershed scopes use.
    collection["geometry"] = {
        "max_allowable_offset_degrees": float(MAX_ALLOWABLE_OFFSET),
        "source": STATE_LAYER,
        "states": list(WESTERN_STATES),
    }

    if args.dry_run:
        print("Dry run: nothing written.")
        return 0
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(
        json.dumps(collection, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"Wrote {OUTPUT_PATH.relative_to(ROOT)} "
          f"({OUTPUT_PATH.stat().st_size / 1024:.0f} KB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
