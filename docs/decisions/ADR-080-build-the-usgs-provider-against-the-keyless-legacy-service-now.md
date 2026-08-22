# ADR-080: Build the USGS provider against the keyless legacy service now

- Status: Accepted
- Date: 2026-08-22

## Context

The 2026-08-22 review ruled eleven of the NWIS parameter-00054 sites new, and
the admission screens admitted seven of them on confirmed dam matches. Building
that provider meant choosing between two services:

- The **legacy** daily-values service (`waterservices.usgs.gov`) needs no key,
  answers generously, and is documented to retire in early 2027. Every figure
  this project has measured — the survey's coverage table, the worked Walker
  Lake example, the admission audit's series — came from it.
- Its successor (`api.waterdata.usgs.gov`) rate-limits to about 50 requests
  per IP per hour without a self-service API key. ADR-004 holds that a source
  needing a credential for a read-only request is a conflict with an accepted
  decision, not a detail to work around.

## Decision

**Build against the legacy service now, and record the migration as debt with
a date.** The runway is months, not days: a provider built today runs against
a service that answers exactly as it answered through every measurement this
project has made. The seven admissions are worth publishing in that window;
waiting for the credential question to settle first would defer them past the
retirement entirely.

The migration is not this record's to solve, but its terms are now written:
before early 2027, either register the free API key and amend ADR-004 for this
one provider, or withdraw the seven reservoirs under ADR-056's rules when the
service stops answering. `check_reference_freshness.py` will not catch a
service retirement — that is what this date is.

## Consequences

`pipeline/providers.py` gains a fifth adapter pointed at the legacy endpoint.
When the migration lands or the service retires, the adapter changes; the
roster file, the station identities (USGS site numbers survive both services),
and every published percentage do not.
