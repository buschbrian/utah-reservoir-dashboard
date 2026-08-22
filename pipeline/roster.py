"""Which reservoirs this project publishes, and what it divides them by.

The committed admission files, the capacity evidence each entry has to carry,
and the station-keyed tables the refresh iterates. Keyed by the provider's own
identifier throughout (ADR-066): a name is a label, not an identity, and the
west holds two Lost Creeks 946 km apart.

Procedure for changing any of this: docs/operations/source-admission.md.
"""

import json
from pathlib import Path

from .constants import (
    ADMITTED_CDEC_RESERVOIRS_PATH, ADMITTED_CDSS_RESERVOIRS_PATH,
    ADMITTED_RESERVOIRS_PATH, ADMITTED_RISE_RESERVOIRS_PATH,
    ADMITTED_USGS_RESERVOIRS_PATH, BASE_AWDB_RESERVOIRS,
    BASE_RISE_RESERVOIRS, CAPACITY_PATH,
)


REQUIRED_CAPACITY_EVIDENCE = {
    "capacity_af", "capacity_basis", "nid_id", "nid_dam_name",
    "dam_lon", "dam_lat", "match_distance_km", "match_confirmed_by",
}


def validate_capacity_evidence(name: str, capacity: object) -> None:
    if not isinstance(capacity, dict) or not REQUIRED_CAPACITY_EVIDENCE <= capacity.keys():
        raise ValueError(f"{name}: incomplete capacity evidence")
    if not isinstance(capacity.get("capacity_af"), (int, float)) \
            or capacity["capacity_af"] <= 0:
        raise ValueError(f"{name}: capacity must be positive")
    if capacity.get("capacity_basis") == "reclamation_project_record":
        if not isinstance(capacity.get("capacity_source_url"), str) \
                or not capacity["capacity_source_url"].startswith("https://www.usbr.gov/"):
            raise ValueError(
                f"{name}: a Reclamation project capacity needs its owner-operated source")
    # The same rule for the third provider's own figure (ADR-070). A
    # denominator preferred over the inventory has to name where it was read,
    # whichever operator published it -- otherwise "the operator says so" is
    # an assertion in a commit message rather than a citation in the file.
    if capacity.get("capacity_basis") == "cdec_reservoir_report":
        if not isinstance(capacity.get("capacity_source_url"), str) \
                or not capacity["capacity_source_url"].startswith(
                    "https://cdec.water.ca.gov/"):
            raise ValueError(
                f"{name}: a service-published capacity needs its owner-operated source")


def load_admitted_rise_reservoirs(
    path: Path = ADMITTED_RISE_RESERVOIRS_PATH,
) -> dict[str, dict]:
    """Load reviewed Reclamation storage items admitted by R2.

    The original 30 items stay in source because they predate the reviewed
    admission file. R2's western additions keep the provider item, point,
    matched dam and denominator in one committed record, the same shape R1
    established for the admitted AWDB stations.
    """
    document = json.loads(path.read_text(encoding="utf-8"))
    rows = document.get("reservoirs")
    if not isinstance(rows, dict) or not rows:
        raise ValueError(f"{path.name} must contain a non-empty reservoirs object")
    for item_id, row in rows.items():
        if not isinstance(item_id, str) or not item_id.isdigit() or not isinstance(row, dict):
            raise ValueError(f"invalid reservoir entry in {path.name}")
        name = row.get("name")
        if not isinstance(name, str) or not name:
            raise ValueError(f"{item_id}: a reservoir needs a name to be called by")
        if str(row.get("rise_item_id")) != item_id:
            raise ValueError(
                f"{item_id}: keyed by one item and configured for {row.get('rise_item_id')!r}")
        if row.get("cadence") != "daily":
            raise ValueError(f"{name}: Reclamation storage items must be daily")
        if not isinstance(row.get("lat"), (int, float)) or not isinstance(
                row.get("lon"), (int, float)):
            raise ValueError(f"{name}: coordinates are required")
        validate_capacity_evidence(name, row.get("capacity"))
    return rows


ADMITTED_RISE_RESERVOIRS = load_admitted_rise_reservoirs()
RESERVOIRS = {
    **BASE_RISE_RESERVOIRS,
    **{
        item_id: (row["name"], row["lat"], row["lon"])
        for item_id, row in ADMITTED_RISE_RESERVOIRS.items()
    },
}


