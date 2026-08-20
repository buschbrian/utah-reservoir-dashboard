#!/usr/bin/env python3
"""What the sampling step is worth, in the tenths of a point the site publishes.

`compute_drought_coverage.py` samples each drainage area on a grid of cell
centres. The grid is the engine's dominant error term -- ADR-055 measured the
spherical area model at 0.004 points against a geodesic oracle and the sampling
at an order of magnitude more -- so the step is what decides whether a published
tenth means anything.

This runs the real engine at several steps against one fine reference and
counts, over every share in every area, how many would round to a different
tenth. That is the question the published precision actually turns on: not the
average error, which is small at any step, but how often a reader would see a
different digit.

    python tools/measure_drought_convergence.py
    python tools/measure_drought_convergence.py --steps 0.01 0.005 --reference 0.002

It writes nothing. The committed coverage files and the archive are untouched,
which is the whole point of a measurement.

Measured on the map of 2026-08-11 over the 75 drawn areas, 844 published
shares, against a 0.001-degree reference:

    step     values over 0.05  worst   run time
    0.01     59 (7.0%)         0.2     10s
    0.005    17 (2.0%)         0.1     21s
    0.002     5 (0.6%)         0.1     80s

The 0.6% at 0.002 is the floor rather than a residue to chase: those are shares
whose true value sits on a rounding boundary, where no step settles the digit.
0.01 was the step this project published at until that table was measured.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import watershed_scopes  # noqa: E402
from tools.compute_drought_coverage import (  # noqa: E402
    DROUGHT_PATH, LAND_PATH, build_payload,
)

#: A published tenth changes when the error passes half of one.
ROUNDING_BOUNDARY = 0.05


def shares(payload: dict, level: int) -> dict[tuple[str, str, str], float]:
    """Every published share, keyed by area, block and class.

    The level names the attribute the code arrives in
    (`watershed_scopes.huc_field`), never a list written here: a hand-written
    `huc6 or huc4 or huc2` chain omitted `huc8`, which is a registered level,
    and keyed all 571 of its subbasins to the empty string -- each
    overwriting the last, so the table compared one surviving unit and
    reported a clean run. A tool that decides whether to move `DEFAULT_STEP`
    may not answer from a collision.
    """
    field = watershed_scopes.huc_field(level)
    out: dict[tuple[str, str, str], float] = {}
    for unit in payload["units"]:
        code = unit[field]
        for block in ("percent_of_area", "percent_of_area_at_least"):
            for name, value in (unit.get(block) or {}).items():
                if isinstance(value, (int, float)):
                    out[(code, block, name)] = float(value)
        measured = unit.get("measured") or {}
        for name, value in measured.items():
            if isinstance(value, (int, float)):
                out[(code, "measured", name)] = float(value)
    return out


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--scope", default=watershed_scopes.DEFAULT_SCOPE,
                        choices=tuple(sorted(watershed_scopes.SCOPES)))
    parser.add_argument("--steps", type=float, nargs="+",
                        default=[0.01, 0.005, 0.002])
    parser.add_argument("--reference", type=float, default=0.001,
                        help="the step every other one is measured against")
    parser.add_argument("--drought", type=Path, default=DROUGHT_PATH)
    parser.add_argument("--land", type=Path, default=LAND_PATH)
    args = parser.parse_args()

    scope = watershed_scopes.get_scope(args.scope)
    drought = json.loads(args.drought.read_text(encoding="utf-8"))
    boundaries = json.loads((ROOT / scope.output).read_text(encoding="utf-8"))
    if not args.land.exists():
        print(f"ERROR: no land mask at {args.land}; "
              "run tools/fetch_us_land_mask.py", file=sys.stderr)
        return 1
    land = json.loads(args.land.read_text(encoding="utf-8"))

    print(f"reference: {args.reference} degrees over {scope.name}", flush=True)
    reference = shares(build_payload(drought, boundaries, args.reference, land),
                       scope.level)
    print(f"{len(reference)} published shares\n")
    print(f"{'step':<10}{'over ' + str(ROUNDING_BOUNDARY):<14}{'worst':<10}{'mean':<10}")
    worst_overall = 0.0
    for step in sorted(args.steps, reverse=True):
        measured = shares(build_payload(drought, boundaries, step, land),
                          scope.level)
        gaps = [abs(value - reference[key])
                for key, value in measured.items() if key in reference]
        if not gaps:
            print(f"{step:<10}no comparable shares")
            continue
        over = sum(1 for gap in gaps if gap > ROUNDING_BOUNDARY)
        worst_overall = max(worst_overall, max(gaps))
        print(f"{step:<10}{f'{over} ({over / len(gaps) * 100:.1f}%)':<14}"
              f"{max(gaps):<10.3f}{sum(gaps) / len(gaps):<10.4f}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
