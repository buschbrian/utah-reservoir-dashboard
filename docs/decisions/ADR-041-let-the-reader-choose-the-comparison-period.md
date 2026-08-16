# ADR-041: Let the reader choose the comparison period, and open on the standard one

- Status: Accepted
- Date: 2026-08-16

## Context

Every "normal for this week" on this site was a median over 2015 onward.
Nobody chose that period. `START_DATE = "20150101"` in `refresh_reservoirs.py`
is where the pipeline starts asking the providers, and the normal inherited it.

Three problems followed from that accident.

**The period is a drought.** 2015 through 2025 is the driest stretch in the
modern record for this region. A reservoir measured against it is measured
against the drought, so a bad year reads as ordinary. The methods page already
disclosed this in words — "a normal built from this record is a dry-period
normal" — which is the right disclosure and no substitute for a right number.

**The two halves of the site disagreed.** The snowpack payload has always used
1991–2020, the period the World Meteorological Organization defines and the
measuring service publishes. So "snow at 70% of normal" and "storage near
normal" on the same page were answers to two different questions, and the
storage half was flattered. This was recorded as a known flaw in the methods
review and was, until now, disclosed rather than fixed.

**The magnitude was unmeasured.** It turns out to be large. Lake Powell on
2026-08-16 reads **44.6% of normal against 2015–2025 and 35.0% against
1991–2020** — nearly ten points, on the reservoir that dominates every combined
figure the site publishes.

The obvious objection is that the data for a real climate normal does not
exist. It was measured before anything was built. Probing RISE and AWDB
directly for the earliest reading of each of the 69 reservoirs:

```
record starts 1991 or earlier : 54 reservoirs   98.2% of combined capacity
starts 1992 to 2010           :  8 reservoirs    1.5%
starts after 2010             :  5 reservoirs    0.3%
no reading returned           :  2 reservoirs    0.0%
```

Lake Powell reaches 1963, Flaming Gorge 1962, Bear Lake 1911, Utah Lake 1932.
`first_obs` reading `2015-01-01` for all 69 was never a fact about the
providers; it was a fact about our own request window.

## Decision

**Publish both periods and let the reader pick, opening on 1991–2020.**

1. `tools/build_normal_baselines.py` fetches the full 1991–2020 record once and
   writes `normals.json`: per reservoir, a median for each of the 366 days of
   the year and each of the 12 calendar months, with the number of contributing
   years beside each.

2. `normals.json` is **committed and never published**. It is a build-time
   reference like `capacities.json`, not a payload. `vite.config` copies an
   explicit list of files into `dist/`, and this is not on it.

3. `refresh_reservoirs.py` attaches both periods to every reservoir as
   `baselines: { recent, climate, default }`, and both monthly normals to every
   month. The recent period is still computed live, because it genuinely moves
   as the record grows; the climate period is read from the committed file,
   because a median over a period that has ended cannot change.

4. The three existing `seasonal_*` fields keep their exact meaning and carry
   the recent period. Nothing that already reads the payload changes meaning.

5. `DEFAULT_BASELINE = "climate"` in the pipeline. The page reads it from the
   payload rather than deciding for itself.

## Why the standard period is the default

Because the alternative was never a choice anybody made. Defaulting to the
recent period would keep every headline number on the site measured against the
drought, and would keep the storage and snow halves disagreeing — while now
having the honest answer sitting one control away, unselected. A default is a
claim about which question the site thinks a reader is asking, and the question
is "is this a normal amount of water", not "is this normal for a drought".

The cost is that six reservoirs cannot use it, and that cost is paid in words
rather than hidden.

## What is refused

**A comparison never answers with a period it was not asked for, silently.**
Two forms of this were live risks:

- A reservoir with no record in the period. `climate` is `null`, never filled
  in from `recent`.
- A reservoir with *some* record in the period. This is the subtle one. Jackson
  Flat's dam dates from 2017, so it has three years inside 1991–2020, and a
  three-year median presented under the label "1991 through 2020" is true in
  every word and wrong as a whole. The pipeline publishes
  `minimum_years: 10`, and the page refuses any baseline thinner than it.

In both cases the panel falls back to the other period, names that period in
the row's own heading, and says in the same sentence which case it hit. Sixty
three of sixty nine reservoirs clear the threshold.

**A sample size never travels separately from its median.** Every sentence
quoting a normal carries the years behind it. "3,278,380 acre-feet (now at
80.2%); 30 years of 1991 through 2020" is the shape.

**The history rank does not follow the control.** A percentile needs the whole
population, not one median, and the population we hold starts in 2015. Making
the rank appear to honour the control while it did not would be worse than
leaving it where it is, so it stays and the methods page says so.

## Consequences

- The site's headline numbers change the day this ships. Storage will read
  lower nearly everywhere, because it is now compared against a period that
  includes wet years. That is the correction, not a regression.
- The methods page's "storage and snow use different periods" caveat is
  retired, replaced by a worked example of what the choice is worth.
- `normals.json` is 281 KB committed and rebuilt rarely — annually at most, and
  only when the standard period itself moves (2021–2050 becomes standard in
  2031).
- A missing `normals.json` costs the climate period and nothing else. The daily
  publish still runs, every reservoir reports `climate: null`, and the control
  hides itself rather than offering a period with nothing behind it.
- The chosen period is a URL parameter, written only when the reader chooses,
  so a shared link carries a choice rather than freezing today's default.

## Alternatives considered

**Compute the baseline in the client.** Not possible. The payload carries 12
months of history and one precomputed normal per month; there is nothing to
recompute from. This was checked first, and it is what makes this a pipeline
change rather than a UI one.

**Move `START_DATE` back to 1991.** Would triple the daily refresh's request
volume forever to re-derive an unchanging answer every morning, and would put
the daily publish at the mercy of a thirty-year query. `capacities.json` set
the precedent for the alternative.

**Keep one period and just switch it to 1991–2020.** Loses a real question. "How
does this compare with the rest of the drought" is worth asking, and it is what
the recent period answers well.

## Supersedes

Nothing. It resolves the flaw disclosed under the methods review and narrows
the scope of ADR-006's disclosure obligation rather than changing it.
