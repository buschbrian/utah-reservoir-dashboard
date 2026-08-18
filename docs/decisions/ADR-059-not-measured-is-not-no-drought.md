# ADR-059: Not measured is not no drought

- Status: Accepted
- Date: 2026-08-18

## Context

The drought engine samples a grid over each drainage area, assigns each cell
the worst class whose polygon contains it, and publishes the share in each
class. Cells in no polygon at all became `none` -- the share of the area with
no drought on it.

That is correct for a drainage area inside the country, and every one of the
fourteen published today is. It is wrong for the west.

The U.S. Drought Monitor maps the United States and stops at both borders.
Scoping `west-huc6` was expected to raise a question about the three basins
under HUC-4 1508, which are named for Mexican rivers. Measured, the problem is
twelve basins and it is worse to the north than to the south:

| basin | measured | unmeasured |
|---|---:|---:|
| Rio De La Concepcion | 1.3% | 98.7% |
| Kootenai | 24.8% | **75.2%** |
| Rio Sonoyta | 31.2% | 68.8% |
| Rio De Bavispe | 43.2% | 56.8% |
| Upper Columbia | 48.1% | **51.9%** |
| Laguna-San Diego Coastal | 76.8% | 23.2% |
| Lower Colorado | 76.9% | 23.1% |
| Puget Sound | 81.1% | 18.9% |
| Salton Sea | 87.2% | 12.8% |
| San Pedro-Willcox | 88.5% | 11.5% |
| Pend Oreille | 95.3% | 4.7% |
| Santa Cruz | 95.5% | 4.5% |

Run against the real polygons for 2026-08-11, the unmasked engine reported
**Kootenai as 75.2% drought-free and 24.8% in drought**. The truth is that
every acre of Kootenai anyone can measure is in drought; the rest is British
Columbia. Upper Columbia reported 51.8 points the same way.

Dropping the Mexican basins -- the change this was expected to need -- would
have fixed three of the twelve and left Kootenai and Upper Columbia wrong,
while deleting the Columbia headwaters from a western water dashboard. The
defect is not in the scope. It is in the arithmetic.

## Decision

**A cell the monitor does not cover is dropped before any class is counted.**
It cannot land in `none`, because `none` is a measurement -- land seen and
found dry-but-not-in-drought -- and the space beyond a border is not.

**The class shares divide by the measured land.** So "D1 or worse" means the
same thing in every drainage area and can be compared across them. A basin
half in Canada reports what its American half is doing, which is the only
thing anyone can know about it.

**The measured share divides by the whole area, and lives in its own block.**
`measured.percent_of_area` says how much of the basin the figures above
cover. It is a share of a different denominator, so it sits outside
`percent_of_area` where nothing can add it to the class shares -- ADR-046 as
structure rather than as a convention to remember. The validator refuses a
block claiming 100, because the writer omits it when the whole area is
measured, and refuses a share with no `basis` string: a number saying 24.8%
is unreadable without the sentence saying what it is 24.8% of.

**An area with no measured land publishes no drought share at all.** Not
zeros. Zeros read as "no drought here", and there is no denominator to divide
by. This is the same rule ADR-041 already applies to a climate baseline
thinner than its own minimum: too little evidence counts as unavailable
rather than as a low number.

**The mask is the union of western state polygons**, from the Census TIGERweb
service the county assignment already reads (ADR-058), one layer up, at the
project's default 100-metre tolerance. Committed and never published: the
engine reads it offline like `huc6.geojson`, and no browser has a use for it.
No tolerance exception is claimed or needed -- the sampling grid is an order
of magnitude coarser, so a finer mask could not move a published figure.

**A missing mask stops the run.** Running without one does not fail; it
quietly reports every border basin's far half as drought-free and looks like
a clean run. That is the defect this record exists to remove, so it is refused
rather than defaulted.

## Consequences

**Nothing published moves.** All fourteen current drainage areas are wholly
inside the country, so none carries a `measured` block and the recomputed
coverage file is identical to the committed one. That was the acceptance test:
the change is a no-op until the geography that needs it arrives.

The engine now takes 9.4 seconds over 75 basins with the mask, against the
8.8 seconds measured without it. Compute was never the constraint and still is
not.

Twenty-one of the 75 western basins carry a `measured` block, not twelve. The
extra nine are coastal basins whose HUC polygons include a little open water
outside the state outline -- Washington Coastal at 99.5%, San Francisco Bay at
99.5%. Those are true statements at the precision this site publishes, and the
block appears exactly when the difference is visible at 0.1 of a point.

**The history does not carry the measured share.** A border does not move
from week to week, so it is a property of the geography rather than of a week,
and storing it in every entry would put one static fact in the archive 520
times per drainage area -- in the one file the western scoping already
identified as the thing that does not scale. It travels in the current week's
payload, where a reader and a map can both find it.

`unit_coverage` now returns the shares and the measured fraction as a pair
rather than the shares alone. Two callers changed, both tests, and one of them
is ADR-055's area-model oracle -- which is unaffected in substance, because
the measured fraction is a ratio of cell counts and carries no area model.

**What this does not do is tell a reader.** The payload now distinguishes
unmeasured from dry; no surface reads `measured` yet. A drought page drawing
Kootenai at 100% D0-or-worse without saying that covers a quarter of the basin
would be accurate and still misleading. That is the next change, and it is a
design question rather than an arithmetic one.
