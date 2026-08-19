"""Network-free contracts for named watershed extraction scopes."""

from dataclasses import replace
import json
from pathlib import Path

import pytest

from tools.fetch_watershed_scope import (
    ArcGISFeatureLayerIdProvider,
    ArcGISRestClient,
    MAX_ALLOWABLE_OFFSET,
    normalize_collection,
)
import huc
import refresh_reservoirs
from watershed_scopes import (
    DEFAULT_SCOPE,
    ROOT,
    ROSTER_SCOPE,
    WBD_LAYER_BY_LEVEL,
    get_scope,
    huc_field,
    load_scope_units,
    validate_huc_codes,
)


def test_utah_connected_scope_preserves_the_published_dashboard_rule():
    scope = get_scope("utah-connected")

    assert scope.where == "states LIKE '%UT%' AND huc6 NOT LIKE '17%'"
    assert scope.expected_count == 14
    assert scope.output == "huc6.geojson"
    assert scope.level == 6


def test_the_dashboard_draws_the_western_huc6_scope():
    """The coverage change, in the one place it is decided (ADR-063).

    Level 6 is not incidental: every figure on this site -- storage banked in
    an area, drought coverage, snow percent of normal -- is keyed at six
    digits, so a scope drawn at another size would put shapes on the map that
    no number describes.
    """
    assert DEFAULT_SCOPE == "west-huc6"

    scope = get_scope(DEFAULT_SCOPE)
    assert scope.published
    assert scope.level == 6
    assert scope.output == "data/watersheds/west-huc6.geojson"
    # The pipeline assigns reservoirs with the file the maps draw, rather
    # than with a file named separately in huc.py.
    assert huc.BOUNDARY_PATH == ROOT / scope.output


def test_the_finer_and_coarser_western_scopes_are_registered_and_draw_nothing():
    """They exist so the geography can be fetched and reviewed before any
    surface draws it, which is the state west-huc6 was in until it was
    drawn. Neither is published, so the reference export skips both."""
    for name, level, output in (
        ("west-huc4", 4, "data/watersheds/west-huc4.geojson"),
        ("west-huc8", 8, "data/watersheds/west-huc8.geojson"),
    ):
        scope = get_scope(name)
        assert scope.level == level
        assert scope.output == output
        assert not scope.published
        assert scope.output != get_scope(DEFAULT_SCOPE).output
        # Banded rather than pinned: nine regions of the Watershed Boundary
        # Dataset are revised more often than one.
        assert scope.expected_count is None
        assert scope.expected_range is not None


def test_every_roster_reservoir_sits_inside_the_roster_scope():
    """The roster scope is the geography the reservoirs were admitted from,
    and the map's opening extent is the box of it (ADR-063).

    Read from the committed roster rather than from reservoirs.json: a
    reservoir whose feed goes quiet is withdrawn from the payload (ADR-056),
    and a payload-driven assertion would retire itself on the morning that
    happened rather than failing.

    What this catches is a reservoir admitted outside the roster scope while
    the scope name stays behind. The map would still open on the old box and
    the new reservoir would sit outside it, which is not a visible failure --
    it is a reservoir the reader can select and then cannot pan to.
    """
    scope = get_scope(ROSTER_SCOPE)
    units = load_scope_units(ROSTER_SCOPE)
    dams = refresh_reservoirs.dam_points()

    points = {name: (lon, lat) for name, (_, lat, lon)
              in refresh_reservoirs.RESERVOIRS.items()}
    points.update({name: (lon, lat) for name, (_, lat, lon, _, _)
                   in refresh_reservoirs.AWDB_RESERVOIRS.items()})
    # The assignment point, not the published one, wherever there is a
    # reviewed dam: a drainage area is where the stored water leaves.
    points.update(dams)
    assert len(points) >= 69

    outside = sorted(name for name, point in points.items()
                     if huc.assign_huc(point, units) is None)
    assert outside == [], (
        f"{outside} are outside the {ROSTER_SCOPE} scope the map opens on; "
        f"move ROSTER_SCOPE to the geography they were admitted from")
    assert scope.published, "the extent is derived from this scope's roster"


