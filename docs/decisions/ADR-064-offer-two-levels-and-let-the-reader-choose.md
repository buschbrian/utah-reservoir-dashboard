# ADR-064: Offer two hydrologic levels, and let the reader choose

- Status: Accepted
- Date: 2026-08-18

## Context

ADR-063 moved the drawn coverage to `west-huc6`: 75 basins across the west,
all at one size. `docs/WESTERN-EXPANSION-SCOPING.md` measured the second half
of the request that produced it -- a reader-selectable hydrologic level -- and
found it cheap where it was expected to be expensive. The station payloads do
not grow at all: the same 825 SNOTEL sites and 342 reservoir stations exist
whatever size the areas they are grouped into are. What changes is the number
of *areas*, and areas are the small part of every file here.

ADR-050 has to be answered before any of it is built, because it reads like a
refusal. That record says the drawn level is the **scope's** and deliberately
**not the view's**: level is not driven by view scale, because a finer outline
a reader can point at, with no figure behind it, is less information rather
than more.

## Decision

**The site offers two levels, HUC-6 and HUC-4, and publishes every figure at
both.** HUC-6 stays the default and is what every map opens at.

**A reader-chosen level is a scope change, and ADR-050 permits it.** What
ADR-050 refuses is a level that arrives as a side effect of zooming, where the
map silently subdivides into areas the site has no numbers for. The condition
that record actually protects is that *every drawn area has a figure behind
it*, and this decision keeps it by publishing the figures rather than by
freezing the level:

- **Drought coverage** is computed per level and published per level:
  `data/drought/usdm-huc6.json` and `data/drought/usdm-huc4.json`. The engine
  reads the code from the attribute the level names and writes it back the
  same way, which is ADR-050's own rule applied on the pipeline side -- it had
  only ever been applied on the client side, and pointing the engine at a
  HUC-4 file refused it with a `KeyError`.
- **Storage banked in an area** is a sum over reservoirs grouped by code, and
  a HUC-4 group is the same sum over a coarser key. Exact rather than
  approximate: hydrologic codes are fixed-width and nest by construction, so
  `huc6[:4]` *is* the subregion, and all 75 published basins nest inside the
  44 published subregions with none left over. This is the rule the subregion
  filter has already used since ADR-060.
- **Snow percent of normal** is a mean over sites, so a HUC-4 rollup is that
  mean over the sites in the subregion. Computed from sites and never from
  averaging the HUC-6 rollups, which would be a mean of means over unequal
  site counts and simply a different number. `regionCurve` in
  `src/snow-model.ts` already computes a curve from sites with the pipeline's
  own rule, held to it by a test that recomputes a published basin.

**The archive stays at one level.** `usdm-huc6-history.json` grows with the
area count -- about 3.9 MB raw at the 520-week cap for 75 areas, against 30 MB
at HUC-8 -- and it joins its weeks on their codes, so a file holding two
levels would be two series wearing one name and the join would find nothing
rather than fail. `merge_history` now refuses a payload whose level is not the
archive's, and names `--no-history` in the error.

**HUC-8 is not offered, and is not refused on accuracy.** The drought engine's
sampled share carries about 0.08 points of error at HUC-8 against a published
precision of 0.1, which is inside it; the refusal at HUC-10 (0.21 points)
stands on its own. What makes HUC-8 a separate decision is the archive and
571 areas of hosted outlines, which is step 3 of the scoping and not this
record.

## What it cost, measured

| | HUC-6 | HUC-4 |
|---|---:|---:|
| areas | 75 | 44 |
| weekly coverage | 17.5 KB raw / **2.9 KB** gzip | 10.5 KB raw / **2.0 KB** gzip |
| engine runtime | 10.3 s | 8.5 s |

`reference.json` carries both rosters and went from 26.9 KB raw / 6.7 KB
gzipped to 30.8 KB / 7.4 KB. Nothing else grew: `reservoirs.json` and
`snowpack.json` are untouched, which is the measurement the scoping made and
the reason this was worth doing before the roster expands.

`west-huc4.geojson` was refetched at `maxAllowableOffset=0.0005` before any of
it, for the reason ADR-063 records: publishing a boundary file makes it
measurement geometry, and at the 100-metre default the same fourteen areas
moved a published drought figure by a rounding step.

## Consequences

- **Two coverage files must always describe one week.** A reader changing the
  level fetches a different file, and a file left behind would move them to
  another week with nothing said. `tools/check_drought_pair.py` now checks
  every published coverage file against the polygons rather than one of them,
  finds them by glob so a third level cannot be forgotten, and the workflow
  reverts the whole set if either recompute fails.
- **The published level is a fact each file states.** Every coverage payload
  carries `level`, and each unit's code sits under `huc4` or `huc6`
  accordingly. A client reads `huc${level}`; nothing measures a code to work
  out what it is looking at.
- **`JOINABLE_LEVEL` becomes a set.** `src/data/boundaries.ts` warns when the
  published scope is at a level the figures are not keyed to; the condition is
  now membership rather than equality, and HUC-8 would still warn.
- **The default is unchanged.** Every deep link, saved view and figure keeps
  meaning what it meant, because HUC-6 is what a reader who chooses nothing
  gets.

## Alternatives Considered

### Derive the HUC-4 figures in the client from the HUC-6 ones

- Pros: no second coverage file, no pipeline change.
- Rejected for drought, which is the only one where it is wrong: a share of
  land is an area-weighted quantity and the payload publishes no areas, so
  combining four basins' shares needs a denominator that is deliberately not
  there (ADR-046). Storage and snow *are* recombinable and are recombined,
  because their inputs -- acre-feet and per-site percentages -- travel in the
  payload already.

### Let view scale pick the level after all

- Pros: no control to design; the map subdivides as a reader zooms in.
- Rejected: this is ADR-050 exactly, and publishing figures at both levels
  does not fix what it objects to. A level that changes underneath a reader
  changes what every figure on the page counts without them asking, and the
  page is a set of figures rather than a map with a legend.

### Offer HUC-8 at the same time

- Pros: the finest level the engine holds its precision at, and the boundary
  file is already fetched.
- Rejected here, deferred to step 3: 571 areas is eight times the hosted
  outline cost measured in ADR-063, and the archive question needs its own
  answer first.
