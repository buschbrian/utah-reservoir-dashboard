# What the drainage boundaries cost over the wire

Measured, not estimated. Every figure here comes from a real page load against
a built `dist/`, counting response bodies by host and path — the same method
`tools/audit-transfer.mjs` uses, run per layer rather than per page.

Re-take these after any change to how the boundaries are fetched, and widen or
correct the numbers rather than reasoning from the old ones.

## The committed file this replaces

The drainage-area geometry used to reach the browser inside `reference.json`:

| | |
|---|---|
| `reference.json` whole | **1,001 KB** |
| of which boundary geometry | **982 KB** |
| Fetched on | every map page, every load (`cache: "no-store"`) |
| Parsed by | `parseDrainageAreas`, on the main thread, every coordinate pair |

## Hosted, quantized to the view

The SDK asks for the features in the current view, generalized to the
resolution that view can show, as binary PBF. Fourteen published basins:

| view | committed | hosted |
|---|---:|---:|
| ~1:18,000,000 | 982 KB | 12 KB |
| ~1:9,000,000 | 982 KB | 24 KB |
| ~1:4,600,000 | 982 KB | 47 KB |
| ~1:1,200,000 | 982 KB | 176 KB |

The same fourteen fetched in bulk without quantization are 935 KB as PBF and
4.7 MB as JSON, so **the saving is the quantization, not the hosting**. It also
follows the viewport rather than the size of the scope, which is the property
that makes a western scope possible at all.

## The drought map pays twice, on purpose

Its boundaries are cased — a wide bright pass under a narrow dark one — because
the map is drawn over the Drought Monitor's palette, where a single line is
invisible on either the palest or the darkest class depending on which colour it
is. A casing only works if every casing is down before any core is drawn;
within one layer that ordering is not ours to choose, so a neighbour's casing
paints over a shared edge. Two layers over one service is what buys the
ordering.

Measured at the drought map's opening view, one build against the other, same
viewport:

| | requests | bytes |
|---|---:|---:|
| Service metadata, one layer | 1 | 3.1 KB |
| Features, one layer | 13 | 27.1 KB |
| **One layer, total** | **14** | **30.2 KB** |
| Service metadata, two layers | 2 | 6.2 KB |
| Features, two layers | 26 | 54.2 KB |
| **Two layers, total** | **28** | **60.4 KB** |

**Exactly 2.00×.** Nothing is shared between the two layer instances — not the
service metadata, not a single feature query — so the doubling is the whole
doubling, with no cache relief to hope for.

It is worth it at this size. Doubled, the cased boundary is **60.4 KB against
the 982 KB** of committed geometry it replaces: still a sixteenfold reduction,
and still proportional to the viewport rather than to the scope. The number to
watch is not this ratio but the base, because the base grows with how much of
the west is on screen.

### The alternative, and why it was not taken

One layer carrying a CIM symbol with two stroke layers would halve this. It was
not taken because whether the SDK draws CIM symbol layers as separate passes
across all features — which is what makes the casing correct — cannot be
verified in the environment available here: **the ArcGIS canvas renders blank
in headless Chromium**, so the artifact this exists to prevent is exactly the
thing no automated check can see. Two layers are correct by construction. If
the base ever grows enough for 2× to matter, the CIM version is the first thing
to try, and it needs a person's eye on a real browser to accept.

## The payload, after the polygons left it

ADR-048. `reference.json` publishes the roster -- code, name and states per
area -- and the state outline, and no drainage geometry at all.

| | bytes |
|---|---:|
| Before | 1,024,952 |
| After | **21,714** |

A 47-fold reduction on a file every map page fetches on **every** load, since
`src/data/fetch.ts` sets `cache: "no-store"`. The main-thread coordinate walk
that came with it is gone too, which appears in none of these numbers and is
the part a reader feels first.

## What each page now pays for its geography

Everything fetched to draw the areas, measured per page against a built
`dist/`:

| page | before | reference.json | hosted | after |
|---|---:|---:|---:|---:|
| Storage map | 1,001 KB | 21.2 KB | 42.5 KB (10 req) | **63.7 KB** |
| Drought map | 1,001 KB | 21.2 KB | 60.4 KB (28 req) | **81.6 KB** |
| Snow map | 1,001 KB | 21.2 KB | 124.5 KB (14 req) | **145.7 KB** |

The snow map is the expensive one, and the reason is the point of the whole
arrangement rather than a fault in it: its opening view is tighter, so the
quantized geometry it asks for is finer. The cost follows what is on screen.
It also means every figure in this table moves with a map's opening extent --
re-measure rather than reason.

## What still ships that nobody fetches

`huc6.geojson` is still copied into `dist/` twice, at 652 KB each, because it
is a documented direct download and was one before any of this. No page
requests it. That is deploy weight rather than reader weight, and it is a
separate decision from this one.
