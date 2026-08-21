"""Watershed membership for each reservoir.

Three facts get attached to every published record: which six-digit hydrologic
unit its water drains through, whether its provider point is in Utah, and
whether its waterbody intersects Utah. They are separate on purpose. A
drainage area does not stop at a state line -- Lake
Powell's water comes down the Green from Wyoming and the Colorado from
Colorado -- so "reservoirs in Utah" and "reservoirs in drainage areas that
touch Utah" are two different questions and the dashboard has to be able to
ask each one without the other quietly changing.

Standard library only, and deliberately kept out of refresh_reservoirs.py:
this is geometry with no series, no network and no pandas in it, so it can be
tested on its own and reused by tools/probe_huc_points.py without dragging
the whole data stack along.

Boundaries come from the file the drawn scope names, written by
tools/fetch_watershed_scope.py from the USGS Watershed Boundary Dataset and
committed. Committed rather than fetched at refresh time for the same reason
as capacities.json: an assignment that can change underneath you is not
reproducible, and a reservoir that silently moves basin between two runs is
the kind of error nobody would catch by looking.

Which file that is comes from `watershed_scopes.DEFAULT_SCOPE` rather than
being written here. It was `huc6.geojson` for as long as there was only one
answer; publishing the west made it a second copy of a product decision, and
the failure mode of a second copy is that the pipeline assigns reservoirs
with one geography while every surface draws another.
"""

import json
import math
from pathlib import Path

import watershed_scopes

BOUNDARY_PATH = (watershed_scopes.ROOT
                 / watershed_scopes.get_scope(watershed_scopes.DEFAULT_SCOPE).output)
UTAH_BOUNDARY_PATH = Path(__file__).resolve().parent / "utah-boundary.geojson"

# A provider point sits in exactly one state; a waterbody need not. These were
# reviewed against the official USGS NHDPlus HR NHDWaterbody layer, and the
# permanent identifiers make the evidence reproducible without adding a remote
# geometry dependency to the daily refresh. See ADR-013 and ADR-060.
# Source: https://hydro.nationalmap.gov/arcgis/rest/services/NHDPlus_HR/MapServer/9
#
# The value is *every* state the waterbody touches, including the one holding
# the provider point, so an entry describes the waterbody rather than a
# correction to somewhere else. Bear Lake's point is in Idaho and Meeks
# Cabin's in Wyoming; both reach into Utah, which is why they are here.
#
# Absence means "the waterbody is in the state its point is in", which is true
# of every reservoir nobody has had reason to review. That is a default, not a
# finding, and `waterbody_states` says so by returning the point's state alone.
# Lake Powell carries different evidence, and it is this project's own: its
# reviewed dam point is in Coconino County, Arizona and its published
# waterbody point in San Juan County, Utah (ADR-057, ADR-058), so the water
# between them crosses the line and no external lookup is needed to say so.
# Measured across every reservoir holding both points, it is the only one --
# which is why the Utah-only table never needed it: that table existed to add
# Utah to waterbodies whose *point* was elsewhere, and Powell's point is
# already in Utah. Generalising the question exposed the gap.
#
# Keyed by the station id the roster is keyed by -- a RISE item id or an AWDB
# station triplet, exactly as `RESERVOIRS` and `AWDB_RESERVOIRS` in
# refresh_reservoirs.py are (ADR-066). A review is a fact about one reservoir,
# and a name can be shared by two: the west holds a Lost Creek in Utah and
# another in Oregon. The name stays in the value for the human reader.
CROSS_BORDER_WATERBODIES = {
    "10055500:ID:BOR": {"name": "Bear Lake", "states": ("ID", "UT"),
                        "nhd_permanent_id": "120026431"},
    "509": {"name": "Lake Powell", "states": ("AZ", "UT"),
            "evidence": "dam point in Arizona, waterbody point in Utah"},
    # Measured against the NHD polygon: 66.7% Nevada, 33.2% Arizona. RISE's
    # own five monitoring points on the lake are all in Clark County, Nevada,
    # so the provider's evidence alone would have defaulted this to Nevada and
    # been a third wrong.
    "6124": {"name": "Lake Mead", "states": ("AZ", "NV"),
             "nhd_permanent_id": "122648503"},
    "574": {"name": "Meeks Cabin", "states": ("UT", "WY"),
            "nhd_permanent_id": "120025290"},
}

