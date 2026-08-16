# ADR-037: Refetch the drainage boundaries at the resolution the source stops adding detail

## Status

Accepted — supersedes ADR-005

## Date

2026-08-16

## Context

ADR-005 committed one generalized boundary file at about 500 metres, and
measured that choice honestly: it saved 455 KiB against the 100-metre
candidate and moved no reservoir assignment. Both halves were true and both
are still true.

What the measurement did not cover is how the file *renders*. In 2026-08 the
drainage outlines went from context on one map to a drawn subject on three,
carried the drought view's per-area figures, and gained navigation that lets a
reader zoom to a dam. At those scales the 500-metre generalization is visible
as what it is: adjacent units whose shared divide was simplified independently
no longer meet, so the boundaries show slivers and gaps along ridgelines that
do not exist in the source.

ADR-024 had already found the related problem from the other direction. Snow
sites sit on divides — Hoosier Pass, McClure Pass and Parleys Summit are 4 to
65 metres from one — so their basin assignment was moved to the full-resolution
Watershed Boundary Dataset. Assignment was correct; only the drawn geometry was
coarse.

## Decision

Refetch `huc6.geojson` at `maxAllowableOffset=0.0005`, about 56 metres, and
make the tolerance a command-line flag on `tools/fetch_watershed_scope.py`
rather than a constant, because it is a decision with a measured trade-off
rather than a detail of how the query is built.

**56 metres is not a preference; it is where the source stops answering.**
Measured against the U.S. Geological Survey service for these fourteen units:

| tolerance | vertices | gzip |
|---|---|---|
| 557 m (ADR-005) | 6,008 | 39 KiB |
| 111 m | 25,057 | 135 KiB |
| **56 m** | **29,856** | **193 KiB** |
| 11 m | 29,887 | — |
| full | 29,891 | — |

Going from 56 m to full precision adds 35 vertices — one tenth of one percent
more geometry — and multiplies the transfer. Everything past 56 m is decimal
places, not detail.

## Consequences

The committed file goes from 39 KiB to 193 KiB gzipped, and `reference.json`,
which repackages the same rings into the public API contract, goes from 151 KiB
to 305 KiB. That is the price, stated plainly: about 150 KiB more on each of
the three map pages, against roughly 5 MiB those pages already fetch from
basemap and service hosts.

**ADR-005's analytical claim survives intact, and this is worth recording
because it is the evidence that the change was about rendering and nothing
else.** Recomputing the weekly drought coverage on the finer geometry moved
the largest single class share by **0.10 percentage points**, on two of
fourteen areas; every other figure was unchanged. The 500-metre file was never
producing wrong numbers.

Two constants moved with the file and had to move in lockstep, in the same way
the colour table does (ADR-008). `HUC6_BOUNDS` is the bounding box of the
committed rings, and finer geometry found true extremes that the generalization
had cut the corners off — about a hundred metres. It is now carried at full
five-decimal precision rather than rounded to three, because three decimals
cannot both contain every polygon and stay inside the test's tolerance against
the file. It lives in `src/viz/extent.ts` and in the frozen oracle
`shared/reservoir-viz.js`, and a test compares them.

The drought coverage scanline still runs in about two seconds on the finer
rings, so nothing in the weekly automation needed to change.

The 100-metre default for *new* committed GeoJSON in the source inventory is
unchanged. This record moves one file, for a stated rendering reason, on a
measurement. It is not a general instruction to fetch everything finer.
