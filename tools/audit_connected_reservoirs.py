"""Audit reservoirs outside Utah that drain through the same watersheds.

Four of the fourteen drainage areas that touch Utah currently have no tracked
reservoir at all: Colorado Headwaters, White-Yampa, Lower San Juan and Upper
Snake. That is not because they are empty. It is because this dashboard grew
from a Utah inventory, and the water that arrives in Lake Powell is stored
upstream in Colorado, Wyoming and New Mexico first.

Reclamation's own Upper Colorado status page names the candidates: Blue Mesa,
Crystal, Morrow Point, Navajo and Fontenelle.

A candidate is only admissible when it has **all four** of:

  1. an observed storage series -- not a modelled or forecast value,
  2. a traceable capacity, from the same National Inventory of Dams the rest
     of the dashboard uses,
  3. a stable site identifier, so the series can be re-fetched tomorrow,
  4. a usable dam or outlet coordinate that lands in a published unit.

This tool reports each candidate against those four, and does **not** add
anything. Admitting a reservoir changes every statewide total on the page, so
it is a decision to make deliberately with the evidence in front of you.

    python tools/audit_connected_reservoirs.py
    python tools/audit_connected_reservoirs.py --json
"""

import argparse
import json
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from huc import assign_huc, in_utah, load_units  # noqa: E402

RISE_CATALOG_ITEM = "https://data.usbr.gov/rise/api/catalog-item"
RISE_LOCATION = "https://data.usbr.gov/rise/api/location"
RISE_RESULT = "https://data.usbr.gov/rise/api/result"
NID_LAYER = ("https://services2.arcgis.com/FiaPA4ga0iQKduv3/arcgis/rest/"
             "services/NID_v1/FeatureServer/0")

USER_AGENT = "utah-reservoir-dashboard/connected-audit (+https://github.com/buschbrian)"
TIMEOUT = 90

# name -> the NID dam that impounds it. The inventory is keyed by dam, and
# three of these five are named for neither the reservoir nor the river, so
# the mapping is written down rather than guessed by string similarity --
# the same lesson build_capacity_table.py records.
CANDIDATES = {
    "Blue Mesa": {"dam": "Blue Mesa", "state": "Colorado", "river": "Gunnison"},
    "Morrow Point": {"dam": "Morrow Point", "state": "Colorado", "river": "Gunnison"},
    "Crystal": {"dam": "Crystal", "state": "Colorado", "river": "Gunnison"},
    "Navajo": {"dam": "Navajo", "state": "New Mexico", "river": "San Juan"},
    "Fontenelle": {"dam": "Fontenelle", "state": "Wyoming", "river": "Green"},
}

# NID's state column holds the full state name, not the two-letter code --
# the same variance build_capacity_table.py already guards against, and the
# reason a first pass of this tool reported "no matching dam" for all five.
STATE_CODES = {"Colorado": "CO", "New Mexico": "NM", "Wyoming": "WY"}

# The full watershed service, not the committed 15-unit file. A candidate
# outside every Utah-touching unit still has a drainage area, and naming it
# is what turns "rejected" into a reason.
WBD_LAYER = "https://hydro.nationalmap.gov/arcgis/rest/services/wbd/MapServer/3"


def get_json(url: str, params: dict | None = None, accept_json_api: bool = False):
    headers = {"User-Agent": USER_AGENT}
    if accept_json_api:
        headers["Accept"] = "application/vnd.api+json"
    full = url + ("?" + urllib.parse.urlencode(params) if params else "")
    try:
        with urllib.request.urlopen(
                urllib.request.Request(full, headers=headers), timeout=TIMEOUT) as response:
            return json.loads(response.read().decode("utf-8"))
    except (urllib.error.URLError, TimeoutError, ValueError) as exc:
        print(f"    !! {url.rsplit('/', 1)[-1]}: {exc}", file=sys.stderr)
        return None


