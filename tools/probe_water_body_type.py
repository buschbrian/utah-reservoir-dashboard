"""Ask three sources what kind of water body each renamed reservoir is.

The names worksheet carries an FType for the rows NHD resolved and nothing
for the rest. Both halves are asked again here, the resolved ones so the
existing value is checked rather than trusted, and each answer is kept
under the source that gave it. The reviewer's 1 km threshold applies: a
type found further away describes some other water.
"""
import csv, json, re, sys, time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))
from probe_nhd_waterbody import query_layer, attr, FTYPE_NAMES

HYDRO = "https://hydro.nationalmap.gov/arcgis/rest/services/"
GNIS = ("https://carto.nationalmap.gov/arcgis/rest/services/"
        "geonames/MapServer/7")
NEAR = 1000
GENERIC = {"lake", "reservoir", "lk", "res", "the", "of"}

def core(name):
    return set(re.findall(r"[a-z0-9]+", (name or "").lower())) - GENERIC

def ftype(row):
    raw = attr(row, "FType")
    return FTYPE_NAMES.get(str(raw), None)

roster = json.loads((ROOT / "reservoirs.json").read_text(encoding="utf-8"))["reservoirs"]
index = {r["name"].strip().lower(): r for r in roster}
rows = list(csv.DictReader((ROOT / "names-worksheet.csv").open(encoding="utf-8")))

out = []
for n, row in enumerate(rows, 1):
    r = index.get(row["current_roster_name"].strip().lower())
    if not r or r.get("lat") is None:
        out.append({**row, "_probe": "no point"}); continue
    lat, lon = r["lat"], r["lon"]
    want = core(row["proposed_display_name"]) or core(row["current_roster_name"])
    answers = {}

    for key, layer in (("nhd_hr", HYDRO + "NHDPlus_HR/MapServer/9"),
                       ("nhd_medium", HYDRO + "nhd/MapServer/12")):
        for rec in query_layer(layer, "*", lon, lat, NEAR)[:6]:
            nm, ft = attr(rec, "GNIS_Name"), ftype(rec)
            if ft and (not want or not core(nm) or (core(nm) & want)):
                answers.setdefault(key, []).append(f"{nm or '(unnamed)'}={ft}")
        time.sleep(0.15)

    for rec in query_layer(GNIS, "*", lon, lat, NEAR)[:6]:
        nm, fc = attr(rec, "gaz_name"), attr(rec, "gaz_featureclass")
        if fc and (not want or not core(nm) or (core(nm) & want)):
            answers.setdefault("gnis", []).append(f"{nm}={fc}")
    time.sleep(0.15)

    out.append({**row, "_probe": json.dumps(answers)})
    print(f"  {n:2}/{len(rows)} {row['current_roster_name'][:34]:34} "
          f"{ {k: v[:2] for k, v in answers.items()} }", file=sys.stderr)

(Path(ROOT) / "type-probe.json").write_text(
    json.dumps([{"name": o["current_roster_name"], "probe": o["_probe"]} for o in out],
               indent=1), encoding="utf-8")
print("\nwrote type-probe.json", file=sys.stderr)
