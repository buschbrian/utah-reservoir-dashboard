/*
 * When each kind of name appears, and how loud it is, in one table.
 *
 * Same rule as the colour tables (ADR-008): every map reads these rows, so a
 * label treatment cannot mean one thing on the storage map and another on
 * the drought map. What this table encodes is a ladder, and the ladder has
 * two rules.
 *
 * **Scale follows containment.** A state contains drainage areas, a drainage
 * area contains reservoirs, and a county cuts across both. So the names hand
 * off rather than pile up: states carry the widest views and step aside once
 * the reader is inside one, drainage areas hold the middle, reservoirs
 * arrive only after the reader has zoomed past the opening view, and
 * counties arrive last of all. At no scale is every name on at once. The
 * opening views measure 1:10,700,000 (the storage map) and about
 * 1:7,900,000 (the snow and drought cards), and the navigation bounds stop
 * a reader at 1:18,500,000 going out -- so those are the numbers the
 * thresholds are placed against, not round guesses.
 *
 * **Size follows containment too, inverted.** A name inside another name's
 * shape is never larger than it. Reservoirs sit inside drainage areas which
 * sit inside states, so the type gets smaller as the thing gets smaller: 12,
 * 11, 9, 8.5. Weight and colour carry the rest of the hierarchy -- only the
 * drainage names, which are the subject of these maps, are bold; everything
 * else recedes into grey. A reservoir name is a caption on a dot, not a
 * heading.
 */

/*
 * The typeface every label on every map is drawn in.
 *
 * Atkinson Hyperlegible Next, added to the SDK's 2D label fonts in 5.1. It
 * was drawn for the Braille Institute specifically to be read by people with
 * low vision: the characters that usually collapse into each other at small
 * sizes -- capital I against lowercase l, 0 against O, b against d -- are
 * given deliberately different shapes. Every label on these maps is small
 * type over a busy relief basemap, which is the exact case it was designed
 * for, and this project already treats mobile and accessibility as product
 * commitments rather than test artifacts.
 *
 * Weight lives in the family name, not in a `weight` property: these are
 * four separate font files, and asking for "bold" on the regular family gets
 * a synthesized bold at best. The bold family is used for one tier only --
 * the drainage-area names, which are the subject of these maps.
 *
 * 2D only, and served as `pbf` from Esri's font host rather than bundled. A
 * font that does not arrive falls back to the SDK's default sans, which
 * costs the typeface and never the label, so this needs no deadline of its
 * own.
 */
export const LABEL_FONT_FAMILY = "Atkinson Hyperlegible Next Regular";
export const LABEL_FONT_FAMILY_BOLD = "Atkinson Hyperlegible Next Bold";

/*
 * The type sizes, in the order the shapes nest.
 *
 * Written here rather than at four call sites because the rule they encode
 * is a relationship, not four numbers: a name inside another name's shape is
 * never larger than it. A unit test compares them, which only works while
 * they are comparable -- which only works while they live together.
 */
export const STATE_LABEL_SIZE_PX = 12;
export const DRAINAGE_LABEL_SIZE_PX = 11;
export const RESERVOIR_LABEL_SIZE_PX = 9;
export const COUNTY_LABEL_SIZE_PX = 8.5;

export interface LabelScale {
  /** Visible when the map scale is at or below this. 0 means no limit out. */
  minScale: number;
  /** Visible when the map scale is at or above this. 0 means no limit in. */
  maxScale: number;
}

/**
 * States: on from the widest view, off once the reader is well inside one.
 *
 * They exist to say where the national drought sweep is, which is a question
 * that stops being asked the moment a single drainage area fills the canvas.
 */
export const STATE_LABEL_SCALE: LabelScale = { minScale: 0, maxScale: 3_000_000 };

/**
 * The scale a reservoir stops being a dot and becomes a drawing.
 *
 * One number, used twice on purpose. Below it the map draws the composed
 * symbol -- proportional ring, proportional fill, drop shadow, dashed ring
 * for a late reading -- and writes the names. Above it, it draws a simplified
 * two-layer symbol and no names at all.
 *
 * Tying the symbol ladder to the label ladder is the whole point. A reader
 * zooming in crosses one threshold and the map gets more detailed in every
 * respect at once, rather than sprouting names at one scale and detail at
 * another. It also means the wide view is not rasterizing a half-point drop
 * shadow and a three-quarter-point inner stroke that are well under a pixel
 * at 1:10,700,000.
 */
export const RESERVOIR_DETAIL_SCALE = 4_500_000;

/**
 * Reservoirs: off at the opening view, on one zoom step in.
 *
 * Fifty-one names over the whole region at load is a busy map before the
 * reader has asked it anything. This is the threshold that keeps the first
 * frame quiet: both opening views sit above it, so the names arrive as a
 * result of zooming rather than as the page's greeting.
 */
export const RESERVOIR_LABEL_SCALE: LabelScale = {
  minScale: RESERVOIR_DETAIL_SCALE, maxScale: 0
};

/**
 * Counties: last on, and boundaries before names.
 *
 * A county layer drawn at load is the information overload this ladder
 * exists to prevent -- there are three thousand of them and they mean
 * nothing at regional scale. The outlines come in first as faint context,
 * and the names only once a county is large enough on screen to be worth
 * naming.
 */
export const COUNTY_SCALE: LabelScale = { minScale: 2_500_000, maxScale: 0 };
export const COUNTY_LABEL_SCALE: LabelScale = { minScale: 1_200_000, maxScale: 0 };
