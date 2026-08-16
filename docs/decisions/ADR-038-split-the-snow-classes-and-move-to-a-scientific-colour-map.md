# ADR-038: Split the bottom snow class, and take the ramp from a scientific colour map

## Status

Accepted

## Date

2026-08-16

## Context

ADR-032 moved the snow table off the ramp it shared with storage and recorded
the rule that no colour may appear in two of the three tables. That fixed the
collision. It did not fix what a reader actually noticed, which was that the
new ramp made no visible difference: on the day the map opens, every basin was
one colour.

Measurement explained it, and the fault was in the class breaks rather than
the colours. Across the whole accumulation season, **62% of every published
basin-day fell into the single lowest class**. Four of the six colours existed
only in the legend. An equal-interval scheme was being applied to a
distribution that is nothing like equal — the median in-season basin-day is
39% of normal, the 75th percentile is 59%, and only 3% of days reach 90%.

The four thresholds in use — 50, 75, 90 and 110 — are not arbitrary. They are
what the measuring service reports against, so a map that abandoned them would
be incomparable with the agency's own products.

## Decision

**Keep all four published thresholds and add one at 25%.** Six classes: under
25, 25–50, 50–75, 75–90, 90–110, above 110. The added break splits the
overloaded bottom without touching any threshold a reader might carry in from
elsewhere, and takes the worst class from 62% to 39% of in-season basin-days.
Six is still inside the five-to-seven a reader can hold at once.

**Take the colours from Crameri's `roma`**, a scientific colour map:
perceptually uniform, colour-vision-deficiency safe, readable in greyscale,
and citable. It runs warm to cool — dry earth through pale olive to water —
which is the conventional moisture direction.

It was selected by search rather than by eye. Every Crameri diverging map was
sampled at these six class positions and filtered on four rules at once:

- no class outside the luminance band a translucent fill over shaded relief
  needs, so "near normal" can never be mistaken for the grey that means no
  reading;
- no two adjacent classes closer than 30 in RGB distance;
- the dry end warm and the wet end cool, because a map where dry reads as blue
  is a map that lies;
- no colour close to anything in the storage or drought tables.

Eighteen combinations survived all four. This one had the largest separation
from the other two tables.

## Consequences

The season now spreads across the ramp: 39 / 24 / 29 / 5 / 2 / 1 percent of
in-season basin-days, against 62 / 29 / 5 / 2 / 1 before.

**The day the map opens is still one colour, and that is the data rather than
the design.** On 2026-05-09 every reporting basin is under 25% of normal. Two
things compound there: the year is severe, and `defaultMapDay` deliberately
picks the newest day meeting the half-the-sites floor, which late in the melt
season is the most depleted day that still qualifies. The caption already says
which day is shown and why. Worth revisiting if the opening day should instead
be the season's peak, but that is a separate decision about what the map is
for.

The class count is now published in the readiness signal. The browser suite
had a hardcoded legend count and broke the moment the table gained a class,
which is a test measuring itself rather than the page.

This record does not touch the storage table. Percent full is sequential data
currently drawn with a diverging ramp, which is a real error, but correcting
it means changing the frozen colour oracle and resolving how an empty
reservoir stays visible when the ramp's low end is pale. That is its own
decision.
