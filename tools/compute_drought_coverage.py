"""Compute weekly drought coverage for each published drainage area.

Reads the committed U.S. Drought Monitor polygons and the committed HUC-6
boundaries, and writes the percent of each drainage area's land in each
intensity class. The downloaded polygons are *exclusive*: each feature covers
exactly its class, verified by probing interior points, so "D1 or worse" is a
sum of disjoint areas rather than a union.

    python tools/compute_drought_coverage.py
    python tools/compute_drought_coverage.py --step 0.02 --output out.json

Method: even-odd scanline sampling. Each drainage area's bounding box is
covered by a grid of cell centres ``step`` degrees apart. A grid row is one
latitude; every polygon segment crossing that latitude is solved for its
longitude once, and a point is inside when an odd number of crossings sit to
its west -- the same even-odd rule as the repository's ray-casting point
tests, so holes and multiple parts need no special cases. Each point is
weighted by the cosine of its latitude, because a degree of longitude narrows
toward the pole and an unweighted count would overstate the north of every
unit. That weight is not an approximation of an equal-area projection: it is
the exact area element of a sphere, so this already measures equal area and
the only open question was ever which figure of the earth it assumes. The
result is deterministic for a given pair of input files: no timestamps, so an
unchanged week writes an unchanged file.

Two error terms, both measured against the committed inputs (ADR-055), in the
percentage points this file publishes, against a rounding boundary of 0.05:

    area model, sphere against the WGS84 ellipsoid      0.004
    sampling, the 0.01-degree step against convergence  0.069
    control: dropping the latitude weight entirely      0.286

So the sampling dominates, the area model cannot move a published figure, and
an equal-area projection -- which is what Albers would supply -- would change
nothing a reader could see. The first thing to reach for if the published
precision ever tightens past 0.1 is a finer step, not a projection.

`tests/test_area_model.py` holds both terms against a geodesic oracle;
`tests/test_drought_coverage.py` holds the engine to known shapes and the
committed output to its own arithmetic.
"""

from __future__ import annotations

import argparse
import json
import math
import tempfile
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
DROUGHT_PATH = ROOT / "data" / "drought" / "usdm-current.geojson"
BOUNDARIES_PATH = ROOT / "huc6.geojson"
OUTPUT_PATH = ROOT / "data" / "drought" / "usdm-huc6.json"
HISTORY_PATH = ROOT / "data" / "drought" / "usdm-huc6-history.json"
DEFAULT_STEP = 0.01
LEVELS = ("d0", "d1", "d2", "d3", "d4")

# How many weekly maps the history keeps.
#
# The monitor publishes every Thursday, so this is ten years. It exists to
# bound the file rather than because anything older stops being interesting:
# at fourteen drainage areas and five cumulative shares each, a decade is
# about 36,000 numbers, and the file only reaches that size in 2036.
#
# The history starts the week this was added. The monitor's own archive goes
# back to 2000 and is not backfilled here -- every figure in this file is one
# this pipeline computed from polygons it verified, and mixing those with
# values recomputed later from a different archive would make the series two
# different measurements wearing one name.
HISTORY_WEEKS_KEPT = 520


def segments_of(geometry: dict) -> np.ndarray:
    """Every ring of a Polygon or MultiPolygon as one (n, 4) segment array.

    Outer rings and holes are pooled: under the even-odd rule a hole is just
    more crossings, so the distinction never needs to be carried.
    """
    polygons = ([geometry["coordinates"]] if geometry["type"] == "Polygon"
                else geometry["coordinates"])
    pieces = []
    for polygon in polygons:
        for ring in polygon:
            points = np.asarray(ring, dtype=float)
            if len(points) < 2:
                continue
            pieces.append(np.column_stack([points[:-1], points[1:]]))
    if not pieces:
        raise ValueError("geometry has no rings")
    return np.concatenate(pieces)


def row_crossings(segments: np.ndarray, lat: float) -> np.ndarray:
    """Sorted longitudes where the polygon boundary crosses one latitude."""
    y1 = segments[:, 1]
    y2 = segments[:, 3]
    straddles = (y1 > lat) != (y2 > lat)
    if not straddles.any():
        return np.empty(0)
    x1 = segments[straddles, 0]
    x2 = segments[straddles, 2]
    y1 = y1[straddles]
    y2 = y2[straddles]
    crossings = x1 + (lat - y1) * (x2 - x1) / (y2 - y1)
    crossings.sort()
    return crossings


def inside_row(crossings: np.ndarray, lons: np.ndarray) -> np.ndarray:
    """Even-odd membership for every point of one grid row."""
    if crossings.size == 0:
        return np.zeros(lons.shape, dtype=bool)
    return (np.searchsorted(crossings, lons) % 2) == 1


