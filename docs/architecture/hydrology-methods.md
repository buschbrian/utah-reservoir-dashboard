# Hydrology and measurement methods

Every rule here is a property of a published number. Changing one changes what
the site claims, so it is a decision-record change, not an implementation
detail: follow
[`.claude/skills/science-method-change/SKILL.md`](../../.claude/skills/science-method-change/SKILL.md).

## The seasonal comparison

**A calendar date is one position in every year.** `canonical_day` maps a date
into a 365-day year where 29 February shares 28 February's place;
`seasonal_window`, the climate-normal table and its lookup all match on it.
Never reach for `dayofyear` again: it makes 19 August day 231 in an ordinary
year and 232 in a leap year, so a window centred on 19 August was centred on 18
August for every leap year in the record, and the normals table was built over
a leap year while being read by ordinary-year numbers. The wrap at the year end
is a flat 365 for every year.

**Every year gets one vote.** A seasonal normal is the median of one
representative value per year (`annual_seasonal_values`), never a median over
the pooled readings: a reservoir reported daily brings about 450 readings to a
thirty-year window and one reported at month end brings about 15, so pooling
made the statistic a fact about reporting density. The history rank ranks the
same annual values, and the details panel leads with the ordinal — "3rd-lowest
of 12" carries its own sample size and a percentile does not.

**A vote is one window instance, not one calendar year** (review of
2026-08-20). Away from 1 January the two are the same thing. At the year end
the window wraps, and grouping the wrapped readings by their own calendar year
put a year's early-January readings — the winter before — and its
late-December ones — the winter after — in a single vote describing neither,
about 360 days apart. Each reading votes with the instance whose reference date
it is days from, and `prior_annual_seasonal_values` cuts on the **vote's**
year: cutting on the reading's admitted the current winter's December as
"prior" evidence and split a finished winter across two votes. The seam is also
why fourteen days of `normals.json` count 31 years against a thirty-year period
and that is the honest count — a winter spans two calendar years, so a period
bounded by them cuts its first and last winters in half, and both halves really
did vote.

**A tie is not below** (review of 2026-08-20). `seasonal_rank` counts the years
strictly below the current reading, so `seasonal_percentile` must too: the two
are one comparison printed in one row, and counting ties as at-or-below on one
side only published "1st-lowest of 12" beside a percentile of 9.1 for four
reservoirs in a committed payload. Lowest ever, tied or not, reads 0, and 100
arrives exactly when the rank reads highest.

**A normal names the years it came from** (ADR-041). Two comparison periods are
published per reservoir and the reader picks; `normals.json` holds the standard
1991-2020 one and is rebuilt by `tools/build_normal_baselines.py`, not by the
daily refresh — a median over a period that has ended cannot change. Two rules
have tests behind them: a comparison never answers with a period it was not
asked for without saying so, and a median never appears without the number of
years behind it. A baseline thinner than the payload's own `minimum_years`
counts as unavailable, because a three-year median labelled "1991 through 2020"
is true in every word and wrong as a whole.

## Method version

**A method version is not a schema version.** A field can keep its name, type
and units while the estimator under it changes, and `schema_version` cannot see
that. `METHOD_VERSION` can, and three places refuse to mix:

1. `tools/build_normal_baselines.py` stops a partial run against a file built
   by another estimator;
2. `load_normals` warns when the payload and the committed normals disagree;
3. `merge_history` refuses a drought week measured by another method exactly as
   it already refused one at another level.

An interrupted full normals build is the single exception — it keeps its
fetches and drops the rest, because it has already paid for them.

**Every normals run is a merge, a completed full one included.** A full run
keeps the records of reservoirs absent from today's payload — the ADR-056
withdrawal the merge exists to protect — so after a method change it would
otherwise write old-estimator records under a header stamped with the new
version. That is worse than a plain mix: `load_normals` reads the header, so a
file claiming one method could never warn. A full run therefore drops those
records, names them, and leaves `--missing` to rebuild each one when its feed
returns. Every published drought coverage file states its `method.version` too,
and a test holds both levels to it — the HUC-4 file is written with
`--no-history` and so never passes `merge_history`'s gate.

## Change intervals

**A change names the reading it is a change from.** "30-day change" is the date
the pipeline asks for; the reading it gets is the nearest one inside a
tolerance of ten days for a daily feed and forty-five for a month-end one, so
"change in 1 year" has covered 320 days to 410. `change_*_reference_date` and
`change_*_elapsed_days` publish the interval, and the details panel prints the
measured one whenever it differs from the name.

## Dates and calendars

**A monthly stamp names the month; the water was measured at its end.**
California's service dates a monthly storage value on the **first** day of the
month it describes, and the value is that month's **last** reading — verified
against the same station's daily series, where Oroville's monthly `2026-6-1` of
3,082,292 acre-feet is its 30 June reading and 1 June was 3,327,054.
`fetch_cdec_series` moves the date to the month's end, because every date this
pipeline publishes means when the water was measured: `days_stale` is computed
from it and ADR-056 withdraws 60 days past it. Left alone, all 33 monthly
California stations read 50 days late on the morning they were admitted and
would have been withdrawn as quiet feeds inside a fortnight, while reporting
normally. The Conservation Service's month-end feed already stamps the last
day, so there is one convention rather than two. **The calendar is corrected,
never the reading.**

## What may not be done to these numbers

**These reservoirs are not one population.** No fitted normal curve, no
standard deviation as an interpretive frame: they differ by size, purpose,
hydrology, operating rules and flood-control duty, so a flood-control reservoir
held deliberately low in spring sits in the same histogram bins as a supply
reservoir kept full. `distributionStats` publishes the mean, the median and the
middle half. The SDK's histogram offers no quantile overlay, so the key states
the middle half rather than drawing it.

**Never subtract two shares with different denominators** (ADR-046). A share of
land minus a share of reservoir capacity is not a quantity. Such a difference
may rank rows and may set the length of a line; it may not be printed as a
number or given a baseline.

## Area measurement

**`cos(lat)` is the sphere's exact area element, not a rough projection**
(ADR-055). The drought engine measures equal area already, so "move it to
Albers" is not an accuracy fix — measured, the area model is worth 0.004
points, against a rounding boundary of 0.05. Albers and geodesic agree on these
polygons to 0.1 ppm. **Geodesic is the measure of record for any area this
project states**, and it lives in `tests/test_area_model.py` as an oracle:
`geographiclib` is in `requirements-test.txt` and must never reach
`requirements-pipeline.txt`, which stays at numpy, pandas and requests. If the
published precision ever tightens past 0.1 of a point, reach for a finer step
first and exact clipping second — never for a projection.

**The sampling step is the term that mattered, and it has moved.** At 0.01
degrees, 59 of the 844 shares the drought engine publishes would round to a
different tenth than a fine reference gives. `DEFAULT_STEP` is 0.002, where
that falls to 5 — the engine's own floor, since those five sit on a rounding
boundary and no step settles them. It costs about 70 seconds a morning in a job
that otherwise waits on other people's services.
`tools/measure_drought_convergence.py` measures it again and writes nothing;
run it before moving the step. Passing `--output` to
`compute_drought_coverage.py` implies `--no-history`, because a trial run
redirected away from the committed coverage file used to rewrite the committed
archive anyway.
