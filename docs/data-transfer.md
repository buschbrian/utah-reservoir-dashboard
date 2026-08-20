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
| `snowpack.json` | 3,607 KB | **322 KB** |
| `reservoirs.json` | 1004 KB | 104.5 KB |
| `snow_sites.json` | 143 KB | 22 KB |
| `reference.json` | 30.1 KB | 6.5 KB |
| `data/drought/usdm-huc6.json` | 17.5 KB | 2.9 KB |
| `data/drought/usdm-huc4.json` | 10.5 KB | 2.0 KB |

Re-measured 2026-08-19, after ADR-067 dropped `geography.state`: `reference.json`
went from 36.9 KB raw / 8.8 KB gzipped to **30.1 KB / 6.5 KB**, confirming
what the retirement brief projected before the change was made. The removed
field was the whole committed `utah-boundary.geojson` -- 6.8 KB raw of the
file -- republished so the browser could paint a mask that no longer exists
now that the site draws 75 basins across 11 states rather than one. The
polygon itself is unaffected: it stays committed and reviewed for Python's
`in_utah` and `intersects_utah` classification, which is what still reads it.

Measured 2026-08-19, after S1 of
[`OPENING-SCOPE-AND-THE-WESTERN-ROSTER.md`](OPENING-SCOPE-AND-THE-WESTERN-ROSTER.md)
published a bounding box per drainage area and registered `west-huc2` for the
five region names: `reference.json` went from 7.4 KB gzipped to **8.8 KB**, a
1.6 KB gzip cost (6.6 KB raw) for 148 boxes -- 75 + 44 + 14 + 10 + 5, one per
unit across every published scope -- plus the five region names themselves.
Rounding each box outward to three decimal places (`huc.outer_bbox`) is what
kept that number this small: the source geometry is committed at five, and
two more decimals on 148 boxes was not worth the bytes for a box whose job is
"open a map here", not trace a ring. `west-huc2` costs five rows the same
shape as any other scope's, not a special case.

Re-measured 2026-08-18, after the coverage moved to the whole west (ADR-063).
The two files that carry a row per drainage area went from 14 rows to 75:
`reference.json` gained 1.2 KB on the wire and the weekly drought coverage
gained 2.0 KB. Both are roughly a fifth of what the area count did, because
what repeats between rows is keys and class names rather than values. The
scoping projected 4.8 KB for the coverage file and it came in at 2.9.

`reservoirs.json` did not move: the roster is still 69 reservoirs in 14 of the
75 areas, and the drainage codes it carries were already six digits.

Offering a second level (ADR-064) added the 44-subregion coverage file, the
HUC-4 roster and eleven subregion names in the snow payload: 2.0 KB, 0.9 KB
and 0.1 KB gzipped, and nothing else. That is the whole
cost in this project's own files, and it is the measurement the scoping made
before any of it was built -- the station payloads describe the same ground
whatever size the areas they group into are, so `snowpack.json` and
`reservoirs.json` are byte-identical at either level. A reader who never
changes the level pays none of it.

Measured 2026-08-18 before that, after Lake Mead joined the roster (ADR-062)
and the county and state fields joined every record (ADR-058, ADR-060):
`reservoirs.json` gained 1.2 KB on the wire for a reservoir and five new fields
per record. The new fields are short strings and short arrays, so they compress
well against the twelve months of numbers already in each record.

`snowpack.json` was 1,913 KB raw and 216.6 KB gzipped until ADR-052 wrote the
water-year calendar once instead of once per site: **54% off the wire**, with
all 68,540 rows verified identical after the rebuild.

## The snow network at western coverage

Measured 2026-08-19, after the inventory moved to `west-huc6`: 217 sites
became **637**, in 51 basins rather than 14, and `snowpack.json` went from
98.8 KB gzipped to **322 KB**. The scoping projected 287 KB and was 12% light.
The inventory itself, which every snow page also fetches, went from 51 KB raw
to 143 KB and costs 22 KB on the wire.

**There is no cheap encoding left to take.** Two obvious reductions were
measured against the real file rather than argued about:

| | gzipped |
|---|---:|
| as published | 304 KB |
| whole numbers written as integers rather than `0.0` | 295 KB |
| ...and a full calendar index omitted where a site has every day | 293 KB |

Together **3.6%**, for a payload encoding and a validator to match it. Fifty-
three percent of the readings are exactly zero and 579 of 637 sites carry the
whole calendar, so the raw file falls by nearly a megabyte -- and gzip had
already taken almost all of it. This is the rule at the top of this file
paying for itself: a raw byte count would have made both changes look worth
making. (Figures here are gzip -9 locally; the table above is the default
level, which is why 304 and 322 describe one file.)

