"""Download the current U.S. Drought Monitor polygons as GeoJSON.

The National Drought Mitigation Center publishes a current ArcGIS feature
layer with one polygon feature per reported intensity. This tool verifies the
live layer schema, requests every object ID, downloads bounded GeoJSON batches,
and refuses a partial or duplicate response.

    python tools/fetch_drought_monitor.py --dry-run
    python tools/fetch_drought_monitor.py
    python tools/fetch_drought_monitor.py --output data/drought/usdm.geojson

The default output retains every national feature and asks the service for a
roughly 100-metre geometry tolerance suitable for analysis and a web map. It can later be
clipped or intersected with the committed HUC-6 boundaries without making the
download depend on a particular dashboard view.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import tempfile
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
OUTPUT_PATH = ROOT / "data" / "drought" / "usdm-current.geojson"
LAYER_URL = (
    "https://services5.arcgis.com/0OTVzJS4K09zlixn/arcgis/rest/services/"
    "USDM_current/FeatureServer/0"
)
USER_AGENT = "western-water-dashboard/drought-monitor (+https://github.com/buschbrian)"
TIMEOUT = 90
MAX_ALLOWABLE_OFFSET = 0.001  # degrees; about 110 m north-to-south
GEOMETRY_PRECISION = 5
DATE_FIELDS = ("MapDate", "ReleaseDate", "ValidStart", "ValidEnd")
REQUIRED_FIELDS = {"DM", "MapDate", "ReleaseDate"}
ATTRIBUTION = (
    "U.S. Drought Monitor, produced by the National Drought Mitigation Center, "
    "the U.S. Department of Agriculture, and the National Oceanic and "
    "Atmospheric Administration"
)


def get_json(url: str, params: dict) -> dict:
    request = urllib.request.Request(
        f"{url}?{urllib.parse.urlencode(params)}",
        headers={"User-Agent": USER_AGENT, "Accept": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except (urllib.error.URLError, TimeoutError, ValueError) as exc:
        raise RuntimeError(f"drought service request failed: {exc}") from exc
    if not isinstance(payload, dict):
        raise RuntimeError("drought service returned a non-object response")
    if payload.get("error"):
        message = (payload["error"] or {}).get("message", "unknown service error")
        raise RuntimeError(f"drought service error: {message}")
    return payload


def object_id_field(metadata: dict) -> str:
    """Resolve the object ID field across ArcGIS service generations."""
    direct = metadata.get("objectIdField") or metadata.get("objectIdFieldName")
    if direct:
        return str(direct)
    for field in metadata.get("fields") or []:
        if field.get("type") == "esriFieldTypeOID" and field.get("name"):
            return str(field["name"])
    raise ValueError("drought layer does not advertise an object ID field")


def validate_metadata(metadata: dict) -> tuple[str, int]:
    if metadata.get("geometryType") != "esriGeometryPolygon":
        raise ValueError("drought layer is not a polygon layer")
    formats = {
        value.strip().lower()
        for value in str(metadata.get("supportedQueryFormats") or "").split(",")
    }
    if "geojson" not in formats:
        raise ValueError("drought layer does not advertise GeoJSON queries")
    fields = {field.get("name") for field in metadata.get("fields") or []}
    missing = REQUIRED_FIELDS - fields
    if missing:
        raise ValueError(f"drought layer is missing fields: {', '.join(sorted(missing))}")
    batch_size = metadata.get("maxRecordCount")
    if not isinstance(batch_size, int) or batch_size < 1:
        raise ValueError("drought layer has no usable record limit")
    return object_id_field(metadata), batch_size


def iso_date(value) -> str | None:
    if not isinstance(value, (int, float)):
        return None
    return dt.datetime.fromtimestamp(value / 1000, tz=dt.timezone.utc).date().isoformat()


def assemble_geojson(features: list[dict], object_ids: list[int], oid_field: str) -> dict:
    if not features:
        raise ValueError("drought layer returned no features")
    expected = set(object_ids)
    received = []
    severities = []
    map_dates = set()
    release_dates = set()

    for feature in features:
        if feature.get("type") != "Feature" or not isinstance(feature.get("properties"), dict):
            raise ValueError("drought layer returned an invalid GeoJSON feature")
        geometry = feature.get("geometry") or {}
        if geometry.get("type") not in {"Polygon", "MultiPolygon"}:
            raise ValueError("drought layer returned a non-polygon feature")
        properties = feature["properties"]
        received.append(properties.get(oid_field))
        severity = properties.get("DM")
        if not isinstance(severity, int) or severity not in range(5):
            raise ValueError(f"invalid drought intensity {severity!r}")
        severities.append(severity)
        map_dates.add(properties.get("MapDate"))
        release_dates.add(properties.get("ReleaseDate"))

    if len(received) != len(set(received)):
        raise ValueError("drought layer returned duplicate object IDs")
    if set(received) != expected:
        missing = sorted(expected - set(received))
        extra = sorted(set(received) - expected)
        raise ValueError(f"partial drought response; missing {missing}, extra {extra}")
    if len(severities) != len(set(severities)):
        raise ValueError("drought layer returned duplicate intensity features")
    if len(map_dates) != 1 or len(release_dates) != 1:
        raise ValueError("drought features do not report one common map and release date")

    features.sort(key=lambda feature: feature["properties"]["DM"])
    return {
        "type": "FeatureCollection",
        "name": "U.S. Drought Monitor current conditions",
        "source": LAYER_URL,
        "attribution": ATTRIBUTION,
        "map_date": iso_date(next(iter(map_dates))),
        "release_date": iso_date(next(iter(release_dates))),
        "geometry": {
            "coordinate_system": "WGS 84 (EPSG:4326)",
            "max_allowable_offset_degrees": MAX_ALLOWABLE_OFFSET,
            "coordinate_decimal_places": GEOMETRY_PRECISION,
        },
        "features": features,
    }


def fetch_current() -> dict:
    metadata = get_json(LAYER_URL, {"f": "json"})
    oid_field, batch_size = validate_metadata(metadata)
    ids_payload = get_json(
        f"{LAYER_URL}/query",
        {"f": "json", "where": "1=1", "returnIdsOnly": "true"},
    )
    object_ids = ids_payload.get("objectIds")
    if not isinstance(object_ids, list) or not object_ids:
        raise RuntimeError("drought layer returned no object IDs")
    if len(object_ids) != len(set(object_ids)):
        raise RuntimeError("drought layer returned duplicate object IDs")

    features = []
    for start in range(0, len(object_ids), batch_size):
        chunk = object_ids[start:start + batch_size]
        page = get_json(
            f"{LAYER_URL}/query",
            {
                "f": "geojson",
                "objectIds": ",".join(str(value) for value in chunk),
                "outFields": "*",
                "returnGeometry": "true",
                "outSR": 4326,
                "maxAllowableOffset": MAX_ALLOWABLE_OFFSET,
                "geometryPrecision": GEOMETRY_PRECISION,
            },
        )
        if page.get("type") != "FeatureCollection" or not isinstance(
                page.get("features"), list):
            raise RuntimeError("drought layer returned invalid GeoJSON")
        features.extend(page["features"])
    return assemble_geojson(features, object_ids, oid_field)


def write_atomic(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(
            "w", encoding="utf-8", dir=path.parent, delete=False) as handle:
        temporary = Path(handle.name)
        # Geometry dominates this file. Compact encoding keeps the weekly
        # runtime download under a megabyte without changing any coordinate.
        json.dump(payload, handle, separators=(",", ":"))
        handle.write("\n")
    temporary.chmod(0o644)
    temporary.replace(path)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=OUTPUT_PATH)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    try:
        payload = fetch_current()
    except (RuntimeError, ValueError) as exc:
        print(f"ERROR: {exc}")
        return 1

    levels = ", ".join(f"D{feature['properties']['DM']}" for feature in payload["features"])
    print(f"{len(payload['features'])} drought polygons for {payload['map_date']}: {levels}")
    if args.dry_run:
        print("Dry run: nothing written.")
        return 0
    write_atomic(args.output, payload)
    print(f"Wrote {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