def coarser_roster(codes, level: int) -> list[dict]:
    """The areas at `level` that a set of finer codes belongs to, named.

    The codes need nothing published: they are the first `level` digits of a
    code every record already carries, because HUC codes are fixed-width
    (ADR-050). The *names* have to come from somewhere, and this is ADR-048's
    rule -- the roster, not the polygons -- applied one level up.

    Read from the committed scope file for that level, which covers every area
    any scope here can reach. Absent, the names are empty and a caller labels
    by code: a filter that says "1401" is worse than one that says "Colorado
    Headwaters" and much better than no filter at all.

    Published in each surface's own payload rather than in `reference.json`,
    because every surface fetches its payload and only the maps fetch the
    reference -- and one copy of a roster is the point of having a roster.

    Lives here rather than in either refresh script because both of them
    publish it: the storage payload names the coarser areas its reservoirs
    fall in, and the snow payload names the ones its sites do (ADR-064).

    Written for one level and now taking it as an argument (ADR-073). Every
    offered level below the payload's own needs this, and a second near-copy
    of it for regions would be a second place for the fallback, the warning
    and the sort to drift.
    """
    import watershed_scopes

    scope_name = watershed_scopes.DRAWN_SCOPES.get(level)
    if scope_name is None:
        raise ValueError(
            f"no drawn scope at hydrologic level {level}; "
            f"choose {', '.join(str(k) for k in sorted(watershed_scopes.DRAWN_SCOPES))}")
    field = watershed_scopes.huc_field(level)
    names: dict[str, str] = {}
    path = watershed_scopes.ROOT / watershed_scopes.get_scope(scope_name).output
    if path.exists():
        payload = json.loads(path.read_text(encoding="utf-8"))
        for feature in payload.get("features") or []:
            code = feature["properties"].get(field)
            if code:
                names[code] = feature["properties"].get("name", "")
    else:
        print(f"WARNING: {path.name} is absent; publishing {field} codes "
              "without names")
    return [{field: code, "name": names.get(code, "")}
            for code in sorted({str(c)[:level] for c in codes if c})]


def subregion_roster(codes) -> list[dict]:
    """The HUC-4 subregions a set of finer codes belongs to, named."""
    return coarser_roster(codes, 4)


def region_roster(codes) -> list[dict]:
    """The HUC-2 regions a set of finer codes belongs to, named."""
    return coarser_roster(codes, 2)


def _load_utah_polygons(path: Path = UTAH_BOUNDARY_PATH):
    """Read the committed UGRC polygon in the same normalized shape as WBD."""
    payload = json.loads(path.read_text(encoding="utf-8"))
    geometry = payload["features"][0]["geometry"]
    if geometry["type"] == "Polygon":
        return [geometry["coordinates"]]
    if geometry["type"] == "MultiPolygon":
        return geometry["coordinates"]
    raise ValueError(f"Unsupported Utah boundary geometry: {geometry['type']}")


UTAH_POLYGONS = _load_utah_polygons()
# Compatibility for callers that need the principal outline. Classification
# uses every polygon and its holes below.
UTAH_RING = UTAH_POLYGONS[0][0]

Point = tuple[float, float]

#: How far inside its drainage area an assignment point has to sit.
#:
#: The committed boundaries are generalized, so a point nearer the divide than
#: the generalization can resolve is not assigned to a basin -- it is assigned
#: to whichever side the simplification happened to leave it on.
#:
#: ADR-013 assigns from the dam because that is where the stored water leaves.
#: The rule assumes the dam is *inside* the basin, and for a dam that defines
#: the basin's own outlet it is degenerate: Hoover Dam is 0.00 km from the
#: 150100 divide, because 150100 ends at Hoover Dam. Measured across every
#: committed dam point, the next closest is Lost Lake at 2.73 km, so this
#: threshold separates the degenerate case from the real ones with room on
#: both sides. `tests/test_huc.py` holds the same 2 km against the roster.
MIN_ASSIGNMENT_MARGIN_KM = 2.0


