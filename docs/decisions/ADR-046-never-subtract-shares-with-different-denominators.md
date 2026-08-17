# ADR-046: Never subtract two shares with different denominators

- Status: Accepted
- Date: 2026-08-16

## Context

The drought page's central question is whether dry land and banked water
agree. It answered it with a scatter: share of land in severe drought or worse
across, combined reservoir storage up. That chart is right and it is a cloud —
the reading it wants is each point's distance from the diagonal where the two
shares are equal, and that diagonal is not drawn. Judging perpendicular
distance by eye is a poor way to rank fourteen areas, so the page could show
the relationship and could not show the order.

The obvious fix is a diverging bar of `storagePercent − dryPercent`, sorted.
It was designed and rejected.

Those two percentages **divide by different things**. One is a share of land
area; the other is a share of reservoir capacity. Their difference is not a
quantity of anything — there is no such thing as "fifteen points of cushion" —
and a bar drawn from a zero baseline asserts that there is. The encoding would
have been making a claim the data cannot support, on the page whose whole
purpose is that these two measures are not interchangeable.

## Decision

**A derived difference between unlike shares may rank and may set a length. It
may not be stated as a number, and it may not be given a baseline.**

The drought page's ranked comparison draws each area as **two dots on one 0–100
axis with a line between them**. The dry dot takes the area's worst class
colour from `DROUGHT_CLASSES`; the water dot takes its storage class colour
from the same table the map circles use (ADR-008, ADR-032). The joining line is
neutral — it is a distance, not a third value, and a colour of its own would
invent a category.

The gap is still what the eye reads, because it is the length of the line. But
both real values stay separately legible, each row's description names both and
never their difference, and no axis implies the difference is a measurement.

`byStorageGap` computes the difference and its documentation says plainly what
it is for: ranking, and the length of a line. Nothing renders it.

## Consequences

- The page keeps both charts. A cloud shows the shape of a relationship; the
  ranked rows show the order. They are built from the same array, so they
  cannot disagree about which areas have a reservoir reading.
- This is a rule for future charts, not a note about one. Any chart tempted to
  combine a share of land, a share of capacity, a share of sites, or a percent
  of normal into a single derived figure falls under it.
- The severity distribution added alongside follows the same discipline from
  the other direction: it counts each area once at its own worst class, so its
  bars sum to the number of areas and mean exactly one thing.

## Alternatives considered

**A diverging bar of the difference.** The subject of this record.

**Draw the diagonal on the scatter and leave it there.** Helps read the
existing chart and still gives no order.

**Normalise both to a common index first.** Would require choosing a
weighting, which is a modelling decision this site does not make — every
figure here is a measurement or an arithmetic comparison of measurements.