def rise_storage_items(name: str, state_code: str) -> list[dict]:
    """RISE catalog items carrying an observed storage series for this site.

    Walks location -> catalogRecord -> catalogItem rather than filtering the
    catalog directly. **RISE silently ignores filters it does not support**:
    `/catalog-item?itemTitle=Blue Mesa` answers 200 with a page of unrelated
    California reservoirs, so a first pass of this tool concluded that none
    of the five candidates had a storage series at all. tools/probe_rise.py
    records the same trap for `locationId`. Treat any RISE filter as
    unsupported until its output proves otherwise.
    """
    matches = []
    for page in range(1, 8):
        payload = get_json(RISE_LOCATION, {
            "stateId": state_code, "itemsPerPage": 100, "page": page,
        }, accept_json_api=True)
        rows = (payload or {}).get("data", []) or []
        if not rows:
            break
        for row in rows:
            attributes = row.get("attributes") or {}
            title = str(attributes.get("locationName") or "")
            low = title.lower()
            # The reservoir itself, not its power plant: the generating units
            # share a name and carry no storage series.
            if name.lower() in low and "power plant" not in low:
                matches.append({"id": attributes.get("_id"), "name": title})

    def related_iris(payload, wanted):
        related = ((payload or {}).get("data") or {}).get("relationships") or {}
        out = []
        for key, value in related.items():
            if wanted not in key.lower().replace("-", "").replace("_", ""):
                continue
            entries = value.get("data") or []
            if isinstance(entries, dict):
                entries = [entries]
            out += [str(e.get("id") or "") for e in entries if e.get("id")]
        return out

    items = []
    for location in matches:
        # location -> catalogRecords -> catalogItems. A location does not
        # carry catalog items directly, which is the level a first pass of
        # this tool skipped -- it looked for `catalogItems` on the location,
        # found nothing, and reported "no storage series" for a reservoir
        # that has one.
        location_doc = get_json(f"{RISE_LOCATION}/{location['id']}", accept_json_api=True)
        for record_iri in related_iris(location_doc, "catalogrecord"):
            record = get_json("https://data.usbr.gov" + record_iri, accept_json_api=True)
            for item_iri in related_iris(record, "catalogitem"):
                item = get_json("https://data.usbr.gov" + item_iri, accept_json_api=True)
                attributes = ((item or {}).get("data") or {}).get("attributes") or {}
                if "storage" not in str(attributes.get("parameterName") or "").lower():
                    continue
                items.append({
                    "id": attributes.get("_id"),
                    "title": attributes.get("itemTitle"),
                    "parameter": attributes.get("parameterName"),
                    "timestep": attributes.get("temporalResolution"),
                    "units": attributes.get("parameterUnit"),
                    "location": location["name"],
                })
    return items


def rise_has_recent_values(item_id) -> dict:
    payload = get_json(RISE_RESULT, {
        "itemId": item_id, "itemsPerPage": 5, "page": 1, "order[dateTime]": "desc",
    }, accept_json_api=True)
    rows = (payload or {}).get("data", []) or []
    values = [r.get("attributes", {}) for r in rows]
    newest = values[0].get("dateTime") if values else None
    return {"rows": len(values), "newest": newest,
            "value": values[0].get("result") if values else None}


def nid_dam(name: str, state: str) -> dict | None:
    payload = get_json(f"{NID_LAYER}/query", {
        "where": f"NAME LIKE '{name}%' AND STATE='{state}'",
        "outFields": "NIDID,NAME,STATE,NORMAL_STORAGE,MAX_STORAGE,NID_STORAGE",
        "returnGeometry": "true", "outSR": "4326", "f": "json",
    })
    features = (payload or {}).get("features") or []
    if not features:
        return None
    # Largest first: a name can repeat across a stock pond and a major dam.
    features.sort(key=lambda f: (f.get("attributes", {}).get("NID_STORAGE") or 0),
                  reverse=True)
    best = features[0]
    a = best.get("attributes", {})
    g = best.get("geometry", {})
    pick = lambda v: float(v) if v not in (None, "") and float(v) > 0 else None
    return {
        "nid_id": a.get("NIDID"), "dam_name": a.get("NAME"), "state": a.get("STATE"),
        "normal_storage_af": pick(a.get("NORMAL_STORAGE")),
        "max_storage_af": pick(a.get("MAX_STORAGE")),
        "nid_storage_af": pick(a.get("NID_STORAGE")),
        "point": (round(g["x"], 5), round(g["y"], 5)) if g.get("x") is not None else None,
    }


