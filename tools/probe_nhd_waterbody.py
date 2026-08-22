"""Probe: how many published points resolve to an NHD water body.

The first task `WATER-BODY-AND-NAVIGATION-SCOPING.md` names for its name and
type items: nobody can size "normalize the names" until it is known how many
of the 375 published points resolve to exactly one NHD water body at all.
Reservoirs are published at a provider point, which may sit on a dam, a
gauge or an outlet rather than inside the polygon.

Primary source is the project's reviewed reference layer,
`NHDPlus_HR/MapServer/9` (NHDWaterbody) on
`hydro.nationalmap.gov`, asked server-side with a 100-metre tolerance --
the project's measurement default (rule 5 of the inventory). Every point
that resolves to zero or more than one water body is then asked again
against Esri's `USA_Detailed_Water_Bodies` republication, so a disagreement
between the two is visible instead of silently folded into one number:

- **resolved** -- NHD answers exactly one; counted.
- **confirmed** -- NHD answered zero or several, but Esri agrees with one
  of NHD's answers or supplies exactly one itself; two independent
  publications aligning on the same water.
- **disputed / silent** -- the two sources disagree, both are silent, or
  either answered several with no overlap. These need a person's review;
  they are excluded from the headline rate rather than resolved by a rule
  this tool has no authority to make.

A probe prints and writes nothing. It renames nothing: what GNIS says a
water body should be called is blocked on the former-name decision, and
this measurement exists to size that work, not to start it.

    python tools/probe_nhd_waterbody.py [--tolerance-metres 100]
"""

import argparse
import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

NHD_LAYER = ("https://hydro.nationalmap.gov/arcgis/rest/services/"
             "NHDPlus_HR/MapServer/9")
NHD_FIELDS = "GNIS_Name,FType,Permanent_Identifier"
ESRI_LAYER = ("https://services.arcgis.com/P3ePLMYs2RVChkJx/arcgis/rest/"
              "services/USA_Detailed_Water_Bodies/FeatureServer/0")

USER_AGENT = ("western-water-dashboard/nhd-resolution-probe "
              "(+https://github.com/buschbrian)")
TIMEOUT = 60
POLITENESS_SECONDS = 0.25

#: FType 390 is LakePond, 436 is Reservoir -- the pair the type item reads.
FTYPE_NAMES = {"390": "LakePond", "436": "Reservoir"}


