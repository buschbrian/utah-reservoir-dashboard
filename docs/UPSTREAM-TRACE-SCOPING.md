# Scoping an upstream trace

> **Scoping document, not a specification.** It records what was measured on
> 2026-08-21 and what the work would be. Nothing here is built. Current
> architecture is [`docs/architecture/`](architecture/README.md).

Every figure below came from a live query against the named service on this
machine, not from its documentation. Sizes are the actual response, timings
the actual round trip.

## The question

The drought page already says the thing this feature would answer, in words,
and then cannot show it:

> A reservoir holds water that arrived in earlier years. **It collects that
> water from land far upstream.**

Today the site can say which drainage area a reservoir's *dam* sits in
(`huc6`, assigned from the dam or outlet point). It cannot say what is
upstream of that reservoir: which basins drain into it, which snow sites
measure the snow that will fill it, which other reservoirs sit above it on the
same river and are emptying into it.

That is one question with three useful answers, and they are not the same
work.

| | question | what it needs |
|---|---|---|
| **A** | What land drains to this reservoir? | one contributing-area polygon |
| **B** | Which of *our* snow sites and reservoirs are on that land? | the polygon, plus a point-in-polygon pass |
| **C** | Which reservoirs are directly above this one on the river? | a flow network, not a polygon |

A and B are cheap and are measured below. C is a different order of work and
is scoped last.

## The hydrologic codes cannot do this, and it is worth saying why

The obvious cheap answer is wrong. HUC codes nest — 140100 is inside 1401 is
inside 14 — and this project already relies on that nesting for every
regrouping it does. **Nesting is containment, not flow.** Nothing in a
hydrologic code says which of two adjacent basins drains into the other. The
Upper Colorado region (14) does drain into the Lower Colorado region (15), and
no arithmetic on "14" and "15" discovers that; the neighbouring pair 16 (Great
Basin) and 17 (Pacific Northwest) drain into each other not at all.

So an upstream trace needs a source that models the river network. There is
one, it is authoritative, and it is free.

## The USGS Network-Linked Data Index, measured

`api.water.usgs.gov/nldi` is the USGS's own index over NHDPlus. It needs no
key, it answers anonymous browser requests with `access-control-allow-origin:
*`, and it is the same agency whose Watershed Boundary Dataset this project
already computes every scope from.

Measured against two real dam points from the published roster:

| call | response | time |
|---|---:|---:|
| Flaming Gorge dam point → flowline (`/comid/position`) | 430 B | 0.38 s |
| Flaming Gorge → upstream contributing basin (`/basin`) | 73 KB | 0.37 s |
| **Lake Powell → upstream contributing basin** | **251 KB / 94 KB gzipped** | **0.48 s** |
| Flaming Gorge → upstream HUC12 pour points | 162 KB, 345 points | 1.52 s |

Lake Powell is the worst case this roster has — its contributing area is most
of the Upper Colorado, about 108,000 square miles — and it is a 94 KB gzipped
polygon fetched in half a second. That is smaller than the storage payload
this site already fetches on every page load.

The navigation endpoint also offers upstream **NWIS gauges**, **Water Quality
Portal sites** and **HUC12 pour points**, each as its own feature collection.
None of those is needed for A or B, and the pour points are one route into C.

## What the join actually returns

Answer B, run for real: the contributing-area polygon from NLDI, against the
points in this project's own published payloads, by even-odd ray cast — the
same test `huc.py` already uses to assign reservoirs to basins.

| reservoir | upstream reservoirs | upstream snow sites |
|---|---:|---:|
| Flaming Gorge | **7** of 365 | **21** of 637 |
| Lake Powell | **58** of 365 | **134** of 637 |

The answers check out against the geography. Flaming Gorge's list holds
Fontenelle, Big Sandy, Meeks Cabin and Stateline — all on the Green above the
dam. Powell's holds Blue Mesa on the Gunnison, Flaming Gorge on the Green, and
56 more.

