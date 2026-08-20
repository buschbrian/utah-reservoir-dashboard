"""Fetch a named watershed scope from the USGS Watershed Boundary Dataset.

The sole fetcher for committed boundary geometry. The default output is a
separate Upper Colorado file; the production Utah-connected file is only
replaced when that scope is named explicitly.

The hydrologic level is a property of the scope (`watershed_scopes.py`), and
it decides both the service layer queried and the attribute the unit code
arrives in -- so a HUC4 or HUC8 scope is a table entry rather than an edit
here.

    python tools/fetch_watershed_scope.py --scope upper-colorado --dry-run
    python tools/fetch_watershed_scope.py --scope west-huc6 --dry-run
    python tools/fetch_watershed_scope.py --scope upper-colorado

ArcGIS REST query contract:
https://developers.arcgis.com/rest/services-reference/enterprise/query-feature-service-layer/
"""

import argparse
import datetime as dt
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import requests

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from watershed_scopes import (  # noqa: E402
    SCOPES, WBD_LAYER_BY_LEVEL, get_scope, huc_field, validate_huc_codes,
)

#: The Watershed Boundary Dataset service. Each hydrologic level is a layer
#: on it, so the level a scope is expressed at decides the layer and the
#: attribute the code arrives in -- see `WBD_LAYER_BY_LEVEL` and `huc_field`.
WBD_SERVICE = "https://hydro.nationalmap.gov/arcgis/rest/services/wbd/MapServer"
#: The six-digit layer, which is what the published dashboard draws. Kept as a
#: named constant because it is the one the source inventory records.
WBD_LAYER = f"{WBD_SERVICE}/{WBD_LAYER_BY_LEVEL[6]}"


def layer_for(level: int) -> str:
    """The service layer that publishes one hydrologic level."""
    try:
        return f"{WBD_SERVICE}/{WBD_LAYER_BY_LEVEL[level]}"
    except KeyError as exc:
        raise ValueError(f"no watershed layer for hydrologic level {level}") from exc
TIMEOUT = 90
GEOMETRY_PRECISION = "5"
# Roughly 100 metres north-to-south. The default for new committed geometry;
# the production scope now asks for finer, and says so on the command line.
#
# It is a flag rather than a constant because the tolerance is a decision
# with a measured trade-off behind it (ADR-005, and ADR-037 which supersedes
# it), not a detail of how the query is built. Anyone regenerating a file has
# to state what they asked for.
MAX_ALLOWABLE_OFFSET = "0.001"


class ArcGISFeatureLayerIdProvider:
    """Use ArcGIS API for Python to resolve a scope's complete object-ID set.

    Importing ``arcgis`` is delayed so the lightweight REST backend continues
    to work in the dashboard's normal refresh environment.

    FeatureLayer query guide:
    https://developers.arcgis.com/python/latest/guide/working-with-feature-layers-and-features/
    """

    def __init__(self, layer_url: str, *, layer_factory=None):
        if layer_factory is None:
            try:
                from arcgis.features import FeatureLayer
            except ImportError as exc:
                raise RuntimeError(
                    "the arcgis backend needs ArcGIS API for Python; "
                    "install requirements-gis.txt with Python 3.10-3.13") from exc
            layer_factory = FeatureLayer
        self.layer = layer_factory(layer_url)

    def object_ids(self, scope) -> list[int]:
        payload = self.layer.query(where=scope.where, return_ids_only=True)
        object_ids = sorted(payload.get("objectIds") or [])
        if not object_ids:
            raise RuntimeError(f"ArcGIS returned no features for {scope.name}")
        return object_ids


