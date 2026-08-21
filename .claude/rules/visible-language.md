---
description: Simplified Technical English vocabulary for anything a reader can see (ADR-006)
globs: ["src/**/*.ts", "*.html", "src/styles/**", "docs/**"]
---

**Visible text is Simplified Technical English** (ADR-006). This covers page
copy, button labels, `aria-label`s, live-region messages and chart titles —
everything the smoke suite reads.

Never write, where a reader can see it:

| Never | Write |
|---|---|
| `af` | acre-feet |
| `period-of-record` | highest recorded storage |
| `stale` | late data |
| `cadence` | update schedule |
| `seasonal percentile` | history rank |
| `RISE` | Bureau of Reclamation |
| `AWDB` | Natural Resources Conservation Service |
| `CDEC` | California Department of Water Resources |

Also: no `text-transform` in `src/styles/` or the pages — `innerText` returns
what CSS transformed, so an uppercase label is what a screen reader says.

Enforced by `src/content-language.test.ts` and `tests/smoke-modern.mjs`.
Machine identifiers stay quoted in API documentation (ADR-026).
