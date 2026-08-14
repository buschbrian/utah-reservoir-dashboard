"""Write reference.json: the capacity table and every boundary in one file.

The reference half of the dashboard's data -- what a surface needs before it
can draw anything -- assembled from the committed source files by
``refresh_reservoirs.build_export_sections``.

    python tools/build_reference_export.py --check   # does the committed file still match?
    python tools/build_reference_export.py

Generated rather than hand-edited, and committed rather than built on the
fly: the pages fetch it at runtime (ADR-002, ADR-018), so it has to exist in
the published output without a Python step in the deploy. ``--check`` is the
guard that keeps the committed copy from drifting away from the four files it
is derived from; ``tests/test_refresh.py`` runs the same comparison, so a
change to capacities.json or a boundary file fails the build until this is
re-run in the same commit.
"""

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from refresh_reservoirs import EXPORT_PATH, build_export_sections  # noqa: E402


def render(sections: dict) -> str:
    """The exact bytes the committed file holds.

    One place decides the formatting, because ``--check`` compares the file
    it would write against the file on disk.

    Compact, like the committed GeoJSON it is built from. Indenting it costs
    a megabyte -- 1190 KB against 250 KB -- and every byte is fetched by a
    reader's browser. Nothing is lost by it: the polygons are reviewed in
    their source files, and this file's correctness is a comparison against
    those sources rather than something an eye checks. Keys are sorted so
    the derived file changes only when its inputs do.
    """
    return json.dumps(sections, separators=(",", ":"), sort_keys=True) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true",
                        help="compare the committed file against its sources and "
                             "report drift, without writing anything")
    args = parser.parse_args()

    rendered = render(build_export_sections())
    relative = EXPORT_PATH.relative_to(ROOT)

    if args.check:
        if not EXPORT_PATH.exists():
            print(f"ERROR: {relative} has not been generated", file=sys.stderr)
            return 1
        if EXPORT_PATH.read_text(encoding="utf-8") != rendered:
            print(f"ERROR: {relative} no longer matches the files it is built "
                  f"from; re-run python {Path(__file__).relative_to(ROOT)}",
                  file=sys.stderr)
            return 1
        print(f"{relative} matches its sources")
        return 0

    EXPORT_PATH.write_text(rendered, encoding="utf-8")
    size_kb = len(rendered) / 1024
    print(f"Wrote {relative} ({size_kb:.0f} KB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
