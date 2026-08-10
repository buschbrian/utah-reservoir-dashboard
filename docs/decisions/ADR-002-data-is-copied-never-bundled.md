# ADR-002: Runtime data is copied into the published output, never bundled

## Status

Accepted

## Date

2026-08-09

## Context

`reservoirs.json` is rewritten every morning at 6am Mountain Time by a GitHub
Action that re-pulls each reservoir's full 2015-to-present series and
recomputes every metric. Before the build step existed, that commit **was** the
deploy: the pages fetched the file at runtime, so new numbers went live the
moment the file changed.

Adding a build step (ADR-001) put that contract at risk. If the application
imports `reservoirs.json`, then:

- every data refresh needs a successful rebuild to reach readers, and
- a build failure silently freezes the dashboard at yesterday's numbers while
  continuing to look completely healthy.

A dashboard whose whole purpose is showing current conditions failing *silently
and invisibly* into staleness is the worst failure mode available to it. The
project already has direct experience of exactly this class of bug: three
reservoirs sat frozen at week-old values for eleven days while the workflow
stayed green, which is why staleness is now first-class data.

## Decision

**Data is copied into the published output. It is never imported.**

`vite.config.ts` copies `reservoirs.json`, `capacities.json` and
`huc6.geojson` into `dist/` and `dist/data/` in a `closeBundle` hook, after the
bundle is written. Nothing in `src/` imports them. Pages fetch them at runtime
with `cache: "no-store"`.

## Alternatives Considered

### Import the JSON and rebuild on every refresh

- Pros: one artifact, no copy step, the payload is type-checked at build time.
- Cons: couples the daily data to a green build; a broken test freezes the
  numbers.
- Rejected: it inverts the dependency. The data pipeline is the reliable part
  of this project and the frontend is the part under active reconstruction.

### Cache-bust the fetch with a key derived from `as_of`

- Rejected as circular: the client only learns `as_of` by fetching the payload.
  `cache: "no-store"` is the honest version of the same intent.

## Consequences

- The deploy workflow asserts both halves rather than trusting them: that every
  published URL resolves in `dist/`, and that the payload's `generated_at`
  string does **not** appear anywhere in `dist/assets`. A bundled payload fails
  the build.
- A red build still freezes the numbers, because the deploy publishes the build
  output. That is why the unit tests compare against `shared/reservoir-viz.js`
  loaded in a `node:vm` sandbox rather than against literal values from one
  day's payload — **a data refresh cannot turn the build red on its own.**
- `reservoirs.json` stays at the repository root as well as in `data/`, so the
  URLs the existing pages fetch keep working.
- The runtime validator at the fetch boundary is what replaces the type safety
  that importing the file would have given.