def load_admitted_reservoirs(path: Path = ADMITTED_RESERVOIRS_PATH) -> dict[str, dict]:
    """Load the reviewed AWDB stations admitted onto the roster.

    Candidate discovery remains live and read-only. Publication is a separate,
    reviewable decision, so the selected station, update frequency and capacity
    evidence are committed together instead of being copied into Python tuples.
    """
    document = json.loads(path.read_text(encoding="utf-8"))
    rows = document.get("reservoirs")
    if not isinstance(rows, dict) or not rows:
        raise ValueError(f"{path.name} must contain a non-empty reservoirs object")

    for station, row in rows.items():
        if not isinstance(station, str) or not station or not isinstance(row, dict):
            raise ValueError(f"invalid reservoir entry in {path.name}")
        name = row.get("name")
        if not isinstance(name, str) or not name:
            raise ValueError(f"{station}: a reservoir needs a name to be called by")
        # Keyed by the station and carrying the name, since ADR-066. The key
        # has to agree with the field, or the roster is indexed by one station
        # and fetched from another.
        if row.get("station_triplet") != station:
            raise ValueError(
                f"{station}: keyed by one station and configured for "
                f"{row.get('station_triplet')!r}")
        if station.count(":") != 2:
            raise ValueError(f"{name}: invalid station triplet")
        if row.get("cadence") not in {"daily", "monthly"}:
            raise ValueError(f"{name}: cadence must be daily or monthly")
        if not isinstance(row.get("lat"), (int, float)) or not isinstance(
                row.get("lon"), (int, float)):
            raise ValueError(f"{name}: coordinates are required")
        validate_capacity_evidence(name, row.get("capacity"))
    return rows


def load_admitted_cdec_reservoirs(
    path: Path = ADMITTED_CDEC_RESERVOIRS_PATH,
) -> dict[str, dict]:
    """Load the reviewed California Data Exchange Center stations.

    The third provider, and the same shape the other two admitted files
    already have: the station this project fetches with, the point, the
    matched dam and the denominator, committed together so publication stays
    a reviewable decision rather than a tuple somebody edited.

    Two things this file carries that the others do not. `review` is on the
    entries a person admitted *against* a screen -- a flood-control dam that
    has never been a third full is a real reservoir whose percentage is true
    and useless, and the file says which screen was waived and why. And
    `withheld` names the candidates that stayed out with the finding behind
    each, so the next reader meets the work rather than repeating it.
    """
    document = json.loads(path.read_text(encoding="utf-8"))
    rows = document.get("reservoirs")
    if not isinstance(rows, dict) or not rows:
        raise ValueError(f"{path.name} must contain a non-empty reservoirs object")
    for station, row in rows.items():
        if not isinstance(station, str) or not station or not isinstance(row, dict):
            raise ValueError(f"invalid reservoir entry in {path.name}")
        name = row.get("name")
        if not isinstance(name, str) or not name:
            raise ValueError(f"{station}: a reservoir needs a name to be called by")
        # Keyed by the station and carrying it too, as both other rosters are
        # (ADR-066): a roster indexed by one station and fetched from another
        # publishes one reservoir's water under another's name.
        if row.get("station") != station:
            raise ValueError(
                f"{station}: keyed by one station and configured for "
                f"{row.get('station')!r}")
        if row.get("cadence") not in {"daily", "monthly"}:
            raise ValueError(f"{name}: cadence must be daily or monthly")
        if not isinstance(row.get("lat"), (int, float)) or not isinstance(
                row.get("lon"), (int, float)):
            raise ValueError(f"{name}: coordinates are required")
        review = row.get("review")
        if review is not None:
            # A waiver with no reason is a screen turned off. Both halves are
            # required, and the file is where a reviewer reads them.
            if not isinstance(review, dict) or not review.get("waived") \
                    or not isinstance(review.get("why"), str) or not review["why"]:
                raise ValueError(
                    f"{name}: a reviewed admission must name the screen it "
                    "was admitted against, and why")
        validate_capacity_evidence(name, row.get("capacity"))
    return rows


ADMITTED_CDEC_RESERVOIRS = load_admitted_cdec_reservoirs()
CDEC_RESERVOIRS = {
    station: (
        row["name"], row["lat"], row["lon"],
        row["capacity"]["capacity_af"], row["cadence"],
    )
    for station, row in ADMITTED_CDEC_RESERVOIRS.items()
}