def query_layer(layer: str, fields: str, lon: float, lat: float,
                distance: int) -> list[dict]:
    """Water-body records within `distance` metres of the point."""
    request = urllib.request.Request(
        f"{layer}/query",
        data=urllib.parse.urlencode({
            "geometry": f"{lon},{lat}", "geometryType": "esriGeometryPoint",
            "inSR": "4326", "spatialRel": "esriSpatialRelIntersects",
            "distance": distance, "units": "esriSRUnit_Meter",
            "outFields": fields, "returnGeometry": "false",
            "resultRecordCount": 10, "f": "json",
        }).encode(),
        headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except (urllib.error.URLError, TimeoutError, ValueError) as exc:
        print(f"    !! {exc}", file=sys.stderr)
        return []
    if isinstance(payload, dict) and payload.get("error"):
        message = payload["error"].get("message", "?")
        print(f"    !! service error: {message}", file=sys.stderr)
        return []
    return [f["attributes"] for f in (payload or {}).get("features") or []]


def attr(attributes: dict, name: str):
    """A field under any case the service felt like publishing.

    NHDPlus HR answers lowercase keys (`gnis_name`) whatever the alias
    says; Esri layers answer upper. Asking either for the documented name
    reads every polygon as unnamed.
    """
    lowered = name.lower()
    for key, value in attributes.items():
        if key.lower() == lowered:
            return value
    return None


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--tolerance-metres", type=int, default=100)
    parser.add_argument("--json", action="store_true",
                        help="print the full per-point report as JSON")
    args = parser.parse_args()

    reservoirs = json.loads(
        (ROOT / "reservoirs.json").read_text(encoding="utf-8"))["reservoirs"]
    points = [(r["name"], r["lon"], r["lat"]) for r in reservoirs
              if r.get("source_station_id")]
    print(f"{len(points)} published points, "
          f"tolerance {args.tolerance_metres} m", file=sys.stderr)

    resolved, confirmed, disputed = [], [], []
    for index, (name, lon, lat) in enumerate(points, start=1):
        matches = query_layer(NHD_LAYER, NHD_FIELDS, lon, lat,
                              args.tolerance_metres)
        esri = None
        if len(matches) != 1:
            # Only the problem cases pay for the second source.
            time.sleep(POLITENESS_SECONDS)
            esri = query_layer(ESRI_LAYER, "NAME", lon, lat,
                               args.tolerance_metres)

        nhd_named = [attr(m, "GNIS_Name") for m in matches]
        esri_names = [attr(e, "NAME") for e in (esri or [])]
        label = None
        if len(matches) == 1:
            match = matches[0]
            ftype = attr(match, "FType")
            label = attr(match, "GNIS_Name") or "(unnamed)"
            resolved.append(
                {"name": name, "gnis": attr(match, "GNIS_Name"),
                 "ftype": str(ftype) if ftype is not None else None,
                 "nhd_id": attr(match, "Permanent_Identifier")})
            outcome = "resolved"
        elif not matches and not esri:
            disputed.append({"name": name, "reason": "silent on both"})
            outcome = "SILENT"
        elif not matches and esri:
            confirmed.append(
                {"name": name, "esri_names": [str(n) for n in esri_names],
                 "note": "Esri alone"})
            outcome = "esri-only"
        elif len(matches) > 1 and not esri:
            disputed.append({"name": name,
                             "reason": f"NHD answered {len(matches)}",
                             "nhd_names": [str(n) for n in nhd_named]})
            outcome = f"NHD x{len(matches)}"
        else:
            overlap = {str(n).strip().lower() for n in nhd_named} & \
                      {str(n).strip().lower() for n in esri_names}
            entry = {"name": name,
                     "nhd_names": [str(n) for n in nhd_named],
                     "esri_names": [str(n) for n in esri_names]}
            if overlap or len(esri) == 1:
                confirmed.append({**entry,
                                  "note": "sources align"
                                  if overlap else "Esri single, NHD several"})
                outcome = "aligned"
            else:
                disputed.append({**entry, "reason": "sources disagree"})
                outcome = "DISPUTED"

        if index % 25 == 0 or outcome not in ("resolved",):
            print(f"  [{index:>3}/{len(points)}] {name:<38} {outcome}",
                  file=sys.stderr)
        time.sleep(POLITENESS_SECONDS)

    total = len(points)
    print(f"\n=== Resolution rate against NHDPlus HR water bodies "
          f"(+/-{args.tolerance_metres} m)")
    print(f"  exactly one NHD water body : {len(resolved):>4}"
          f"  ({100 * len(resolved) / total:.1f}%)")
    print(f"  zero/multi, sources align  : {len(confirmed):>4}")
    print(f"  needs human review         : {len(disputed):>4}")
    types: dict[str, int] = {}
    for entry in resolved:
        key = FTYPE_NAMES.get(entry["ftype"] or "", entry["ftype"] or "(none)")
        types[key] = types.get(key, 0) + 1
    print(f"  NHD FType among resolved   : "
          f"{json.dumps(types, sort_keys=True)}")
    unnamed = sum(1 for e in resolved if not e["gnis"])
    print(f"  resolved but unnamed (blank GNIS_Name): {unnamed}")

    if confirmed:
        print("\nConfirmed by Esri where NHD was silent or ambiguous:")
        for entry in confirmed:
            note = entry.get("note", "")
            names = entry.get("esri_names") or entry.get("nhd_names")
            print(f"  {entry['name']:<38} {names} -- {note}")
    if disputed:
        print("\nNEEDS HUMAN REVIEW (excluded from the rate above):")
        for entry in disputed:
            print(f"  {entry['name']:<38} {entry['reason']} "
                  f"{entry.get('nhd_names') or ''}"
                  f"{(' vs ' + str(entry['esri_names'])) if entry.get('esri_names') else ''}")

    print(f"\nThe 28 damaged names live in this denominator: "
          f"{len(resolved)} of {total} points have an NHD answer to "
          f"normalize against.")
    if args.json:
        print(json.dumps({"resolved": resolved, "confirmed": confirmed,
                          "disputed": disputed}, indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
