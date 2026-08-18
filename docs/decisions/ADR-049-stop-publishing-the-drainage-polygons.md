# ADR-049: Stop publishing the drainage polygons

## Status

Accepted

## Date

2026-08-17

## Context

ADR-048 took the drainage geometry out of `reference.json` and said, in its
Decision, that `huc6.geojson` "stays published as the documented direct
download it already was." That was written on the strength of the comment in
`vite.config.ts` describing the standalone files as "documented
direct-download contracts."

Checked rather than repeated: **it is not documented anywhere a reader can
see.** `data.html` links `data/drought/usdm-current.geojson` and describes the
three JSON payloads; it has never named `huc6.geojson`. The only things
asserting the file's presence in `dist/` were the deploy workflow's manifest
and `src/deploy.test.ts` — the build checking its own output, not a promise to
anybody.

Meanwhile the build copies it **twice**, into `dist/` and `dist/data/`, at 652
KB each. That is 1.3 MB in every deploy, for a file no page has requested
since ADR-047 moved the outlines to the hosted layer.

## Decision

`huc6.geojson` is not copied into `dist/`. It stays committed, it stays the
reviewed source the pipeline assigns every reservoir with, `source_file` in
`reference.json` still names it, and it stays reviewable in the repository —
the same arrangement `normals.json` has had all along, for the same reason.

`utah-boundary.geojson` continues to be published. The mask is drawn from that
polygon, it is 19 KB, and no hosted service publishes the reviewed UGRC
outline.

## Consequences

`dist/` drops from 38 MB to 37 MB. That is deploy weight rather than reader
weight — no page fetched either copy — so no measurement in
`docs/data-transfer.md` moves.

**Anyone deep-linking `/huc6.geojson` or `/data/huc6.geojson` now gets a 404.**
This is the whole risk and it is worth stating plainly rather than assuming it
away: the file was reachable for as long as it was published, whether or not
the site advertised it, and something may have found it. The judgement is that
an undocumented path nothing links to is not a contract, and that the file
remains available in the repository at the same name. If that turns out to be
wrong, restoring it is one line in `vite.config.ts`.

This corrects a statement of fact in ADR-048 rather than reversing its
decision. ADR-048 stands as written; its claim that the file stayed published
is superseded here.

## Related

- Follows [ADR-048](ADR-048-publish-the-roster-not-the-polygons.md), which
  took the same geometry out of the payload.
- [ADR-002](ADR-002-data-is-copied-never-bundled.md) is the rule this operates
  under: published data is copied, never imported. This removes a file from
  what is copied; it does not change how anything is published.