def unit_coverage(
    unit_segments: np.ndarray,
    drought_segments: dict[int, np.ndarray],
    step: float,
) -> dict[str, float]:
    """Raw percent of one drainage area's land in each exclusive class."""
    lon_min, lat_min = unit_segments[:, [0, 1]].min(axis=0)
    lon_max, lat_max = unit_segments[:, [2, 3]].max(axis=0)
    # Cell centres, nudged so a grid row cannot sit exactly on a vertex
    # latitude, where a crossing count is ambiguous.
    epsilon = step * 1e-6
    lats = np.arange(lat_min + step / 2 + epsilon, lat_max, step)
    lons = np.arange(lon_min + step / 2 + epsilon, lon_max, step)
    if lats.size == 0 or lons.size == 0:
        raise ValueError("drainage area smaller than one grid cell")

    total_weight = 0.0
    level_weights = dict.fromkeys(drought_segments, 0.0)
    for lat in lats:
        in_unit = inside_row(row_crossings(unit_segments, lat), lons)
        count = int(in_unit.sum())
        if count == 0:
            continue
        weight = math.cos(math.radians(lat))
        total_weight += weight * count
        row_lons = lons[in_unit]
        # One class per point, worst wins. The classes are exclusive by
        # contract, but their 100-metre-simplified edges can overlap by a
        # sliver, and a point counted twice would push the total past 100.
        category = np.full(row_lons.shape, -1)
        for level in sorted(drought_segments):
            hits = inside_row(row_crossings(drought_segments[level], lat), row_lons)
            category[hits] = level
        for level in drought_segments:
            level_weights[level] += weight * int((category == level).sum())

    if total_weight == 0.0:
        raise ValueError("no grid point landed inside the drainage area")
    return {
        f"d{level}": 100.0 * level_weights[level] / total_weight
        for level in sorted(drought_segments)
    }


def build_payload(drought: dict, boundaries: dict, step: float) -> dict:
    drought_segments = {}
    for feature in drought["features"]:
        level = feature["properties"]["DM"]
        if not isinstance(level, int) or level not in range(5):
            raise ValueError(f"invalid drought intensity {level!r}")
        if level in drought_segments:
            raise ValueError(f"duplicate drought intensity D{level}")
        drought_segments[level] = segments_of(feature["geometry"])

    units = []
    for feature in sorted(boundaries["features"],
                          key=lambda item: item["properties"]["huc6"]):
        raw = unit_coverage(segments_of(feature["geometry"]), drought_segments, step)
        # A class the map does not carry this week covers nothing.
        exclusive = {key: raw.get(key, 0.0) for key in LEVELS}
        # One class per sampled point, so this cannot exceed 100; the max
        # guards the arithmetic against float dust, and adding 0.0
        # normalises a negative zero out of the published file.
        in_any = min(sum(exclusive.values()), 100.0)
        # Cumulative sums come from the unrounded figures, so "D1 or worse"
        # cannot disagree with its parts by more than the display rounding.
        at_least = {}
        running = 0.0
        for key in reversed(LEVELS):
            running += exclusive[key]
            at_least[key] = round(running, 1)
        units.append({
            "huc6": feature["properties"]["huc6"],
            "huc6_name": feature["properties"]["name"],
            "percent_of_area": {
                "none": round(100.0 - in_any, 1) + 0.0,
                **{key: round(value, 1) for key, value in exclusive.items()},
            },
            "percent_of_area_at_least": {key: at_least[key] for key in LEVELS},
        })

    return {
        "schema_version": 1,
        "map_date": drought["map_date"],
        "release_date": drought["release_date"],
        "source": drought["source"],
        "attribution": drought["attribution"],
        "method": {
            "sampling": "even-odd scanline over cell centres",
            "grid_step_degrees": step,
            "weighting": "cosine of latitude",
            "classes": "exclusive; at-least values are sums of disjoint classes",
        },
        # The size of the drainage areas, as the length of their code. The
        # boundary file decides it; this reports it so a reader never has to
        # infer the level by measuring a code.
        "level": len(units[0]["huc6"]) if units else None,
        "unit_count": len(units),
        "units": units,
    }


def history_entry(payload: dict) -> dict:
    """One week, reduced to what a comparison between weeks needs.

    Only the cumulative shares are kept. The exclusive shares are recoverable
    by differencing them -- `d2` alone is `at_least["d2"] - at_least["d3"]`,
    and the share in no class at all is `100 - at_least["d0"]` -- so storing
    both would be storing one fact twice, rounded twice, with two chances to
    disagree.

    The area names are not repeated either. They belong to the boundary file
    and to the current week's payload; a history that carried its own copy
    would be a second place for a name to be wrong.
    """
    return {
        "map_date": payload["map_date"],
        "release_date": payload["release_date"],
        # Deliberately not `payload["previous"]`: an archive where each entry
        # carries a copy of the one before it stores every week twice and
        # doubles again on the next release.
        "units": [
            {"huc6": unit["huc6"],
             "percent_of_area_at_least": dict(unit["percent_of_area_at_least"])}
            for unit in payload["units"]
        ],
    }


