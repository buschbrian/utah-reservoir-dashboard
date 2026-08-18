# Scoping the west, and reader-selectable hydrologic levels

Scoped 2026-08-18. Every figure below came from a live query or a real run on
this machine, not from documentation and not from scaling the Utah figure by a
ratio of basin counts — telemetry density is not uniform, and the Pacific
Northwest carries far more snow sites per basin than the Great Basin does.

## The two axes are independent, and one of them is already free

The question arrived as one thing and is two.

**Coverage** is which basins exist in the scope. **Level** is how finely that
same geography is divided. The registry in `watershed_scopes.py` already
models them separately, and three western scopes are registered with
`published=False` and their boundaries fetched: `west-huc4`, `west-huc6`,
`west-huc8`.

One clarification worth making first, because it changes what the work is.
The 14 basins published today are **complete basins that happen to touch
Utah** — ADR-053 scopes by where the water goes, not by longitude, and
nothing is cut at a state line. So "see the entire watershed, not just the
ones intersecting Utah" is a request for *more basins*, not for *unclipped*
ones. The basins already published are whole.

## Measured: what is actually out there

A live AWDB query across every state regions 14–18 reach (CO, UT, WY, NM, AZ,
NV, CA, OR, WA, ID, MT) returned **825 SNOTEL stations** and **342 reservoir
stations**. Assigned to each scope by the pipeline's own point-in-polygon
rule:

| scope | areas | snow sites | reservoir stations |
|---|---:|---:|---:|
| `utah-connected` (today) | 14 | 217 | 86 |
| `west-huc4` | 44 | **639** | **225** |
| `west-huc6` | 75 | **639** | **225** |
| `west-huc8` | 571 | **639** | **225** |

**The station counts are identical across all three western scopes.** They
describe the same ground at three resolutions, so the level changes how many
*areas* the stations are grouped into and not how many stations there are.

That is the central result. **Choosing a hydrologic level is free in the
expensive payloads.** It costs only in the roster and the drought coverage
rows, both of which are small. The reader-selectable level the request asks
for is the cheap half of this work.

One caveat on 225: that is the AWDB BOR network alone. Today's published
reservoirs come from RISE and AWDB together, so 225 is a **floor** for the
western reservoir count, not a total. RISE will add to it.

## Measured: what expansion costs over the wire

Per-record costs measured from the committed payloads, and gzip ratios
measured on the real files rather than assumed (ADR-051, ADR-052):

| payload | today | gzip ratio | per record |
|---|---|---:|---:|
| `reservoirs.json` | 340 KB raw / **41 KB gzip** | 8.2× | 3,442 B |
| `snowpack.json` | 1,170 KB raw / **99 KB gzip** | 11.9× | 5,261 B |
| `reference.json` | 21 KB raw / **5.5 KB gzip** | 3.8× | — |
| `usdm-huc6.json` | 3.4 KB raw / **0.9 KB gzip** | 3.7× | 249 B |

Projected at western coverage:

| payload | today | west | change |
|---|---:|---:|---:|
| `reservoirs.json` | 41 KB | **~108 KB** | 2.6× |
| `snowpack.json` | 99 KB | **~287 KB** | 2.9× |
| drought coverage, HUC4 | — | ~3 KB | — |
| drought coverage, HUC6 | 0.9 KB | **4.8 KB** | measured |
| drought coverage, HUC8 | — | **36 KB** | measured |

The storage map's first load goes from about 47 KB to about 113 KB gzipped.
That is still a small page. **The snow page is the real cost**, roughly
tripling to 287 KB, and it is already the heaviest thing here.

Geometry stays free. ADR-048 and ADR-049 publish the roster and not the
polygons, and outlines come from the hosted Watershed Boundary Dataset
quantized to the view. The fetched western files are large — 771 KB, 914 KB
and 2,057 KB gzipped for HUC4, HUC6 and HUC8 — and none of it reaches a
browser. `WBD_LAYER_BY_LEVEL` already maps every level to its service layer.

## Measured: what expansion costs to compute

The drought engine, run for real against the committed weekly polygons:

| scope | areas | runtime | output |
|---|---:|---:|---:|
| today | 14 | ~2 s | 3.4 KB raw |
| `west-huc6` | 75 | **8.8 s** | 18 KB raw |
| `west-huc8` | 571 | **23.8 s** | 133 KB raw |

All three are comfortable inside a daily job. Compute is not the constraint,
which is worth saying because it looked like it would be.

## The one thing that does not scale

`usdm-huc6-history.json` is capped at 520 weeks — ten years — and grows with
the number of areas. At roughly 100 bytes per area-week:

| level | areas | archive at the 520-week cap |
|---|---:|---:|
| today | 14 | ~0.7 MB raw |
| `west-huc6` | 75 | ~3.9 MB raw |
| `west-huc8` | 571 | **~30 MB raw** |

Thirty megabytes is not a file this project should publish, and the cap is
what bounds it rather than anything about the data. Note that nothing fetches
this to draw a week-over-week change — the current coverage file carries its
own previous week for exactly that reason — so the archive serves series work
only.

**Recommendation: publish coverage at every offered level, and the archive at
one.** HUC6 is the natural home for it. A reader choosing HUC8 still gets
this week and last week, because those travel in the coverage file.

## What this suggests doing, in order

1. **Publish `west-huc6`.** It is the coverage change the request is really
   asking for: 75 whole basins instead of 14, the same level everything is
   already keyed at, and no new level machinery. The registry, the boundary
   file, and the level plumbing (ADR-050) all exist.

2. **Then add the level selector**, HUC4 and HUC6 first. Free in the
   expensive payloads, per the measurement above. This needs a decision
   recorded against ADR-050: that record says the drawn level is the *scope's*
   and deliberately not the *view's*, and a reader-chosen level is a scope
   change rather than a view-scale change — so it is permitted by ADR-050 and
   should say so explicitly rather than appearing to contradict it.

3. **HUC8 last, and only with the archive pinned to HUC6.** It is the finest
   level the drought engine holds its published precision at (0.21 points of
   error at HUC-10 against a published 0.1), so it is the floor, and the
   archive is the reason to treat it as a separate decision.

4. **Watch the snow page.** 287 KB gzipped is the number to re-measure after
   step 1, not to predict. ADR-052's write-the-calendar-once encoding already
   absorbs part of this, since sites index into a shared date array.

## Open questions this did not answer

- **How many reservoirs does RISE add** on top of the 225 AWDB stations? That
  needs a RISE catalog query, and it is the one number here that is a floor
  rather than a measurement.
- **Does `normals.json` have to grow with the roster?** It is rebuilt by a
  ~20-minute job over 30 years for 69 reservoirs. At 225-plus that is over an
  hour, still off the build path, but worth knowing before it is a surprise.
- **What happens to the details panel and the reservoir list at 225 rows?**
  The list already scrolls in its own box; whether it stays usable is a design
  question rather than a data one.
