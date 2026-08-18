"""Which structure of a dam project supplies the assignment point (ADR-057).

Network-free. A dam identifier names a project, and three of the committed
ones return several rows -- a dam and its dikes -- carrying the same storage
and different coordinates. The point is the drainage-area assignment point, so
"whichever row arrived last" is not an answer that survives two runs.
"""

import json
from pathlib import Path

import pytest

from tools.add_dam_points import SECONDARY_STRUCTURE, principal_structure

ROOT = Path(__file__).resolve().parent.parent


def rows(*named):
    """Inventory rows, as `fetch_dam_points` groups them before choosing."""
    return [{"name": name, "point": point} for name, point in named]


def test_the_dam_wins_over_its_dike():
    chosen = principal_structure(rows(
        ("Hyrum Dike", (-111.8681, 41.6276)),
        ("Hyrum Dam", (-111.8732, 41.624)),
    ))
    assert chosen["name"] == "Hyrum Dam"


def test_the_dam_wins_however_the_service_orders_the_rows():
    """The defect this rule replaces, stated directly.

    The two inventory copies returned Stateline's three structures in
    different orders, so a dictionary keyed by identifier wrote the dam from
    one service and a dike from the other -- from identical data.
    """
    stateline = [
        ("Stateline Dike A", (-110.3924, 40.9876)),
        ("Stateline Dike B", (-110.3935, 40.986)),
        ("Stateline Dam", (-110.3857, 40.9885)),
    ]
    orderings = [
        stateline,
        list(reversed(stateline)),
        [stateline[2], stateline[0], stateline[1]],
        [stateline[1], stateline[2], stateline[0]],
    ]
    chosen = {principal_structure(rows(*order))["point"] for order in orderings}
    assert chosen == {(-110.3857, 40.9885)}


@pytest.mark.parametrize("name", [
    "Stateline Dike A", "Willard Dyke", "Some Saddle Dam", "Auxiliary Dam",
    "stateline dike b",
])
def test_secondary_structures_are_recognised_whatever_their_case(name):
    assert SECONDARY_STRUCTURE.search(name)


@pytest.mark.parametrize("name", [
    "Hyrum Dam", "Glen Canyon Dam", "Soldier Creek Dam", "Dikes Creek Dam",
])
def test_a_principal_structure_is_not_mistaken_for_a_secondary_one(name):
    """`\\b` is doing real work: "Dikes Creek Dam" is a dam on a creek."""
    assert not SECONDARY_STRUCTURE.search(name)


def test_a_project_of_only_dikes_still_resolves_to_one_of_them():
    """Sorted, not filtered.

    An inventory that names things unexpectedly should give a worse answer,
    not no answer: a reservoir silently losing its point is the worse failure.
    """
    chosen = principal_structure(rows(
        ("North Dike", (-111.0, 41.0)),
        ("East Dike", (-111.1, 41.1)),
    ))
    assert chosen["name"] == "East Dike"


def test_one_row_needs_no_rule():
    chosen = principal_structure(rows(("Echo Dam", (-111.431, 40.9655))))
    assert chosen["name"] == "Echo Dam"


def test_the_committed_table_credits_the_owner_operated_inventory():
    """ADR-057's migration half, asserted against the file rather than the code.

    `capacities.json` credited a hosted copy while already holding the owner
    service's values -- provenance wrong in the file, not in the tool.
    """
    document = json.loads((ROOT / "capacities.json").read_text(encoding="utf-8"))
    owner = "geospatial.sec.usace.army.mil"
    assert owner in document["source_layer"]
    assert owner in document["dam_points"]["source"]
    assert "services2.arcgis.com" not in json.dumps(document)
