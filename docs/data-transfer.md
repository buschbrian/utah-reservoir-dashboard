# What this site costs over the wire

Two rules before any figure below is read:

- **Gzip is what a reader actually pays.** GitHub Pages compresses the JSON,
  so a raw byte count overstates the cost several times over. The local test
  server used for the per-page measurements does *not* compress, so figures
  taken from it are raw and marked as such.
- **Re-measure rather than reason.** Every number here came from a real
  request and each one moves with things that are easy to change by accident.

## The payloads

| file | raw | gzip |
|---|---:|---:|
| `snowpack.json` | 1,170 KB | **98.6 KB** |
| `reservoirs.json` | 360 KB | 43.1 KB |
| `reference.json` | 27 KB | 6.7 KB |
| `data/drought/usdm-huc6.json` | 17.5 KB | 2.9 KB |

Re-measured 2026-08-18, after the coverage moved to the whole west (ADR-063).
The two files that carry a row per drainage area went from 14 rows to 75:
`reference.json` gained 1.2 KB on the wire and the weekly drought coverage
gained 2.0 KB. Both are roughly a fifth of what the area count did, because
what repeats between rows is keys and class names rather than values. The
scoping projected 4.8 KB for the coverage file and it came in at 2.9.

`reservoirs.json` did not move: the roster is still 69 reservoirs in 14 of the
75 areas, and the drainage codes it carries were already six digits.

Measured 2026-08-18 before that, after Lake Mead joined the roster (ADR-062)
and the county and state fields joined every record (ADR-058, ADR-060):
`reservoirs.json` gained 1.2 KB on the wire for a reservoir and five new fields
per record. The new fields are short strings and short arrays, so they compress
well against the twelve months of numbers already in each record.

`snowpack.json` was 1,913 KB raw and 216.6 KB gzipped until ADR-052 wrote the
water-year calendar once instead of once per site: **54% off the wire**, with
all 68,540 rows verified identical after the rebuild.

## Paying twice for the same bytes

Every runtime fetch used `cache: "no-store"`, which refuses the cache and so
refuses the conditional request with it. The published site answers one
happily:

```
ETag: W/"6a83a376-1de2c0"   →   If-None-Match: …   →   HTTP/1.1 304 Not Modified
```

ADR-051 switched to `no-cache`, which never serves a stored copy without
asking and never pays for one it already has. A repeat visit inside a day
costs a round trip instead of 228 KB on the snow page.

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
| Storage map | 1,001 KB | 26.9 KB | 210.6 KB (9 req) | **237.5 KB** |
| Drought map | 1,001 KB | 26.9 KB | 241.2 KB (23 req) | **268.1 KB** |
| Snow map | 1,001 KB | 26.9 KB | 120.7 KB (10 req) | **147.6 KB** |

Re-measured 2026-08-18 at western coverage (ADR-063), and this is where
publishing 75 areas instead of 14 is actually paid. The hosted outlines cost
the storage map 168 KB more and the drought map 181 KB more; the snow map is
within 4 KB of its old figure because `measuredScope` keeps it drawing the 14
areas the snow network reports in. Nothing about the arrangement changed --
the geometry is still quantized to the view and still never enters a committed
file -- there is simply five times as much of it in front of the reader.

This is the first-load figure and the lever on it is what each map draws, not
how it fetches: the drought map has a measurement for all 75 and pays for all
75, and the storage map draws the areas beyond the roster as context around 69
reservoirs. If that trade ever stops being worth 168 KB, narrowing the storage
map the way the snow map is narrowed is the change, and it is four lines.

The snow map used to be the expensive one, and the reason it was is the point
of the arrangement rather than a fault in it: its opening view is tighter, so
the quantized geometry it asks for is finer. The cost follows what is on
screen. It also means every figure in this table moves with a map's opening
extent -- re-measure rather than reason.

## What no longer ships at all

`huc6.geojson` was copied into `dist/` twice, at 652 KB each, on the belief
that it was a documented direct download. It was not documented anywhere a
reader can see -- `data.html` has never named it -- and no page has requested
it since the outlines became the hosted layer's. ADR-049 stopped publishing
it: `dist/` went from 38 MB to 37 MB, and because nothing fetched either copy,
no figure above moves. The file stays committed and stays the pipeline's
assignment source.