class ArcGISRestClient:
    """Complete, bounded downloads from a public ArcGIS feature layer."""

    def __init__(self, layer_url: str, *, session=None, timeout: int = TIMEOUT):
        self.layer_url = layer_url.rstrip("/")
        self.session = session or requests.Session()
        self.timeout = timeout

    def _json(self, url: str, params: dict) -> dict:
        """POST rather than GET, because the object-ID list is unbounded.

        These requests name every feature explicitly, and the identifiers go
        in the request rather than in a `where` clause. At fourteen units that
        is a short URL; at the 1,247 subbasins of a western HUC8 scope it is
        about 9 KB of query string, and the service answers **414 Request-URI
        Too Large** rather than truncating -- so the failure is loud, but it
        arrives only once a scope gets big.

        ArcGIS query endpoints accept the same parameters as a form post, with
        no length limit worth reaching. Nothing else about the contract
        changes.
        """
        response = self.session.post(url, data=params, timeout=self.timeout)
        response.raise_for_status()
        payload = response.json()
        if payload.get("error"):
            error = payload["error"]
            raise RuntimeError(f"ArcGIS query failed: {error.get('message', error)}")
        return payload

    def query(self, scope, *, object_ids=None, geometry_precision=GEOMETRY_PRECISION,
              max_allowable_offset=MAX_ALLOWABLE_OFFSET) -> dict:
        metadata = self._json(self.layer_url, {"f": "json"})
        capabilities = {part.strip().lower()
                        for part in str(metadata.get("capabilities", "")).split(",")}
        if "query" not in capabilities:
            raise RuntimeError("ArcGIS layer does not advertise Query capability")
        batch_size = int(metadata.get("maxRecordCount") or 1000)
        if batch_size < 1:
            raise RuntimeError("ArcGIS layer reported an invalid maxRecordCount")
        # FeatureServer and MapServer layer resources use different names for
        # the same field across service versions. Older MapServers expose it
        # only through the field type.
        object_id_field = (metadata.get("objectIdField")
                           or metadata.get("objectIdFieldName"))
        if not object_id_field:
            object_id_field = next(
                (field.get("name") for field in metadata.get("fields", [])
                 if field.get("type") == "esriFieldTypeOID"),
                None,
            )
        if not object_id_field:
            raise RuntimeError("ArcGIS layer does not identify its object-ID field")
        # The attribute the code arrives in follows the level, because each
        # level is a different layer and each layer names its own column.
        code_field = huc_field(scope.level)

        query_url = f"{self.layer_url}/query"
        if object_ids is None:
            ids_payload = self._json(query_url, {
                "where": scope.where,
                "returnIdsOnly": "true",
                "f": "json",
            })
            object_ids = sorted(ids_payload.get("objectIds") or [])
        else:
            object_ids = sorted(object_ids)
        if not object_ids:
            raise RuntimeError(f"ArcGIS returned no features for {scope.name}")

        features = []
        for start in range(0, len(object_ids), batch_size):
            batch = object_ids[start:start + batch_size]
            parameters = {
                "objectIds": ",".join(map(str, batch)),
                "outFields": f"{object_id_field},{code_field},name,states",
                "returnGeometry": "true",
                "outSR": "4326",
                "f": "geojson",
            }
            if geometry_precision is not None:
                parameters["geometryPrecision"] = str(geometry_precision)
            if max_allowable_offset is not None:
                parameters["maxAllowableOffset"] = str(max_allowable_offset)
            payload = self._json(query_url, parameters)
            features.extend(payload.get("features") or [])

        if len(features) != len(object_ids):
            raise RuntimeError(
                f"ArcGIS returned {len(features)} of {len(object_ids)} requested features")
        return {"type": "FeatureCollection", "features": features}


def _vertex_count(value) -> int:
    if not isinstance(value, list):
        return 0
    if len(value) >= 2 and all(isinstance(item, (int, float)) for item in value[:2]):
        return 1
    return sum(_vertex_count(item) for item in value)


