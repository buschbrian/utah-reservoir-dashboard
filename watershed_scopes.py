"""Named watershed extraction scopes used by the data tools.

The production dashboard scope remains the Colorado/Great Basin units that
touch Utah. Broader research scopes write separate files and never replace
``huc6.geojson`` unless a later product decision changes the dashboard's
published geography.

A scope now carries the hydrologic level it is expressed at. Every scope here
is still HUC-6, which is what the dashboard draws, but the level is a property
of the scope rather than an assumption of the code -- so a HUC-4 or HUC-8
scope is a new entry in this table rather than an edit to every caller.

Levels above 8 are deliberately absent, and that is a measurement rather than
an omission: the drought coverage engine samples on a fixed grid, and the
share it computes for one unit is only as good as the number of cells inside
it. A HUC-6 gets about 33,000 cells and lands within 0.03 points of geodesic
truth; a HUC-8 about 4,800 and roughly 0.08; a HUC-10 about 640 and roughly
0.21, which is twice the precision the site publishes. `compute_drought_coverage`
refuses outright below one grid cell. Finer levels need an exact-geometry area
engine first.
"""

from dataclasses import dataclass
from pathlib import Path


ROOT = Path(__file__).resolve().parent


#: Hydrologic levels this project can express a scope at, mapped to the layer
#: that serves them on the USGS Watershed Boundary Dataset service. The layer
#: ids are the service's own; the field name each layer publishes its code in
#: follows the same pattern (``huc4``, ``huc6``, ``huc8``).
WBD_LAYER_BY_LEVEL = {2: 1, 4: 2, 6: 3, 8: 4}


def huc_field(level: int) -> str:
    """The attribute a WBD layer publishes its unit code in."""
    return f"huc{level}"


@dataclass(frozen=True)
class WatershedScope:
    name: str
    description: str
    where: str
    output: str
    #: Hydrologic level the scope's codes are expressed at.
    level: int = 6
    region: str | None = None
    #: The exact number of units this scope must return.
    #:
    #: Kept exact where the answer is knowable and stable, because it is the
    #: strongest guard the pipeline has: a service that quietly starts
    #: returning thirteen units for a fourteen-unit scope is a silent change
    #: of published geography, and `load_scope_units` raises rather than
    #: letting it through.
    expected_count: int | None = None
    #: Whether the reference export carries this scope's boundaries.
    #:
    #: A scope can be registered before it has ever been fetched -- that is
    #: how a new geography gets measured and reviewed before anything draws
    #: it. Only a scope marked for publication has to exist on disk, and for
    #: those a missing or short file still raises rather than exporting
    #: quietly.
    published: bool = True
    #: For scopes too large to pin exactly. A plausibility band, not a
    #: measurement -- the count of HUC units in a region does change as the
    #: WBD is revised, and a scope covering nine regions should not fail the
    #: daily run because one subbasin was split upstream.
    expected_range: tuple[int, int] | None = None


#: The region filter shared by every western scope, as an ArcGIS `where`.
#:
#: Regions 14 through 18: Upper Colorado, Lower Colorado, Great Basin,
#: Pacific Northwest and California. That is the water this dashboard is
#: about -- everything that reaches the Pacific, including the Colorado
#: through the Gulf of California, plus the Great Basin, which reaches
#: nothing at all.
#:
#: Regions 10 through 13 are deliberately outside it. Missouri and
#: Arkansas-White-Red drain to the Gulf of Mexico through the Mississippi,
#: Texas-Gulf drains to it directly, and the Rio Grande reaches it at
#: Brownsville. They are western in longitude and eastern in hydrology, and
#: a site about western water supply has nothing to say about them: 106 of
#: the 181 HUC6 basins in regions 10-18 are theirs, so including them more
#: than doubles the scope with water that leaves the region.
#:
#: The one genuine argument for an exception is HUC4 **1305, "Rio Grande
#: Closed Basins"** (New Mexico and Texas) -- Basin and Range country whose
#: water reaches no ocean, filed under a region that does. It is left out
#: because it is administered as part of the Rio Grande system, and because
#: one closed basin inside an excluded region is a footnote rather than a
#: rule. If it is ever wanted, it is one added clause here and nothing else.
#:
#: A string comparison on the leading two digits rather than five `LIKE`
#: clauses: the codes are fixed-width and zero-padded, so '14' <= region <=
#: '18' is exactly the set, and it reads as the range it is.
WEST_REGION_WHERE = (
    "SUBSTRING({field}, 1, 2) >= '14' AND SUBSTRING({field}, 1, 2) <= '18'")


