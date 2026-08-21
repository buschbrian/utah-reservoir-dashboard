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

CAPACITY_PATH = Path(__file__).resolve().parent.parent / "capacities.json"

# The inventory, from the agency that maintains it. Pinned rather than
# searched for: this tool used to locate a layer by querying ArcGIS Online
# for "National Inventory of Dams" and taking the most-viewed result, which
# had two problems. It cannot reach this service at all -- USACE runs its own
# ArcGIS Server and publishes nothing to ArcGIS Online, so the search could
# only ever return somebody's hosted copy -- and it wrote whatever it landed
# on into `source_layer`, making the provenance of capacities.json a record
# of that day's search ranking. Measured 2026-08-18: the owner service and
# the hosted copy this file used to credit return byte-identical rows for
# every committed identifier, so pinning changes no published number.
NID_LAYER = ("https://geospatial.sec.usace.army.mil/dls/rest/services/NID/"
             "National_Inventory_of_Dams_Public_Service/FeatureServer/0")

# The owner service names states in full ("Utah", not "UT"). Two-letter codes
# return zero rows rather than an error, which is the kind of empty answer
# that looks like a scope decision.
NID_STATE_WHERE = "STATE IN ('Utah', 'Arizona', 'Wyoming', 'Nevada')"

# Field names are still resolved rather than hard-coded. Against one pinned
# service this is no longer a compatibility shim for hosted copies that spell
# things differently -- it is a guard: if the owner renames a column, the
# resolution fails loudly here instead of writing a table full of nulls.
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
    "Lake Mead": "Hoover",               # Hoover Dam impounds Lake Mead
    "Willard Bay": "Arthur V Watkins",   # Arthur V. Watkins Dam
    "Strawberry": "Soldier Creek",       # Soldier Creek Dam
    "Rockport": "Wanship",               # Wanship Dam
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


