# ADR-075: Draw the spread chart rather than configure it

- Status: Accepted
- Date: 2026-08-21

## Context

The storage charts page draws six charts. Five are the ArcGIS charts SDK and
one of them, the box plot of percent-full within each drainage area, could not
be made to do the one thing the chart is for.

**Every box came out the same colour.** A box plot in that SDK is *one series*
however many categories it has, and every colour API it exposes is per series:
`setSeriesColor`, `meanLinesBoxColor`, `colorMatch`. Four approaches were tried
and the file recorded three of them before this change:

| approach | result |
|---|---|
| `colorMatch` over a unique-value renderer keyed on the area | one flat colour |
| `colorMatch` over a class-breaks renderer keyed on the value | one flat colour |
| `colorMatch` over a continuous colour visual variable | one flat colour |
| `splitByField` on the storage class, to make five real series | five series, and a reserved lane for each of them **inside every category** — each box drew at a fifth of its row height, a sliver floating at whatever height its class sorted to |

`seriesLength` never rose above 1 for the first three, so there was never more
than one box's worth of colour to set. The fourth makes the series and breaks
the layout instead.

**Two more things were wrong for the same underlying reason** — that the chart
was configured rather than drawn. The category axis clipped or wrapped the
drainage-area names into rows too short to hold two lines, so "Southern Oregon
Coastal" and "Northern California Coastal" ran together. And the ordering was
the SDK's, not the reader's.

## Decision

**The spread chart is hand-built SVG**, in `src/viz/spread.ts`, joining the
snow curve, the storage trend and the drought page's three charts. The
statistics move to `spreadBoxes` in `overview-model.ts`, which is pure and
tested in Node — including the whisker rule, which is the thing that decides
which reservoirs are outliers, and the outliers are what this chart is read
for.

**Each box takes its colour from its own area's middle value**, through
`storageColor`, so a box means here what the same colour means on the map and
in the bars above it (ADR-008). The middle value and not the mean: the line
inside the box is the middle value, and colouring from a statistic the chart
never draws would be a third quantity to decode.

**The whiskers and the outliers stay neutral.** A whisker is a reach rather
than a level, and an outlier's own position on the axis already states its
value; a class colour on either would be the same claim made twice in a place
where the two could disagree by a pixel.

**Rows are ordered by the middle value, driest first**, with the area name
breaking a tie so two areas at the same level keep a stable order between
renders rather than swapping places when the filter changes.

**Areas with fewer than three reservoirs are left out**, and the card says so.
A box drawn over two reservoirs has quartiles that are just the two values
again, and a reader cannot tell that from a genuinely tight spread.

## Consequences

**One fewer SDK chart.** Five remain, and the histogram and scatterplot still
need it — they compute their own binning and their own statistics, which is
work worth borrowing. A box plot's five numbers are not.

**The tests changed shape, and got stronger.** The old assertions checked SDK
configuration: that the model was rotated, that `characterLimit` was null, that
the host was sized for its category count. The new ones check the output —
more than one distinct fill among the boxes, no truncated name, a row per
area — and the first of those is the defect this record exists for, asserted
directly rather than through a setting that was supposed to cause it.

**The chart sizes itself.** `#spread-chart` no longer takes a height from
`--chart-category-count`; the row height lives with the rows.

**This is not a general retreat from the SDK.** It is one chart whose one
requirement the SDK cannot meet, moved to the technique this project already
uses for five others.

## Related

- Serves [ADR-008](ADR-008-one-class-break-table.md): every surface takes its
  colour from the class table, which this chart could not do until now.
- Follows the hand-built precedent set by the snow curve and stated again in
  [`viz/drought-gap.ts`](../../src/viz/drought-gap.ts) — a few dozen rows need
  no chart SDK, and everything that is not data takes its colour from CSS so
  both themes stay readable.
