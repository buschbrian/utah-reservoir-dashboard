# Data rules (`data/`, root `*.json`)

**Never hand-edit a generated file.** The next run overwrites it, and an edit
that survives review is an unreproducible number on a public page.
[`generated-files.json`](generated-files.json) is the machine-readable owner
table and `tests/test_generated_files.py` holds it to the repository.

| Class | Examples | Rule |
|---|---|---|
| Generated daily | `reservoirs.json`, `snowpack.json`, `snow_sites.json`, `reference.json`, `data/drought/usdm-huc{4,6}.json` | Change the writer, run it, commit the output. |
| Generated weekly | `data/drought/usdm-current.geojson` | Fetched by `tools/fetch_drought_monitor.py`. |
| Generated archive | `data/drought/usdm-huc6-history.json` | Append-only, one level, capped at ten years. |
| Long-lived derived | `normals.json`, `counties.json`, `capacities.json`, `data/watersheds/*.geojson`, `data/us-land.geojson` | Rebuilt on demand by a named tool; every run merges. |
| Hand-maintained, reviewed | `admitted_*.json` | Edited by a person, with evidence. A waiver needs a reason or the loader refuses it. |
| Frozen historical | `huc6.geojson`, `utah-boundary.geojson` | Kept for parity. Do not regenerate. |

- **Every coverage file describes one week.** The two drought levels are
  committed together or not at all.
- **The polygons and the coverage must agree**; `tools/check_drought_pair.py`
  is the check and the remedy is to recompute, never to edit.
- **Long-lived reference data carries the date it was checked**, and the
  generator stamps it. `tools/check_reference_freshness.py` reports what is due.
- **Payload cost is measured gzipped** (ADR-051). `docs/data-transfer.md` holds
  the measurements.

Verify: `npm run verify:pipeline`.