def resolve_nid_layer():
    """Confirm the pinned inventory still publishes the schema this tool reads.

    Returns the same shape the ArcGIS Online search used to, so `main` is
    unchanged: the layer, the resolved field names, and the `where` that
    selects the states in scope. The difference is that a failure here means
    the owner changed something, not that a search ranked a different copy
    first.
    """
    print(f"=== inventory: {NID_LAYER}")
    info = get(NID_LAYER, {"f": "json"}) or {}
    resolved = field_map(info)
    if not usable(resolved):
        print(f"    !! schema not recognised: resolved {resolved}", file=sys.stderr)
        return None, None, None, None
    print(f"    fields: {resolved}")

    count = get(f"{NID_LAYER}/query", {
        "f": "json", "where": NID_STATE_WHERE, "returnCountOnly": "true"})
    rows = (count or {}).get("count", 0)
    print(f"    {NID_STATE_WHERE} -> {rows} rows")
    # The states in scope hold thousands of dams between them. A handful means
    # the state values changed spelling again, which is a silent scope change
    # rather than an error, so it is refused here.
    if rows < 100:
        print(f"    !! only {rows} dams in scope; the state values have moved",
              file=sys.stderr)
        return None, None, None, None
    return NID_LAYER, resolved, NID_STATE_WHERE, "Utah"


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

    layer_url, resolved, where, _state_value = resolve_nid_layer()
    if not layer_url:
        print("ERROR: the pinned dam inventory did not answer with the "
              "schema this tool reads", file=sys.stderr)
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

    # A failed match must not delete a reviewed entry. Lake Mead's was
    # confirmed by hand (ADR-062): Hoover Dam stands 42 km from the
    # published point, outside both match radii, so no automatic pass can
    # re-derive it. Kept and said out loud rather than silently rewritten
    # away -- the same rule that moved build_normal_baselines.py --only
    # from rewriting the file to merging into it.
    committed = {}
    if CAPACITY_PATH.exists():
        committed = (json.loads(CAPACITY_PATH.read_text(encoding="utf-8"))
                     .get("capacities") or {})

    def keep_or_report(station: str, name: str, why: str) -> None:
        kept = committed.get(station)
        if kept is not None:
            table[station] = kept
            problems.append(f"{name}: {why}; kept the committed entry "
                            f"({kept.get('nid_dam_name')})")
        else:
            problems.append(f"{name}: {why}")

    print(f"\n{'reservoir':<18} {'normal_af':>12} {'max_af':>12} {'nid_af':>12} "
          f"{'record max':>12}  dam")
    # By station id since ADR-066: the key is the identity, and the name
    # rides along for matching and for the humans reading the report.
    for station, (name, lat, lon) in RESERVOIRS.items():
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
        floor = observed.get(station)
        match = admission.find_dam(
            (lon, lat), ALIASES.get(name, name), located,
            plausible=lambda dam, floor=floor: admission.could_hold(dam, floor))
        if match is None:
            keep_or_report(
                station, name,
                f"no dam within {admission.NEAR_RADIUS_KM} km, and none "
                f"named the same within {admission.NAMED_RADIUS_KM} km")
            continue
        dam = match.dam["_row"]
        normal, maximum, nid = (storage(dam, "normal"), storage(dam, "max"),
                                storage(dam, "nid"))
        record_max = observed.get(station)
        print(f"{name:<18} {str(normal):>12} {str(maximum):>12} {str(nid):>12} "
              f"{str(record_max):>12}  {dam.get(name_field)}")

        # Order matters, and so does what the water has done. The preference
        # is normal_storage (conservation pool) first, then max_storage, then
        # nid_storage: the conservation pool is the figure that tracks reality
        # for almost every reservoir here, landing within a percent of the
        # storage actually observed since 2015 (Strawberry 1,105,910 vs
        # 1,106,560; Rockport 62,120 vs 62,372), while the headline figure is
        # the worst of the three -- Lake Powell has no normal_storage, and
        # taking nid_storage gave 29,875,000 af against a real full pool
        # nearer 25,000,000, quietly understating how empty it is.
        #
        # The preference is a preference and not a rule on its own, because
        # for a handful of reservoirs the conservation pool is not the figure
        # the readings are measured against at all: the Corps flood-control
        # projects report gross storage, and Detroit's series stands at
        # 346,757 acre-feet against a 155,000 pool. `denominator_for` offers
        # each figure in turn and takes the first the observed record fits
        # inside, so the pool keeps every reservoir it describes and loses the
        # ones it does not (ADR-072).
        denominator, basis = admission.denominator_for(
            {"normal_storage_af": normal, "max_storage_af": maximum,
             "nid_storage_af": nid},
            record_max)
        if denominator is None:
            keep_or_report(station, name, "no usable storage figure in the inventory")
            continue
        # The load-bearing check, and now the *residual* one: we have observed
        # this reservoir since 2015, so a capacity below what we have already
        # seen in it means the match is wrong -- not that it overflowed for a
        # decade. `denominator_for` above has already tried every figure the
        # record holds, so reaching here means none of them contains the
        # water. That is either a wrong dam or a surcharge above every
        # published pool (ADR-065), and neither is a denominator this tool can
        # choose between.
        if record_max and denominator < record_max * 0.9:
            keep_or_report(
                station, name,
                f"capacity {denominator:,.0f} af is below the observed "
                f"record max {record_max:,.0f} af -- probably the wrong dam "
                f"({dam.get(name_field)})")
            continue

        table[station] = {
            "name": name,
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
        # The identity the table is keyed by (ADR-066). Stated in the file
        # so a reader of the JSON does not have to know which side of the
        # rekey it was written on.
        "keyed_by": "source_station_id",
    }

    if args.dry_run:
        print("\n--dry-run: not writing")
        return 0

    CAPACITY_PATH.write_text(json.dumps(payload, indent=2) + "\n")
    print(f"\nWrote {len(table)} capacities to {CAPACITY_PATH}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
