"""Named HUC6 extraction scopes used by watershed data tools.

The production dashboard scope remains the Colorado/Great Basin units that
touch Utah. Broader research scopes write separate files and never replace
``huc6.geojson`` unless a later product decision changes the dashboard's
published geography.
"""

from dataclasses import dataclass
from pathlib import Path


ROOT = Path(__file__).resolve().parent


@dataclass(frozen=True)
class WatershedScope:
    name: str
    description: str
    where: str
    output: str
    region: str | None = None
    expected_count: int | None = None


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


def validate_huc6_codes(codes, region: str | None = None) -> list[str]:
    """Return sorted HUC6 codes after strict schema and scope validation."""
    values = list(codes)
    if any(not isinstance(code, str) or len(code) != 6 or not code.isdigit()
           for code in values):
        raise ValueError("HUC6 codes must be six-digit strings")
    if len(values) != len(set(values)):
        raise ValueError("duplicate HUC6 code returned")
    if region and any(not code.startswith(region) for code in values):
        wrong = sorted(code for code in values if not code.startswith(region))
        raise ValueError(f"HUC6 codes outside region {region}: {', '.join(wrong)}")
    return sorted(values)


def load_scope_units(name: str, *, root: Path = ROOT) -> list[dict]:
    """Load the committed boundaries configured for one named scope."""
    from huc import load_units

    scope = get_scope(name)
    path = root / scope.output
    if not path.exists():
        raise FileNotFoundError(
            f"watershed scope {name!r} has not been generated: {path}")
    units = load_units(path)
    codes = validate_huc6_codes((unit["huc6"] for unit in units), scope.region)
    if scope.expected_count is not None and len(codes) != scope.expected_count:
        raise ValueError(
            f"expected {scope.expected_count} units for {name}, received {len(codes)}")
    return units
