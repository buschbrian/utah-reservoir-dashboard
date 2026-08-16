# ADR-028: Use equal storage bands and a colorblind-safe ramp

## Status

Superseded by ADR-039 (the bands stand; the ramp does not)

## Date

2026-08-14

## Context

The five storage classes used a red-to-green ramp and uneven breaks at 25%,
50%, 75%, and 90%. Red and green are difficult to distinguish for common
forms of color-vision deficiency. The uneven final bands also made the key
harder to learn and put only two of the 69 published reservoirs in the top
class, while the first three classes each covered 25 percentage points.

Storage is an ordered quantity, but readers also need to see the practical
difference between reservoirs below and above half full. Direct percentage
labels and accessible tables remain available anywhere the colours appear.

## Decision

Use five equal 20-point bands with breaks at 20%, 40%, 60%, and 80%.

Use ColorBrewer's five-class RdYlBu palette, ordered from low-storage red to
high-storage blue:

- `#d7191c`
- `#fdae61`
- `#ffffbf`
- `#abd9e9`
- `#2c7bb6`

The direction is intentional. Low storage carries the warning red; high
storage carries the water-associated blue. The pale middle colours are fills,
not text backgrounds, and every map or chart mark gives them a visible edge.

ADR-008 still governs where these values live: `CLASSES` in
`shared/reservoir-viz.js` remains the single source of truth, and the typed
copy is tested value for value.

## Alternatives Considered

### Keep the uneven breaks and only change the colours

- Rejected. The narrow 90% to 100% band was sparsely populated and made the
  key harder to explain without adding useful precision.

### Use a single-hue sequential blue scale

- Pros: a conventional encoding for one ordered quantity.
- Rejected for now: it makes very low storage less immediately distinct. The
  chosen scale keeps warning and water states clear while direct values avoid
  treating the midpoint as a separate category.

### Put red at the high end

- Rejected. It would make a fuller reservoir look like the warning state.

## Consequences

- Legends and filters use five regular intervals that are easier to scan.
- The current payload is distributed 14, 20, 18, 11, and 6 reservoirs across
  the five bands, rather than 20, 24, 16, 7, and 2 under the former breaks.
- Red and green are no longer the two ends of the storage scale.
- Exact percentages, outlines, chart labels, and data tables remain necessary;
  colour is never the only way to read a value.
