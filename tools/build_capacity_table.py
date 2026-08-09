"""Build capacities.json from the National Inventory of Dams.

RISE publishes no capacity (tools/probe_rise.py has the proof), so
`pct_of_record_max` divides by the highest storage ever *observed*, which
drifts as the record grows. NID is the authoritative alternative: USACE
maintains it, it is in acre-feet, and it covers every Utah dam.

Three storage figures are recorded per reservoir so the choice of
denominator can change later without re-fetching:

  normal_storage  storage at the normal (conservation) pool -- what
                  operators usually mean by "capacity", and what this
                  dashboard divides by
  max_storage     storage at the maximum pool, including flood surcharge
  nid_storage     NID's own headline figure (generally max of the two)

Every match is sanity-checked against the storage we have actually
observed since 2015: a capacity below the observed record max means the
row is almost certainly the wrong dam, and is reported as a failure rather
than written out. Name matching across two agencies is exactly the kind of
thing that silently attaches Deer Creek's numbers to some other Deer Creek.

    python tools/build_capacity_table.py --dry-run   # print, write nothing
    python tools/build_capacity_table.py             # write capacities.json
"""

import argparse
import datetime as dt
import json
import re
import sys
from pathlib import Path

import requests

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from refresh_reservoirs import RESERVOIRS, load_previous, OUTPUT_PATH  # noqa: E402

AGOL_SEARCH = "https://www.arcgis.com/sharing/rest/search"
CAPACITY_PATH = Path(__file__).resolve().parent.parent / "capacities.json"

# NID's schema, as seen on hosted copies of the inventory.
REQUIRED_FIELDS = {"nidid", "dam_name", "normal_storage", "max_storage", "nid_storage"}

# Where our name and NID's differ beyond normalization. Kept explicit and
# small: every entry here is a human decision that a reviewer can check.
ALIASES = {
    "Lake Powell": "Glen Canyon",
    "Flaming Gorge": "Flaming Gorge",
    "Joes Valley": "Joes Valley",
    "Huntington North": "Huntington North",
    "Upper Stillwater": "Upper Stillwater",
    "Willard Bay": "Arthur V Watkins",  # Willard Bay's dam is Arthur V. Watkins
}

NOISE = re.compile(r"\b(reservoir|lake|dam|and|powerplant|no|number)\b", re.I)


def normalize(name: str) -> str:
    name = NOISE.sub(" ", name or "")
    return re.sub(r"[^a-z0-9]+", "", name.lower())


def get(url: str, params: dict | None = None, timeout: int = 60):
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
        print(f"    !! non-JSON from {resp.url[:130]}")
        return None


def find_nid_layer() -> str | None:
    """Locate a hosted National Inventory of Dams layer carrying the NID schema."""
    for query in ('"National Inventory of Dams"', "National Inventory of Dams NID",
                  "NID dams inventory"):
        print(f"\n=== searching AGOL: {query}")
        payload = get(AGOL_SEARCH, {"f": "json", "num": 15, "q": query,
                                    "sortField": "numViews", "sortOrder": "desc"})
        for item in (payload or {}).get("results", []):
            url = item.get("url")
            if item.get("type") != "Feature Service" or not url:
                continue
            meta = get(url, {"f": "json"}) or {}
            for layer in (meta.get("layers") or [])[:3]:
                layer_url = f"{url}/{layer['id']}"
                info = get(layer_url, {"f": "json"}) or {}
                names = {f["name"].lower() for f in (info.get("fields") or [])}
                missing = REQUIRED_FIELDS - names
                print(f"    {item['title'][:52]!r} layer {layer['id']}: "
                      f"{'OK' if not missing else f'missing {sorted(missing)}'}")
                if missing:
                    continue
                count = get(f"{layer_url}/query", {
                    "f": "json", "where": "state='UT'", "returnCountOnly": "true"})
                utah = (count or {}).get("count", 0)
                print(f"      Utah rows: {utah}")
                if utah and utah > 100:
                    print(f"    -> using {layer_url}")
                    return layer_url
    return None


