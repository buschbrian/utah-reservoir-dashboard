# ADR-042: Sink the basemap's reference layers below this project's data

- Status: Accepted
- Date: 2026-08-16

## Context

A reader reported a grey line drawn straight through Flaming Gorge. The
reservoir sits on the Utah–Wyoming border, so the line was obviously a state
boundary — and the state boundaries had already been moved to the bottom of
the operational stack in an earlier slice, with an ADR-035-era comment
explaining that borrowed reference geography belongs behind the subject.

The fix had not worked, and the reason is that **a basemap is two stacks, not
one**:

- `basemap.baseLayers` draw below every operational layer.
- `basemap.referenceLayers` draw **above** every operational layer.

The second stack exists so place names stay readable over whatever a map puts
on the ground. Oceans carries `World Ocean Reference` there, and it contains
administrative boundaries as well as labels. Measured on the live storage map:

```
basemap.referenceLayers : ["World Ocean Reference"]  (vector-tile)
map.layers              : utah-mask, drainage-areas, drainage-labels,
                          reservoirs, selection
```

So no operational reordering could ever have fixed it. The line was not in the
stack that was being reordered. This is the load-bearing fact, and it is the
reason this record exists rather than a one-line change: the earlier fix was
reasonable, was tested, and was addressing the wrong stack.

## Decision

Move the current basemap's reference layers out of the basemap and add them as
the bottom-most operational layers. `src/arcgis/basemap-reference.ts` owns it.

Three things it has to get right:

1. **Removed from the basemap first.** Left in both places the SDK draws them
   twice, and the copy still in the reference stack draws on top — which is
   the exact problem being removed.
2. **Repeatable.** The basemap is swapped on every theme change and by the
   storage map's gallery. Each swap brings a fresh reference stack, so this
   runs again and must first remove the layers the previous run moved. A
   `WeakMap` keyed by map holds them.
3. **Reported.** `basemapReferenceSunk` is a readiness field, asserted in the
   browser suite. A map that quietly stopped moving them looks identical until
   someone notices a line through a reservoir again — which is how the first
   attempt survived.

Callers that insert layers at a fixed index must count from a layer they own
rather than from zero. The storage map's drainage insert became
`map.layers.indexOf(maskLayer) + 1` for this reason.

## Consequences

- The borrowed place names now sit under this project's own layers. On these
  maps that is the right way round: what covers them is either
  semi-transparent (the Utah mask), thin (drainage outlines) or small
  (reservoir circles), and where a name is genuinely covered, the thing
  covering it is the subject the reader came for.
- It applies to every map on the site, including any added later, because it
  runs from the two places a basemap is ever assigned.
- A basemap with no reference layers is a no-op, so nothing depends on Oceans
  specifically.

## Alternatives considered

**Reorder the operational layers.** Already done, and the subject of this
record: it cannot work, because the layers in question are not operational.

**Turn the reference layers off.** Loses the ocean and place labels that are
most of why ADR-033 chose Oceans in the first place.

**Choose a basemap with no reference stack.** Would trade a real cartographic
benefit for a layer-ordering problem that has a direct fix.

## Relationship to other records

Does not supersede ADR-030 or ADR-035. Those describe where *this project's*
labels and outlines sit relative to each other, which is unchanged and still
correct. This record is about a stack neither of them was looking at.
