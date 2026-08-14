"""Network-free contract checks for the drought GeoJSON downloader."""

import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from tools.fetch_drought_monitor import (  # noqa: E402
    assemble_geojson,
    object_id_field,
    validate_metadata,
)


def metadata(**overrides):
    value = {
        "geometryType": "esriGeometryPolygon",
        "objectIdField": "OBJECTID",
        "maxRecordCount": 2000,
        "supportedQueryFormats": "JSON, geoJSON, PBF",
        "fields": [
            {"name": "OBJECTID", "type": "esriFieldTypeOID"},
            {"name": "DM", "type": "esriFieldTypeSmallInteger"},
            {"name": "MapDate", "type": "esriFieldTypeDate"},
            {"name": "ReleaseDate", "type": "esriFieldTypeDate"},
        ],
    }
    value.update(overrides)
    return value


def feature(oid, severity, map_date=1_786_433_400_000,
            release_date=1_786_606_200_000):
    return {
        "type": "Feature",
        "properties": {
            "OBJECTID": oid,
            "DM": severity,
            "MapDate": map_date,
            "ReleaseDate": release_date,
        },
        "geometry": {
            "type": "Polygon",
            "coordinates": [[[-111, 40], [-110, 40], [-110, 41], [-111, 40]]],
        },
    }


def test_layer_schema_resolves_object_id_and_batch_limit():
    assert validate_metadata(metadata()) == ("OBJECTID", 2000)
    fallback = metadata(objectIdField=None)
    assert object_id_field(fallback) == "OBJECTID"


@pytest.mark.parametrize("change,message", [
    ({"geometryType": "esriGeometryPoint"}, "polygon"),
    ({"supportedQueryFormats": "JSON"}, "GeoJSON"),
    ({"maxRecordCount": 0}, "record limit"),
])
def test_layer_schema_refuses_an_incompatible_service(change, message):
    with pytest.raises(ValueError, match=message):
        validate_metadata(metadata(**change))


def test_geojson_is_complete_sorted_and_self_describing():
    payload = assemble_geojson([feature(9, 2), feature(7, 0), feature(8, 1)],
                               [7, 8, 9], "OBJECTID")
    assert [row["properties"]["DM"] for row in payload["features"]] == [0, 1, 2]
    assert payload["map_date"] == "2026-08-11"
    assert payload["release_date"] == "2026-08-13"
    assert "National Drought Mitigation Center" in payload["attribution"]


def test_geojson_refuses_partial_duplicate_or_mixed_week_results():
    with pytest.raises(ValueError, match="partial"):
        assemble_geojson([feature(7, 0)], [7, 8], "OBJECTID")
    with pytest.raises(ValueError, match="duplicate object"):
        assemble_geojson([feature(7, 0), feature(7, 1)], [7], "OBJECTID")
    with pytest.raises(ValueError, match="common map"):
        assemble_geojson([feature(7, 0), feature(8, 1, map_date=0)],
                         [7, 8], "OBJECTID")