def in_ring(point: Point, ring) -> bool:
    """Ray casting, counting a crossing on the half-open edge [y0, y1).

    The same algorithm as `inRing` in src/data/huc.ts, kept in step by a
    shared set of fixtures in the two test suites. A point exactly on the
    boundary is not specified either way and is not worth defining: dam
    points do not land on watershed boundaries, and pretending otherwise
    would invent a rule nothing tests.
    """
    x, y = point
    inside = False
    for i in range(len(ring)):
        xi, yi = ring[i][0], ring[i][1]
        xj, yj = ring[i - 1][0], ring[i - 1][1]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
            inside = not inside
    return inside


def in_polygon(point: Point, rings) -> bool:
    """Inside the outer ring and inside none of its holes."""
    if not rings or not in_ring(point, rings[0]):
        return False
    return not any(in_ring(point, hole) for hole in rings[1:])


def in_utah(point: Point) -> bool:
    return any(in_polygon(point, polygon) for polygon in UTAH_POLYGONS)


def waterbody_states(station: str | None, point_state: str | None) -> list[str]:
    """Every state this reservoir's water touches.

    Looked up by the station id the roster is keyed by (ADR-066): a review is
    a fact about one reservoir, and a name can be shared by two. The reviewed
    answer where there is one, and the point's own state otherwise. Sorted so
    two records carrying the same states compare equal however the table was
    written.

    A reservoir whose point falls in no state at all -- which the mask can
    produce for a waterbody just off a generalized outline -- returns the
    reviewed list if it has one and an empty list if it does not, rather than
    inventing a state to be in.
    """
    reviewed = CROSS_BORDER_WATERBODIES.get(station)
    if reviewed:
        return sorted(reviewed["states"])
    return [point_state] if point_state else []


def waterbody_intersects_utah(station: str | None, point: Point) -> bool:
    """Whether the reservoir surface intersects Utah.

    A point inside Utah proves intersection. A point outside the state needs
    a reviewed polygon; the current exceptions are versioned above, by
    station id (ADR-066).
    """
    reviewed = CROSS_BORDER_WATERBODIES.get(station)
    return in_utah(point) or bool(reviewed and "UT" in reviewed["states"])


def location_fields(station: str | None, lat: float, lon: float) -> dict:
    """Stable location facts that do not depend on watershed boundaries."""
    site = (lon, lat)
    return {
        "in_utah": in_utah(site),
        "intersects_utah": waterbody_intersects_utah(station, site),
    }


def _bounds(polygons) -> tuple[float, float, float, float]:
    """West, south, east, north for every ring of every part."""
    west = south = float("inf")
    east = north = float("-inf")
    for polygon in polygons:
        for ring in polygon:
            for lon, lat in ring:
                if lon < west:
                    west = lon
                if lon > east:
                    east = lon
                if lat < south:
                    south = lat
                if lat > north:
                    north = lat
    return west, south, east, north


#: Decimal places a published drainage-area bounding box is rounded to.
#:
#: The source geometry is committed at five (`GEOMETRY_PRECISION` in
#: `tools/fetch_watershed_scope.py`), and a box does not need that much: it
#: only has to say roughly where a map should open, not trace a ring, and
#: every extra decimal is bytes every map page fetches on 75+44+14+10+5
#: units. Three is about 111 metres at the equator -- the same 0.001-degree
#: margin `extent.test.ts` already allows a freshly measured box to differ
#: from the frozen module's `HUC6_BOUNDS` by.
PUBLISHED_BBOX_DECIMALS = 3


def outer_bbox(
    bounds: tuple[float, float, float, float],
    decimals: int = PUBLISHED_BBOX_DECIMALS
) -> list[float]:
    """``[west, south, east, north]``, coarsened so the box still contains
    the rings ``bounds`` was measured from.

    The two edges cannot round the same way. Rounding the minimum up or the
    maximum down moves that edge *inward* -- toward the middle of the box --
    which is exactly the direction that clips the polygon the box is
    published to describe. So the minima floor and the maxima ceil: rounding
    outward rather than to the nearest value is what keeps a coarsened box a
    superset of the exact one ``_bounds`` measured, not an approximation of
    it that happens to be close.
    """
    west, south, east, north = bounds
    scale = 10 ** decimals
    return [
        math.floor(west * scale) / scale,
        math.floor(south * scale) / scale,
        math.ceil(east * scale) / scale,
        math.ceil(north * scale) / scale,
    ]


