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

## What is still additive

`reference.json` is **still fetched in full on every map page**, because the
drainage-area codes and names come from it and the snow map fills each basin by
a value the hosted service has never heard of. Until that is retired the hosted
layers are on top of the file rather than instead of it, and the page-level
figure has gone up, not down. Retiring it is the remaining work.
