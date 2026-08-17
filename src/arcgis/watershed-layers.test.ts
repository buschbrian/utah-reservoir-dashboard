/*
 * The parts of the hosted watershed source that are decidable without a
 * network: which service a level maps to, and the clause that scopes it.
 *
 * The clause is the one worth testing hardest. It names every unit in scope
 * explicitly, because the published scope is not a code prefix -- it is
 * "touches Utah and is not the Columbia" -- and a clause that silently
 * matched more than the scope would put basins on the map that no figure on
 * the page describes.
 */
import { describe, expect, it } from "vitest";

import {
  DRAWABLE_LEVELS,
  watershedCodeField,
  watershedScopeClause,
  watershedServiceUrl
} from "./watershed-layers";

describe("which service a hydrologic level comes from", () => {
  it("serves every level the project can draw", () => {
    expect(DRAWABLE_LEVELS).toEqual([4, 6, 8]);
    for (const level of DRAWABLE_LEVELS) {
      expect(watershedServiceUrl(level)).toContain(
        `Watershed_Boundary_Dataset_HUC_${level}s`);
    }
  });

  /* The same organisation the state and county boundaries already come from
   * (ADR-034), which is why the content policy needs no widening and ADR-004's
   * no-key rule is untouched. */
  it("stays on the organisation the other borrowed boundaries come from", () => {
    for (const level of DRAWABLE_LEVELS) {
      expect(watershedServiceUrl(level))
        .toContain("services.arcgis.com/P3ePLMYs2RVChkJx");
    }
  });

  /* Finer levels are absent on purpose rather than missing: the drought
   * engine's sampled share carries about 0.21 points of error at HUC-10
   * against a published precision of 0.1. */
  it("refuses a level it will not draw, and says which it will", () => {
    expect(() => watershedServiceUrl(12)).toThrow(/level 12/);
    expect(() => watershedServiceUrl(12)).toThrow(/4, 6, 8/);
    expect(() => watershedServiceUrl(5)).toThrow();
  });

  it("names the code field after the level", () => {
    expect(watershedCodeField(4)).toBe("huc4");
    expect(watershedCodeField(6)).toBe("huc6");
    expect(watershedCodeField(8)).toBe("huc8");
  });
});

describe("scoping the layer to the published units", () => {
  it("names every unit rather than matching a prefix", () => {
    expect(watershedScopeClause(6, ["140100", "160202"]))
      .toBe("huc6 IN ('140100','160202')");
  });

  it("asks the level's own field", () => {
    expect(watershedScopeClause(8, ["14010001"]))
      .toBe("huc8 IN ('14010001')");
  });

  /* An empty scope draws nothing. The alternative -- an absent clause -- is a
   * layer with no `definitionExpression`, which is every basin in the country
   * rather than none of them, and it would arrive looking like a working map. */
  it("draws nothing when the scope is empty, rather than everything", () => {
    expect(watershedScopeClause(6, [])).toBe("1=0");
  });
});