def test_the_roster_scopes_areas_are_the_drawn_scopes_own_geometry():
    """The two committed files must agree, area for area, about the fourteen
    they share.

    They are fetched separately and could be fetched at different
    generalizations, and the difference is not cosmetic: at 100 metres against
    56, two drought figures moved by a tenth of a point -- one rounding step at
    the precision this site publishes -- with no weather behind it. The
    reservoir assignment and the map's extent are read from one file and the
    drought shares from the other, so a disagreement here is two geographies
    wearing one set of codes.
    """
    drawn = {unit["huc6"]: unit for unit in load_scope_units(DEFAULT_SCOPE)}
    roster = load_scope_units(ROSTER_SCOPE)

    assert {unit["huc6"] for unit in roster} <= set(drawn)
    for unit in roster:
        assert unit["polygons"] == drawn[unit["huc6"]]["polygons"], (
            f"{unit['huc6']} {unit['name']} has different geometry in "
            f"{get_scope(ROSTER_SCOPE).output} and "
            f"{get_scope(DEFAULT_SCOPE).output}")

    # Regions 14 through 18, as a range on the leading two digits rather than
    # five LIKE clauses. Region 19 is Alaska and is out.
    where = get_scope("west-huc6").where
    assert "SUBSTRING(huc6, 1, 2) >= '14'" in where
    assert "SUBSTRING(huc6, 1, 2) <= '18'" in where


def test_the_scope_is_pacific_draining_water_and_closed_basins():
    """The subject is where the water goes, not where the state lines are.

    Regions 14 and 15 reach the Pacific through the Gulf of California, 17
    and 18 reach it directly, and 16 -- the Great Basin -- reaches nothing.
    Regions 10 to 13 are western in longitude and eastern in hydrology: the
    Missouri and the Arkansas leave through the Mississippi, Texas-Gulf and
    the Rio Grande reach the Gulf of Mexico directly. They are two thirds of
    the basins in 10-18, so this is the difference between a dashboard about
    western water and one about most of the country.
    """
    for name in ("west-huc4", "west-huc6", "west-huc8"):
        scope = get_scope(name)
        path = ROOT / scope.output
        if not path.exists():
            continue
        field = f"huc{scope.level}"
        codes = [feature["properties"][field]
                 for feature in json.loads(path.read_text(encoding="utf-8"))["features"]]
        regions = sorted({code[:2] for code in codes})
        assert regions == ["14", "15", "16", "17", "18"], (
            f"{name} carries regions {regions}; 10-13 drain to the Gulf of "
            "Mexico and are not this product's subject")


def test_upper_colorado_scope_is_separate_from_the_published_scope():
    scope = get_scope("upper-colorado")

    assert scope.where == "huc6 LIKE '14%'"
    assert scope.expected_count == 10
    assert scope.output == "data/watersheds/upper-colorado-huc6.geojson"


def test_huc_validation_preserves_codes_as_strings_and_rejects_wrong_regions():
    assert validate_huc_codes(["140100", "140200"], 6, "14") == ["140100", "140200"]

    with pytest.raises(ValueError, match="6-digit strings"):
        validate_huc_codes([140100], 6, "14")
    with pytest.raises(ValueError, match="outside region 14"):
        validate_huc_codes(["150100"], 6, "14")
    with pytest.raises(ValueError, match="duplicate"):
        validate_huc_codes(["140100", "140100"], 6, "14")


def test_validation_follows_the_level_rather_than_assuming_six():
    """A HUC code is fixed-width and zero-padded, so the digit count *is* the
    level. A six-digit code inside a HUC8 scope is a mixed-level payload, not
    a short one, and every downstream join is by code."""
    assert validate_huc_codes(["14010001", "14010002"], 8, "14") == [
        "14010001", "14010002"]
    assert validate_huc_codes(["1401", "1402"], 4, "14") == ["1401", "1402"]

    with pytest.raises(ValueError, match="8-digit strings"):
        validate_huc_codes(["140100"], 8)
    with pytest.raises(ValueError, match="4-digit strings"):
        validate_huc_codes(["140100"], 4)


def test_an_unsupported_level_is_a_configuration_error():
    """HUC10 and finer are absent on purpose: the drought engine's sampled
    share carries about 0.21 points of error at HUC10 against a published
    precision of 0.1, so the level is refused rather than quietly published."""
    assert sorted(WBD_LAYER_BY_LEVEL) == [2, 4, 6, 8]

    with pytest.raises(ValueError, match="unsupported hydrologic level 12"):
        validate_huc_codes(["140100010101"], 12)


def test_the_layer_and_field_follow_the_level():
    """The WBD service publishes each level as its own layer, and each layer
    names its code column after the level."""
    assert WBD_LAYER_BY_LEVEL[6] == 3
    assert huc_field(6) == "huc6"
    assert huc_field(8) == "huc8"


def test_unknown_scope_is_a_configuration_error():
    with pytest.raises(KeyError, match="unknown watershed scope"):
        get_scope("everything")


def test_committed_upper_colorado_boundaries_match_the_named_scope():
    units = load_scope_units("upper-colorado")

    assert [unit["huc6"] for unit in units] == [
        "140100", "140200", "140300", "140401", "140402",
        "140500", "140600", "140700", "140801", "140802",
    ]


