"""Discover a Utah-published reservoir capacity dataset (acre-feet).

Superseded rather than required: the findings below are captured in ADR-003,
which chose the National Inventory of Dams. Kept for the day a Utah-published
capacity table appears and the survey needs re-running.

RISE has no capacity figure (see tools/probe_rise.py for the proof), so a
true "percent full" needs a second source. This enumerates the ArcGIS orgs
that publish Utah water data and dumps the schema and sample rows of every
reservoir/dam layer it finds, so a capacity table is written against a real
schema in known units rather than a guess.

Discovery only -- it never writes a capacity table.

    python tools/find_utah_capacities.py            # targeted org sweep
    python tools/find_utah_capacities.py --search   # broad AGOL search

FINDINGS SO FAR (2026-08-09) -- no Utah DWR capacity table located yet:

  - services1.arcgis.com/wQnFk5ouCfPzTlPw is NRCS (NWCC), not Utah. Its
    "Reservoir Storage Capacity" layer's `StorageCapacity` reads 22 for
    Pineview and 35 for Panguitch Lake. Pineview's real capacity is around
    110,000 af, so those are percent-of-capacity readings. Do NOT mistake
    that field for a capacity in acre-feet -- it is the single most
    plausible-looking wrong answer in this whole search.
  - services.arcgis.com/ZzrwjTRez6FJiOq4 carries Utah DNR planning layers
    (West Colorado Basin, Hydropower Facilities in Utah). Its "CAPACITY"
    field on Hydro_Dams_Con is megawatts, not storage.
  - The only schema found with real storage volumes is the National
    Inventory of Dams layout: `nid_storage`, `normal_storage`,
    `max_storage`, `surface_area`, keyed by `nidid` and `dam_name`. NRCS
    hosts one such layer, but scoped to a Virginia watershed, not Utah.
    NID is the promising direction: it is authoritative, in acre-feet, and
    covers every Utah dam -- but it is USACE/NRCS data, not Utah DWR's own
    numbers, and the two can disagree on what "capacity" means (total vs.
    normal vs. active conservation pool).

Whoever picks this up next: decide *which* capacity definition the
dashboard should divide by before wiring anything, and record the source
per reservoir. A denominator nobody can trace is worse than the honest
`pct_of_record_max` we already have.
"""

import argparse
import json
import sys

import requests

AGOL_SEARCH = "https://www.arcgis.com/sharing/rest/search"

# ArcGIS org ids worth sweeping, most likely first.
ORGS = {
    "Utah DNR / Water Resources": "https://services.arcgis.com/ZzrwjTRez6FJiOq4/arcgis/rest/services",
    "UGRC (Utah Geospatial Resource Center)": "https://services1.arcgis.com/99lidPhWCzftIe9K/arcgis/rest/services",
    "NRCS NWCC": "https://services1.arcgis.com/wQnFk5ouCfPzTlPw/arcgis/rest/services",
}

SERVICE_HINTS = ("dam", "reservoir", "storage", "capacit", "water")

CAPACITY_HINTS = ("capac", "storage", "acre", "_af", "af_", "volume", "vol",
                  "full", "max", "pool", "active", "total")
NAME_HINTS = ("name", "label", "reservoir", "dam", "title", "site")

# A few of our reservoirs, to sanity-check units against known record maxima.
PROBE_NAMES = ("Pineview", "Deer Creek", "Jordanelle", "Strawberry", "Echo")


def get(url: str, params: dict | None = None, timeout: int = 45):
    try:
        resp = requests.get(url, params=params, timeout=timeout)
    except requests.exceptions.RequestException as exc:
        print(f"    !! {exc}")
        return None
    if resp.status_code != 200:
        print(f"    !! HTTP {resp.status_code} {resp.url[:130]}")
        return None
    try:
        return resp.json()
    except ValueError:
        print(f"    !! non-JSON {resp.url[:130]}: {resp.text[:100]}")
        return None


def inspect_layer(layer_url: str, label: str):
    """Full field list plus rows for a handful of known reservoirs."""
    info = get(layer_url, {"f": "json"})
    if not info:
        return
    fields = [f["name"] for f in (info.get("fields") or [])]
    caps = [n for n in fields if any(h in n.lower() for h in CAPACITY_HINTS)]
    names = [n for n in fields if any(h in n.lower() for h in NAME_HINTS)]
    if not (caps and names):
        return

    print(f"\n  >>> {label}")
    print(f"      {layer_url}")
    print(f"      all fields: {fields}")
    print(f"      capacity-ish: {caps}")
    print(f"      name-ish: {names}")

    # Unit check: pull rows for reservoirs whose real capacity we can eyeball.
    name_field = names[0]
    where = " OR ".join(f"{name_field} LIKE '%{n}%'" for n in PROBE_NAMES)
    rows = get(f"{layer_url}/query", {
        "f": "json", "where": where, "outFields": "*",
        "resultRecordCount": 20, "returnGeometry": "false",
    })
    features = (rows or {}).get("features") or []
    if not features:
        rows = get(f"{layer_url}/query", {
            "f": "json", "where": "1=1", "outFields": "*",
            "resultRecordCount": 5, "returnGeometry": "false",
        })
        features = (rows or {}).get("features") or []
        print("      (no name matches; showing arbitrary rows)")
    for feature in features[:8]:
        attrs = feature.get("attributes", {})
        trimmed = {k: attrs.get(k) for k in names + caps}
        print(f"      row: {json.dumps(trimmed)[:320]}")


def sweep_org(label: str, root: str):
    print(f"\n\n======== {label}\n    {root}")
    listing = get(root, {"f": "json"})
    if not listing:
        return
    services = listing.get("services") or []
    print(f"    {len(services)} services; matching ones:")
    for service in services:
        name = service.get("name", "")
        if not any(h in name.lower() for h in SERVICE_HINTS):
            continue
        print(f"      - {name} ({service.get('type')})")
        service_url = f"{root}/{name.split('/')[-1]}/{service.get('type')}"
        meta = get(service_url, {"f": "json"})
        if not meta:
            continue
        for layer in ((meta.get("layers") or []) + (meta.get("tables") or []))[:8]:
            inspect_layer(f"{service_url}/{layer['id']}",
                          f"{name} :: {layer.get('name')}")


def broad_search():
    for query in ('Utah dams capacity acre feet', 'Utah reservoir capacity acre-feet',
                  'Utah Division of Water Rights dams'):
        print(f"\n=== search: {query}")
        payload = get(AGOL_SEARCH, {"f": "json", "num": 15, "q": query,
                                    "sortField": "numViews", "sortOrder": "desc"})
        for item in (payload or {}).get("results", []):
            if item.get("type") != "Feature Service" or not item.get("url"):
                continue
            print(f"    {item['title'][:60]!r} owner={item.get('owner')}")
            print(f"      {item['url']}")
            meta = get(item["url"], {"f": "json"})
            for layer in ((meta or {}).get("layers") or [])[:4]:
                inspect_layer(f"{item['url']}/{layer['id']}",
                              f"{item['title']} :: {layer.get('name')}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--search", action="store_true",
                        help="broad AGOL search instead of the org sweep")
    args = parser.parse_args()

    if args.search:
        broad_search()
    else:
        for label, root in ORGS.items():
            sweep_org(label, root)
    print("\n=== done")
    return 0


if __name__ == "__main__":
    sys.exit(main())
