# ADR-048: Publish the drainage roster, not the drainage polygons

## Status

Accepted

## Date

2026-08-17

## Context

ADR-018 put the reference half of the data into one versioned export, and it
was right about the shape: one file, one `schema_version`, every named scope
in it, the published one named rather than assumed. That decision stands.

What did not survive contact with a western scope is *what* was in it. The
drainage polygons were **982 KB of a 1,001 KB file**, and the file is fetched
whole by every map page on every load — `src/data/fetch.ts` sets
`cache: "no-store"`, so it is fetched again on every visit, not once. Then
`parseDrainageAreas` walked it: every feature, every ring, every coordinate
pair, type-checked on the main thread before the map could draw.

That was affordable at fourteen areas. The measured western equivalent is
about 8.2 MB at HUC-6 and 57 MB at HUC-8, which is not a slower version of
the same page — it is a different page, one that hangs before it paints.

ADR-047 had already moved every map's outlines to the hosted Watershed
Boundary Dataset, quantized to whatever the reader is looking at. So by the
time this was written the geometry in `reference.json` was being fetched,
parsed and then not drawn from by anything.

The one surface that looked like it still needed the shapes was the snow map,
which fills each drainage area by this project's own percent of normal — a
number no hosted renderer has ever heard of. That turned out to be a
misreading of what "needs the geometry" means: it needs *one symbol per
area*, which a unique-value renderer keyed on the area code states exactly,
without the browser seeing a coordinate.

## Decision

`reference.json` publishes the drainage **roster** — code, name and states per
area — and no drainage geometry. `schema_version` goes to 2, and a reader on
the old shape gets the treatment ADR-018 already specified for a version it
does not recognise: no boundaries at all, rather than a best effort at
parsing.

The state outline stays in the file, whole. It is 19 KB, both maps mask with
it, and no hosted service publishes the reviewed UGRC polygon.

`huc6.geojson` does not go away. It stays committed, the pipeline still
assigns every reservoir with it, `source_file` still names it, and it stays
published as the documented direct download it already was. It simply stops
travelling inside the payload every page fetches — committed and reviewable
without being pushed at every reader, exactly as `normals.json` already is.

**The ADR-018 guarantee is kept, not traded away.** The point of committed
boundaries was that a drawn outline could never disagree with the drainage
area a reservoir was assigned to. The codes published here are still read out
of that same committed file, in its order, and a test asserts it. What the
reader is handed is the same roster; only the shapes come from elsewhere, and
they come from the dataset the committed file was itself cut from.

## Consequences

Measured, per page, everything each one fetches to draw its geography:

| page | before | after |
|---|---:|---:|
| Storage map | 1,001 KB | **63.7 KB** |
| Drought map | 1,001 KB | **81.6 KB** |
| Snow map | 1,001 KB | **145.7 KB** |

`reference.json` itself went from **1,024,952 bytes to 21,714** — a 47-fold
reduction on a file every map page fetches on every load. The main-thread
coordinate walk is gone with it, which does not show up in any of these
numbers and is the part a reader feels first.

The snow map is the expensive one now, and the reason is worth recording: its
opening view is tighter than the other two, so the quantized geometry it asks
for is finer. That is the cost behaving exactly as intended — proportional to
what is on screen rather than to the size of the scope — but it does mean the
figures above will move with any change to a map's opening extent, and they
should be re-measured rather than reasoned about.

Three functions are gone rather than kept: `parseDrainageAreas`,
`createDrainageLayer`, and `drainageLabelPoint`, which existed to find an
interior label point for a text symbol that no longer exists. So is
`queryWatershedShapes`, written for the snow map on the assumption above — it
was quietly expensive and did not look it, moving 935 KB as binary and 4.7 MB
as JSON, because `queryFeatures` on a layer answers at full source resolution
and is not the view's quantized request.

## Alternatives considered

**Keep the geometry and generalize it harder.** Rejected on measurement: this
layer ignores `maxAllowableOffset` entirely — every offset from 56 m to 2 km
returns byte-identical results. Generalization is not the lever; quantization
is, and only the view can apply it.

**Split `reference.json` per region and fetch the reader's own.** Rejected as
premature and as the wrong axis. It keeps the client parsing geometry, and it
makes the page's cost follow which region a reader is in rather than what
they are looking at.

**Drop `reference.json` and read the roster from the hosted service.** It
would work, and it is one fewer file. Rejected because the roster is the
thing that must agree with `reservoirs.json`, and asking a third party what
the scope is puts that agreement outside this repository's control.

## Related

- Amends [ADR-018](ADR-018-reference-data-ships-as-one-versioned-export.md),
  which keeps its shape and its guarantee and loses its polygons.
- Follows [ADR-047](ADR-047-let-the-label-engine-place-drainage-names.md),
  which moved the outlines the payload existed to carry.
- The measurements and the method are in `docs/data-transfer.md`.
