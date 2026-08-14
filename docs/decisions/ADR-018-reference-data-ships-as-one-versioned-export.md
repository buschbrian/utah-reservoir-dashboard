# ADR-018: Reference data ships as one versioned export

## Status

Accepted

## Date

2026-08-13

## Context

The dashboard's data comes in two halves that behave nothing alike.

`reservoirs.json` is rewritten every morning and its commit is the deploy
(ADR-002). The other half — capacity and geography — changes on the order of
never, and it is what every surface needs before it can draw anything: a
percentage needs its denominator, and a map needs its outlines.

That half was four committed files, each fetched by name: `capacities.json`,
`huc6.geojson`, `utah-boundary.geojson`, and the separate Upper Colorado
scope generated for research. Three problems came with that arrangement.

Every new surface re-learns the set. Which files exist, which of them is the
published geography and which is a research scope, and what shape each one
is in are facts spread across `vite.config.ts`, the deploy workflow's URL
list, and two loaders. A page that fetched the wrong scope would look like it
worked.

Nothing declared a version. A reader had no way to say "this payload is not
the shape I understand" — it could only parse what it found and draw whatever
came out, which is how a map ends up confidently wrong rather than visibly
broken.

And the research scopes could not be compared against anything. The Upper
Colorado boundaries were generated and committed
(`docs/UPPER-COLORADO-PIPELINE.md`) but never published, so the comparison
they exist for required a checkout.

## Decision

The reference half ships as one file, `reference.json`, built by
`refresh_reservoirs.build_export_sections()` and written by
`tools/build_reference_export.py`.

- It carries `schema_version`, the whole capacity catalog with its National
  Inventory of Dams provenance, the state outline, and **every** named
  watershed scope.
- `geography.watersheds.default_scope` names the published one. The research
  scopes travel in the same file and are not drawn. Which geography is the
  accepted one stays a single decision (ADR-009, ADR-010), made by the
  export rather than by each page that reads it.
- A payload whose `schema_version` this build does not recognise reads as no
  boundaries at all, not as a best effort. Both callers already handle
  missing boundaries; half-understanding a later shape is the failure mode
  worth preventing.
- It is **generated and committed**, not built during the deploy. The pages
  fetch it at runtime (ADR-002) and the deploy has no Python step.
- It is **compact**, like the GeoJSON it is built from. Indenting it costs
  1190 KB against 229 KB, and every byte is fetched by a reader's browser.

The four source files stay committed and stay published. They are the
reviewed originals, and the two legacy map pages still read the Utah outline
directly.

Two tests keep the copy honest. `test_the_committed_reference_export_matches_the_files_it_is_built_from`
fails until the export is rebuilt in the same commit as any change to its
sources, and `test_the_export_publishes_the_committed_boundaries_unchanged`
asserts the geometry is byte-for-byte the committed geometry.

## Alternatives Considered

### Leave the four files as they are

- Pros: no change; already deployed and tested.
- Rejected: it is the arrangement described above, and the version problem
  does not get better by waiting. The Upper Colorado scope also stays
  unpublishable without adding a fifth name to every list.

### Fold the reference data into `reservoirs.json`

- Pros: one payload, one request, nothing new to publish.
- Rejected: it would put a quarter-megabyte of unchanged polygons in every
  morning's diff. That diff is the only review surface the daily storage
  numbers get, and burying them is a real cost against no benefit — the two
  halves change on completely different schedules.

### Build the export during the deploy instead of committing it

- Pros: cannot drift from its sources.
- Rejected: it puts Python in the Pages build for a file that changes on the
  order of never, and a build-time step means the published geography exists
  nowhere a reviewer can see it. The drift risk is real and is answered by a
  test instead.

### Serve every scope as its own file and let pages choose

- Pros: a reader fetches only the scope it draws.
- Rejected: that is the arrangement being replaced. It puts the "which scope
  is published" decision in every page that reads one.

## Consequences

- The typed stack makes one request where it made two, and both the mask and
  the drainage outlines come from it. The request is shared between the two
  independent call sites in `main.ts`; the failure is not, so either can
  still fail softly on its own.
- The published geography costs about 28 KB more over the wire — 71 KB
  gzipped against 43 KB — almost all of it the Upper Colorado scope that is
  now available to compare against.
- Changing `capacities.json` or any boundary file requires re-running
  `python tools/build_reference_export.py` in the same commit. The Python
  suite fails until that happens.
- `huc6.geojson` keeps its own committed life as the reviewed source and as
  what `extent.test.ts` recomputes `HUC6_BOUNDS` from (ADR-017). It is no
  longer fetched by the application.
- The two legacy map pages are unchanged and still fetch
  `utah-boundary.geojson` directly. Moving them is a separate decision;
  until then the export's geometry is asserted identical to theirs, so the
  engines cannot disagree (ADR-007).
