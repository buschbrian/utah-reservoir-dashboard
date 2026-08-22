"""Export the measurement review lists as CSV for a person to rule on.

Three lists came out of the 2026-08-21 measurements, and each one is
*evidence for a review*, not a set of decisions: which USGS sites are
duplicates of published reservoirs, which published points have no clean
NHD water-body answer, and which roster names carry provider debris. This
tool prints each list as CSV so a reviewer can mark it up in a spreadsheet.

A probe prints and writes nothing: every mode writes to stdout, and the
caller redirects. The CSVs stay uncommitted working documents.

    python tools/export_review_lists.py --nwis     # 34 NWIS sites
    python tools/export_review_lists.py --nhd      # NHD problem points
    python tools/export_review_lists.py --names    # the damaged names

The NWIS list is queried live (about six requests against the keyless
legacy service). The NHD list needs the resolution pass's full report;
give its `--json` output with `--nhd-json`, or let this tool re-run that
probe when the report is absent, which costs about fifteen minutes
against the nationalmap service.
"""

import argparse
import csv
import io
import json
import re
import subprocess
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))

NHD_REPORT = Path("/tmp/nhd-report2.txt")

#: FType 390 is LakePond, 436 Reservoir -- what the type item reads.
FTYPE_NAMES = {"390": "LakePond", "436": "Reservoir"}


def load_nhd_report(path: Path) -> dict:
    """The probe's --json output, re-running the probe when it is gone."""
    def extract(text: str) -> dict:
        lines = text.splitlines()
        start = next(i for i, line in enumerate(lines)
                     if line.strip() == "{"
                     and '"resolved"' in lines[i + 1])
        return json.loads("\n".join(lines[start:]))

    if path.is_file():
        return extract(path.read_text(encoding="utf-8"))
    print("(no saved NHD report found; re-running the resolution probe, "
          "about fifteen minutes)", file=sys.stderr)
    result = subprocess.run(
        [sys.executable, str(ROOT / "tools" / "probe_nhd_waterbody.py"),
         "--json"], capture_output=True, text=True, check=True)
    return extract(result.stdout)


def nwis_rows() -> list[dict]:
    """Every active reporting 00054 site in the six thin states."""
    from probe_nwis_storage import DV_URL, km_between, name_words  # noqa: E402

    reservoirs = json.loads(
        (ROOT / "reservoirs.json").read_text(encoding="utf-8"))["reservoirs"]
    points = [(r["name"], r["lon"], r["lat"]) for r in reservoirs
              if r.get("source_station_id")]
    capacities = json.loads(
        (ROOT / "capacities.json").read_text(encoding="utf-8"))
    dam_points = [
        (entry["name"], entry["dam_lon"], entry["dam_lat"])
        for entry in capacities.get("capacities", {}).values()
        if entry.get("dam_lon") is not None]

    rows = []
    for state in ["AZ", "NV", "ID", "OR", "WA", "WY"]:
        query = urllib.parse.urlencode({
            "stateCd": state.lower(), "parameterCd": "00054",
            "siteStatus": "active", "period": "P7D", "format": "json"})
        request = urllib.request.Request(
            f"{DV_URL}?{query}",
            headers={"User-Agent":
                     "western-water-dashboard/review-export"})
        with urllib.request.urlopen(request, timeout=120) as response:
            payload = json.loads(response.read())
        time.sleep(1.0)

        sites: dict[str, dict] = {}
        for series in payload.get("value", {}).get("timeSeries", []):
            source = series.get("sourceInfo") or {}
            site_no = (source.get("siteCode") or [{}])[0].get("value")
            if not site_no:
                continue
            geog = (source.get("geoLocation") or {}).get(
                "geogLocation") or {}
            sites[site_no] = {"name": source.get("siteName"),
                              "lon": geog.get("longitude"),
                              "lat": geog.get("latitude")}
        for site_no, site in sorted(sites.items()):
            best_km, best_name = None, ""
            for pub_name, pub_lon, pub_lat in points + dam_points:
                dist = km_between(site["lon"], site["lat"], pub_lon, pub_lat)
                if best_km is None or dist < best_km:
                    best_km, best_name = dist, pub_name
            shared = name_words(site["name"] or "") & name_words(best_name)
            near = best_km is not None and best_km <= 3.0
            rows.append({
                "state": state,
                "usgs_site_no": site_no,
                "usgs_site_name": site["name"],
                "latitude": site["lat"],
                "longitude": site["lon"],
                "class_": "candidate-duplicate" if near else "new",
                "nearest_published_reservoir": best_name,
                "distance_km": round(best_km, 2) if best_km is not None
                else "",
                "shared_name_words": "/".join(sorted(shared)),
                "reviewer_ruling": "",
                "notes": "",
            })
    return rows


