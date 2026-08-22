"""Cross-check every silent point against five independent water sources.

One source answering is not evidence; agreement between publications is.
Five are asked, and each is asked twice: once at 1000 metres, the reviewer's
threshold, and once at 4000 metres only if the first is silent. The
threshold is a rule, not a tuning knob -- anything whose nearest evidence
lies beyond 1 km is returned for a person to look at, however many sources
agree out there, because at that range they may be agreeing about a
different body of water.

Sources, in order of naming authority:

- GNIS -- the USGS names authority. Names, not polygons, and the only one
  that reliably carries very small reservoirs.
- NHDPlus HR NHDWaterbody -- the project's reviewed reference layer.
- NHDPlus HR NHDArea -- the same product's *other* water class. A reservoir
  on a large river is often mapped here, so asking only Waterbody reads as
  silence.
- NHD medium resolution -- an independently built cache of the same survey.
- Esri USA_Detailed_Water_Bodies -- a second publisher entirely.

A probe prints; the caller redirects.
"""
import csv, json, re, sys, time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))
from probe_nhd_waterbody import query_layer, attr

HYDRO = "https://hydro.nationalmap.gov/arcgis/rest/services/"
SOURCES = [
    ("gnis", "https://carto.nationalmap.gov/arcgis/rest/services/geonames/MapServer/7"),
    ("nhd_waterbody", HYDRO + "NHDPlus_HR/MapServer/9"),
    ("nhd_area", HYDRO + "NHDPlus_HR/MapServer/8"),
    ("nhd_medium", HYDRO + "nhd/MapServer/12"),
    ("esri", "https://services.arcgis.com/P3ePLMYs2RVChkJx/arcgis/rest/"
             "services/USA_Detailed_Water_Bodies/FeatureServer/0"),
]
NEAR, FAR = 1000, 4000
#: Words that describe the kind of water, not which water it is.
GENERIC = {"lake", "reservoir", "lk", "res", "dam", "the", "of", "pond", "forebay"}

def name_of(row):
    for key in ("gaz_name", "gnis_name", "name"):
        value = attr(row, key)
        if value and str(value).strip():
            return str(value).strip()
    return None

def tokens(name):
    """The words that identify *which* water body, order thrown away."""
    words = re.findall(r"[a-z0-9]+", (name or "").lower())
    return frozenset(w for w in words if w not in GENERIC)

def ask(layer, lat, lon, radius):
    rows = query_layer(layer, "*", lon, lat, radius)
    time.sleep(0.15)
    return [n for n in (name_of(r) for r in rows[:5]) if n]

roster = json.loads((ROOT / "reservoirs.json").read_text(encoding="utf-8"))["reservoirs"]
index = {r["name"].strip().lower(): r for r in roster}
rows = [r for r in csv.DictReader((ROOT / "nhd-review.csv").open(encoding="utf-8"))
        if r["reason"] == "silent on both"]

out = []
for n, row in enumerate(rows, 1):
    r = index.get(row["reservoir"].strip().lower())
    if not r:
        continue
    lat, lon = r["lat"], r["lon"]
    near, far = {}, {}
    for key, layer in SOURCES:
        hit = ask(layer, lat, lon, NEAR)
        if hit:
            near[key] = hit
        else:
            far[key] = ask(layer, lat, lon, FAR)

    # Only evidence inside the threshold may settle anything.
    named = {k: v for k, v in near.items() if any(tokens(x) for x in v)}
    groups = {}
    for key, names in named.items():
        for nm in names:
            groups.setdefault(tokens(nm), []).append((key, nm))
    best, agreeing = None, []
    if groups:
        tok, members = max(groups.items(), key=lambda kv: len(set(m[0] for m in kv[1])))
        agreeing = sorted(set(m[0] for m in members))
        # GNIS is the naming authority: if it is among them, its spelling wins.
        gnis = next((m[1] for m in members if m[0] == "gnis"), None)
        best = gnis or members[0][1]

    if not near and not any(far.values()):
        verdict, why = "human review", "no source within 4 km"
    elif not near:
        verdict, why = "human review", "nearest evidence beyond 1 km"
    elif len(agreeing) >= 2:
        verdict, why = "verified", f"{len(agreeing)} sources agree within 1 km"
    elif agreeing:
        verdict, why = "human review", "only one source names it"
    else:
        verdict, why = "human review", "water within 1 km but unnamed"

    out.append({
        "reservoir": row["reservoir"], "state": row["state"],
        "reviewer_note": row["reviewer_note"] if "reviewer_note" in row else row["notes"],
        "verdict": verdict, "why": why,
        "proposed_name": best or "",
        "agreeing_sources": ",".join(agreeing),
        "sources_within_1km": ",".join(sorted(near)),
        "gnis_1km": "; ".join(near.get("gnis", [])),
        "nhd_waterbody_1km": "; ".join(near.get("nhd_waterbody", [])),
        "nhd_area_1km": "; ".join(near.get("nhd_area", [])),
        "nhd_medium_1km": "; ".join(near.get("nhd_medium", [])),
        "esri_1km": "; ".join(near.get("esri", [])),
        "beyond_1km": "; ".join(f"{k}:{v[0]}" for k, v in far.items() if v),
    })
    print(f"  {n:2}/{len(rows)} {row['reservoir'][:28]:28} {verdict:13} "
          f"{best or '-':28} [{','.join(agreeing)}]", file=sys.stderr)

dest = ROOT / "point-verification.csv"
with dest.open("w", newline="", encoding="utf-8") as fh:
    w = csv.DictWriter(fh, fieldnames=list(out[0].keys()))
    w.writeheader(); w.writerows(out)
print(f"\nwrote {dest}", file=sys.stderr)
