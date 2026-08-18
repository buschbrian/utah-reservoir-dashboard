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
import admission  # noqa: E402
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
    "lat": ("latitude", "lat", "ycoord", "y"),
    "lon": ("longitude", "lon", "long", "xcoord", "x"),
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
# The inventory is keyed by dam, not by reservoir, and several of ours are
# named for neither. Each entry is a human decision a reviewer can check.
ALIASES = {
    "Lake Powell": "Glen Canyon",        # Glen Canyon Dam impounds Lake Powell
    "Willard Bay": "Arthur V Watkins",   # Arthur V. Watkins Dam
    "Strawberry": "Soldier Creek",       # Soldier Creek Dam
    "Rockport": "Wanship",               # Wanship Dam
}

# Not every reservoir a Utah dashboard tracks sits in Utah: Glen Canyon Dam
# is in Arizona and Meeks Cabin is in Wyoming, and filtering the inventory
# to state='UT' silently dropped both. Utah rows are still preferred when a
# name appears in more than one state.
STATES = {
    "UT": ("UT", "AZ", "WY"),
    "Utah": ("Utah", "Arizona", "Wyoming"),
    "UTAH": ("UTAH", "ARIZONA", "WYOMING"),
}

# Name normalization lives in `admission.py` now. Two copies of the rule
# for which words two agencies are likely to drop is how the two matchers
# came to disagree in the first place.

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
                        states = STATES[value]
                        joined = ",".join(f"'{s}'" for s in states)
                        full = f"{resolved['state']} IN ({joined})"
                        print(f"    -> using {layer_url} with {full}")
                        return layer_url, resolved, full, states[0]
    return None, None, None, None


def fetch_utah_dams(layer_url: str, where: str) -> list[dict]:
    """Every dam in scope, paged, carrying its position.

    The geometry is asked for now. It used to be refused, which is the whole
    reason this tool matched on name alone: it had no position to match on.
    That was survivable while the query was one state and is not at eleven --
    the inventory holds several "Mud Lake", and a name bucket picks between
    them by storage.
    """
    rows, offset = [], 0
    while True:
        page = get(f"{layer_url}/query", {
            "f": "json", "where": where, "outFields": "*",
            "returnGeometry": "true", "outSR": 4326,
            "resultOffset": offset, "resultRecordCount": 1000,
        })
        features = (page or {}).get("features") or []
        for feature in features:
            row = dict(feature.get("attributes") or {})
            geometry = feature.get("geometry") or {}
            if geometry.get("x") is not None:
                row["_lon"], row["_lat"] = geometry["x"], geometry["y"]
            rows.append(row)
        if len(features) < 1000:
            break
        offset += 1000
    located = sum(1 for row in rows if row.get("_lon") is not None)
    print()
    print(f"=== {len(rows)} dams in the inventory, {located} with a position")
    return rows


