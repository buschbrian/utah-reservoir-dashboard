import { describe, expect, it } from "vitest";
import type { DrainageArea } from "../data/boundaries";
import type { Reservoir } from "../types";
import { STORAGE_CLASSES } from "../viz/classes";
import {
  DRAINAGE_LABEL_SIZE_PX,
  LABEL_FONT_FAMILY,
  LABEL_FONT_WEIGHT_BOLD,
  RESERVOIR_DETAIL_SCALE,
  RESERVOIR_LABEL_SCALE
} from "../viz/label-scales";
import { cssPixelsToPoints } from "../viz/units";
import {
  DRAINAGE_LABEL_HALO_COLOR,
  DRAINAGE_LABEL_MIN_SCALE,
  DRAINAGE_LABEL_HALO_PX,
  DRAINAGE_NAME_FIELD,
  NAME_FIELD,
  RESERVOIR_REFERENCE_LAYER_ID,
  createDrainageLayer,
  createReservoirLayer,
  createReservoirReferenceLayer,
  reservoirLabelingInfo
} from "./layers";

const square = (west: number, south: number): [number, number][] => [
  [west, south], [west + 1, south], [west + 1, south + 1],
  [west, south + 1], [west, south]
];

const reservoirNamed = (name: string): Reservoir => ({
  name,
  lon: -111,
  lat: 40,
  current_storage_af: 1000,
  capacity_af: 2000,
  pct_of_capacity: 50,
  as_of: "2026-08-14",
  source_key: "rise",
  monthly: []
} as unknown as Reservoir);

describe("the reservoir layer", () => {
  const reservoir = reservoirNamed;

  /**
   * The regression this pins is invisible in the source and only appears in
   * a painting browser: `hitTest` answers from the layer *view*, which
   * materializes the fields it can prove the layer needs. The renderer needs
   * `symbol_key`, `size_basis` and `fill_percent`, so the hit graphic came
   * back with no `name` on it and pointer selection had nothing to identify
   * a reservoir by -- until a scope change replaced the layer, after which
   * the replacement carried every field and clicking started working.
   *
   * Asserting the request rather than the answer is the point: the answer
   * needs a render loop, and there is no render loop here or in the smoke
   * test's headless browser.
   */
  it("requests every field, so a hit graphic can identify its reservoir", () => {
    const { layer } = createReservoirLayer([reservoir("Deer Creek")]);

    expect(layer.outFields).toContain("*");
    expect(layer.fields?.map((field) => field.name)).toContain(NAME_FIELD);
    expect(layer.source.at(0)?.attributes?.[NAME_FIELD]).toBe("Deer Creek");
  });
});

describe("the drainage-area layer", () => {
  it("builds one source feature and one background label per HUC6", () => {
    const areas: DrainageArea[] = [{
      huc6: "140100",
      name: "Colorado Headwaters",
      states: "CO,UT",
      // Two disconnected polygons still belong to one drainage-area feature.
      polygons: [[square(-110, 39)], [square(-108, 39)]]
    }, {
      huc6: "160202",
      name: "Jordan",
      states: "UT",
      polygons: [[square(-112, 40)]]
    }];

    const result = createDrainageLayer(areas);

    expect(result.labels).toBe(areas.length);
    expect(result.layer.source.length).toBe(areas.length);
    expect(result.labelLayer.graphics.length).toBe(areas.length);
    expect(result.layer.source.at(0)?.geometry?.type).toBe("polygon");
    expect((result.layer.source.at(0)?.geometry as { rings?: unknown[] }).rings).toHaveLength(2);
    expect(result.labelLayer.graphics.at(0)?.geometry?.type).toBe("point");
  });

  it("uses one name symbol with a half-opacity halo at the regional map scale", () => {
    const result = createDrainageLayer([{
      huc6: "160202",
      name: "Jordan",
      states: "UT",
      polygons: [[square(-112, 40)]]
    }]);
    const label = result.labelLayer.graphics.at(0);
    const symbol = label?.symbol;

    expect(result.layer.labelingInfo ?? []).toHaveLength(0);
    expect(result.labelLayer.minScale).toBe(DRAINAGE_LABEL_MIN_SCALE);
    expect(result.labelLayer.graphics).toHaveLength(1);
    expect(label?.attributes?.[DRAINAGE_NAME_FIELD]).toBe("Jordan");
    expect(symbol?.type).toBe("text");
    expect((symbol as { text?: string } | null | undefined)?.text).toBe("Jordan");
    expect((symbol as { haloSize?: number } | null | undefined)?.haloSize)
      .toBe(cssPixelsToPoints(DRAINAGE_LABEL_HALO_PX));
    expect((symbol as { haloColor?: { toCss(alpha?: boolean): string } } | null | undefined)
      ?.haloColor?.toCss(true).replaceAll(" ", "")).toBe(DRAINAGE_LABEL_HALO_COLOR);
  });
});

