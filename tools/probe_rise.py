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
    python tools/probe_rise.py --name "Lake Powell" --capacity-hunt

WHAT THIS FOUND (2026-08-09, Lake Powell / item 509 / location 393):
RISE does not publish reservoir capacity anywhere reachable from the API.

  - The location carries no capacity attribute. Its only volume-adjacent
    field is `elevation` (3596.0), which is the dam's elevation in feet,
    not a storage volume.
  - The catalogRecord's 17 catalog items are Storage, Elevation, Inflow
    (several variants), Release (powerplant/spillway/bypass/total),
    Evaporation, Area, Bank Storage and Change In Storage. No capacity.
  - `hasProfile` is False, and /rise/api/profile, /catalog-item/{id}/profile
    and /profile?itemId= all 404, so there is no elevation-area-capacity
    table to read a full-pool figure off.
  - `locationDescription`, `projectNames`, `externalDataUrl` and
    `metadataFilePath` are all empty, so it is not hiding in free text.
  - Careful: /catalog-item?locationId= silently ignores the filter and
    returns items from other basins. Use the catalogRecord's catalogItems
    relationship instead, or you will draw confident conclusions from the
    wrong reservoir's data.

So `pct_of_record_max` cannot be turned into a true "percent full" from
RISE alone. Doing it properly needs a second, cited source for capacity
(Reclamation's project data sheets or Utah DWR), stored as a reviewed table
with provenance -- not guessed at.
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


HOST = "https://data.usbr.gov"


def resolve(iri: str) -> str:
    """RISE uses IRIs like /rise/api/catalog-record/123 as JSON:API ids."""
    return HOST + iri if iri.startswith("/") else iri


def related_iris(payload) -> dict[str, list[str]]:
    """Pull every relationship target out of a JSON:API document."""
    out: dict[str, list[str]] = {}
    data = (payload or {}).get("data")
    if not isinstance(data, dict):
        return out
    for name, rel in (data.get("relationships") or {}).items():
        target = rel.get("data")
        if isinstance(target, dict) and isinstance(target.get("id"), str):
            out[name] = [target["id"]]
        elif isinstance(target, list):
            out[name] = [t["id"] for t in target
                         if isinstance(t, dict) and isinstance(t.get("id"), str)][:20]
    return out


def dump_attributes(payload, label: str):
    """Every attribute, truncated. Capacity may not be named 'capacity'."""
    data = (payload or {}).get("data")
    entries = data if isinstance(data, list) else [data]
    for i, entry in enumerate(entries[:3]):
        attrs = (entry or {}).get("attributes")
        if not isinstance(attrs, dict):
            continue
        print(f"  --- {label}[{i}]: all attributes ---")
        for key, value in attrs.items():
            printable = str(value)
            if len(printable) > 100:
                printable = printable[:100] + "…"
            print(f"    {key} = {printable}")


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


def capacity_hunt(item_id: int) -> int:
    """Chase the last places a real capacity figure could be hiding.

    The catalog walk already ruled out the obvious ones: the location has no
    capacity attribute (only `elevation`, which is the dam's, not a volume),
    and none of the 17 catalog items on the record is a capacity parameter.
    What's left is the `hasProfile` flag on a catalog item -- RISE profiles
    are elevation/area/capacity tables -- and free text on the location.
    """
    print(f"=== item {item_id}: profile-related attributes")
    item = get(f"{BASE}/catalog-item/{item_id}")
    attrs = ((item or {}).get("data") or {}).get("attributes") or {}
    for key in ("hasProfile", "isModeled", "dataStructure", "itemStructureId",
                "matrix", "parameterGroup", "externalDataUrl", "metadataFilePath"):
        print(f"    {key} = {attrs.get(key)!r}")

    print("\n=== location free text (capacity is often only prose)")
    record_iri = (related_iris(item).get("catalogRecord") or [None])[0]
    location_iri = None
    if record_iri:
        record = get(resolve(record_iri))
        for key, values in related_iris(record).items():
            if "location" in key.lower() and values:
                location_iri = values[0]
    if location_iri:
        loc = get(resolve(location_iri))
        lattrs = ((loc or {}).get("data") or {}).get("attributes") or {}
        for key in ("locationName", "locationDescription", "projectNames",
                    "locationTags", "locationTypeName", "elevation"):
            value = str(lattrs.get(key))
            print(f"    {key} = {value[:500]}")

    print("\n=== candidate profile endpoints")
    for url, params in (
        (f"{BASE}/profile", {"itemId": item_id}),
        (f"{BASE}/catalog-item/{item_id}/profile", None),
        (f"{BASE}/profile", None),
        (f"{BASE}/result/downloadall", {"itemId": item_id}),
    ):
        payload = get(url, params)
        if payload:
            summarize_keys(payload, url.rsplit("/", 1)[-1])
            show_interesting(payload, url.rsplit("/", 1)[-1])
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--item-id", type=int, help="a RISE catalog-item id")
    parser.add_argument("--name", help="a reservoir name from RESERVOIRS instead")
    parser.add_argument("--dump", action="store_true",
                        help="also print each full payload")
    parser.add_argument("--capacity-hunt", action="store_true",
                        help="chase the remaining capacity leads and stop")
    args = parser.parse_args()

    item_id = args.item_id
    if args.name:
        # RESERVOIRS is keyed by station id since ADR-066; the name rides in
        # the value. Accept either spelling, and refuse a shared name rather
        # than answer for one twin wearing the other's question.
        matched = [station for station, (name, _lat, _lon) in RESERVOIRS.items()
                   if name == args.name or station == args.name]
        if not matched:
            print(f"unknown reservoir: {args.name}", file=sys.stderr)
            return 2
        if len(matched) > 1:
            print(f"{args.name} names {len(matched)} stations "
                  f"({', '.join(matched)}); pass the station id", file=sys.stderr)
            return 2
        item_id = matched[0]
    if not item_id:
        print("need --item-id or --name", file=sys.stderr)
        return 2

    if args.capacity_hunt:
        return capacity_hunt(item_id)

    print(f"=== catalog-item/{item_id}")
    item = get(f"{BASE}/catalog-item/{item_id}")
    if not item:
        return 1
    summarize_keys(item, "catalog-item")
    dump_attributes(item, "catalog-item")

    rels = related_iris(item)
    print(f"  relationships: { {k: v[:3] for k, v in rels.items()} }")

    # Capacity is not on the storage timeseries itself. Walk outward:
    # catalog-item -> catalogRecord -> location, dumping every attribute at
    # each hop, then list the location's other catalog items -- a sibling
    # parameter is the most likely place for a capacity figure to live.
    record_iri = (rels.get("catalogRecord") or [None])[0]
    location_iri = None
    if record_iri:
        print(f"\n=== catalogRecord {record_iri}")
        record = get(resolve(record_iri))
        if record:
            summarize_keys(record, "catalog-record")
            dump_attributes(record, "catalog-record")
            show_interesting(record, "catalog-record")
            rrels = related_iris(record)
            print(f"  relationships: { {k: v[:3] for k, v in rrels.items()} }")
            for key, values in rrels.items():
                if "location" in key.lower() and values:
                    location_iri = values[0]

    if location_iri:
        print(f"\n=== location {location_iri}")
        loc = get(resolve(location_iri))
        if loc:
            attrs = ((loc.get("data") or {}).get("attributes")) or {}
            print(f"  location attribute keys: {list(attrs)}")
            print("  --- location attributes that could be a capacity ---")
            for key, value in attrs.items():
                low = key.lower()
                if any(n in low for n in ("capac", "storage", "volume", "elev",
                                          "area", "full", "pool", "acre")):
                    printable = str(value)
                    if len(printable) > 200:
                        printable = printable[:200] + "…"
                    print(f"    {key} = {printable}")
            lrels = related_iris(loc)
            print(f"  location relationships: {list(lrels)}")

    # The authoritative sibling list is the catalogRecord's own catalogItems
    # relationship. The /catalog-item?locationId= filter is silently ignored
    # -- the first attempt came back with items from other basins entirely,
    # which would have made any conclusion about "no capacity parameter
    # exists" worthless.
    if record_iri:
        record = get(resolve(record_iri))
        item_iris = []
        for key, values in related_iris(record).items():
            if "item" in key.lower():
                item_iris = values
        print(f"\n=== {len(item_iris)} catalog items on this record")
        seen = set()
        for iri in item_iris[:40]:
            payload = get(resolve(iri))
            a = ((payload or {}).get("data") or {}).get("attributes") or {}
            line = (f"    id={a.get('_id')} param={a.get('parameterName')!r} "
                    f"unit={a.get('parameterUnit')!r} step={a.get('parameterTimestep')!r}")
            if line not in seen:
                seen.add(line)
                print(line)

    print("\n=== done")
    return 0


if __name__ == "__main__":
    sys.exit(main())