def test_committed_upper_colorado_geometry_uses_the_new_file_default():
    path = Path(__file__).resolve().parent.parent / get_scope("upper-colorado").output
    payload = json.loads(path.read_text(encoding="utf-8"))

    assert payload["geometry"]["max_allowable_offset_degrees"] <= 0.001


class Response:
    def __init__(self, payload):
        self.payload = payload

    def raise_for_status(self):
        return None

    def json(self):
        return self.payload


class Session:
    def __init__(self):
        self.calls = []

    def post(self, url, *, data, timeout):
        """The client posts rather than gets.

        The object-ID list is unbounded -- a western HUC8 scope names 1,247
        of them, about 9 KB of parameters -- and the service answers 414 to a
        query string that long. The parameters are identical either way.
        """
        params = data
        self.calls.append((url, params, timeout))
        if not url.endswith("/query"):
            return Response({"capabilities": "Map,Query", "maxRecordCount": 1,
                             "fields": [{"name": "OBJECTID",
                                         "type": "esriFieldTypeOID"}]})
        if params.get("returnIdsOnly") == "true":
            return Response({"objectIdFieldName": "OBJECTID", "objectIds": [2, 1]})
        object_id = int(params["objectIds"])
        return Response({"type": "FeatureCollection", "features": [{
            "type": "Feature",
            "properties": {"OBJECTID": object_id,
                           "huc6": f"140{object_id:03d}",
                           "name": f"Unit {object_id}", "states": "CO"},
            "geometry": {"type": "Polygon", "coordinates": [[
                [-110, 39], [-109, 39], [-109, 40], [-110, 39]
            ]]},
        }]})


def test_arcgis_rest_client_fetches_every_object_id_in_bounded_batches():
    session = Session()
    collection = ArcGISRestClient("https://example.test/MapServer/3", session=session).query(
        get_scope("upper-colorado"))

    assert [feature["properties"]["OBJECTID"] for feature in collection["features"]] == [1, 2]
    feature_calls = [params for url, params, _ in session.calls
                     if url.endswith("/query") and "objectIds" in params]
    assert [call["objectIds"] for call in feature_calls] == ["1", "2"]
    assert all(call["f"] == "geojson" and call["outSR"] == "4326"
               for call in feature_calls)
    assert MAX_ALLOWABLE_OFFSET == "0.001"
    assert all(call["maxAllowableOffset"] == "0.001" for call in feature_calls)


def test_arcgis_rest_client_can_keep_full_boundary_precision():
    session = Session()
    ArcGISRestClient("https://example.test/MapServer/3", session=session).query(
        get_scope("upper-colorado"),
        geometry_precision="6",
        max_allowable_offset=None,
    )
    feature_calls = [params for url, params, _ in session.calls
                     if url.endswith("/query") and "objectIds" in params]
    assert all(call["geometryPrecision"] == "6" for call in feature_calls)
    assert all("maxAllowableOffset" not in call for call in feature_calls)


def test_arcgis_python_provider_uses_feature_layer_query_contract():
    class Layer:
        def __init__(self, url):
            self.url = url

        def query(self, **kwargs):
            assert kwargs == {"where": "huc6 LIKE '14%'", "return_ids_only": True}
            return {"objectIds": [3, 1, 2]}

    provider = ArcGISFeatureLayerIdProvider(
        "https://example.test/MapServer/3", layer_factory=Layer)

    assert provider.object_ids(get_scope("upper-colorado")) == [1, 2, 3]


def test_normalization_uses_huc_strings_and_reports_geometry_with_numpy():
    collection = Session().post("https://example.test/query", data={"objectIds": "1"},
                                timeout=1).json()
    one_unit_scope = replace(get_scope("upper-colorado"), expected_count=1)
    normalized, report = normalize_collection(collection, one_unit_scope)

    assert normalized["features"][0]["properties"]["huc6"] == "140001"
    # The report names the level and keys the codes by the level's own field,
    # so a HUC8 report is not silently readable as a HUC6 one.
    assert report == {
        "feature_count": 1,
        "level": 6,
        "huc6": ["140001"],
        "state_codes": ["CO"],
        "total_vertices": 4,
        "median_vertices": 4.0,
    }


def test_normalization_refuses_duplicate_or_missing_features():
    duplicate = {
        "type": "FeatureCollection",
        "features": [
            {"properties": {"huc6": "140100", "name": "A", "states": "CO"},
             "geometry": {"type": "Polygon", "coordinates": []}},
            {"properties": {"huc6": "140100", "name": "B", "states": "CO"},
             "geometry": {"type": "Polygon", "coordinates": []}},
        ],
    }
    with pytest.raises(ValueError, match="duplicate"):
        normalize_collection(duplicate, get_scope("upper-colorado"))
