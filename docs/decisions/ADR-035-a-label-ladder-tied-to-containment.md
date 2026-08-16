# ADR-035: A label ladder tied to containment, shared with the symbols

## Status

Accepted

## Date

2026-08-16

## Context

ADR-025 fixed the map symbols and labelled each drainage area once. ADR-027
set label sizes in CSS pixels. ADR-030 moved the drainage names below the
reservoirs. Each solved one label problem for one layer.

Then the maps gained more names than any of those records anticipated:
reservoir names on all three maps, and state and county names on the drought
map (ADR-034). Four tiers of place name, each added for a good reason, with no
rule about how they relate.

The first attempt showed what happens without one. Reservoir names went on at
every scale in nine-pixel bold, which was louder than the drainage names they
sit inside and put fifty-one labels on the opening view of a map nobody had
asked anything yet. Both faults came from the same absence: nothing said how a
name should behave relative to the shape that contains it.

## Decision

`src/viz/label-scales.ts` owns the whole ladder as one table, on the same
one-table rule as the colour tables in ADR-008. It encodes two relationships,
not four numbers.

**Scale follows containment.** A state contains drainage areas, which contain
reservoirs; counties cut across both. So the tiers hand off rather than pile
up: states carry the widest views and step aside once the reader is inside one,
drainage areas hold the middle, reservoirs arrive one zoom step in from where
each map opens, counties last of all. A test asserts that no reachable scale
has three tiers on at once.

**Size follows containment, inverted.** A name inside another name's shape is
never larger than it: 12, 11, 9 and 8.5 pixels. Weight and colour carry the
rest of the hierarchy — only the drainage names, the subject of these maps, are
bold; everything else recedes into grey. A test compares the sizes, which only
works while they are comparable, which is why they live in one file.

The thresholds are placed against **measured** opening scales — 1:10,700,000
on the storage map, about 1:7,900,000 on the snow and drought cards — not
against round guesses. Any threshold above those would have blanked the view
the reader actually starts on.

`RESERVOIR_DETAIL_SCALE` is deliberately the same constant the reservoir
symbols switch on (`alternateSymbols`, SDK 5.1). Crossing one line makes the
map more detailed in every respect at once, rather than sprouting names at one
scale and symbol detail at another.

## Consequences

Adding a new kind of label means adding a row to the ladder and deciding where
it sits in the containment order — not choosing a size and a scale in
isolation.

Deconfliction handles density within a tier; the ladder handles it between
tiers. Neither substitutes for the other, and the earlier attempt to make
deconfliction do both is why the scale rule exists.

ADR-030 still stands and is the one exception the ladder does not govern:
drainage names are text symbols on their own layer so they can sit *under* the
reservoirs, which the SDK label pass cannot do. Reservoir, state and county
names use the label engine, which is what they want.

The typeface is a separate matter and is not fixed here beyond the sizes.
`LABEL_FONT_FAMILY` records the family; the weight is a weight, never folded
into a family name — a 2D label font is fetched by a slug built from both, so
a family ending in a weight word asks for a font that does not exist and falls
back silently.
