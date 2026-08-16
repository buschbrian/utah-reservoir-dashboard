# ADR-040: Open the snow map on the season's peak snow

## Status

Accepted

## Date

2026-08-16

## Context

The snow map opened on the newest day where at least half the sites reported.
That reads like a sensible default — show the most recent thing that can be
shown — and ADR-038 recorded that it was not, without resolving it.

Late in the melt season the newest qualifying day is the *most depleted* day
that still qualifies. Sites melt out one by one; the last day half of them
still report is the last day there is meaningfully any snow. So the map opened
on the worst picture of the year by construction. In this record that is
2026-05-09: mean 10.5% of normal, every reporting basin in the lowest class,
two basins with no value at all, and the whole region one colour whatever the
class breaks were.

## Decision

Open on the day the region held the most snow.

**Peak depth, not peak percent of normal**, and the distinction was measured
rather than assumed. In this record:

| candidate | date | mean % of normal | mean snow |
|---|---|---|---|
| peak percent of normal | 2025-12-06 | 77.7% | 2.3 in |
| **peak depth** | **2026-03-07** | **61.1%** | **8.4 in** |
| newest qualifying (old) | 2026-05-09 | 10.5% | 1.5 in |

The highest-ratio day is in early December on a couple of inches of snow,
because the normal it is divided by is tiny then too. It is arithmetically the
region's best day and hydrologically close to meaningless. The peak depth day
is the day the snowpack actually held the most water, which is what a reader
means by the peak and what the rest of the year is judged against.

`regionDepthCurve` computes it. A site that has melted out reports zero and is
counted: that is a real reading, and counting it is what makes the curve peak
at the true maximum rather than at the last day anyone measured. The same
half-the-sites floor applies, so a handful of high stations cannot define the
peak alone.

Out of season, or on a record too thin to find a peak in, it falls back to the
old behaviour — the newest day meeting the floor — which is still the right
answer when there is no peak to show.

## Consequences

The map opens on a day with something to see. On the committed record it moves
from one class across twelve basins to four classes across fourteen, with no
basin left grey.

`?day=` is unaffected. A shared link still carries whichever day its author was
looking at, and the peak is only the default.

The reading beside the slider marks the opening day as the season high point,
so a reader who moves away and comes back knows which day is which.

This is a decision about what the map is for, and it is worth being explicit:
the map now answers "how much snow did this season build, and where" rather
than "what is left today". The seasonal curve and the site table still answer
the second, and the day slider reaches every day either way.