**One detail to handle:** a reservoir's own dam point sits on the boundary of
its own contributing area and lands inside it, so Flaming Gorge appears in its
own list. That is a one-line exclusion, but it has to be a deliberate one.

This is the whole feature, and it is already this good on the first
measurement. "The snow above Lake Powell" is 134 sites the site already
publishes daily values for, and it can currently only be asked for as "the
snow in the areas Powell's dam happens to sit in", which is one basin of the
dozens that actually feed it.

## Where the work goes: precomputed, not fetched at runtime

The tempting design is a browser fetch on selection. It should not be that,
for three reasons this codebase has already settled:

1. **Polygon geometry in the browser is refused** (ADR-048, ADR-049). The
   state filter cannot clip to a state line for exactly this reason. A runtime
   trace would ship a 94 KB polygon *and* a point-in-polygon implementation to
   the client to answer a question the pipeline can answer once.
2. **An assignment that can change underneath you is not reproducible.**
   `huc.py` says this about boundaries and it is the same argument: a
   reservoir that silently changes its upstream set between two runs is an
   error nobody would catch by looking.
3. **It is 365 calls, once.** At the measured half-second each, a full
   precompute is about three minutes — a `derived-on-demand` tool like
   `build_capacity_table.py`, not a step in the daily refresh.

So: a new tool writes a committed reference file keyed by station id
(ADR-066), holding for each reservoir the upstream reservoir stations, the
upstream snow stations, and the NLDI COMID the trace was taken from. The
payload gains an `upstream` block per reservoir the way it gained `huc6`. No
geometry is published — the polygon is the tool's input, never the output.

## Estimated shape of the work

| slice | what | rough size |
|---|---|---|
| 1 | `tools/build_upstream_index.py` — position → comid → basin → point-in-polygon, written to a committed reference file with the COMID as evidence | the bulk of it |
| 2 | Admission-style review: the trace is evidence and needs a screen. A reservoir whose trace returns nothing, or returns the whole west, is a bad match, not an empty answer | small, and load-bearing |
| 3 | Payload: an `upstream` block, its schema version, its documentation on `data.html` | small |
| 4 | Surfaces: "the snow above this reservoir" on the detail panel, and an upstream filter on the snow page | the interesting part |
| 5 | ADR: what an upstream set means, what it does not, and the self-inclusion rule | one record |

## What this cannot answer, and should say so

**Answer C is not in scope above.** "Which reservoirs are *directly* above this
one" needs the flow network rather than the contributing polygon — an upstream
set is unordered, so Fontenelle and Big Sandy are both above Flaming Gorge and
nothing in the polygon says Fontenelle is above Big Sandy. NLDI's flowline
navigation carries that order, and `pathlength` on each flowline is the
distance downstream, so the ordering is reachable. It is a second tool and a
second reference file, and it should not be attempted in the same change.

**A trace is about water, not about operations.** A reservoir upstream of
another is not necessarily released into it on any schedule a reader could
predict — transbasin diversions move Colorado water to the east slope, and
several of the reservoirs in these lists are on the sending end of one. The
surfaces in slice 4 must say "upstream of", never "feeds" or "supplies".

**The polygon is NHDPlus's, not this project's.** It will not agree exactly
with the WBD basin boundaries the maps draw, because they are two different
products at two different resolutions. A trace result is a set of stations, and
publishing the polygon beside a WBD outline would put two disagreeing lines on
one map.

## Sources, all authoritative and all keyless

| service | what it gives |
|---|---|
| `api.water.usgs.gov/nldi` | flowline for a point, upstream contributing basin, upstream gauges and pour points |
| `hydro.nationalmap.gov/.../wbd/MapServer` | the WBD levels, already in use (ADR-073) |
| `hydro.nationalmap.gov/.../NHDPlus_HR/MapServer` | already cited in `huc.py` for the reviewed waterbody points |
