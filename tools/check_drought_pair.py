"""Check that the two committed drought files describe the same week, and how
old that week is.

`data/drought/usdm-current.geojson` is the download, and one file per offered
level -- `usdm-huc6.json` and `usdm-huc4.json` -- is the per-drainage-area
coverage computed from it. The drought view refuses to draw when the pair it
loaded names different weeks, and it is right to: two files describing two
different weeks is a pipeline fault, and rendering a map of one week over
figures from another would be worse than showing nothing.

Every coverage file is checked, not just the one the map opens at. A reader
who changes the level is fetching a different file (ADR-064), and a file that
fell behind would put them on another week with nothing said.

That refusal protects the reader, not the pipeline. This is the pipeline half.
It runs in the refresh workflow between recomputing the coverage and committing
anything, so a mismatch is caught while both files can still be put back, and
never reaches a commit that the deploy will publish.

It also answers the other weekly question: how old the newest release is. The
monitor publishes every Thursday, and when it stops, nothing fails -- the last
verified week stays on the page with its age stated. So the only way anyone
notices is if something asks, which is what `--github-output` is for.

Exit status is the whole contract for the first job: zero when the pair agrees,
non-zero when it does not. Release age is reported, never fatal; a late
upstream release is not a broken pipeline.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import date, datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
POLYGON_PATH = ROOT / "data" / "drought" / "usdm-current.geojson"


def coverage_paths() -> list[Path]:
    """Every published weekly coverage file, one per offered level.

    Found rather than listed: a level is added by publishing a scope and
    running the engine at it, and a list here would be a second place to
    remember. The archive is excluded by name -- it is a series, not a week.
    """
    return sorted(path for path in (ROOT / "data" / "drought").glob("usdm-huc*.json")
                  if not path.name.endswith("-history.json"))

# Nine days, matching LATE_AFTER_DAYS in src/drought-model.ts, which is what
# the drought page marks a release late at. A weekly release plus two days of
# slack: eight days is a release that merely slipped, ten is one that was
# missed. The two constants are pinned to each other by a test rather than
# left to drift, because a reader being told "late" on a page while the
# pipeline stays quiet is exactly the kind of disagreement nobody chases.
LATE_AFTER_DAYS = 9


def read_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def days_since(release_date: str, today: date) -> int:
    """Whole days from an ISO release date to today. Negative dates are not
    special-cased: a release in the future is a data fault the caller sees as
    a negative age rather than a silent zero."""
    released = datetime.strptime(release_date, "%Y-%m-%d").date()
    return (today - released).days


def check_pair(polygons: dict, coverage: dict) -> list[str]:
    """The reasons the two files do not describe the same week. Empty when
    they agree, so the caller can print each one rather than a single
    unhelpful boolean."""
    problems: list[str] = []
    for field in ("map_date", "release_date"):
        left = polygons.get(field)
        right = coverage.get(field)
        if left != right:
            problems.append(
                f"{field}: polygons say {left!r}, coverage says {right!r}")
    return problems


def emit_github_output(values: dict[str, str]) -> None:
    """Write step outputs when running inside Actions, and to stdout when not,
    so the same command is readable by hand."""
    path = os.environ.get("GITHUB_OUTPUT")
    lines = [f"{key}={value}" for key, value in values.items()]
    if path:
        with open(path, "a", encoding="utf-8") as handle:
            handle.write("\n".join(lines) + "\n")
    else:
        print("\n".join(lines))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--polygons", type=Path, default=POLYGON_PATH)
    parser.add_argument("--coverage", type=Path, nargs="+", default=None,
                        help="coverage files to check; every published level "
                             "by default")
    parser.add_argument(
        "--github-output", action="store_true",
        help="Report the release age as workflow step outputs and exit zero.")
    args = parser.parse_args()

    coverage_files = args.coverage if args.coverage is not None else coverage_paths()
    if not coverage_files:
        print("no coverage files to check", file=sys.stderr)
        return 1
    for path in (args.polygons, *coverage_files):
        if not path.exists():
            print(f"missing {path}", file=sys.stderr)
            return 1

    polygons = read_json(args.polygons)
    covers = [(path, read_json(path)) for path in coverage_files]

    problems = [f"{path.name} {problem}"
                for path, coverage in covers
                for problem in check_pair(polygons, coverage)]
    if problems and not args.github_output:
        for problem in problems:
            print(f"drought files disagree -- {problem}", file=sys.stderr)
        return 1

    # Every file agrees with the polygons by here, so any of them answers the
    # age question; the one the map opens at is the one to name.
    coverage = covers[0][1]
    release_date = coverage.get("release_date", "")
    today = datetime.now(timezone.utc).date()
    age = days_since(release_date, today) if release_date else -1
    late = age >= LATE_AFTER_DAYS

    if args.github_output:
        emit_github_output({
            "map_date": str(coverage.get("map_date", "")),
            "release_date": release_date,
            "days_old": str(age),
            "late": "true" if late else "false",
        })
        # The age is never fatal: an upstream publisher that misses a
        # Thursday is not this pipeline failing, and the alert the caller
        # raises from these outputs is the right response, not a red run.
        return 0

    names = ", ".join(path.name for path, _ in covers)
    print(
        f"drought files agree on {coverage.get('map_date')} "
        f"(released {release_date}, {age} days ago): {names}"
        + (" -- LATE" if late else ""))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
