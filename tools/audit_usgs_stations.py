#!/usr/bin/env python3
"""Audit the ruled-new USGS reservoir-storage sites for admission.

The 2026-08-22 review of `nwis-review.csv` ruled eleven NWIS daily-value
sites new -- none of them within three kilometres of a published point.
This tool gathers what admission needs for those eleven and decides each
with the shared machinery in `admission.py`, unmodified:

- the storage series since 2015, from the legacy daily-values service
  (parameter 00054, acre-feet, keyless; see ADR-080 for the retirement
  this build accepts);
- the National Inventory of Dams record for each state's dams, so the dam
  can be matched by position first and name second (ADR-015);
- `admit` for the match and denominator, then `discrepancies` for the four
  screens that compare everything else known about the same water.

A probe: it prints its evidence as JSON and writes nothing.

    .venv/bin/python tools/audit_usgs_stations.py [--json]

The candidates come from the review CSV rather than being restated here, so
the rulings and the audit cannot drift apart.
"""

from __future__ import annotations

import csv
import json
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "tools"))

import urllib.parse
import urllib.request

import admission
from audit_candidate_capacity import dam_states, fetch_dams, find_dam_layer

REVIEW_CSV = ROOT / "nwis-review.csv"
NWIS_DV = "https://waterservices.usgs.gov/nwis/dv"
PARAMETER = "00054"
START_DATE = "2015-01-01"
USER_AGENT = "western-water-dashboard/usgs-admission (+https://github.com/buschbrian)"
TIMEOUT = 120


def nwis_series(site_no: str) -> list[float]:
    """Every accepted 00054 value since 2015, oldest first."""
    query = urllib.parse.urlencode({
        "sites": site_no, "parameterCd": PARAMETER,
        "startDT": START_DATE, "format": "json"})
    request = urllib.request.Request(
        f"{NWIS_DV}?{query}", headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=TIMEOUT) as response:
        payload = json.loads(response.read())
    values = []
    for series in payload.get("value", {}).get("timeSeries", []):
        # The reply nests twice: each entry of `values` is one method's block,
        # and each block's `value` is the list of daily readings.
        for block in series.get("values", []):
            for reading in block.get("value", []):
                value = reading.get("value")
                if value in (None, ""):
                    continue
                try:
                    number = float(value)
                except (TypeError, ValueError):
                    continue
                # Provisional or approved, a negative storage is a sentinel,
                # not a reading -- the same rule every other adapter applies.
                if number >= 0:
                    values.append(number)
    return values


def candidates() -> list[dict]:
    """The rows the reviewer ruled new, and nothing else."""
    with REVIEW_CSV.open(encoding="utf-8") as handle:
        rows = list(csv.DictReader(handle))
    return [{
        "station": row["usgs_site_no"],
        "name": row["usgs_site_name"].title(),
        "state": row["state"],
        "lon": float(row["longitude"]),
        "lat": float(row["latitude"]),
    } for row in rows
      if row["class_"] == "new" or "new" in (row["reviewer_ruling"] or "").lower()]


def main() -> int:
    wanted = candidates()
    print(f"{len(wanted)} ruled-new USGS sites", file=sys.stderr)

    series = {}
    for site in wanted:
        values = nwis_series(site["station"])
        series[site["station"]] = values
        site["observed_max_af"] = max(values) if values else None
        print(f"  {site['station']} {site['name'][:36]:<38} "
              f"{len(values)} readings, max "
              f"{max(values):,.0f}" if values else
              f"  {site['station']} {site['name'][:36]:<38} no readings",
              file=sys.stderr)
        time.sleep(0.5)

    # The inventory's STATE field carries full names, so the codes the
    # review CSV holds go through the same translation every other audit
    # uses (dam_states reports a code it cannot map rather than dropping it).
    # The neighbour states join the fetch because coverage follows rivers,
    # not lines: Topaz Lake's ruling came back NV and its dam stands in
    # California -- the same lesson the CDEC audit recorded.
    states = sorted(set(dam_states([{"state": site["state"]}
                                    for site in wanted]))
                    | {"California", "Oregon", "Montana", "Wyoming"})
    layer_url, fields, where, expected = find_dam_layer(states)
    if not layer_url:
        print("ERROR: no dam inventory found with a usable schema",
              file=sys.stderr)
        return 1
    # fetch_dams answers with the canonical field names the admission module
    # reads (normal_storage_af, nid_id, ...) -- the field map is its input.
    dams = fetch_dams(layer_url, fields, where)
    print(f"{len(dams)} dams fetched across {', '.join(states)}", file=sys.stderr)

    evidence = []
    held = 0
    for site in wanted:
        values = series[site["station"]]
        candidate = {
            "name": site["name"],
            "lon": site["lon"], "lat": site["lat"],
            "observed_max_af": site.get("observed_max_af"),
        }
        decision = admission.admit(candidate, dams)
        highest = sorted(values, reverse=True)[:5]
        screens = admission.discrepancies(decision, highest_readings=highest)
        if screens or not decision.admitted:
            held += 1
        entry = {
            "station": site["station"], "state": site["state"],
            "lon": site["lon"], "lat": site["lat"],
            "readings_since_2015": len(values),
            **decision.evidence(),
            "screens": [{"screen": name, "detail": detail}
                        for name, detail in screens],
        }
        evidence.append(entry)
        flag = "HELD" if (screens or not decision.admitted) else "clear"
        print(f"  {site['station']} {site['name'][:32]:<34} {flag}: "
              f"{decision.reason} "
              f"{'; '.join(name for name, _ in screens)}", file=sys.stderr)

    print(json.dumps(evidence, indent=1))
    print(f"\n{len(wanted) - held} clear, {held} held for review",
          file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