describe("reservoir names", () => {
  /* The drainage names could not use the label engine -- they have to sit
   * under the reservoirs and the label pass always paints above (ADR-030).
   * Reservoir names want exactly what that pass gives, including the
   * deconfliction a layer of text symbols cannot do, so the two label
   * treatments are deliberately different mechanisms and this holds them
   * apart: the drainage layer has no labelling info, the reservoir layer
   * does. */
  it("labels the reservoir layer through the SDK label engine", () => {
    const result = createReservoirLayer([reservoirNamed("Jordanelle")]);

    expect(result.labelled).toBe(true);
    expect(result.layer.labelsVisible).toBe(true);
    expect(result.layer.labelingInfo).toHaveLength(1);
  });

  it("names reservoirs from the field selection reads", () => {
    const [label] = reservoirLabelingInfo() as {
      labelExpressionInfo: { expression: string };
      labelPlacement: string;
    }[];

    expect(label?.labelExpressionInfo.expression).toBe(`$feature.${NAME_FIELD}`);
    /* Above the symbol, not beside it: the circles range from 8 to 36
     * pixels and the label engine offsets from each symbol's own box, so
     * every name clears the ring it belongs to. */
    expect(label?.labelPlacement).toBe("above-center");
  });

  /* Measured against the surfaces rather than chosen: the storage map opens
   * at 1:10,700,000, so a threshold above that would put fifty-one names on
   * the first frame of a map nobody has asked anything of yet. Tied to the
   * symbol ladder on purpose -- one threshold, and the map gets more
   * detailed in every respect at once. */
  it("holds the names back until the reader has zoomed past the opening view", () => {
    const [label] = reservoirLabelingInfo() as { minScale: number; maxScale: number }[];

    expect(label?.minScale).toBe(RESERVOIR_LABEL_SCALE.minScale);
    expect(label?.maxScale).toBe(RESERVOIR_LABEL_SCALE.maxScale);
    expect(RESERVOIR_LABEL_SCALE.minScale).toBe(RESERVOIR_DETAIL_SCALE);
    expect(RESERVOIR_LABEL_SCALE.minScale).toBeLessThan(10_700_000);
  });

  /* The containment rule from `viz/label-scales.ts`: a name inside another
   * name's shape is never larger than it. A reservoir sits inside a drainage
   * area, so its name has to be smaller and lighter than the drainage name
   * -- which is the one label on these maps drawn bold. */
  it("is smaller and lighter than the drainage-area name it sits inside", () => {
    const [label] = reservoirLabelingInfo() as {
      symbol: { font: { size: number; family: string; weight: string } };
    }[];

    expect(label?.symbol.font.size).toBeLessThan(DRAINAGE_LABEL_SIZE_PX);
    expect(label?.symbol.font.family).toBe(LABEL_FONT_FAMILY);
    expect(label?.symbol.font.weight).not.toBe(LABEL_FONT_WEIGHT_BOLD);
  });

  /*
   * Atkinson Hyperlegible Next, drawn for low-vision readability and added to
   * the SDK's 2D label fonts in 5.1. One family, and the weight as a weight.
   *
   * This shipped as four families -- "Atkinson Hyperlegible Next Bold" and
   * so on, which is how the SDK documents them -- and every label silently
   * fell back to the default sans, because 2D labels are glyph atlases
   * fetched by a slug built from the family *and* the weight: the name
   * already ending in "Regular" asked the host for
   * `atkinson-hyperlegible-next-regular-regular`, which does not exist. The
   * browser suite now watches the font host for exactly that.
   */
  it("draws the drainage names in the same family at bold weight", () => {
    const result = createDrainageLayer([{
      huc6: "160202", name: "Jordan", states: "UT", polygons: [[square(-112, 40)]]
    }]);
    const font = (result.labelLayer.graphics.at(0)?.symbol as {
      font?: { family?: string; weight?: string };
    } | null | undefined)?.font;

    expect(font?.family).toBe(LABEL_FONT_FAMILY);
    expect(font?.weight).toBe(LABEL_FONT_WEIGHT_BOLD);
  });

  /* The mistake this file exists to prevent repeating: a family name that
   * already carries its own weight. The SDK appends the weight to build the
   * glyph-atlas slug, so any family ending in a weight word asks for a font
   * that is not there and falls back without saying so. */
  it("never folds a weight into the family name", () => {
    expect(LABEL_FONT_FAMILY).not.toMatch(/\b(regular|bold|italic|light|medium)\b/i);
  });
});

describe("the reservoir reference layer", () => {
  const reservoirs = [reservoirNamed("Jordanelle"), reservoirNamed("Deer Creek")];

  it("draws and labels every reservoir under its own layer identity", () => {
    const result = createReservoirReferenceLayer(reservoirs);

    expect(result.drawn).toBe(2);
    expect(result.labelled).toBe(true);
    expect(result.layer.id).toBe(RESERVOIR_REFERENCE_LAYER_ID);
    expect(result.layer.labelingInfo).toHaveLength(1);
  });

  /* The same defect the storage layer was fixed for: a layer view
   * materializes only the fields it can prove the renderer needs, and this
   * renderer needs none at all -- so without the declaration every hover
   * would ask a hit graphic for a name it was never given. */
  it("declares every field rather than letting the layer view infer them", () => {
    const result = createReservoirReferenceLayer(reservoirs);

    expect(result.layer.outFields).toEqual(["*"]);
    expect(result.layer.source.at(0)?.attributes?.[NAME_FIELD]).toBe("Jordanelle");
  });

  /* One colour language per map (ADR-021, applied to drought as well): the
   * snow scale owns the snow map and the monitor's palette owns the drought
   * map, so these points carry no storage colour and no proportional size.
   * A single simple renderer is what enforces that -- a unique-value or
   * size-variable renderer here would be the storage map's claim smuggled
   * onto a page about something else. */
  it("carries one neutral symbol, never the storage class colours", () => {
    const renderer = createReservoirReferenceLayer(reservoirs).layer.renderer as {
      type?: string;
      symbol?: { color?: { toHex(): string } };
    };

    expect(renderer.type).toBe("simple");
    const color = renderer.symbol?.color?.toHex();
    for (const entry of STORAGE_CLASSES) {
      expect(color).not.toBe(entry.color);
    }
  });
});