The lever that remains is not an encoding. Every site carries the whole water
year because the page's subject is the shape of the season, and shortening
that is a design decision rather than a compression one.

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

ADR-048. `reference.json` published the roster -- code, name and states per
area -- and the state outline, and no drainage geometry at all. (ADR-067
later dropped the state outline too; see "The payloads" above for the
current figure.)

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
| Storage map | 1,001 KB | 30.0 KB | 210.6 KB (9 req) | **240.6 KB** |
| Drought map | 1,001 KB | 30.0 KB | 566-663 KB (23 req) | **596-693 KB** |
| Snow map | 1,001 KB | 30.0 KB | 52.2 KB (10 req) | **82.2 KB** |

Re-measured 2026-08-19 with the snow network at western coverage. Two of the
three are stable across runs; the drought map is not, and moved by 97 KB
between two consecutive runs of the same build. That is the caveat below
behaving exactly as written -- the outlines are quantized to whatever view the
page has settled at when it goes idle -- so it is published as the range it
measures at rather than as a figure that looks repeatable and is not.

The snow map fell from 120.7 KB while going from 14 drawn areas to 51, which
is recorded here as the measurement it is. No mechanism is offered for it: the
same tool, the same build and the same framing produced both numbers, and
guessing at the cause is what this file exists to stop.

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

## The roster goes west (2026-08-19)

R1 admitted the AWDB western candidates, so `reservoirs.json` carries 198
published reservoirs and 5 withdrawn rather than 69. On the wire it went from
**41.0 KB to 104.5 KB gzipped** -- measured with `gzip -9`, not projected, and
close to the 95 KB the scoping estimated.

That is the largest single move any payload on this site has made, and it is
paid on every surface that fetches the roster. It buys **40 of the 75 drawn
drainage areas holding a reservoir**, against 14 before: the storage map stops
being a Utah map with western context around it.

`reference.json` is 12.8 KB gzipped, up from 6.5 KB, because `ROSTER_SCOPE`
moved to `west-huc6` and the export now publishes the drawn scope's roster as
the roster scope's as well.

## The Bureau-only west (2026-08-20)

R2 adds 25 daily reservoirs without adding a browser request. The public
storage payload is now **1,264,362 bytes raw and 136,074 bytes (132.9 KB)
gzipped** with `gzip -9`, against 104.5 KB after R1. It publishes 223 active
reservoirs and five withdrawal notices. The transfer increase is therefore
about 28 KB compressed for the observations and comparison history of the 25
additions.

`reference.json` is **80,292 bytes raw and 14,795 bytes (14.4 KB) gzipped**.
Its increase carries 25 reviewed capacity records, including the retained
national inventory evidence and the three named operator-record overrides;
the new source-only admission roster is not copied into `dist/`.

The rebuilt `normals.json` is 939,289 bytes raw and 188,200 bytes gzipped, but
it is a pipeline input and does not ship. The same is true of the county
assignment and admission files. The first-load cost of R2 is the two public
payload increases above, not the size of all four committed artefacts.

## Generalized against full-resolution boundaries (2026-08-19)

The state and county outlines were the publisher's generalized layers on the
grounds that generalization is what you use for decoration. Measured, that
was wrong, and the measurement is worth keeping because the intuition is
strong and the arithmetic is not obvious.

Fetched **whole**, generalization is overwhelming — all states, one request:

| tolerance | generalized | full resolution |
|---:|---:|---:|
| 1000 m | 105 KB | 2,044 KB |
| 300 m | 118 KB | 5,933 KB |
| 100 m | 129 KB | 11,640 KB |

But a `FeatureLayer` never fetches a layer whole. It requests the current
view, quantized to the current resolution, and quantization discards exactly
the vertices generalization would have. Measured in place with
`tools/audit-transfer.mjs` on the drought page, which draws both layers,
twice each and reproducible to the kilobyte:

| | requests | from the boundary host |
|---|---:|---:|
| full resolution | 22 | **511 KiB** |
| generalized | 17 | 534 KiB |

The full-resolution layers are *cheaper* here, and either way the difference
is under 4% of what that page fetches from other hosts. So the site draws the
real geometry.

Counties carry a second argument that is about correctness rather than cost.
ADR-058 requires the detailed layer for the county assignment, because the
generalized one puts Lost Lake outside Wasatch County. While the drawn
outline came from the generalized layer, the line on the map could disagree
with the county this site publishes for a reservoir. One source now answers
both.

**The rule this does not change:** generalized geometry is still never used
for analysis. The numbers above are about what a browser draws, and a
41-vertex Utah cannot resolve a border whatever it costs to send.
