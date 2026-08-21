# ADR-073: Draw the regions too, and read them from their own publisher

- Status: Accepted
- Date: 2026-08-21

## Context

`west-huc2` — the five hydrologic regions this dashboard covers — has been
published in `reference.json` since the western scope landed, and drawn
nowhere. That was deliberate. Decision D2 in
[`docs/OPENING-SCOPE-AND-THE-WESTERN-ROSTER.md`](../OPENING-SCOPE-AND-THE-WESTERN-ROSTER.md)
put it this way: a region is an **entry vocabulary** a reader narrows the
existing view with — `?area=14` — not a size the ground is drawn at. Drawing
five regions would mean five drought rows and five storage groups, "a coarser
answer to a question nobody asked".

That reasoning was sound while the level was the *site's* to choose. ADR-064
changed which question is being asked: it made the level a control, offered
HUC-6 and HUC-4, and kept HUC-6 as the default every map opens at. Once a
reader can pick the size, "nobody asked" stops being a property of the level
and becomes a property of the reader — and a reader looking at the whole west
has a real question the 75-basin view answers badly, which is how the five
regions compare with each other.

ADR-064 also set the condition any new level has to meet, and it is the only
one that matters: **every drawn area has a figure behind it.** A level offered
without figures is a control that empties the map.

## Decision

**Regions are the third offered level.** `?level=2`, "Regions" in the Area
size control, and HUC-6 still the default and still what every map opens at.
Nobody is given five regions unasked.

Every figure exists there, by the same three routes ADR-064 established:

- **Drought coverage** is computed at the level and published at it:
  `data/drought/usdm-huc2.json`, written by the same engine from the same
  polygons, committed with the other two and checked against them by
  `tools/check_drought_pair.py` — which needed no change, because it finds
  the coverage files rather than listing them.
- **Storage banked in an area** is a sum over reservoirs grouped by code, and
  a region is that sum on a two-digit key. Exact, not approximate: all 75
  published basins nest inside the five published regions with none left over.
- **Snow percent of normal** is a mean over the sites in the region, rebuilt
  from the sites and never by averaging basin means.

**And so does every area's name.** This is the half that was nearly missed.
`payloadAtLevel` labels a coarser area from a roster published beside the
figures, and the only roster published was `subregions` — a HUC-4 table that
holds "Colorado Headwaters" for 1401 and says nothing about what 14 is called.
Drawing regions against it labelled every one of them by code, and the snow
picker read **"14 (137 sites)"**. That is precisely the failure `west-huc2`
was published to prevent in the first place. Both payloads now carry a
`regions` table beside `subregions`, built by one `coarser_roster` function
that takes the level.

**Level 2's outlines come from the Watershed Boundary Dataset's own
publisher.** `hydro.nationalmap.gov` is the USGS service this project's
pipeline already computes every scope and every drought coverage figure from
(`watershed_scopes.py`), and until now the browser drew Esri's republication
of the same data while the numbers were computed from the original.

It can do everything the hosted layers do. `supportsCoordinatesQuantization`
is true and PBF is among its query formats, so the view-quantized binary
request the drainage layer depends on works there unchanged; it answers
anonymous browser requests with `access-control-allow-origin: *`; and it
publishes `huc2`, `name` and `states`, which are exactly the three fields the
layer asks for.

**`connect-src` gains one named host to reach it.** That is a real widening of
a published security policy and is stated as such: `https://hydro.nationalmap.gov`,
a single host named exactly, narrower than either wildcard already in the
directive. ADR-034 chose the Living Atlas partly because "the content policy
already allows the host", and that convenience is what had been deciding which
publisher this site reads its geography from.

**Levels 4, 6 and 8 stay on the Living Atlas for now.** The two agree —
queried for Colorado Headwaters both return the identical extent to five
decimal places — and differ only in resolution, USGS returning 2,180 vertices
against Esri's 31,977 for that basin. Moving them is a change to what every
existing map draws rather than an addition, and it belongs in its own commit
with its own before and after.

## What it costs, measured

| | gzipped | areas |
|---|---:|---:|
| `usdm-huc2.json` | **796 B** | 5 |
| `usdm-huc4.json` | 2,125 B | 44 |
| `usdm-huc6.json` | 3,533 B | 75 |

The coarsest level is the cheapest thing on the site: a fifth of the HUC-6
coverage file, a fifteenth of the outlines, and no change at all to the
station payloads — the same 637 snow sites and 365 reservoirs exist whatever
size the areas they are grouped into are, which is the measurement ADR-064
already made and the reason a third level was cheap to add.

## Consequences

**HUC-8 is still absent, and for its own reason.** 571 areas is eight times
the hosted-outline cost ADR-063 measured, and the drought engine's sampled
share stops holding the published precision below it. Nothing here changes
that; regions cost the opposite of subbasins.

**`?level=2` is a saved link now.** The parameter already accepted any level
the export offered, so the only thing that changed is which ones it offers.
A link written before this still resolves the same way.

**Two publishers serve one dataset.** That is a state worth naming rather
than tidying over, and `watershed-layers.ts` names it: level 2 from USGS,
levels 4, 6 and 8 from Esri, with the reason and the measurement in the file.
The tests assert both facts separately so neither can move quietly.

## Related

- Extends [ADR-064](ADR-064-offer-two-levels-and-let-the-reader-choose.md)
  from two levels to three, and meets its condition — every drawn area has a
  figure behind it — by the same three routes.
- Supersedes decision D2 of
  [`docs/OPENING-SCOPE-AND-THE-WESTERN-ROSTER.md`](../OPENING-SCOPE-AND-THE-WESTERN-ROSTER.md)
  on the narrow question of whether regions are drawn. That document is a
  journal and is left as written; this record is where the change lives.
- Narrows [ADR-034](ADR-034-hosted-boundary-layers-with-a-deadline.md) for
  one level, and leaves the rest of it standing.
- Rests on [ADR-050](ADR-050-the-drawn-level-is-the-scopes-not-the-views.md):
  the level is still the scope's and still not the view's. A reader chooses
  it; zooming never changes it.