def normalize_collection(collection: dict, scope) -> tuple[dict, dict]:
    """Validate ArcGIS GeoJSON with pandas and summarize geometry with NumPy."""
    features = collection.get("features") or []
    if not features:
        raise ValueError("watershed collection has no features")

    code_field = huc_field(scope.level)
    table = pd.json_normalize([feature.get("properties") or {} for feature in features])
    required = {code_field, "name", "states"}
    missing = sorted(required - set(table.columns))
    if missing:
        raise ValueError(f"watershed properties missing: {', '.join(missing)}")

    # HUC identifiers are codes, not numbers. Keeping them as strings protects
    # leading zeroes if another region is configured later.
    raw_codes = table[code_field].tolist()
    codes = validate_huc_codes(raw_codes, scope.level, scope.region)
    if scope.expected_count is not None and len(codes) != scope.expected_count:
        raise ValueError(
            f"expected {scope.expected_count} units for {scope.name}, received {len(codes)}")
    if scope.expected_range is not None:
        low, high = scope.expected_range
        if not low <= len(codes) <= high:
            raise ValueError(
                f"expected {low}-{high} units for {scope.name}, received {len(codes)}")

    order = sorted(range(len(features)), key=lambda index: raw_codes[index])
    normalized_features = []
    for index in order:
        feature = features[index]
        geometry = feature.get("geometry")
        if not geometry:
            raise ValueError(f"HUC{scope.level} {raw_codes[index]} has no geometry")
        normalized_features.append({
            "type": "Feature",
            "properties": {
                code_field: raw_codes[index],
                "name": str(table.iloc[index]["name"]).strip(),
                "states": str(table.iloc[index]["states"]).strip(),
            },
            "geometry": geometry,
        })

    vertices = np.fromiter(
        (_vertex_count(feature["geometry"].get("coordinates"))
         for feature in normalized_features),
        dtype=np.int64,
        count=len(normalized_features),
    )
    state_codes = sorted({state.strip()
                          for value in table["states"].astype("string")
                          for state in value.split(",") if state.strip()})
    report = {
        "feature_count": len(normalized_features),
        "level": scope.level,
        code_field: codes,
        "state_codes": state_codes,
        "total_vertices": int(vertices.sum()),
        "median_vertices": float(np.median(vertices)),
    }
    return {"type": "FeatureCollection", "features": normalized_features}, report


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--scope", default="upper-colorado",
                        choices=tuple(sorted(SCOPES)))
    parser.add_argument("--output", type=Path)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--backend", choices=("rest", "arcgis"), default="rest",
                        help="use ArcGIS API for Python for ID discovery, or REST only")
    parser.add_argument(
        "--max-allowable-offset", default=MAX_ALLOWABLE_OFFSET,
        help="generalization tolerance in degrees; 0.0005 is about 56 metres, "
             "which is where this source stops adding detail")
    args = parser.parse_args()

    scope = get_scope(args.scope)
    # The layer follows the scope's level; the field name follows it too.
    layer = layer_for(scope.level)
    output = args.output or ROOT / scope.output
    object_ids = None
    if args.backend == "arcgis":
        object_ids = ArcGISFeatureLayerIdProvider(layer).object_ids(scope)
    collection = ArcGISRestClient(layer).query(
        scope, object_ids=object_ids,
        max_allowable_offset=args.max_allowable_offset)
    normalized, report = normalize_collection(collection, scope)
    normalized.update({
        "source": layer,
        # When this was fetched. See `tools/check_reference_freshness.py` for
        # why a committed boundary file needs to carry one.
        "retrieved": dt.date.today().isoformat(),
        "scope": scope.name,
        "filter": scope.where,
        "unit_count": report["feature_count"],
        "geometry": {
            "coordinate_system": "WGS 84 (EPSG:4326)",
            "max_allowable_offset_degrees": float(args.max_allowable_offset),
            "coordinate_decimal_places": int(GEOMETRY_PRECISION),
        },
    })
    print(json.dumps(report, indent=2))
    if args.dry_run:
        print("Dry run: nothing written.")
        return 0

    output.parent.mkdir(parents=True, exist_ok=True)
    body = json.dumps(normalized, separators=(",", ":")) + "\n"
    before = output.read_text(encoding="utf-8") if output.exists() else None
    output.write_text(body, encoding="utf-8")
    print(f"{output.relative_to(ROOT)} " + ("unchanged." if before == body else "written."))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
