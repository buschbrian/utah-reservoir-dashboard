# ADR-044: The zoom envelope belongs to the view, not to the frozen module

- Status: Accepted
- Date: 2026-08-16

## Context

Every map could be zoomed out to level 4 and in to level 23. In Web Mercator a
level is about `1:591,657,527 / 2^z`, so that is **1:37,000,000 to 1:70**: out
to most of North America on a dashboard about one state's water, and in past
the point where the basemap has tiles or this data has anything finer to show.
The three maps open between 1:4,800,000 and 1:11,000,000, so four levels of
zoom-out were available and only the first was about Utah.

`constraints.geometry` was already set and does not address this. It restricts
where the view's **centre** may go, so it stops a reader panning to Europe and
does nothing about zooming out until Europe is on screen anyway. The two
constraints answer different questions and the project had only one of them.

Correcting it was blocked by a test. `MAP_MIN_ZOOM` and `MAP_MAX_ZOOM` were
asserted equal to the copies in `shared/reservoir-viz.js`, under a case titled
"is the region both production maps already use".

That premise had expired. ADR-031 retired the second production map; there is
one. The frozen module is source-only, draws nothing, and is not published.
ADR-008 makes it the owner of the **colour table** and a test oracle — not of
how far a view may zoom. Holding the view's constraints to it meant a value
measured against the real cards could not be corrected without editing an
oracle whose job is colour.

## Decision

**The zoom envelope is `MAP_MIN_ZOOM = 5` to `MAP_MAX_ZOOM = 16`**, owned by
`src/viz/extent.ts`, and no longer compared with the frozen module.

- 5 is 1:18,500,000 — a little under two levels out from the widest opening
  view, still holding the whole connected Colorado River and Great Basin
  geography this dashboard covers, which reaches from -115.7 to -105.6.
- 16 is about 1:9,000 — a single dam and its outlet across the canvas.

`MAP_BOUNDS` and `MAP_CENTER` **stay pinned** to the frozen module. Where a
reader may go is a contract shared with the saved links the retired routes
translate (ADR-031), and it must not drift.

The two constants are now asserted for what they must be true of instead of
against a copy: min below max, min high enough to exclude a continent and low
enough that every map's opening view is reachable, max deep enough to read a
dam and no deeper.

## Consequences

- A reader cannot zoom a Utah dashboard out to the continent, and the browser
  suite asserts the effective minimum on every map.
- **This narrows what the frozen module owns.** ADR-008 is unchanged in
  substance — colour is still its table, still asserted value for value — but
  the practice of checking *everything* the module happens to export has
  stopped. Anything else pinned to it should be judged the same way: is this a
  contract with something still running, or is it parity with a page that no
  longer exists?
- Deliberately weakening a test is worth recording as such. The replacement
  asserts more about the values than the old one did; it just no longer
  asserts they equal a copy nobody reads.

## Alternatives considered

**Edit the constants in `shared/reservoir-viz.js` to match.** Keeps the
parity test green and edits an oracle to accommodate a view-tuning decision it
has no stake in. ADR-008 froze that file for a reason.

**Set only `constraints.geometry` harder.** Does not constrain zoom at all;
see above.

**Leave the envelope alone and document it.** The complaint was that readers
can leave the subject behind, and a note does not stop them.
