# ADR-006: Write all visible text in Simplified Technical English

## Status

Accepted

## Date

2026-08-09

## Context

The dashboard is public. Its readers are people who want to know whether the
reservoir near them is low — not hydrologists. The interface had accumulated
the vocabulary of its sources instead: `af`, `period-of-record max`, `seasonal
percentile`, `cadence`, `stale`, `RISE`, `AWDB`, `provisional and subject to
revision`.

Every one of those is precise and every one of them is a small barrier. `af`
in particular is a unit abbreviation that a reader has no way to guess.

## Decision

All visible text follows [ASD-STE100 Simplified Technical
English](https://asd-ste100.org/): short sentences, one term for one thing, and
no unexplained specialist word. Concretely:

| Retired | Used instead |
|---|---|
| `af` | acre-feet |
| period-of-record max | highest recorded storage |
| stale | late data |
| cadence | update schedule |
| seasonal percentile | history rank |
| RISE / AWDB | Bureau of Reclamation / Natural Resources Conservation Service |

The overview defines capacity, acre-foot, normal, history rank, update schedule
and CSV file in a *Meaning of terms* block.

## Alternatives Considered

### Keep the precise technical vocabulary and add a glossary

- Pros: no rewriting; the terms stay exact.
- Cons: a glossary is a second place to look, and most readers will not.
- Rejected as the primary strategy, **adopted as a supplement**: the terms
  block exists, but the interface no longer depends on it.

### Simplify the words but leave the metric names alone

- Rejected. The metric names were the worst offenders. "Period-of-record max"
  is exactly the phrase a reader most needs and least understands.

## Consequences

- **Two tests enforce it.** `src/content-language.test.ts` checks the source,
  and `tests/smoke.mjs` checks the rendered text of all three pages at three
  viewport widths and fails if a retired term reappears anywhere a reader can
  see it. Wording rules that are not enforced decay.
- The check covers *visible* text, which includes accessible names and live
  region messages. An `aria-label` written in the old vocabulary fails the
  build — correctly, because a screen reader user is a reader.
- Code comments and internal identifiers are **not** covered and deliberately
  still use the precise terms. `pct_of_record_max` is a good field name.
- Longer strings make panels taller, which has real layout consequences. The
  phone overlap between the title card and the ArcGIS zoom control was caused
  by the longer status text, and the card is now measured against the legend
  rather than capped at a guessed constant.
