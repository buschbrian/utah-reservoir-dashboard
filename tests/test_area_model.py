"""The drought engine's area model against an oracle that shares none of it.

ADR-055. The engine measures area by summing ``cos(lat)`` over sampled points
in geographic coordinates -- the exact area element of a *sphere*. The oracle
here is Karney's geodesic algorithm on the WGS84 ellipsoid: closed form, no
projection, no sampling, accurate to about 0.1 m^2 per vertex. The two share
no assumption except the committed boundary file, so a change to the step, the
weighting, or the boundaries is measured rather than assumed.

`geographiclib` is a test dependency and must never become a pipeline one.
The daily refresh stays numpy, pandas and requests; this is the same
arrangement as the frozen colour oracle, which is also slower, also exact, and
also never in the production path.

Nothing here reads the weekly drought file. The worst case for the area model
is a class boundary that runs along a parallel, which no real week is
guaranteed to contain, so this builds that case instead of waiting for it.
"""

import math
import sys
from pathlib import Path

import numpy as np
import pytest

from geographiclib.geodesic import Geodesic
from geographiclib.polygonarea import PolygonArea

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))

from compute_drought_coverage import (  # noqa: E402
    BOUNDARIES_PATH,
    DEFAULT_STEP,
    LEVELS,
    inside_row,
    row_crossings,
    segments_of,
    unit_coverage,
)

import json  # noqa: E402

# WGS84, and the sphere with the same surface area. The engine's cos(lat) is
# this sphere's area element; the oracle is the ellipsoid it approximates.
E2 = 0.0066943799901413165
AUTHALIC_RADIUS_M = 6371007.181


@pytest.fixture(scope="module")
def units():
    boundaries = json.loads(BOUNDARIES_PATH.read_text())
    return sorted(boundaries["features"], key=lambda item: item["properties"]["huc6"])


def geodesic_area_m2(geometry: dict) -> float:
    """Exact area on WGS84. Outer rings add, holes subtract."""
    polygons = ([geometry["coordinates"]] if geometry["type"] == "Polygon"
                else geometry["coordinates"])
    total = 0.0
    for polygon in polygons:
        for index, ring in enumerate(polygon):
            poly = PolygonArea(Geodesic.WGS84)
            # GeoJSON repeats the first vertex; PolygonArea closes the ring.
            for lon, lat in ring[:-1]:
                poly.AddPoint(lat, lon)
            _, _, area = poly.Compute(False, True)
            total += abs(area) if index == 0 else -abs(area)
    return total


def sampled_area_m2(segments: np.ndarray, step: float) -> float:
    """The engine's own weighting, carried through to square metres.

    Each sampled point stands for a cell of ``step`` degrees on a side, whose
    area on a sphere is ``R^2 cos(lat) (step in radians)^2``.
    """
    lon_min, lat_min = segments[:, [0, 1]].min(axis=0)
    lon_max, lat_max = segments[:, [2, 3]].max(axis=0)
    epsilon = step * 1e-6
    lats = np.arange(lat_min + step / 2 + epsilon, lat_max, step)
    lons = np.arange(lon_min + step / 2 + epsilon, lon_max, step)

    weight_sum = 0.0
    for lat in lats:
        inside = inside_row(row_crossings(segments, lat), lons)
        count = int(inside.sum())
        if count:
            weight_sum += math.cos(math.radians(lat)) * count
    cell = (math.radians(step)) ** 2 * AUTHALIC_RADIUS_M**2
    return weight_sum * cell


def test_sampled_area_matches_the_geodesic_oracle(units):
    """Every drainage area, the engine's model against the ellipsoid.

    The tolerance is not tight because it is absorbing two known and separate
    things: the authalic sphere sits about 1,000 ppm under the ellipsoid at
    these latitudes (ADR-055), and a 0.01-degree grid resolves a ragged
    watershed edge only so well. It is tight enough that a wrong earth radius,
    a dropped cosine, or a hole counted as an outer ring all fail it.
    """
    for feature in units:
        segments = segments_of(feature["geometry"])
        sampled = sampled_area_m2(segments, DEFAULT_STEP)
        truth = geodesic_area_m2(feature["geometry"])
        relative = abs(sampled - truth) / truth
        assert relative < 0.01, (
            f"{feature['properties']['huc6']} "
            f"{feature['properties']['name']}: sampled {sampled / 1e6:,.0f} km2 "
            f"against geodesic {truth / 1e6:,.0f} km2, off by {relative:.4%}"
        )