def nhd_rows(report: dict) -> list[dict]:
    """Disputed and confirmed points, with both sources' answers."""
    reservoirs = json.loads(
        (ROOT / "reservoirs.json").read_text(encoding="utf-8"))["reservoirs"]
    meta = {r["name"]: r for r in reservoirs if r.get("source_station_id")}
    rows = []
    for kind, entries in (("disputed", report["disputed"]),
                          ("esri-confirmed", report["confirmed"])):
        for entry in entries:
            record = meta.get(entry["name"], {})
            states = record.get("waterbody_states") or (
                [record["state"]] if record.get("state") else [])
            rows.append({
                "class_": kind,
                "reason": entry.get("reason", entry.get("note", "")),
                "reservoir": entry["name"],
                "station": record.get("source_station_id", ""),
                "provider": record.get("source_label",
                                       record.get("source_key", "")),
                "state": ",".join(states),
                "nhd_answer": "; ".join(
                    str(n).strip() or "(unnamed)"
                    for n in entry.get("nhd_names", [])) or "(none)",
                "esri_answer": "; ".join(
                    str(n).strip() or "(unnamed)"
                    for n in entry.get("esri_names", [])) or "(none)",
                "reviewer_ruling": "",
                "notes": "",
            })
    return rows


def name_rows(report: dict) -> list[dict]:
    """The scoping's damaged names beside their NHD evidence.

    The patterns are the scoping's own table; matching them here reproduces
    its enumeration against today's roster rather than hard-coding a list
    that drifts the next time the refresh runs. The proposed columns are
    left blank on purpose: proposing a name in code would be deciding one,
    and renaming is blocked until the former-name decision is taken.
    """
    patterns = [
        ("operator parenthetical", re.compile(r"\(([^)]*)\)\s*$")),
        ("alias/dam parenthetical",
         re.compile(r"\((?:Lake|Dam)[^)]*\)", re.IGNORECASE)),
        ("gauge abbreviation", re.compile(r"\b(Res|Lk|Nr|No|Vly|Sta)\b")),
        ("averaging note", re.compile(r"\b\d+Hr\b")),
        ("plant numbering", re.compile(r"^Pit R No \d+")),
        ("whitespace fault", re.compile(r"(  |\s\()")),
        ("trailing comma", re.compile(r",$")),
    ]
    reservoirs = json.loads(
        (ROOT / "reservoirs.json").read_text(encoding="utf-8"))["reservoirs"]
    resolved = {entry["name"]: entry for entry in report["resolved"]}
    rows = []
    for r in reservoirs:
        if not r.get("source_station_id"):
            continue
        hits = [label for label, pattern in patterns
                if pattern.search(r["name"])]
        if not hits:
            continue
        evidence = resolved.get(r["name"])
        rows.append({
            "current_roster_name": r["name"],
            "station": r["source_station_id"],
            "pattern_found": "; ".join(hits),
            "operator_field_available": "",   # filled by hand where it exists
            "nhd_gnis_name": (evidence or {}).get("gnis") or "(not resolved)",
            "nhd_ftype": FTYPE_NAMES.get(
                str((evidence or {}).get("ftype")), ""),
            "nhd_permanent_id": (evidence or {}).get("nhd_id", ""),
            "proposed_display_name": "",
            "proposed_type": "",
            "reviewer_notes": "",
        })
    return rows


def print_csv(rows: list[dict]) -> None:
    if not rows:
        print("(no rows)", file=sys.stderr)
        return
    buffer = io.StringIO()
    writer = csv.DictWriter(buffer, fieldnames=list(rows[0]))
    writer.writeheader()
    writer.writerows(rows)
    print(buffer.getvalue())


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--nwis", action="store_true")
    group.add_argument("--nhd", action="store_true")
    group.add_argument("--names", action="store_true")
    parser.add_argument("--nhd-json", type=Path, default=NHD_REPORT,
                        help="saved --json output of the resolution probe")
    args = parser.parse_args()

    if args.nwis:
        print_csv(nwis_rows())
    elif args.nhd:
        print_csv(nhd_rows(load_nhd_report(args.nhd_json)))
    else:
        print_csv(name_rows(load_nhd_report(args.nhd_json)))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