def previous_week(history: dict | None, map_date: str) -> dict | None:
    """The newest week in the history older than this one, or None.

    Strictly older, so re-running for a week already in the history compares
    against the week before it rather than against itself. That is the
    difference between a rerun being a no-op and a rerun quietly publishing a
    change of zero for every area.
    """
    weeks = [week for week in ((history or {}).get("weeks") or [])
             if week.get("map_date", "") < map_date]
    if not weeks:
        return None
    newest = max(weeks, key=lambda week: week["map_date"])
    return {
        "map_date": newest["map_date"],
        "release_date": newest.get("release_date"),
        "units": [
            {"huc6": unit["huc6"],
             "percent_of_area_at_least": dict(unit["percent_of_area_at_least"])}
            for unit in newest["units"]
        ],
    }


def merge_history(previous: dict | None, payload: dict,
                  keep: int = HISTORY_WEEKS_KEPT) -> dict:
    """Add this week to the history, replacing any entry for the same week.

    Replacing rather than appending is what makes the tool safe to run twice.
    The monitor also revises a published week occasionally, and a rerun after
    a revision has to correct the entry rather than leave the file carrying
    both readings of one Thursday.

    Weeks are held oldest first, so a reader can take the last entry without
    knowing how long the file is.
    """
    weeks = list((previous or {}).get("weeks") or [])
    entry = history_entry(payload)
    weeks = [week for week in weeks if week.get("map_date") != entry["map_date"]]
    weeks.append(entry)
    weeks.sort(key=lambda week: week["map_date"])
    del weeks[:-keep]
    return {
        "schema_version": 1,
        "source": payload["source"],
        "attribution": payload["attribution"],
        "method": {
            **payload["method"],
            "history": (
                "One entry for each weekly map this pipeline has computed, "
                "oldest first. Exclusive class shares are recoverable by "
                "differencing the cumulative ones."
            ),
        },
        "weeks_kept": keep,
        "first_map_date": weeks[0]["map_date"],
        "last_map_date": weeks[-1]["map_date"],
        "week_count": len(weeks),
        "unit_count": payload["unit_count"],
        "weeks": weeks,
    }


def write_atomic(path: Path, payload: dict) -> bool:
    body = json.dumps(payload, separators=(",", ":"), ensure_ascii=False) + "\n"
    before = path.read_text(encoding="utf-8") if path.exists() else None
    if before == body:
        return False
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(
            "w", encoding="utf-8", dir=path.parent, delete=False) as handle:
        temporary = Path(handle.name)
        handle.write(body)
    temporary.chmod(0o644)
    temporary.replace(path)
    return True


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--drought", type=Path, default=DROUGHT_PATH)
    parser.add_argument("--boundaries", type=Path, default=BOUNDARIES_PATH)
    parser.add_argument("--output", type=Path, default=OUTPUT_PATH)
    parser.add_argument("--history", type=Path, default=HISTORY_PATH)
    parser.add_argument("--no-history", action="store_true",
                        help="compute this week only and leave the history alone")
    parser.add_argument("--step", type=float, default=DEFAULT_STEP)
    args = parser.parse_args()

    drought = json.loads(args.drought.read_text(encoding="utf-8"))
    boundaries = json.loads(args.boundaries.read_text(encoding="utf-8"))
    payload = build_payload(drought, boundaries, args.step)
    history_changed = False
    history = None
    previous_history = None
    if not args.no_history:
        previous_history = (json.loads(args.history.read_text(encoding="utf-8"))
                            if args.history.exists() else None)
        # Last week's figures travel in this week's file.
        #
        # A week-over-week comparison needs exactly two weeks, and the full
        # history is the wrong way to deliver them: it grows without bound and
        # every page wanting a single change would fetch a decade to find one
        # subtraction. This block is about a kilobyte and needs no extra
        # request. The archive stays for work that genuinely wants a series.
        payload["previous"] = previous_week(previous_history, payload["map_date"])

    changed = write_atomic(args.output, payload)
    if not args.no_history:
        history = merge_history(previous_history, payload)
        history_changed = write_atomic(args.history, history)

    for unit in payload["units"]:
        worst = next((key for key in reversed(LEVELS)
                      if unit["percent_of_area"][key] > 0), "none")
        print(f"{unit['huc6']} {unit['huc6_name']}: "
              f"{unit['percent_of_area_at_least']['d0']}% in drought or unusually "
              f"dry, worst class {worst}")
    print(f"{payload['unit_count']} drainage areas for {payload['map_date']}; "
          f"{args.output} {'written' if changed else 'unchanged'}.")
    if history is not None:
        print(f"{history['week_count']} weeks kept "
              f"({history['first_map_date']} to {history['last_map_date']}); "
              f"{args.history} {'written' if history_changed else 'unchanged'}.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
