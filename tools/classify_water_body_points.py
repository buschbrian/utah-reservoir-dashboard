"""Turn source agreement into a verdict about *this* reservoir.

The question is not which water body the most publishers name, but whether
the water the row claims is among what they name. A point beside a dam
often has two bodies within a kilometre -- the reservoir above and a
diversion pool below -- and picking the more popular answer would condemn
a point that is sitting exactly where it should.

So every source answer inside 1 km is searched for the claimed name. Found
means confirmed, and any other body nearby is reported rather than ruled
on. Not found, with named water present, means the point is somewhere
other than what it claims. Nothing named inside 1 km is always a person's
call, per the reviewer's threshold.
"""
import csv, re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
GENERIC = {"lake", "reservoir", "lk", "res", "the", "of"}
SUBSIDIARY = {"lagoon", "forebay", "afterbay", "diversion", "pool",
              "tailrace", "tailwater", "regulating"}
COLS = ["gnis_1km", "nhd_waterbody_1km", "nhd_area_1km", "nhd_medium_1km", "esri_1km"]
LABEL = {"gnis_1km": "GNIS", "nhd_waterbody_1km": "hydrography water body",
         "nhd_area_1km": "hydrography area",
         "nhd_medium_1km": "hydrography medium scale", "esri_1km": "Esri"}

def words(name):
    return set(re.findall(r"[a-z0-9]+", (name or "").lower()))

def core(name):
    return words(name) - GENERIC

def same_water(a, b):
    """Same body, allowing word order and the type word to differ."""
    ca, cb = core(a), core(b)
    if not ca or not cb or not (ca & cb):
        return False
    # "Castaic Lagoon" is not "Castaic Lake": a subsidiary word on one side only
    # names a different, smaller pool.
    return bool(SUBSIDIARY & words(a)) == bool(SUBSIDIARY & words(b))

notes = {}
for row in csv.DictReader((ROOT / "nhd-review.csv").open(encoding="utf-8")):
    claim = re.split(r"\s*-\s*", row["notes"].strip(), maxsplit=1)[0].strip()
    if claim and "zero idea" not in claim.lower():
        notes[row["reservoir"]] = claim

rows = list(csv.DictReader((ROOT / "point-verification.csv").open(encoding="utf-8")))
for r in rows:
    claim = notes.get(r["reservoir"]) or r["reservoir"]
    r["claimed_name"] = claim
    matched, others = [], []
    for col in COLS:
        for name in (n.strip() for n in r[col].split(";") if n.strip()):
            (matched if same_water(name, claim) else others).append((col, name))
    named = [n for _, n in matched + others if core(n)]
    if matched:
        srcs = sorted({LABEL[c] for c, _ in matched})
        r["verdict"] = "confirmed"
        r["proposed_name"] = matched[0][1]
        r["agreeing_sources"] = ",".join(sorted({c for c, _ in matched}))
        near = sorted({n for _, n in others if core(n)})
        r["why"] = (f"{len(srcs)} source{'s' if len(srcs) > 1 else ''} name it within 1 km"
                    + (f"; also within 1 km: {', '.join(near[:3])}" if near else ""))
    elif named:
        r["verdict"] = "point suspect"
        r["proposed_name"] = others[0][1]
        r["agreeing_sources"] = ",".join(sorted({c for c, _ in others}))
        r["why"] = ("no source names it within 1 km; they name "
                    + ", ".join(sorted({n for _, n in others if core(n)})[:3]))
    else:
        r["verdict"] = "human review"
        r["proposed_name"] = ""
        r["agreeing_sources"] = ""
        if not r["sources_within_1km"]:
            r["why"] = ("no source within 4 km" if not r["beyond_1km"]
                        else "nearest evidence beyond 1 km")
        else:
            r["why"] = "water within 1 km but no source names it"

with (ROOT / "point-verification.csv").open("w", newline="", encoding="utf-8") as fh:
    w = csv.DictWriter(fh, fieldnames=list(rows[0].keys()))
    w.writeheader(); w.writerows(rows)

from collections import Counter
print(dict(Counter(r["verdict"] for r in rows)), "\n")
for want in ("point suspect", "human review"):
    print(f"=== {want.upper()} ===")
    for r in rows:
        if r["verdict"] == want:
            print(f"  {r['reservoir'][:26]:26} claims {r['claimed_name'][:20]:20} | {r['why'][:64]}")
    print()
print("=== confirmed, but another body is also within 1 km ===")
for r in rows:
    if r["verdict"] == "confirmed" and "also within" in r["why"]:
        print(f"  {r['reservoir'][:26]:26} {r['why'][:76]}")
