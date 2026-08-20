#!/usr/bin/env python3
"""Which committed reference files are due to be checked against their sources.

Some facts do not change daily and can still be revised. A dam is resurveyed
and its capacity moves. Sedimentation reduces a pool. A provider corrects a
historical record. A boundary dataset publishes a new version. None of that
reaches this project on its own, because the whole point of committing a
reference file is that the pipeline stops asking for it every morning
(ADR-018, ADR-051).

So the commitment has a cost, and this is the reminder to pay it:

    python tools/check_reference_freshness.py
    python tools/check_reference_freshness.py --json

It writes nothing and refuses nothing. **Deliberately a tool and not a test.**
A test that fails when a date passes turns the build red on a morning when no
code changed, and on this project a red build freezes the published numbers
(`CLAUDE.md`). What *is* tested is that every file below carries a date and a
policy at all -- a fact about the code, which cannot go stale on its own.

Re-checking a file does not mean rebuilding it. It means asking the publisher
whether what this project holds is still what they publish, and recording the
answer by updating the file's own date -- which is what makes the next run of
this tool quiet.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

#: Each committed reference file, the field carrying the date it was last
#: checked against its source, and how long that answer stays good for.
#:
#: The intervals are judgements about how fast the upstream fact moves, not
#: arbitrary periods:
#:
#: - Dam capacities are resurveyed on the order of decades, but the National
#:   Inventory of Dams republishes continuously and this project holds a
#:   snapshot of it. A year is short enough to catch a revision while it still
#:   explains a percentage a reader questioned.
#: - County and state assignments follow boundaries that move rarely and a
#:   service that is re-hosted more often than the boundaries change.
#: - The drainage boundaries are a versioned national dataset. A new version
#:   is the event; a year is the backstop for noticing one.
#: - The land mask follows the same national sources as the boundaries.
#: - The climate normals are a closed period and cannot change with time --
#:   but the provider records behind them can be corrected, which is a
#:   different thing from the period moving. Annual, and see ADR-041.
#: - The snow site inventory changes when a station is installed or retired,
#:   which happens every season.
REFERENCES: tuple[dict, ...] = (
    {"path": "capacities.json", "field": "retrieved", "days": 365,
     "what": "Reservoir full levels, from the National Inventory of Dams"},
    {"path": "counties.json", "field": "retrieved", "days": 365,
     "what": "County assignment for each reservoir's waterbody"},
    {"path": "admitted_reservoirs.json", "field": "reviewed", "days": 365,
     "what": "The reviewed roster and its capacity evidence"},
    {"path": "normals.json", "field": "built", "days": 365,
     "what": "The 1991-2020 climate normals"},
    {"path": "snow_sites.json", "field": "retrieved", "days": 180,
     "what": "The mountain snow site inventory"},
    {"path": "data/watersheds/west-huc6.geojson", "field": "retrieved", "days": 365,
     "what": "The drawn drainage areas, from the Watershed Boundary Dataset"},
    {"path": "data/watersheds/west-huc4.geojson", "field": "retrieved", "days": 365,
     "what": "The same areas at the larger size"},
    {"path": "data/us-land.geojson", "field": "retrieved", "days": 365,
     "what": "The land mask the drought engine measures against"},
)


def read_date(path: Path, field: str) -> str | None:
    """The file's own record of when it was last checked, or None."""
    if not path.exists():
        return None
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    value = payload.get(field) if isinstance(payload, dict) else None
    return value if isinstance(value, str) else None


def review(today: dt.date) -> list[dict]:
    """Every reference file, with how long since it was checked."""
    rows = []
    for entry in REFERENCES:
        path = ROOT / entry["path"]
        stamped = read_date(path, entry["field"])
        try:
            checked = dt.date.fromisoformat(stamped) if stamped else None
        except ValueError:
            checked = None
        age = (today - checked).days if checked else None
        rows.append({
            **entry,
            "exists": path.exists(),
            "checked": stamped,
            "age_days": age,
            # An undated file is the loudest state, not the quietest: it is
            # indistinguishable from one checked ten years ago.
            "due": age is None or age > entry["days"],
            "due_on": (checked + dt.timedelta(days=entry["days"])).isoformat()
            if checked else None,
        })
    return rows


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--json", action="store_true",
                        help="print the rows as JSON instead of a table")
    parser.add_argument("--today", default=None,
                        help="pretend it is this date, for checking the tool")
    args = parser.parse_args()

    today = dt.date.fromisoformat(args.today) if args.today else dt.date.today()
    rows = review(today)
    if args.json:
        print(json.dumps(rows, indent=1))
        return 0

    print(f"Reference data, checked against {today.isoformat()}\n")
    print(f"{'file':<40}{'checked':<12}{'age':<8}{'due'}")
    for row in rows:
        age = "never" if row["age_days"] is None else f"{row['age_days']}d"
        mark = "  REVIEW" if row["due"] else ""
        state = row["checked"] or ("missing" if not row["exists"] else "undated")
        print(f"{row['path']:<40}{state:<12}{age:<8}{row['due_on'] or '-'}{mark}")

    due = [row for row in rows if row["due"]]
    print()
    if not due:
        print("Nothing is due for review.")
        return 0
    print(f"{len(due)} due for review:")
    for row in due:
        print(f"  {row['path']} -- {row['what']}")
    print("\nRe-checking means asking the publisher whether what is committed "
          "here is still\nwhat they publish, then updating the file's own date "
          "field with the answer.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