def unit_code(properties: dict) -> str:
    """The unit's code, whatever size the collection is.

    Hydrologic codes are fixed width, so the level is the digit count and the
    attribute is named after it -- `huc6` in a six-digit collection, `huc8`
    in an eight. Reading a fixed `huc6` raised a KeyError against the western
    HUC-8 file, which is the polite version of this mistake; the client
    version of it parsed the payload as no areas at all and drew a blank map
    (ADR-050).
    """
    for level in (2, 4, 6, 8, 10, 12):
        code = properties.get(f"huc{level}")
        if isinstance(code, str):
            return code
    raise KeyError(
        "feature carries no huc code; expected one of "
        + ", ".join(f"huc{level}" for level in (2, 4, 6, 8, 10, 12)))


def units_from_collection(payload: dict) -> list[dict]:
    """Normalize a GeoJSON feature collection to the assignment shape.

    Most callers use :func:`load_units` with a committed file. Research tools
    also need to classify divide-adjacent points against an un-generalized
    federal response without writing that much larger geometry to the
    repository first.

    Each unit carries its bounding box, computed once here. See
    :func:`assign_huc` for why.
    """
    units = []
    for feature in payload["features"]:
        geometry = feature["geometry"]
        coordinates = geometry["coordinates"]
        polygons = (coordinates if geometry["type"] == "MultiPolygon"
                    else [coordinates])
        units.append({
            "huc6": unit_code(feature["properties"]),
            "name": feature["properties"]["name"],
            "states": feature["properties"].get("states", ""),
            "polygons": polygons,
            "bounds": _bounds(polygons),
        })
    return sorted(units, key=lambda unit: unit["huc6"])


def load_units(path: Path | None = None) -> list[dict]:
    """The committed hydrologic units, normalized to one polygon list each."""
    payload = json.loads((path or BOUNDARY_PATH).read_text())
    return units_from_collection(payload)


def assign_huc(point: Point, units) -> dict | None:
    """The unit containing this point, or None.

    First hit wins. Hydrologic units tile the country without overlapping, so
    a point inside two of them means the boundary data is wrong; picking the
    first is no worse than any other arbitrary choice, and
    tests/test_huc.py asserts the situation does not arise.

    The bounding-box test in front of the ring scan is what makes this
    affordable at western scale. Ray casting walks every vertex of every ring
    it is given: measured at 44 ms a point on the pre-scoping western HUC-8
    file (1,247 units, 815,761 vertices; the drainage-scoped file committed
    since is 571 units and roughly half the vertices), which is half a minute
    for a 690-reservoir roster and over a minute for the snow network. A box
    comparison rejects almost all of them in four float comparisons, and the
    answer is identical -- a point outside the box cannot be inside the
    polygon.

    `bounds` is optional so that a unit built by hand, in a test or an older
    caller, still works; it is simply slower.
    """
    lon, lat = point
    for unit in units:
        bounds = unit.get("bounds")
        if bounds is not None:
            west, south, east, north = bounds
            if lon < west or lon > east or lat < south or lat > north:
                continue
        if any(in_polygon(point, polygon) for polygon in unit["polygons"]):
            return unit
    return None


