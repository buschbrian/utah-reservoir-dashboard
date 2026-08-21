"""Where a reservoir is, and where its water goes.

Two different questions with two different answers, and the module exists to
keep them apart (ADR-058, ADR-060): a county is where a thing is, assigned
from the published waterbody point rather than from the dam, and a drainage
area is where its water goes, assigned from the dam or outlet point.

Glen Canyon Dam is in Coconino County, Arizona and Lake Powell is in San Juan
County, Utah. Both facts are true and this module publishes the second one.
"""

import json

import huc

from .constants import COUNTIES_PATH
from .roster import load_capacities


def dam_points() -> dict[str, tuple[float, float]]:
    """Dam coordinates by station id, from capacities.json.

    Written by tools/add_dam_points.py, queried from the National Inventory
    of Dams by the NID id the capacity already came from. These are the
    points the watershed assignment should use: a drainage area is where
    the stored water leaves, and for a reservoir that spans a divide the
    middle of the lake is not that place.
    """
    points = {}
    for station, entry in load_capacities().items():
        lon, lat = entry.get("dam_lon"), entry.get("dam_lat")
        if lon is not None and lat is not None:
            points[station] = (lon, lat)
    return points



def attach_counties(records: list[dict]) -> dict:
    """Add the committed county assignment to every record.

    Counties answer "where is this, administratively", which is how readers
    ask for a reservoir when they do not think in drainage areas. The axis is
    a filter and a search term, never a grouping: 68 reservoirs fall in 34
    counties and 19 of those hold one, so a county total is a reservoir total
    with a county's name on it.

    Committed rather than resolved each morning, like the capacities and for
    the same reason -- and read here rather than recomputed, so a reservoir
    cannot move county on a morning when nothing about it changed.

    Runs over carried-forward records too. A reservoir whose feed went quiet
    has not moved counties, and dropping it out of its county filter on the
    day it goes late is exactly when a reader looking for it would fail to
    find it.

    A missing or unreadable file is not fatal, matching `attach_watersheds`:
    losing the whole daily refresh over a county lookup would be much worse
    than shipping a day without one.
    """
    try:
        document = json.loads(COUNTIES_PATH.read_text(encoding="utf-8"))
        counties = document["counties"]
    except (OSError, ValueError, KeyError) as exc:
        print(f"WARNING: no county assignments ({type(exc).__name__}: {exc}); "
              "publishing without county fields")
        return {"assigned": 0, "unassigned": len(records), "county_count": 0}

    unassigned = []
    for record in records:
        # By station id since ADR-066: a county is a fact about one reservoir,
        # and two sharing a name are in two counties.
        found = counties.get(str(record.get("source_station_id")))
        if not found:
            unassigned.append(record["name"])
            continue
        record["county_fips"] = found["county_fips"]
        record["county_name"] = found["county_name"]
        record["state"] = found["state"]
        # Where the water is, as opposed to where the point is. Reviewed
        # against NHD for the waterbodies that cross a line; the point's own
        # state for every other, which is a default rather than a finding
        # (ADR-060). `connected_states` is attached with the drainage area,
        # because that is what knows it. Looked up by station id (ADR-066).
        record["waterbody_states"] = huc.waterbody_states(
            str(record.get("source_station_id")), found["state"])

    distinct = {r["county_fips"] for r in records if r.get("county_fips")}
    states = {r["state"] for r in records if r.get("state")}
    print(f"\nCounties: {len(records) - len(unassigned)}/{len(records)} reservoirs "
          f"assigned across {len(distinct)} counties in {len(states)} states")
    if unassigned:
        # Named rather than guessed, like an unmatched drainage area. A new
        # reservoir arrives on the roster before the assignment is rebuilt,
        # and the honest answer is that its county is not known yet.
        print("  no county assignment: " + ", ".join(sorted(unassigned)) +
              " -- run tools/build_county_assignments.py")
    return {
        "assigned": len(records) - len(unassigned),
        "unassigned": len(unassigned),
        "county_count": len(distinct),
        "state_count": len(states),
    }


def attach_watersheds(records: list[dict]) -> dict:
    """Add watershed membership to every record and summarize the result.

    Runs over carried-forward records too. A reservoir whose feed went quiet
    has not moved, and leaving it without a basin would drop it out of every
    watershed total on the day it most needs to be visible as late data.

    A missing or unreadable boundary file is not fatal. Point and waterbody
    location remain available without it; only HUC assignment is omitted.
    Losing the whole daily refresh over a watershed lookup would be a much
    worse failure than shipping a day without HUC context.
    """
    for record in records:
        lat, lon = record.get("lat"), record.get("lon")
        if lat is not None and lon is not None:
            record.update(huc.location_fields(
                str(record.get("source_station_id")), lat, lon))

    try:
        units = huc.load_units()
    except (OSError, ValueError, KeyError) as exc:
        print(f"WARNING: no watershed boundaries ({type(exc).__name__}: {exc}); "
              "publishing without HUC fields")
        return {"unit_count": 0, "assigned": 0, "unassigned": len(records)}

    dams = dam_points()
    unassigned = []
    for record in records:
        lat, lon = record.get("lat"), record.get("lon")
        if lat is None or lon is None:
            unassigned.append(record.get("name"))
            continue
        # The dam point where we have one, the published lake point where
        # we do not, and the record says which it used. Measured across
        # the 53 reservoirs in the original measurement, switching to dam
        # points moved no assignment -- so this is a provenance improvement,
        # not a correction, and a reader can tell the two apart.
        dam = dams.get(str(record.get("source_station_id")))
        record.update(huc.describe(
            lat, lon, units, station=str(record.get("source_station_id")),
            assignment_point=dam,
            source="nid_dam_point" if dam else "published_point"))
        if record["huc6"] is None:
            unassigned.append(record["name"])

    intersects_utah = sum(1 for r in records if r.get("intersects_utah"))
    by_dam = sum(1 for r in records
                 if r.get("huc_assignment_source") == "nid_dam_point")
    print(f"\nWatersheds: {len(records) - len(unassigned)}/{len(records)} reservoirs "
          f"assigned across {len(units)} drainage areas; "
          f"{intersects_utah} waterbodies intersect Utah; "
          f"{by_dam} assigned by their dam")
    if unassigned:
        # Not a failure. A reservoir outside every unit that touches Utah is
        # a real possibility as the inventory grows east, and the honest
        # response is to name it rather than to drop or guess it.
        print(f"  no drainage area matched: {', '.join(sorted(unassigned))}")
    return {
        "unit_count": len(units),
        "assigned": len(records) - len(unassigned),
        "unassigned": len(unassigned),
        "assigned_by_dam": by_dam,
    }
