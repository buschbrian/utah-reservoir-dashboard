# ADR-036: Make accessibility a gate, and write the content policy from measurement

## Status

Accepted

## Date

2026-08-16

## Context

Accessibility was a stated commitment with no automated check behind it. The
README carried it as an open item, and the browser suite asserted layout,
vocabulary and console health but nothing about whether the pages could be
used. ADR-006 gave the vocabulary a test; nothing gave the interface one.

A DOM check would not have been enough. Calcite and the ArcGIS components put
their real controls inside shadow roots — the focusable control in a
`calcite-slider` is a `div` three levels down — so anything walking the light
DOM would have reported a clean page.

Separately, the project had no Content-Security-Policy at all, and the
modernization plan's Phase 7 asked to verify that CDN-hosted assets resolve
under "the production CSP" that did not exist.

## Decision

**axe-core runs inside the browser suite**, over every page at every tested
width, at WCAG 2.0 and 2.1 levels A and AA, on a settled page — after every
control is wired and every table filled, because a scan of a half-built page
tests the loading state. It is injected from the test's own origin rather than
inline, which the content policy below requires and which is a small proof the
policy works.

Exactly two violations are allowed through, both inside vendor components, and
each is listed in `AXE_EXCEPTIONS` with its reasoning: `arcgis-chart` renders
an inner element carrying an inert `aria-label` with no role, and Calcite's
slider leaves its own handle unnamed. The second is worked around by naming the
handle directly (`src/ui/slider-label.ts`), which only writes when the handle
has no name, so a Calcite that fixes it wins automatically.

**The content policy is written from measurement.** `tools/audit-transfer.mjs`
reports every host the running application contacts; those hosts, and no
others, are what the policy allows. It ships as a `meta` tag on every page,
because GitHub Pages serves no custom headers — which also puts
`frame-ancestors`, `report-uri` and `sandbox` out of reach.

Be plain about its scope, because the measurement forced an honest answer.
`script-src` has to allow the ArcGIS CDN — the SDK's workers import their own
code from it, and without that the charts workspace never finishes loading at
all — and `'unsafe-eval'`, because the charts package compiles JSON schemas
with `new Function`. Both were confirmed by removing them and watching pages
fail. **This policy is therefore not meaningful protection against injected
script**, and the comment on every page says so.

What it does buy is separate and real: no plugins, no injected `base` tag
re-pointing relative URLs, no form posting anywhere, and every fetch, image and
font confined to this origin and named Esri hosts — so an injected `img` or
`fetch` cannot exfiltrate to an attacker's host.

## Consequences

Five real defects were found on the first run and all five were this project's,
not a vendor's: a badge at 4.23:1 where AA wants 4.5, six scrollable regions a
mouse could scroll and a keyboard could not, and both slider handles unnamed.
One of those — the API field tables — is only scrollable at phone widths, which
is why the gate runs at all three and not just at desktop.

The gate immediately caught a defect nothing else could. The label typeface had
been set from the SDK's documented display names, so it asked the font host for
a slug that does not exist; the atlas 404'd and every label silently fell back
to the default sans. A missing label font does not fail, and a 404 console
message carries no URL, so neither the page nor the console filter could show
it. `watchLabelFonts` watches the responses instead.

A new page must carry the policy and pass the gate. Adding a service means
re-running the audit and widening the policy from what it reports, not from
what the service's documentation claims.

If a future SDK stops needing the CDN in `script-src` or stops compiling
schemas at runtime, the policy becomes worth something against script injection
and should be tightened immediately. That is tracked rather than left to
memory.
