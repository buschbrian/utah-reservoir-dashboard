# ADR-074: Compare the week with the one before it

- Status: Accepted
- Date: 2026-08-21

## Context

The drought coverage payload has carried a `previous` block since the archive
existed — last week's share of each area's land at each class, about a
kilobyte, deliberately shipped in the same file so a comparison costs no extra
request. `weeklyDrought` reads it for one sentence in the storage page's
digest. The drought page itself, which is where a reader goes to look at
drought, read none of it.

Two things were in the way.

**Only one level could compare.** `merge_history` refuses to hold two levels
in one archive, for a good reason: the weeks join on their unit codes, and
codes of two widths in one file are two series wearing one name, so the join
would silently find nothing rather than fail. The coarser levels therefore ran
with `--no-history` — and `previous` is produced by the archive, so
`usdm-huc4.json` had no previous week and `usdm-huc2.json` had none either. A
reader who changed the area size lost the comparison without being told.

**There was no colour left.** A change is a diverging quantity and wants a
diverging ramp, and this page already owns the palette a reader knows best.
The monitor's yellows and reds are not this project's to reuse for something
else (ADR-032), storage owns the yellow-green to blue run, and snow owns brown
through cyan to blue.

## Decision

**Each level keeps its own archive.** `usdm-huc4-history.json` and
`usdm-huc2-history.json` join `usdm-huc6-history.json`, named for the level
the same way each coverage file is. `merge_history`'s refusal is unchanged and
is exactly why the answer is one file each rather than one level with a
history and two without.

The cost runs the right way. ADR-063 kept one archive because an archive grows
with the area count and at HUC-8 would reach 30 MB against 3.9 at HUC-6; these
two go the other direction, 44 areas and 5 against 75, so the whole set is
about 1.65 times the one file that existed before.

The two new archives hold one week the day they are written. That is a real
state and the page says so — *"This is the first week measured at this area
size. A comparison needs two."* — rather than drawing a map of zeroes, which
would state that nothing changed during a week nobody measured.

**A change is drawn three ways, from one computation.** `droughtChanges` in
the model is the only place a change is worked out; the map, the table column
and the chart all read it. Three surfaces disagreeing about whether an area
moved is the failure that one shared function makes impossible.

- **The map** gains a mode. "This week's classes" or "Change since last week",
  never both: two colour languages over one set of shapes would ask a reader
  to hold two scales at once. Switching is a layer visibility change, so it
  costs no refetch. The key follows the mode, and so does the card's own
  description — a paragraph reading "the monitor's weekly national map in its
  own colours" over a change surface is the kind of copy a reader stops
  trusting. The control is absent, not disabled, where there is nothing to
  compare.
- **The table** gains a column, said in words with a swatch beside it rather
  than as a coloured cell: a full-strength class fill under a cell's own text
  cannot hold its contrast in both themes.
- **The chart** is a ranked diverging bar, and it draws a bar where
  `drought-gap.ts` explicitly refuses one. That refusal is about two shares
  with different denominators, whose difference is not a quantity. Here both
  numbers are the same measurement of the same ground a week apart, so their
  difference is a real quantity in real units and zero is a real place on the
  axis. The axis is symmetric around zero even when the week is not, or the
  same bar length would mean different numbers on two consecutive Thursdays.

**Only the areas that moved are drawn on the chart.** In the week this landed,
58 of 75 held steady; a row each for them makes a chart four times taller than
its own content and a reader scrolls a screen of blank rows to find six bars.
The note under it counts them rather than dropping them silently.

**The palette was measured, not picked.** Magenta and green are what the other
three tables leave, and the sampled values were then scored against every
colour this project publishes — the three class tables plus the storage map's
three fixed inks:

| | measured |
|---|---:|
| nearest other published colour | **48.7** (this table's neutral grey against the storage table's palest yellow-green) |
| second nearest | 54.9 |
| closest pair within this table | 87.3 |
| luminance range | 0.064 to 0.572 |

`change-classes.test.ts` holds a floor of 45 against every other published
colour, 50 within the table, and the luminance band that keeps each entry
legible as a translucent fill over shaded relief.

**The break is ten points of an area's land**, and it is not tuned to a week.
The monitor publishes to a tenth of a point, so ten points is two orders of
magnitude above its own precision and is a share a reader can state without
consulting a scale.

**The class measured is severe drought or worse**, which is `DRYNESS_CLASS` —
the same one the rest of the page counts by, reused rather than redeclared. A
page measuring "how dry" at one class and "how much drier" at another would be
answering two questions in one column.

## Consequences

**Two new committed archives**, both `generated-archive`: append-only, never
rewritten in place, and staged by the refresh with the rest of the drought
set. `check_drought_pair` needed no change — it finds the coverage files
rather than listing them.

**`--no-history` is gone from the refresh**, and `deploy.test.ts` asserts its
absence: a level running without an archive has no previous week, which is the
defect this record exists to remove.

**A fourth palette exists on this site.** That is the thing ADR-032 was
written to control, and the control is the measurement above plus the test
that holds it, not a promise.

## Related

- Extends [ADR-064](ADR-064-offer-two-levels-and-let-the-reader-choose.md) and
  [ADR-073](ADR-073-draw-the-regions-too-and-read-them-from-their-own-publisher.md):
  every offered level publishes every figure, and a comparison is now one of
  the figures.
- Narrows [ADR-063](ADR-063-draw-the-west-and-open-on-the-roster.md)'s
  one-archive decision. That record's reason was cost at finer levels; these
  two levels are coarser and cost less than the one it kept.
- Bound by [ADR-032](ADR-032-one-colour-language-per-map-across-pages.md): one
  colour language per map, which is why the change surface and the class
  surface are never drawn together.
- Follows [ADR-059](ADR-059-not-measured-is-not-no-drought.md) for the areas
  it leaves out. An unmeasured area has no share to difference, and an area
  last week did not publish has no baseline — neither is "did not move".
