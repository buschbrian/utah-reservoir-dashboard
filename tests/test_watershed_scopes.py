"""Network-free contracts for named watershed extraction scopes."""

from dataclasses import replace

import pytest

from tools.fetch_watershed_scope import (
    ArcGISFeatureLayerIdProvider,
    ArcGISRestClient,
    normalize_collection,
)
from watershed_scopes import get_scope, load_scope_units, validate_huc6_codes


def test_utah_connected_scope_preserves_the_published_dashboard_rule():
    scope = get_scope("utah-connected")

    assert scope.where == "states LIKE '%UT%' AND huc6 NOT LIKE '17%'"
    assert scope.expected_count == 14
    assert scope.output == "huc6.geojson"


def test_upper_colorado_scope_is_separate_from_the_published_scope():
    scope = get_scope("upper-colorado")

    assert scope.where == "huc6 LIKE '14%'"
    assert scope.expected_count == 10
    assert scope.output == "data/watersheds/upper-colorado-huc6.geojson"


def test_huc_validation_preserves_codes_as_strings_and_rejects_wrong_regions():
    assert validate_huc6_codes(["140100", "140200"], "14") == ["140100", "140200"]

    with pytest.raises(ValueError, match="six-digit strings"):
        validate_huc6_codes([140100], "14")
    with pytest.raises(ValueError, match="outside region 14"):
        validate_huc6_codes(["150100"], "14")
    with pytest.raises(ValueError, match="duplicate"):
        validate_huc6_codes(["140100", "140100"], "14")


def test_unknown_scope_is_a_configuration_error():
    with pytest.raises(KeyError, match="unknown watershed scope"):
        get_scope("everything")


def test_committed_upper_colorado_boundaries_match_the_named_scope():
    units = load_scope_units("upper-colorado")

    assert [unit["huc6"] for unit in units] == [
        "140100", "140200", "140300", "140401", "140402",
        "140500", "140600", "140700", "140801", "140802",
    ]


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

    def get(self, url, *, params, timeout):
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
    collection = Session().get("https://example.test/query", params={"objectIds": "1"},
                               timeout=1).json()
    one_unit_scope = replace(get_scope("upper-colorado"), expected_count=1)
    normalized, report = normalize_collection(collection, one_unit_scope)

    assert normalized["features"][0]["properties"]["huc6"] == "140001"
    assert report == {
        "feature_count": 1,
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