def distance_to_boundary_km(point: Point, unit: dict) -> float:
    """Shortest distance from the point to any edge of the unit.

    This is the number that says how much boundary precision the assignment
    needs. A reservoir 200 m from a boundary could be moved into the next
    unit by a generalized polygon or a slightly different dam coordinate; one
    20 km inside cannot. Measured across the 53 reservoirs published at the
    time of the boundary study, the closest is 2.72 km, which is what
    justifies the 500 m generalization in
    tools/fetch_watershed_scope.py.

    Computed on a local equirectangular projection about the point. Over the
    few kilometres that matter the error is far below the thing being
    measured, and it avoids a geodesic dependency in a module that is
    deliberately standard library only.
    """
    lon, lat = point
    scale = math.cos(math.radians(lat))
    km_per_degree = 111.32

    best = float("inf")
    for polygon in unit["polygons"]:
        for ring in polygon:
            local = [((vertex[0] - lon) * scale * km_per_degree,
                      (vertex[1] - lat) * km_per_degree) for vertex in ring]
            for i in range(len(local) - 1):
                (x1, y1), (x2, y2) = local[i], local[i + 1]
                dx, dy = x2 - x1, y2 - y1
                length_squared = dx * dx + dy * dy
                if length_squared == 0:
                    best = min(best, math.hypot(x1, y1))
                    continue
                # Projection of the origin onto the segment, clamped to it.
                t = max(0.0, min(1.0, -(x1 * dx + y1 * dy) / length_squared))
                best = min(best, math.hypot(x1 + t * dx, y1 + t * dy))
    return best


def haversine_km(a: Point, b: Point) -> float:
    lon1, lat1, lon2, lat2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = (math.sin((lat2 - lat1) / 2) ** 2
         + math.cos(lat1) * math.cos(lat2) * math.sin((lon2 - lon1) / 2) ** 2)
    return 2 * 6371.0088 * math.asin(math.sqrt(h))


def describe(lat: float, lon: float, units, *, station: str | None,
             assignment_point: Point | None = None,
             source: str = "published_point") -> dict:
    """The watershed fields for one reservoir record.

    `station` is the id the roster keys the reservoir by (ADR-066); it is
    what the cross-border waterbody review is looked up with.

    Two points, and they must not be collapsed into one:

    - The **reservoir's** point decides `in_utah`. That preserves the provider
      point-location fact.
    - The reservoir point plus reviewed waterbody polygons decide
      `intersects_utah`. That owns the default Utah scope.
    - The **assignment** point decides the drainage area. That asks where the
      stored water leaves, which is the dam or outlet.

    They were the same in the original assignment study and will not stay
    that way. Glen Canyon Dam is in Arizona while Lake Powell reaches well
    into Utah, so the moment the dam points land, computing `in_utah` from the
    assignment point would drop the single largest reservoir on this
    dashboard out of its own default view.

    `source` records what kind of point produced the assignment, because the
    answer is going to improve. The published coordinates are lake points, a
    median of 1.08 km from the dam. Across the 53 reservoirs published when
    that study was run, using the dam point instead moved none of them, so the
    upgrade was a correctness improvement rather than a correction -- but a
    reader should still be able to tell which one produced a given row.
    """
    site = (lon, lat)
    point = tuple(assignment_point) if assignment_point else site
    unit = assign_huc(point, units)
    # A dam sitting on the divide it defines cannot say which side it is on.
    # Fall back to the waterbody, which is unambiguously upstream of it, and
    # record that the fallback happened rather than quietly taking it.
    if (unit is not None and assignment_point is not None
            and distance_to_boundary_km(point, unit) < MIN_ASSIGNMENT_MARGIN_KM):
        from_site = assign_huc(site, units)
        if (from_site is not None
                and distance_to_boundary_km(site, from_site) >= MIN_ASSIGNMENT_MARGIN_KM):
            point, unit = site, from_site
            source = "published_point_dam_on_divide"
    return {
        **location_fields(station, lat, lon),
        "huc6": unit["huc6"] if unit else None,
        "huc6_name": unit["name"] if unit else None,
        # Every state the drainage area reaches, which is a different question
        # from where the reservoir is (ADR-060). Lake Powell sits in Utah and
        # its water arrives from Wyoming and Colorado; a reader asking "what
        # does Colorado feed" wants this list, and one asking "what is in
        # Colorado" wants the state above. The drainage file already carries
        # it, so this costs a split rather than a lookup.
        "connected_states": sorted(
            s for s in (unit.get("states") or "").split(",") if s) if unit else [],
        "huc_assignment_point": [round(point[0], 5), round(point[1], 5)],
        "huc_assignment_source": source if unit else None,
    }
