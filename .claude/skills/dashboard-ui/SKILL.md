---
name: dashboard-ui
description: Change the ArcGIS/Calcite interface — layout, controls, symbology, layers, accessibility or visible text. Use for any reader-visible frontend work.
---

# Dashboard interface

**Trigger:** a layout, control, symbology, layer, accessibility or copy change
on any page.

## Read first

1. [`src/AGENTS.md`](../../../src/AGENTS.md) — the scoped checklist.
2. [`docs/architecture/frontend.md`](../../../docs/architecture/frontend.md) —
   especially "Layout constraints that are already solved". Every item there
   was found by a failing test or a screenshot.
3. [`.claude/rules/visible-language.md`](../../rules/visible-language.md)
   if any reader-visible string changes.

## Files that normally matter

`src/ui/` (shell, map, layers, controls), `src/styles/`, the page HTML,
`src/viz/` for symbols and colour, `tests/smoke-modern.mjs` for the gate.

## Process

1. **Find the constraint before writing CSS.** Page widths are 1280, 390 and
   360; the zoom control has a 56px lane below 640px; grid and flex children
   carrying controls need `min-width: 0`; `calcite-navigation` clips rather
   than scrolls.
2. **Take colour from the table, never from a literal** (ADR-008).
3. **Check layer order against the subject.** Reference geometry may sit over a
   continuous surface and never over points (ADR-061); the storage and snow maps
   keep their basemap reference layers sunk (ADR-042).
4. **Keep the readiness contract.** Add fields to `window.__dashboardReady`;
   never remove one. Clear `aria-busy` on every exit, failures included.
5. **Say it in Simplified Technical English**, `aria-label`s included.
6. **Run the browser suite.** Layout, visible text and console errors are
   invisible to the unit tests.

## Do not

- import an ArcGIS widget, or a component package root;
- add a `text-transform`;
- put controls below the reservoir list — it is its own scroller;
- introduce a new icon without adding it to the committed Calcite asset list;
- change published vocabulary or a URL parameter's meaning as a side effect.

## Done means

`npm run verify:browser` passes with no console errors and no new axe
violation, at every tested width, and you have said plainly that the map canvas
cannot be visually confirmed in headless Chromium.