SCOPES = {
    "utah-connected": WatershedScope(
        name="utah-connected",
        description="Colorado River and Great Basin HUC6 units that touch Utah",
        where="states LIKE '%UT%' AND huc6 NOT LIKE '17%'",
        output="huc6.geojson",
        expected_count=14,
    ),
    "upper-colorado": WatershedScope(
        name="upper-colorado",
        description="Every HUC6 unit in the Upper Colorado hydrologic region",
        where="huc6 LIKE '14%'",
        output="data/watersheds/upper-colorado-huc6.geojson",
        region="14",
        expected_count=10,
    ),
    # The western scopes. Not published by anything yet -- they exist so the
    # geography can be fetched, measured and reviewed before any surface
    # draws it, which is the same order the Utah scope was built in.
    #
    # Scoped by hydrologic region rather than by a list of states. That is the
    # generalisation of ADR-010, which already scopes by region, and it never
    # cuts a basin in half at a state line -- a basin is the unit every figure
    # on this site is keyed to, so a half basin is not a smaller answer, it is
    # a wrong one.
    #
    # Regions 14 through 18: Upper Colorado, Lower Colorado, Great Basin,
    # Pacific Northwest and California -- everything draining to the Pacific
    # plus the Great Basin, which drains nowhere. See WEST_REGION_WHERE for
    # why the Gulf of Mexico regions are not here. Region 19 is Alaska and is
    # not "the west" in any sense this dashboard means.
    "west-huc6": WatershedScope(
        name="west-huc6",
        description="Every HUC6 basin draining to the Pacific or closed inside the west",
        where=WEST_REGION_WHERE.format(field="huc6"),
        output="data/watersheds/west-huc6.geojson",
        published=False,
        # Measured 2026-08-18, after the scope narrowed to regions 14-18:
        # 75 basins (181 under the earlier longitude rule). Banded rather
        # than pinned because nine regions of the WBD are revised more often
        # than one, and a split subbasin upstream must not stop a run.
        expected_range=(70, 85),
    ),
    "west-huc4": WatershedScope(
        name="west-huc4",
        description="Every HUC4 subregion draining to the Pacific or closed inside the west",
        where=WEST_REGION_WHERE.format(field="huc4"),
        output="data/watersheds/west-huc4.geojson",
        published=False,
        level=4,
        # Measured 2026-08-18, regions 14-18: 44 subregions.
        expected_range=(40, 50),
    ),
    "west-huc8": WatershedScope(
        name="west-huc8",
        description="Every HUC8 subbasin draining to the Pacific or closed inside the west",
        where=WEST_REGION_WHERE.format(field="huc8"),
        output="data/watersheds/west-huc8.geojson",
        published=False,
        level=8,
        # Measured 2026-08-18, regions 14-18: 571 subbasins. This is the
        # finest level the drought engine holds its published precision at;
        # see the module docstring.
        expected_range=(540, 610),
    ),
}


# The scope whose boundaries the published dashboard draws. Named here rather
# than repeated at each call site: which geography is the accepted one is a
# product decision (ADR-009), and a second copy of that decision is a second
# thing to forget when it changes.
DEFAULT_SCOPE = "utah-connected"


def get_scope(name: str) -> WatershedScope:
    try:
        return SCOPES[name]
    except KeyError as exc:
        choices = ", ".join(sorted(SCOPES))
        raise KeyError(f"unknown watershed scope {name!r}; choose {choices}") from exc


def validate_huc_codes(codes, level: int = 6, region: str | None = None) -> list[str]:
    """Return sorted HUC codes after strict schema and scope validation.

    The length check follows the level rather than assuming six. A HUC code is
    fixed-width and zero-padded by construction, so the digit count *is* the
    level, and a six-digit code arriving in a HUC-8 scope is a mixed-level
    payload rather than a short one -- which is worth failing on, because
    every downstream join is by code.
    """
    if level not in WBD_LAYER_BY_LEVEL:
        raise ValueError(
            f"unsupported hydrologic level {level}; "
            f"choose {', '.join(str(key) for key in sorted(WBD_LAYER_BY_LEVEL))}")
    values = list(codes)
    if any(not isinstance(code, str) or len(code) != level or not code.isdigit()
           for code in values):
        raise ValueError(f"HUC{level} codes must be {level}-digit strings")
    if len(values) != len(set(values)):
        raise ValueError(f"duplicate HUC{level} code returned")
    if region and any(not code.startswith(region) for code in values):
        wrong = sorted(code for code in values if not code.startswith(region))
        raise ValueError(f"HUC{level} codes outside region {region}: {', '.join(wrong)}")
    return sorted(values)


def validate_huc6_codes(codes, region: str | None = None) -> list[str]:
    """The six-digit case, kept so existing callers read unchanged."""
    return validate_huc_codes(codes, 6, region)


def load_scope_units(name: str, *, root: Path = ROOT) -> list[dict]:
    """Load the committed boundaries configured for one named scope."""
    from huc import load_units

    scope = get_scope(name)
    path = root / scope.output
    if not path.exists():
        raise FileNotFoundError(
            f"watershed scope {name!r} has not been generated: {path}")
    units = load_units(path)
    # `huc.load_units` normalizes whatever the collection calls its code --
    # `huc4`, `huc6`, `huc8` -- into one key, so the level decides what the
    # codes must look like rather than where to find them.
    codes = validate_huc_codes(
        (unit["huc6"] for unit in units), scope.level, scope.region)
    if scope.expected_count is not None and len(codes) != scope.expected_count:
        raise ValueError(
            f"expected {scope.expected_count} units for {name}, received {len(codes)}")
    if scope.expected_range is not None:
        low, high = scope.expected_range
        if not low <= len(codes) <= high:
            raise ValueError(
                f"expected {low}-{high} units for {name}, received {len(codes)}")
    return units
