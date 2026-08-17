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
from watershed_scopes import (
    WBD_LAYER_BY_LEVEL,
    get_scope,
    huc_field,
    load_scope_units,
    validate_huc6_codes,
    validate_huc_codes,
)


def test_utah_connected_scope_preserves_the_published_dashboard_rule():
    scope = get_scope("utah-connected")

    assert scope.where == "states LIKE '%UT%' AND huc6 NOT LIKE '17%'"
    assert scope.expected_count == 14
    assert scope.output == "huc6.geojson"
    assert scope.level == 6


def test_the_western_scopes_are_defined_but_publish_nowhere_near_the_dashboard():
    """They exist so the geography can be fetched and reviewed before any
    surface draws it. None of them writes the file the dashboard reads."""
    published = get_scope("utah-connected").output

    for name, level, output in (
        ("west-huc4", 4, "data/watersheds/west-huc4.geojson"),
        ("west-huc6", 6, "data/watersheds/west-huc6.geojson"),
        ("west-huc8", 8, "data/watersheds/west-huc8.geojson"),
    ):
        scope = get_scope(name)
        assert scope.level == level
        assert scope.output == output
        assert scope.output != published
        # Banded rather than pinned: nine regions of the Watershed Boundary
        # Dataset are revised more often than one.
        assert scope.expected_count is None
        assert scope.expected_range is not None

    # Regions 10 through 18, as a range on the leading two digits rather than
    # nine LIKE clauses. Region 19 is Alaska and is out.
    where = get_scope("west-huc6").where
    assert "SUBSTRING(huc6, 1, 2) >= '10'" in where
    assert "SUBSTRING(huc6, 1, 2) <= '18'" in where


def test_upper_colorado_scope_is_separate_from_the_published_scope():
    scope = get_scope("upper-colorado")

    assert scope.where == "huc6 LIKE '14%'"
    assert scope.expected_count == 10
    assert scope.output == "data/watersheds/upper-colorado-huc6.geojson"


def test_huc_validation_preserves_codes_as_strings_and_rejects_wrong_regions():
    assert validate_huc6_codes(["140100", "140200"], "14") == ["140100", "140200"]

    with pytest.raises(ValueError, match="6-digit strings"):
        validate_huc6_codes([140100], "14")
    with pytest.raises(ValueError, match="outside region 14"):
        validate_huc6_codes(["150100"], "14")
    with pytest.raises(ValueError, match="duplicate"):
        validate_huc6_codes(["140100", "140100"], "14")


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