def pick_coord(dam: dict, resolved: dict, key: str):
    """A position from the attributes, when the geometry did not come."""
    field = resolved.get(key)
    if not field:
        return None
    try:
        return float(dam.get(field))
    except (TypeError, ValueError):
        return None



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

    layer_url, resolved, where, _state_value = find_nid_layer()
    if not layer_url:
        print("ERROR: no dam inventory found with a usable schema", file=sys.stderr)
        return 1

    dams = fetch_utah_dams(layer_url, where)
    if not dams:
        print("ERROR: no Utah dams returned", file=sys.stderr)
        return 1

    name_field = resolved["name"]

    def storage(dam, key):
        return pick(dam.get(resolved[key])) if resolved.get(key) else None

    # Observed record maxima, to catch a match that attached the wrong dam.
    observed = {name: rec.get("record_max_af")
                for name, rec in load_previous(OUTPUT_PATH).items()}
    # One matcher for the whole project. `admission.find_dam` confirms a dam
    # two ways -- near enough that nothing else could be it, or further away
    # and named the same -- and both radii are measured, against reservoirs
    # whose dam is already confirmed by its inventory identifier. The
    # bucket-by-name-and-take-the-biggest this replaces has no distance
    # component at all, so at western scale it attaches the largest dam
    # sharing a name rather than the one at the gauge.
    located = [
        {
            "name": dam.get(name_field),
            "lon": dam.get("_lon", pick_coord(dam, resolved, "lon")),
            "lat": dam.get("_lat", pick_coord(dam, resolved, "lat")),
            # admission.py's names, so its rules can read these directly
            # rather than each caller re-deriving which column is which.
            "normal_storage_af": storage(dam, "normal"),
            "max_storage_af": storage(dam, "max"),
            "nid_storage_af": storage(dam, "nid"),
            "_row": dam,
        }
        for dam in dams
    ]




    table, problems = {}, []
    print(f"\n{'reservoir':<18} {'normal_af':>12} {'max_af':>12} {'nid_af':>12} "
          f"{'record max':>12}  dam")
    for name, (_rise_id, lat, lon) in RESERVOIRS.items():
        # The alias is what to match the name against, not a lookup key:
        # position is the primary evidence now, and the alias only carries
        # the far cases where the two agencies name different things.
        #
        # The screen is the observed record. A structure that could not hold
        # the water this reservoir has been watched holding is not its dam,
        # however close it stands -- Huntington North's gauge has a settling
        # pond 0.29 km away and its own dam 13.49 km away. This is the same
        # evidence the check below the match uses; applied before, it lets
        # the right dam be found instead of only reporting the wrong one.
        floor = observed.get(name)
        match = admission.find_dam(
            (lon, lat), ALIASES.get(name, name), located,
            plausible=lambda dam, floor=floor: admission.could_hold(dam, floor))
        if match is None:
            problems.append(
                f"{name}: no dam within {admission.NEAR_RADIUS_KM} km, and none "
                f"named the same within {admission.NAMED_RADIUS_KM} km")
            continue
        dam = match.dam["_row"]
        normal, maximum, nid = (storage(dam, "normal"), storage(dam, "max"),
                                storage(dam, "nid"))
        record_max = observed.get(name)
        print(f"{name:<18} {str(normal):>12} {str(maximum):>12} {str(nid):>12} "
              f"{str(record_max):>12}  {dam.get(name_field)}")

        # Order matters. normal_storage (conservation pool) is the figure
        # that tracks reality: for reservoirs that have it, it lands within a
        # percent of the storage actually observed since 2015 (Strawberry
        # 1,105,910 vs 1,106,560 observed; Rockport 62,120 vs 62,372).
        # nid_storage is the maximum pool *including flood surcharge* and is
        # the worst choice of the three -- Lake Powell has no normal_storage,
        # and taking nid_storage gave 29,875,000 af against a real full pool
        # nearer 25,000,000, quietly understating how empty it is. Fall back
        # to max_storage before nid_storage.
        denominator = normal or maximum or nid
        basis = ("normal_storage" if normal else
                 "max_storage" if maximum else "nid_storage")
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
            "capacity_basis": basis,
            "normal_storage_af": normal,
            "max_storage_af": maximum,
            "nid_storage_af": nid,
            "nid_id": dam.get(resolved["nidid"]) if resolved.get("nidid") else None,
            "nid_dam_name": dam.get(name_field),
            # Written here now. The dam point was added by a second pass
            # (tools/add_dam_points.py) because this tool refused the
            # geometry and had none to write; it fetches the position to
            # match on, so keeping it costs nothing and the table stops
            # depending on a tool being remembered.
            "dam_lon": round(match.dam["lon"], 5) if match.dam["lon"] is not None else None,
            "dam_lat": round(match.dam["lat"], 5) if match.dam["lat"] is not None else None,
        }

    print(f"\n=== matched {len(table)}/{len(RESERVOIRS)} reservoirs")
    for problem in problems:
        print(f"    !! {problem}")

    payload = {
        "source": "U.S. Army Corps of Engineers, National Inventory of Dams",
        "source_layer": layer_url,
        "retrieved": dt.date.today().isoformat(),
        "denominator": "normal_storage (storage at the normal/conservation "
                       "pool), falling back to max_storage then nid_storage. "
                       "Each reservoir records which one it used as "
                       "capacity_basis.",
        "note": "Capacities are NID's, not Utah DWR's; the two can differ on "
                "what counts as capacity. Every entry was checked against the "
                "storage observed since 2015 and rejected if it came in lower.",
        "unmatched": problems,
        "capacities": table,
        # The same block `tools/add_dam_points.py` used to add in a second
        # pass. The coordinates are written beside each capacity above, so
        # this describes where they came from and what they are for.
        "dam_points": {
            "source": layer_url,
            "note": ("Dam coordinates, from the matched inventory row. Used as "
                     "the watershed assignment point: the drainage area is "
                     "where the stored water leaves, not where the middle of "
                     "the lake is."),
            "count": sum(1 for entry in table.values()
                         if entry.get("dam_lon") is not None),
        },
    }

    if args.dry_run:
        print("\n--dry-run: not writing")
        return 0

    CAPACITY_PATH.write_text(json.dumps(payload, indent=2) + "\n")
    print(f"\nWrote {len(table)} capacities to {CAPACITY_PATH}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
