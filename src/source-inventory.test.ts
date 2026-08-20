import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (file: string): Promise<string> => readFile(resolve(root, file), "utf8");
const joinedPythonStrings = (source: string): string => source.replace(/["'()\s]/g, "");
/* The same idea for TypeScript: a URL long enough to wrap is written as two
 * adjacent string literals joined by `+`, so the whole of it never appears
 * contiguously in the source. */
const joinedTsStrings = (source: string): string => source.replace(/["'+\s]/g, "");

/* The service, not one layer of it. Each hydrologic level is its own layer
 * (HUC4 is 2, HUC6 is 3, HUC8 is 4) and the scope decides which is queried,
 * so pinning `/3` would say the project can only ever read six-digit units. */
const WATERSHED_SERVICE =
  "https://hydro.nationalmap.gov/arcgis/rest/services/wbd/MapServer";
const DRAWN_WATERSHED_SERVICE =
  "https://services.arcgis.com/P3ePLMYs2RVChkJx/arcgis/rest/services/" +
  "Watershed_Boundary_Dataset_HUC_6s/FeatureServer/0";
const UTAH_BOUNDARY_SERVICE =
  "https://services1.arcgis.com/99lidPhWCzftIe9K/ArcGIS/rest/services/UtahStateBoundary/FeatureServer/0";
const DROUGHT_SERVICE =
  "https://services5.arcgis.com/0OTVzJS4K09zlixn/arcgis/rest/services/USDM_current/FeatureServer/0";
const DAM_SERVICE =
  "https://geospatial.sec.usace.army.mil/dls/rest/services/NID/National_Inventory_of_Dams_Public_Service/FeatureServer/0";
const OLD_DAM_SERVICE =
  "https://services2.arcgis.com/FiaPA4ga0iQKduv3/arcgis/rest/services/NID_v1/FeatureServer/0";

describe("the authoritative source inventory", () => {
  it("records every adopted spatial service used by a fetcher", async () => {
    const inventory = await read("docs/AUTHORITATIVE-SOURCE-INVENTORY.md");
    for (const service of [WATERSHED_SERVICE, UTAH_BOUNDARY_SERVICE, DROUGHT_SERVICE]) {
      expect(inventory, `${service} is absent from the source inventory`).toContain(service);
    }

    expect(await read("tools/fetch_watershed_scope.py")).toContain(WATERSHED_SERVICE);
    /* The drawn boundaries come from Living Atlas rather than from the USGS
     * service the pipeline fetches: the pipeline needs a file it can commit,
     * the map needs features quantized to the view. Both are recorded. */
    expect(inventory).toContain(DRAWN_WATERSHED_SERVICE);
    expect(joinedTsStrings(await read("src/arcgis/watershed-layers.ts")))
      .toContain(DRAWN_WATERSHED_SERVICE);
    expect(await read("scripts/fetch-utah-boundary.mjs")).toContain(UTAH_BOUNDARY_SERVICE);
    expect(joinedPythonStrings(await read("tools/fetch_drought_monitor.py")))
      .toContain(DROUGHT_SERVICE);
  });

  /* The migration is done, so this test changed sides. It used to assert that
   * `add_dam_points.py` still named the retired layer -- the point being that
   * a half-finished migration must stay visible rather than look complete.
   * Now it asserts the opposite for every tool, which is what step 5 of the
   * inventory's migration plan asks for: "a regression test that rejects the
   * old service URL in active tools". The retired URL stays named in the
   * inventory document, because that is the record of what moved and why. */
  it("reads the dam inventory from the agency that maintains it", async () => {
    const inventory = await read("docs/AUTHORITATIVE-SOURCE-INVENTORY.md");
    expect(inventory).toContain(DAM_SERVICE);
    expect(inventory).toContain(OLD_DAM_SERVICE);
    expect(inventory).not.toContain("Migration candidate");

    for (const tool of ["tools/audit_candidate_capacity.py", "tools/add_dam_points.py",
      "tools/build_capacity_table.py", "tools/probe_huc_points.py",
      "tools/audit_connected_reservoirs.py"]) {
      const source = joinedPythonStrings(await read(tool));
      expect(source, `${tool} does not name the owner-operated dam service`)
        .toContain(DAM_SERVICE);
      expect(source, `${tool} still names the retired hosted layer`)
        .not.toContain(OLD_DAM_SERVICE);
    }

    /* The committed table and the payload that republishes it. `capacities.json`
     * credited the retired layer while already holding the owner service's
     * values, which is the failure mode a URL constant in a tool cannot catch:
     * the provenance was wrong in the file, not in the code. */
    for (const file of [
      "capacities.json", "reference.json", "admitted_reservoirs.json",
      "admitted_rise_reservoirs.json"
    ]) {
      const source = await read(file);
      expect(source, `${file} still credits the retired hosted layer`)
        .not.toContain(OLD_DAM_SERVICE);
    }
  });

  /* `build_capacity_table.py` used to find its layer by asking ArcGIS Online
   * for "National Inventory of Dams" and taking the most-viewed answer, then
   * writing whatever it found into `capacities.json`. The owner runs its own
   * ArcGIS Server and publishes nothing to ArcGIS Online, so that search could
   * never reach the authoritative copy -- and the provenance of the committed
   * table was a record of a search ranking. */
  it("pins the dam inventory rather than searching for it", async () => {
    const source = await read("tools/build_capacity_table.py");
    expect(source).not.toContain("arcgis.com/sharing/rest/search");
    expect(source).not.toContain("find_nid_layer");
  });

  /* The default for new committed geometry is 100 metres, and every file that
   * departs from it has to say so with the record that decided it. There was
   * one coarser exception (the 500-metre boundaries, ADR-005); there is now
   * one finer one instead (56 metres, ADR-037), because the outlines became a
   * drawn subject at close zoom and the generalization showed as slivers along
   * shared divides. The default itself did not move. */
  it("records the geometry default and the file that departs from it", async () => {
    const inventory = await read("docs/AUTHORITATIVE-SOURCE-INVENTORY.md");
    expect(inventory).toContain("about 100 metres");
    expect(inventory).toContain("about 56 metres, under ADR-037");
    expect(inventory).not.toContain("500-metre ADR-005 exception");
    expect(await read("tools/fetch_watershed_scope.py"))
      .toContain('MAX_ALLOWABLE_OFFSET = "0.001"');
    expect(await read("tools/fetch_drought_monitor.py"))
      .toContain("MAX_ALLOWABLE_OFFSET = 0.001");
  });

  /* The committed boundaries must actually be at the resolution the record
   * claims. A refetch at the old tolerance would otherwise pass every other
   * test in the suite silently. */
  it("carries the boundary tolerance in the file it produced", async () => {
    const boundaries = JSON.parse(await read("huc6.geojson")) as {
      geometry?: { max_allowable_offset_degrees?: number };
    };

    expect(boundaries.geometry?.max_allowable_offset_degrees).toBe(0.0005);
  });
});