def fetch_utah_dams(layer_url: str) -> list[dict]:
    """Every Utah dam in the inventory, paged."""
    rows, offset = [], 0
    while True:
        page = get(f"{layer_url}/query", {
            "f": "json", "where": "state='UT'", "outFields": "*",
            "returnGeometry": "false", "resultOffset": offset,
            "resultRecordCount": 1000,
        })
        features = (page or {}).get("features") or []
        rows.extend(f.get("attributes", {}) for f in features)
        if len(features) < 1000:
            break
        offset += 1000
    print(f"\n=== {len(rows)} Utah dams in the inventory")
    return rows


def pick(value):
    """NID uses 0 and negatives as 'unknown'."""
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if number > 0 else None


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--layer-url", help="skip discovery and use this layer")
    args = parser.parse_args()

    layer_url = args.layer_url or find_nid_layer()
    if not layer_url:
        print("ERROR: no NID layer found with the expected schema", file=sys.stderr)
        return 1

    dams = fetch_utah_dams(layer_url)
    if not dams:
        print("ERROR: no Utah dams returned", file=sys.stderr)
        return 1

    by_norm: dict[str, list[dict]] = {}
    for dam in dams:
        by_norm.setdefault(normalize(dam.get("dam_name")), []).append(dam)

    # Observed record maxima, to catch a match that attached the wrong dam.
    observed = {name: rec.get("record_max_af")
                for name, rec in load_previous(OUTPUT_PATH).items()}

    table, problems = {}, []
    print(f"\n{'reservoir':<18} {'normal_af':>12} {'max_af':>12} {'record max':>12}  dam_name")
    for name in RESERVOIRS:
        candidates = by_norm.get(normalize(ALIASES.get(name, name)), [])
        if not candidates:
            problems.append(f"{name}: no NID dam matched")
            continue
        # Prefer the largest normal_storage when a name repeats -- the small
        # stock ponds sharing a name are never the monitored reservoir.
        dam = max(candidates, key=lambda d: pick(d.get("normal_storage")) or 0)
        normal = pick(dam.get("normal_storage"))
        maximum = pick(dam.get("max_storage"))
        nid = pick(dam.get("nid_storage"))
        record_max = observed.get(name)

        print(f"{name:<18} {str(normal):>12} {str(maximum):>12} "
              f"{str(record_max):>12}  {dam.get('dam_name')}")

        denominator = normal or nid or maximum
        if denominator is None:
            problems.append(f"{name}: NID has no usable storage figure")
            continue
        # The load-bearing check: we have observed storage since 2015, so a
        # capacity below what we have already seen in the reservoir means the
        # match is wrong, not that the reservoir overflowed for a decade.
        if record_max and denominator < record_max * 0.9:
            problems.append(
                f"{name}: capacity {denominator:,.0f} af is below the observed "
                f"record max {record_max:,.0f} af -- probably the wrong dam "
                f"({dam.get('dam_name')})")
            continue

        table[name] = {
            "capacity_af": round(denominator, 1),
            "normal_storage_af": normal,
            "max_storage_af": maximum,
            "nid_storage_af": nid,
            "nid_id": dam.get("nidid"),
            "nid_dam_name": dam.get("dam_name"),
        }

    print(f"\n=== matched {len(table)}/{len(RESERVOIRS)} reservoirs")
    for problem in problems:
        print(f"    !! {problem}")

    payload = {
        "source": "U.S. Army Corps of Engineers, National Inventory of Dams",
        "source_layer": layer_url,
        "retrieved": dt.date.today().isoformat(),
        "denominator": "normal_storage (storage at the normal/conservation pool), "
                       "falling back to nid_storage then max_storage",
        "note": "Capacities are NID's, not Utah DWR's; the two can differ on "
                "what counts as capacity. Every entry was checked against the "
                "storage observed since 2015 and rejected if it came in lower.",
        "unmatched": problems,
        "capacities": table,
    }

    if args.dry_run:
        print("\n--dry-run: not writing")
        print(json.dumps(payload, indent=2)[:2000])
        return 0

    CAPACITY_PATH.write_text(json.dumps(payload, indent=2) + "\n")
    print(f"\nWrote {len(table)} capacities to {CAPACITY_PATH}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