def wbd_unit(point):
    """The drainage area a point really falls in, from the national service."""
    payload = get_json(f"{WBD_LAYER}/query", {
        "geometry": f"{point[0]},{point[1]}", "geometryType": "esriGeometryPoint",
        "inSR": "4326", "spatialRel": "esriSpatialRelIntersects",
        "outFields": "huc6,name,states", "returnGeometry": "false", "f": "json",
    })
    features = (payload or {}).get("features") or []
    return features[0].get("attributes") if features else None


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()

    units = load_units()
    empty = {u["huc6"]: u["name"] for u in units}
    for record in json.loads((ROOT / "reservoirs.json").read_text())["reservoirs"]:
        empty.pop(record.get("huc6"), None)

    findings = []
    for name, meta in CANDIDATES.items():
        print(f"\n=== {name} ({meta['river']} River, {meta['state']})")
        items = rise_storage_items(name, STATE_CODES[meta["state"]])
        series = None
        if items:
            series = rise_has_recent_values(items[0]["id"])
            print(f"  storage series : item {items[0]['id']} "
                  f"({items[0]['timestep']}, {items[0]['units']}), "
                  f"newest {series['newest']}")
        else:
            print("  storage series : none found in the RISE catalog")

        dam = nid_dam(meta["dam"], meta["state"])
        if dam:
            capacity = dam["normal_storage_af"] or dam["max_storage_af"]
            print(f"  capacity       : {capacity:,.0f} acre-feet "
                  f"({dam['nid_id']}, {dam['dam_name']})" if capacity
                  else f"  capacity       : none in NID for {dam['nid_id']}")
        else:
            print("  capacity       : no matching dam in the inventory")

        unit = assign_huc(dam["point"], units) if dam and dam["point"] else None
        actual = wbd_unit(dam["point"]) if dam and dam["point"] else None
        if unit:
            note = "  <-- currently has no tracked reservoir" if unit["huc6"] in empty else ""
            print(f"  drainage area  : {unit['huc6']} {unit['name']}{note}")
        elif actual:
            print(f"  drainage area  : {actual['huc6']} {actual['name']} "
                  f"(states {actual['states']})")
            print("                   This area does NOT touch Utah, so the site is "
                  "outside this dashboard's geography.")
        else:
            print("  drainage area  : could not be determined")

        admissible = bool(items and series and series["rows"]
                          and dam and (dam["normal_storage_af"] or dam["max_storage_af"])
                          and unit)
        print(f"  admissible     : {'yes' if admissible else 'NO'}")
        findings.append({
            "name": name, "river": meta["river"],
            "rise_item_id": items[0]["id"] if items else None,
            "newest_value": series["newest"] if series else None,
            "nid_id": dam["nid_id"] if dam else None,
            "capacity_af": (dam["normal_storage_af"] or dam["max_storage_af"]) if dam else None,
            "capacity_basis": ("normal_storage" if dam and dam["normal_storage_af"]
                               else "max_storage" if dam else None),
            "dam_point": dam["point"] if dam else None,
            "in_utah": in_utah(dam["point"]) if dam and dam["point"] else None,
            "huc6": unit["huc6"] if unit else None,
            "huc6_name": unit["name"] if unit else None,
            "actual_huc6": actual["huc6"] if actual else None,
            "actual_huc6_name": actual["name"] if actual else None,
            "actual_states": actual["states"] if actual else None,
            "fills_empty_area": bool(unit and unit["huc6"] in empty),
            "admissible": admissible,
        })

    if args.json:
        print(json.dumps({"empty_areas": empty, "candidates": findings}, indent=1))
        return 0

    ok = [f for f in findings if f["admissible"]]
    print(f"\n{len(ok)} of {len(findings)} candidates meet all four criteria.")
    print("Drainage areas with no tracked reservoir: " +
          (", ".join(f"{k} {v}" for k, v in empty.items()) if empty else "none"))
    would_fill = {f["huc6"]: f["huc6_name"] for f in ok if f["fills_empty_area"]}
    print("Areas these candidates would fill: " +
          (", ".join(f"{k} {v}" for k, v in would_fill.items()) if would_fill else "none"))
    print("\nNothing was added. Admitting a reservoir changes every statewide "
          "total on the dashboard, so it is a deliberate decision.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