def test_dropping_the_cosine_weight_fails_that_oracle(units):
    """The guard above has teeth: the unweighted count does not pass it."""
    feature = max(units, key=lambda f: np.ptp(segments_of(f["geometry"])[:, 1]))
    segments = segments_of(feature["geometry"])

    lon_min, lat_min = segments[:, [0, 1]].min(axis=0)
    lon_max, lat_max = segments[:, [2, 3]].max(axis=0)
    epsilon = DEFAULT_STEP * 1e-6
    lats = np.arange(lat_min + DEFAULT_STEP / 2 + epsilon, lat_max, DEFAULT_STEP)
    lons = np.arange(lon_min + DEFAULT_STEP / 2 + epsilon, lon_max, DEFAULT_STEP)
    count = sum(int(inside_row(row_crossings(segments, lat), lons).sum())
                for lat in lats)
    unweighted = count * math.radians(DEFAULT_STEP) ** 2 * AUTHALIC_RADIUS_M**2

    truth = geodesic_area_m2(feature["geometry"])
    assert abs(unweighted - truth) / truth > 0.01


def ellipsoidal_weight(lat: float) -> float:
    """The WGS84 area element, up to the constant that cancels in a ratio."""
    sin = math.sin(math.radians(lat))
    return math.cos(math.radians(lat)) / (1.0 - E2 * sin**2) ** 2


def banded_drought(feature: dict) -> dict:
    """A synthetic map whose classes split along a parallel.

    The area model can only move a share by weighting one class's points
    differently from another's, so its worst case is a class boundary running
    east-west through the middle of the widest unit. A real week is not
    obliged to contain one; this builds it.
    """
    segments = segments_of(feature["geometry"])
    lon_min, lat_min = segments[:, [0, 1]].min(axis=0)
    lon_max, lat_max = segments[:, [2, 3]].max(axis=0)
    mid = (lat_min + lat_max) / 2
    pad = 1.0

    def box(south, north):
        return np.array([[lon_min - pad, south, lon_max + pad, south],
                         [lon_max + pad, south, lon_max + pad, north],
                         [lon_max + pad, north, lon_min - pad, north],
                         [lon_min - pad, north, lon_min - pad, south]])

    return {0: box(mid, lat_max + pad), 4: box(lat_min - pad, mid)}


def test_the_area_model_cannot_move_a_published_figure(units):
    """Sphere against ellipsoid, on the shape built to maximise the gap.

    A share is published to 0.1 of a percentage point, so a figure moves only
    if the two models straddle a rounding boundary 0.05 points away. ADR-055
    measured 0.004 points against the live map; the constructed worst case is
    0.0094, and the bound below sits between that and the boundary so that it
    fails on a real change of model rather than on grid jitter.
    """
    worst = 0.0
    for feature in units:
        segments = segments_of(feature["geometry"])
        drought = banded_drought(feature)
        # The measured share is not part of this comparison: it is a ratio of
        # cell counts, so it carries no area model at all.
        spherical, _measured = unit_coverage(segments, drought, DEFAULT_STEP)
        elliptical = _coverage_with_weight(segments, drought, DEFAULT_STEP,
                                           ellipsoidal_weight)
        for key in spherical:
            worst = max(worst, abs(spherical[key] - elliptical[key]))

    assert worst < 0.02, (
        f"the spherical and ellipsoidal area models differ by {worst:.4f} "
        "points; ADR-055 assumes this stays far inside the 0.05-point "
        "rounding boundary"
    )


def _coverage_with_weight(unit_segments, drought_segments, step, weight_fn):
    """`unit_coverage` with the weight function made a parameter.

    Kept beside the test rather than exported from the tool: the production
    engine has one area model on purpose, and a seam for swapping it would be
    a seam for getting it wrong.
    """
    lon_min, lat_min = unit_segments[:, [0, 1]].min(axis=0)
    lon_max, lat_max = unit_segments[:, [2, 3]].max(axis=0)
    epsilon = step * 1e-6
    lats = np.arange(lat_min + step / 2 + epsilon, lat_max, step)
    lons = np.arange(lon_min + step / 2 + epsilon, lon_max, step)

    total = 0.0
    level_weights = dict.fromkeys(drought_segments, 0.0)
    for lat in lats:
        in_unit = inside_row(row_crossings(unit_segments, lat), lons)
        count = int(in_unit.sum())
        if count == 0:
            continue
        weight = weight_fn(lat)
        total += weight * count
        row_lons = lons[in_unit]
        category = np.full(row_lons.shape, -1)
        for level in sorted(drought_segments):
            hits = inside_row(row_crossings(drought_segments[level], lat), row_lons)
            category[hits] = level
        for level in drought_segments:
            level_weights[level] += weight * int((category == level).sum())

    return {f"d{level}": 100.0 * level_weights[level] / total
            for level in sorted(drought_segments)}
