"""Discover a Utah DWR-published reservoir capacity dataset.

RISE has no capacity figure (see tools/probe_rise.py for the proof), so a
true "percent full" needs a second source. This searches ArcGIS Online for
Utah reservoir/dam datasets, then inspects any feature service it finds:
field list first, then a sample of rows, so we can see whether a capacity
column exists and what it is called before writing anything against it.

Discovery only -- it never writes a capacity table. The table is built by
tools/build_capacity_table.py once a source has actually been chosen.

    python tools/find_utah_capacities.py
"""

import json
import sys

import requests

AGOL_SEARCH = "https://www.arcgis.com/sharing/rest/search"

QUERIES = [
    'Utah reservoir capacity',
    'Utah reservoir storage',
    '(Utah dams) AND (capacity OR storage)',
    'owner:UtahDNR reservoir',
    'owner:UtahAGRC dam',
    'Utah Division of Water Resources reservoir',
]

# Field names worth flagging in a schema dump.
CAPACITY_HINTS = ("capac", "storage", "acre", "af", "volume", "vol",
                  "full", "max", "pool", "size")

NAME_HINTS = ("name", "label", "reservoir", "dam", "title")


def get(url: str, params: dict | None = None, timeout: int = 45):
    try:
        resp = requests.get(url, params=params, timeout=timeout)
    except requests.exceptions.RequestException as exc:
        print(f"    !! {exc}")
        return None
    if resp.status_code != 200:
        print(f"    !! HTTP {resp.status_code} {resp.url[:140]}")
        return None
    try:
        return resp.json()
    except ValueError:
        print(f"    !! non-JSON from {resp.url[:140]}: {resp.text[:120]}")
        return None


def search():
    """Find candidate hosted layers, newest/most-used first."""
    seen = {}
    for query in QUERIES:
        print(f"\n=== search: {query}")
        payload = get(AGOL_SEARCH, {
            "f": "json", "num": 20, "q": query,
            "sortField": "numViews", "sortOrder": "desc",
        })
        for item in (payload or {}).get("results", []):
            if item["type"] not in ("Feature Service", "Map Service"):
                continue
            url = item.get("url")
            if not url or url in seen:
                continue
            seen[url] = item
            print(f"    {item['title'][:64]!r}")
            print(f"      owner={item.get('owner')} type={item['type']}")
            print(f"      {url}")
    return seen


def inspect(url: str, title: str):
    """Print a service's layers, their fields, and one sample row."""
    print(f"\n=== inspect {title[:60]!r}\n    {url}")
    meta = get(url, {"f": "json"})
    if not meta:
        return
    layers = (meta.get("layers") or []) + (meta.get("tables") or [])
    if not layers:
        layers = [{"id": 0, "name": meta.get("name", "layer0")}]
    for layer in layers[:4]:
        layer_url = f"{url}/{layer['id']}"
        info = get(layer_url, {"f": "json"})
        if not info:
            continue
        fields = info.get("fields") or []
        names = [f["name"] for f in fields]
        print(f"    layer {layer['id']} {info.get('name')!r} "
              f"({info.get('geometryType')}, {len(names)} fields)")
        interesting = [n for n in names
                       if any(h in n.lower() for h in CAPACITY_HINTS + NAME_HINTS)]
        print(f"      candidate fields: {interesting}")
        if not interesting:
            continue
        rows = get(f"{layer_url}/query", {
            "f": "json", "where": "1=1", "outFields": "*",
            "resultRecordCount": 3, "returnGeometry": "false",
        })
        for feature in (rows or {}).get("features", [])[:3]:
            attrs = feature.get("attributes", {})
            trimmed = {k: v for k, v in attrs.items() if k in interesting}
            print(f"      sample: {json.dumps(trimmed)[:300]}")


def main() -> int:
    found = search()
    print(f"\n\n######## inspecting {len(found)} candidate services ########")
    for url, item in list(found.items())[:12]:
        inspect(url, item["title"])
    print("\n=== done")
    return 0


if __name__ == "__main__":
    sys.exit(main())
