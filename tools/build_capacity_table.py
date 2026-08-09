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

# Hosted copies of the inventory don't agree on field names: some use
# `dam_name`/`normal_storage`, others `NAME`/`NORMAL_STORAGE`, others drop
# the underscores entirely. Match on the squashed lowercase form and keep
# the real field name, rather than demanding one exact spelling -- the
# first attempt required `dam_name` and rejected two perfectly good copies
# of the inventory for calling it something else.
FIELD_OPTIONS = {
    "name": ("damname", "name", "officialname", "damnameofficial", "dam"),
    "normal": ("normalstorage", "normalstor", "conservationstorage", "normal"),
    "max": ("maxstorage", "maximumstorage", "maxstor"),
    "nid": ("nidstorage", "nidstor"),
    "state": ("state", "statename", "stateabbr", "stateabbreviation"),
    "nidid": ("nidid", "federalid", "nididnumber"),
}


def field_map(info: dict) -> dict:
    """Resolve our logical field names against whatever this layer calls them."""
    actual = {f["name"].lower().replace("_", ""): f["name"]
              for f in (info.get("fields") or [])}
    resolved = {}
    for key, options in FIELD_OPTIONS.items():
        for option in options:
            if option in actual:
                resolved[key] = actual[option]
                break
    return resolved


def usable(resolved: dict) -> bool:
    return bool(resolved.get("name") and resolved.get("state")
                and any(resolved.get(k) for k in ("normal", "max", "nid")))

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
                resolved = field_map(info)
                if not usable(resolved):
                    continue
                print(f"    {item['title'][:52]!r} layer {layer['id']}: {resolved}")
                for value in ("UT", "Utah", "UTAH"):
                    where = f"{resolved['state']}='{value}'"
                    count = get(f"{layer_url}/query", {
                        "f": "json", "where": where, "returnCountOnly": "true"})
                    utah = (count or {}).get("count", 0)
                    print(f"      {where} -> {utah} rows")
                    if utah > 100:
                        print(f"    -> using {layer_url}")
                        return layer_url, resolved, where
    return None, None, None


def fetch_utah_dams(layer_url: str, where: str) -> list[dict]:
    """Every Utah dam in the inventory, paged."""
    rows, offset = [], 0
    while True:
        page = get(f"{layer_url}/query", {
            "f": "json", "where": where, "outFields": "*",
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
    args = parser.parse_args()

    layer_url, resolved, where = find_nid_layer()
    if not layer_url:
        print("ERROR: no dam inventory found with a usable schema", file=sys.stderr)
        return 1

    dams = fetch_utah_dams(layer_url, where)
    if not dams:
        print("ERROR: no Utah dams returned", file=sys.stderr)
        return 1

    name_field = resolved["name"]
    by_norm: dict[str, list[dict]] = {}
    for dam in dams:
        by_norm.setdefault(normalize(dam.get(name_field)), []).append(dam)

    # Observed record maxima, to catch a match that attached the wrong dam.
    observed = {name: rec.get("record_max_af")
                for name, rec in load_previous(OUTPUT_PATH).items()}

    def storage(dam, key):
        return pick(dam.get(resolved[key])) if resolved.get(key) else None

    table, problems = {}, []
    print(f"\n{'reservoir':<18} {'normal_af':>12} {'max_af':>12} {'nid_af':>12} "
          f"{'record max':>12}  dam")
    for name in RESERVOIRS:
        candidates = by_norm.get(normalize(ALIASES.get(name, name)), [])
        if not candidates:
            problems.append(f"{name}: no dam matched by name")
            continue
        # Prefer the largest when a name repeats -- the stock ponds sharing a
        # name with a major reservoir are never the monitored one.
        dam = max(candidates, key=lambda d: storage(d, "normal") or storage(d, "nid") or 0)
        normal, maximum, nid = (storage(dam, "normal"), storage(dam, "max"),
                                storage(dam, "nid"))
        record_max = observed.get(name)
        print(f"{name:<18} {str(normal):>12} {str(maximum):>12} {str(nid):>12} "
              f"{str(record_max):>12}  {dam.get(name_field)}")

        denominator = normal or nid or maximum
        if denominator is None:
            problems.append(f"{name}: no usable storage figure in the inventory")
            continue
        # The load-bearing check: we have observed this reservoir since 2015,
        # so a capacity below what we have already seen in it means the match
        # is wrong -- not that it overflowed for a decade.
        if record_max and denominator < record_max * 0.9:
            problems.append(
                f"{name}: capacity {denominator:,.0f} af is below the observed "
                f"record max {record_max:,.0f} af -- probably the wrong dam "
                f"({dam.get(name_field)})")
            continue

        table[name] = {
            "capacity_af": round(denominator, 1),
            "normal_storage_af": normal,
            "max_storage_af": maximum,
            "nid_storage_af": nid,
            "nid_id": dam.get(resolved["nidid"]) if resolved.get("nidid") else None,
            "nid_dam_name": dam.get(name_field),
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
        return 0

    CAPACITY_PATH.write_text(json.dumps(payload, indent=2) + "\n")
    print(f"\nWrote {len(table)} capacities to {CAPACITY_PATH}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
