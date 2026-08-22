"""Probe: USGS reservoir-storage sites in the six thin-roster states.

`WATER-BODY-AND-NAVIGATION-SCOPING.md` item 5's first rule is "count first,
build never": query USGS NWIS parameter 00054 (reservoir storage, acre-feet)
for AZ, NV, ID, OR, WA and WY, and report how many sites exist per state --
because nobody can size a USGS provider until that number does.

Two things are reported, because the scoping asks for both:

- **Sites.** Distinct sites answering the daily-values service with at least
  one 00054 value in the last seven days -- active means *reporting*, not
  merely registered. This extends, rather than restates, the coverage table
  in WESTERN-SOURCE-CANDIDATES.md, whose counts were taken 2026-08-18 from
  registrations reconciled by hand.

- **Overlap candidates.** Each site is compared against every published
  reservoir point and reviewed dam point. A site within three kilometres of
  a published point -- ADR-069's working radius -- or sharing a distinctive
  name word within fifty, is listed as a *candidate* duplicate. Candidates
  are listed, never decided: ruling one a duplicate is a review judgement
  about dam identity, and this tool records evidence, not verdicts.

A probe prints and writes nothing.

    python tools/probe_nwis_storage.py [--days 7]

Queries the legacy waterservices.usgs.gov service, which needs no key today;
its documented retirement (~2027) and its successor's rate limit are already
recorded in the candidates document and are not re-argued here.
"""

import argparse
import json
import math
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

STATES = ["AZ", "NV", "ID", "OR", "WA", "WY"]
DV_URL = "https://waterservices.usgs.gov/nwis/dv"

USER_AGENT = ("western-water-dashboard/nwis-storage-count "
              "(+https://github.com/buschbrian)")
TIMEOUT = 120
POLITENESS_SECONDS = 1.0

#: A site this close to a published point is a duplicate candidate under
#: ADR-069's working radius, not automatically a duplicate.
NEAR_KM = 3.0
NAME_KM = 50.0

#: Name words too common in gauge names to imply the same reservoir.
STOP_WORDS = {
    "res", "reservoir", "lake", "lk", "nr", "near", "at", "abv", "blw",
    "dam", "div", "outlet", "inlet", "creek", "river", "wash",
}


def km_between(lon1: float, lat1: float, lon2: float, lat2: float) -> float:
    dx = math.radians(lon2 - lon1) * math.cos(math.radians((lat1 + lat2) / 2))
    dy = math.radians(lat2 - lat1)
    return math.hypot(dx, dy) * 6371.0


def name_words(name: str) -> set[str]:
    keepers = {w.strip(".,").lower() for w in name.split()} - STOP_WORDS
    return {w for w in keepers if len(w) > 2}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--days", type=int, default=7,
                        help="a site must have reported within this window")
    args = parser.parse_args()

    published = json.loads(
        (ROOT / "reservoirs.json").read_text(encoding="utf-8"))["reservoirs"]
    points = [(r["name"], r["lon"], r["lat"]) for r in published
              if r.get("source_station_id")]
    capacities = json.loads(
        (ROOT / "capacities.json").read_text(encoding="utf-8"))
    dam_points = [
        (entry["name"], entry["dam_lon"], entry["dam_lat"])
        for entry in capacities.get("capacities", {}).values()
        if entry.get("dam_lon") is not None]
    print(f"{len(points)} published points, "
          f"{len(dam_points)} reviewed dam points", file=sys.stderr)

    total_sites = 0
    near_candidates: list[tuple[str, str]] = []
    name_candidates: list[tuple[str, str]] = []
    for state in STATES:
        query = urllib.parse.urlencode({
            "stateCd": state.lower(), "parameterCd": "00054",
            "siteStatus": "active", "period": f"P{args.days}D",
            "format": "json"})
        request = urllib.request.Request(
            f"{DV_URL}?{query}", headers={"User-Agent": USER_AGENT})
        try:
            with urllib.request.urlopen(request, timeout=TIMEOUT) as response:
                payload = json.loads(response.read())
        except urllib.error.HTTPError as error:
            print(f"  !! HTTP {error.code} for {state}", file=sys.stderr)
            continue
        except (urllib.error.URLError, ValueError) as error:
            print(f"  !! {state}: {error}", file=sys.stderr)
            continue
        time.sleep(POLITENESS_SECONDS)

        sites: dict[str, dict] = {}
        for series in payload.get("value", {}).get("timeSeries", []):
            source = series.get("sourceInfo") or {}
            codes = source.get("siteCode") or [{}]
            site_no = codes[0].get("value")
            if not site_no:
                continue
            geog = (source.get("geoLocation") or {}).get(
                "geogLocation") or {}
            sites[site_no] = {
                "name": source.get("siteName"),
                "lon": geog.get("longitude"),
                "lat": geog.get("latitude"),
            }
        print(f"  {state}: {len(sites)} reporting 00054 sites "
              f"(last {args.days} days)")
        total_sites += len(sites)

        for site_no, site in sorted(sites.items()):
            if site["lon"] is None:
                print(f"      !! {site['name']} ({site_no}): no coordinates",
                      file=sys.stderr)
                continue
            best_km, best_name = float("inf"), ""
            best_words: set[str] = set()
            for pub_name, pub_lon, pub_lat in points + dam_points:
                dist = km_between(site["lon"], site["lat"], pub_lon, pub_lat)
                if dist < best_km:
                    best_km, best_name = dist, pub_name
                    best_words = name_words(site["name"] or "") & \
                        name_words(pub_name)
            label = f"{site['name']} ({site_no})"
            if best_km <= NEAR_KM:
                print(f"      NEAR-DUPLICATE candidate: {label} <-> "
                      f"{best_name} [{best_km:.1f} km]")
                near_candidates.append((label,
                                        f"{best_name} [{best_km:.1f} km]"))
            elif best_words and best_km <= NAME_KM:
                print(f"      name candidate: {label} <-> {best_name} "
                      f"[{best_km:.1f} km, shared {'/'.join(sorted(best_words))}]")
                name_candidates.append((label, best_name))

    print(f"\nTotal across {', '.join(STATES)}: {total_sites} sites "
          f"reporting 00054 within {args.days} days.")
    print(f"Near-duplicate candidates for review: {len(near_candidates)}")
    print(f"Name-only candidates for review: {len(name_candidates)}")
    print("\nThe count that sizes the provider is the sites above minus the"
          "\ncandidates a reviewer rules duplicates -- not this list alone.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