def load_admitted_cdss_reservoirs(
    path: Path = ADMITTED_CDSS_RESERVOIRS_PATH,
) -> dict[str, dict]:
    """Load the reviewed Colorado Division of Water Resources stations.

    The fourth provider, held to the same shape and the same validations as
    the other three -- which is this file's loader applied unchanged, because
    the contract does not vary with the agency: the station fetched with, the
    point, the matched dam and the denominator, committed together.

    What differs is where the denominator comes from. This provider publishes
    no full level of its own, so every capacity here is the National
    Inventory of Dams' (`capacity_basis` `normal_storage` / `max_storage` /
    `nid_storage`), and ADR-070's preferred-figure rule never fires for it.
    """
    return load_admitted_cdec_reservoirs(path)


ADMITTED_CDSS_RESERVOIRS = load_admitted_cdss_reservoirs()
CDSS_RESERVOIRS = {
    abbrev: (
        row["name"], row["lat"], row["lon"],
        row["capacity"]["capacity_af"], row["cadence"],
    )
    for abbrev, row in ADMITTED_CDSS_RESERVOIRS.items()
}


def load_admitted_usgs_reservoirs(
    path: Path = ADMITTED_USGS_RESERVOIRS_PATH,
) -> dict[str, dict]:
    """Load the reviewed U.S. Geological Survey stations.

    The fifth provider, held to the same shape and the same validations as
    the others -- the California loader applied unchanged, because the
    contract does not vary with the agency (ADR-066, ADR-077's keying). As
    with Colorado, this provider publishes no full level of its own, so
    every capacity here is the National Inventory of Dams' and ADR-070's
    preferred-figure rule never fires for it.
    """
    return load_admitted_cdec_reservoirs(path)


ADMITTED_USGS_RESERVOIRS = load_admitted_usgs_reservoirs()
USGS_RESERVOIRS = {
    site_no: (
        row["name"], row["lat"], row["lon"],
        row["capacity"]["capacity_af"], row["cadence"],
    )
    for site_no, row in ADMITTED_USGS_RESERVOIRS.items()
}


ADMITTED_RESERVOIRS = load_admitted_reservoirs()
AWDB_RESERVOIRS = {
    **BASE_AWDB_RESERVOIRS,
    **{
        station: (
            row["name"], row["lat"], row["lon"],
            row["capacity"]["capacity_af"], row["cadence"],
        )
        for station, row in ADMITTED_RESERVOIRS.items()
    },
}

#: Every station this project fetches, by the identity it fetches it with.
#:
#: `ALL_RESERVOIR_NAMES` was this set of names until ADR-066. The names are
#: still what a reader sees and what `--only` accepts; they are simply no
#: longer what the roster is keyed by, because two reservoirs may share one.
ALL_RESERVOIR_IDS = (set(RESERVOIRS) | set(AWDB_RESERVOIRS)
                     | set(CDEC_RESERVOIRS) | set(CDSS_RESERVOIRS)
                     | set(USGS_RESERVOIRS))

#: What each station is called, by that same identity. One place builds it, so
#: a label and its station cannot come apart.
RESERVOIR_NAMES = {
    **{station: entry[0] for station, entry in RESERVOIRS.items()},
    **{station: entry[0] for station, entry in AWDB_RESERVOIRS.items()},
    **{station: entry[0] for station, entry in CDEC_RESERVOIRS.items()},
    **{station: entry[0] for station, entry in CDSS_RESERVOIRS.items()},
    **{station: entry[0] for station, entry in USGS_RESERVOIRS.items()},
}

ALL_RESERVOIR_NAMES = set(RESERVOIR_NAMES.values())

def load_capacities() -> dict[str, dict]:
    """Committed National Inventory of Dams capacity records by station id.

    By station and not by name since ADR-066: a capacity is a denominator, and
    handing one reservoir's denominator to another because they share a name
    is a wrong percentage that nothing fails on.

    The original Reclamation table is built by tools/build_capacity_table.py.
    Reviewed admitted-site evidence lives beside its station configuration
    in the two admitted-reservoir files. All are committed rather than
    fetched at refresh time because a denominator must not change silently.
    """
    capacities = {}
    try:
        if CAPACITY_PATH.exists():
            capacities = json.loads(CAPACITY_PATH.read_text()).get("capacities", {})
    except (ValueError, AttributeError):
        print(f"WARNING: {CAPACITY_PATH.name} is unreadable; "
              "its percent-full values will be omitted")
    return {
        **capacities,
        **{station: row["capacity"]
           for station, row in ADMITTED_RISE_RESERVOIRS.items()},
        **{station: row["capacity"] for station, row in ADMITTED_RESERVOIRS.items()},
        **{station: row["capacity"]
           for station, row in ADMITTED_CDEC_RESERVOIRS.items()},
        **{station: row["capacity"]
           for station, row in ADMITTED_CDSS_RESERVOIRS.items()},
    }
