"""Exploratory dump of RISE's catalog metadata for one reservoir.

A debugging aid, not part of the daily pipeline. `refresh_reservoirs.py`
only ever touches /rise/api/result, so nothing in this repo knew what else
RISE publishes about a reservoir -- which is why the dashboard's headline
number was a share of the *observed* record max rather than of real
capacity. This walks the catalog around a known storage item id and prints
what is actually there, so the capacity lookup can be written against the
real payload instead of a guess.

Run it from CI (`.github/workflows/probe-rise.yml`) rather than locally if
your network can't reach data.usbr.gov:

    python tools/probe_rise.py --item-id 509
"""

import argparse
import json
import sys
from pathlib import Path

import requests

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from refresh_reservoirs import RESERVOIRS  # noqa: E402

BASE = "https://data.usbr.gov/rise/api"
HEADERS = {"Accept": "application/vnd.api+json"}
NEEDLES = ("capac", "storage", "elevation", "acre", "full", "conservation", "dead")


def get(url: str, params: dict | None = None):
    """GET a RISE endpoint, printing the outcome rather than raising."""
    try:
        resp = requests.get(url, params=params, headers=HEADERS, timeout=60)
    except requests.exceptions.RequestException as exc:
        print(f"  !! request failed: {exc}")
        return None
    print(f"  {resp.status_code} {resp.url}")
    if resp.status_code != 200:
        print(f"  !! body: {resp.text[:300]}")
        return None
    try:
        return resp.json()
    except ValueError:
        print(f"  !! non-JSON body: {resp.text[:300]}")
        return None


def walk(obj, path="$"):
    """Yield (path, key, value) for every scalar in a nested structure."""
    if isinstance(obj, dict):
        for key, value in obj.items():
            yield from walk(value, f"{path}.{key}")
    elif isinstance(obj, list):
        for i, value in enumerate(obj[:25]):
            yield from walk(value, f"{path}[{i}]")
    else:
        yield path, obj


def show_interesting(payload, label: str):
    """Print every path whose key or value mentions something capacity-shaped."""
    print(f"  --- {label}: candidate fields ---")
    hits = 0
    for path, value in walk(payload):
        text = f"{path} {value}".lower()
        if any(n in text for n in NEEDLES):
            printable = str(value)
            if len(printable) > 120:
                printable = printable[:120] + "…"
            print(f"    {path} = {printable}")
            hits += 1
            if hits > 80:
                print("    … (truncated)")
                break
    if not hits:
        print("    (nothing matched)")


def summarize_keys(payload, label: str):
    print(f"  --- {label}: structure ---")
    if isinstance(payload, dict):
        print(f"    top-level keys: {list(payload)}")
        data = payload.get("data")
        if isinstance(data, dict):
            print(f"    data keys: {list(data)}")
            attrs = data.get("attributes")
            if isinstance(attrs, dict):
                print(f"    data.attributes keys: {list(attrs)}")
            rels = data.get("relationships")
            if isinstance(rels, dict):
                print(f"    data.relationships keys: {list(rels)}")
        elif isinstance(data, list):
            print(f"    data is a list of {len(data)}")
            if data and isinstance(data[0], dict):
                print(f"    data[0] keys: {list(data[0])}")
                attrs = data[0].get("attributes")
                if isinstance(attrs, dict):
                    print(f"    data[0].attributes keys: {list(attrs)}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--item-id", type=int, help="a RISE catalog-item id")
    parser.add_argument("--name", help="a reservoir name from RESERVOIRS instead")
    parser.add_argument("--dump", action="store_true",
                        help="also print each full payload")
    args = parser.parse_args()

    item_id = args.item_id
    if args.name:
        if args.name not in RESERVOIRS:
            print(f"unknown reservoir: {args.name}", file=sys.stderr)
            return 2
        item_id = RESERVOIRS[args.name][0]
    if not item_id:
        print("need --item-id or --name", file=sys.stderr)
        return 2

    print(f"=== catalog-item/{item_id}")
    item = get(f"{BASE}/catalog-item/{item_id}")
    if item:
        summarize_keys(item, "catalog-item")
        show_interesting(item, "catalog-item")
        if args.dump:
            print(json.dumps(item, indent=2)[:6000])

    # Find the location this item hangs off, then look at the location and
    # every other catalog item recorded against it -- capacity is far more
    # likely to be a sibling parameter or a location attribute than to live
    # on the storage timeseries itself.
    location_id = None
    if item:
        for path, value in walk(item):
            if "location" in path.lower() and isinstance(value, str) and "/location/" in value:
                location_id = value.rstrip("/").split("/")[-1]
                print(f"  -> location link {value} (id {location_id})")
                break

    if location_id:
        print(f"\n=== location/{location_id}")
        loc = get(f"{BASE}/location/{location_id}")
        if loc:
            summarize_keys(loc, "location")
            show_interesting(loc, "location")
            if args.dump:
                print(json.dumps(loc, indent=2)[:8000])

        print(f"\n=== catalog-record for location {location_id}")
        rec = get(f"{BASE}/catalog-record", {"locationId": location_id, "itemsPerPage": 100})
        if rec:
            summarize_keys(rec, "catalog-record")
            show_interesting(rec, "catalog-record")

        print(f"\n=== catalog-item list for location {location_id}")
        items = get(f"{BASE}/catalog-item", {"locationId": location_id, "itemsPerPage": 100})
        if items:
            summarize_keys(items, "catalog-item list")
            data = items.get("data") or []
            print(f"  --- {len(data)} catalog items at this location ---")
            for entry in data:
                attrs = (entry or {}).get("attributes") or {}
                print(f"    id={attrs.get('_id') or entry.get('id')} "
                      f"param={attrs.get('parameterName')!r} "
                      f"unit={attrs.get('parameterUnit')!r} "
                      f"timestep={attrs.get('parameterTimestep')!r}")

    print("\n=== done")
    return 0


if __name__ == "__main__":
    sys.exit(main())
