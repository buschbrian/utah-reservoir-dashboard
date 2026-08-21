---
name: scope-state
description: Change geographic scope, hydrologic level, opening behaviour, URL parameters or the remembered place. Use whenever "scope" or "where the map opens" is in the task.
---

# Scope and view state

**Trigger:** anything about which areas are drawn, which reservoirs are on the
roster, where a page opens, what a link carries, or what is remembered between
visits.

## Read first

[`docs/architecture/scopes.md`](../../../docs/architecture/scopes.md), all of
it. Then ADR-063, ADR-068, ADR-064, ADR-044.

## The four scopes are four questions

| Concept | Name | Question |
|---|---|---|
| Drawn | `DEFAULT_SCOPE` / `default_scope` | Which areas do the maps draw? |
| Roster | `ROSTER_SCOPE` / `roster_scope` | Which geography were reservoirs admitted from? |
| Opening | `OPENING_SCOPE_HUC6_BOUNDS`, `src/data/opening-scope.ts` | Where does a page open with no choice made? |
| Selected | `?state=`, `?area=`, `?level=`, the stored place | Where has this reader asked to be? |

They currently coincide in places. **Never answer two of them with one
constant** — that coupling is what ADR-068 was written to break.

## Files that normally matter

`watershed_scopes.py`, `src/data/boundaries.ts`, `src/data/opening-scope.ts`,
`src/state/opening-preference.ts`, `src/viz/extent.ts`,
`src/ui/where-control.ts`, `src/ui/opening-splash.ts`, `src/state/url.ts`.

## Process

1. Say which of the four questions you are changing, and confirm the other
   three do not move.
2. Check the payload contract: a client file never names a hydrologic level;
   it arrives as `DrainageScope { level, areas }`.
3. Check the link contract: the address bar outranks the stored choice, which
   outranks everywhere. The stored choice is never written back into the URL.
   The first-visit chooser appears only when the query string is **empty**.
4. Check the level contract: `?level=` carries the digit count, absent means
   basins, and changing it is a navigation (`location.replace`), not a
   re-render.
5. Check the dominant-reservoir contract: readers start with Powell and Mead
   included; the library default is the opposite on purpose. Rows already
   scoped use `scopeReservoirs`/`rollupOfScoped`, which cannot narrow twice.
6. Run the browser suite: the deep-link case is what catches a modal buried
   over someone's shared link.

## Do not

- move `OPENING_SCOPE_HUC6_BOUNDS` — it is a contract with saved links;
- name a boundary file directly in a test, tool or fixture;
- write `/^\d{6}$/` — use `HUC_CODE`;
- delete `?state=all`, which is how "everywhere" is said out loud.

## Done means

`npm run verify:browser` passes, saved links still resolve, and each of the four
scopes still answers only its own question.
