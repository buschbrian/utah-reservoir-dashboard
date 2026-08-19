# Opening on what the reader came for

Scoped 2026-08-19, on `main` with 54 test files and 718 unit tests green. This
document covers **two pieces of work that look separate and are one**: taking
the reservoir roster west, and letting a reader choose what they open on.

It continues [`INITIAL-SCOPE-SELECTION.md`](INITIAL-SCOPE-SELECTION.md), which
settled the splash's expensive decisions, and
[`WESTERN-RESERVOIR-ADMISSION.md`](WESTERN-RESERVOIR-ADMISSION.md), which
measured the roster pool. Four of the nine steps that document ordered have
landed since it was written. What follows is what is left, what the request
adds to it, and the order it can be built in.

## The three visitors

The request names them, and they are the acceptance test for all of it:

| Visitor | Wants | Lands on |
|---|---|---|
| "the upper Colorado River basin" | one **region**, every subject | `?area=14` |
| "Idaho snowpack" | one **state**, one subject | `snow.html?state=ID` |
| "Arizona drought" | one **state**, one subject | `drought.html?state=AZ` |

Two things fall out of that table immediately.

**The chooser answers two questions, not one.** `INITIAL-SCOPE-SELECTION.md`
decided "the splash asks one question: which state. Not a level, not a drainage
area." Two of the three visitors above disagree: one arrives with a basin in
mind and no state, and two arrive with a subject in mind and no interest in the
other two pages. A chooser that answers only "which state" sends the Idaho
snowpack visitor to a storage map. **The splash asks where, and what.**

**Neither question needs a new parameter.** `?state=` and `?area=` already
exist, already mean the right things, and already travel across the navigation
(`portable-url.ts`, since `1f4914e`). "What" is not a parameter at all — it is
which page the button links to.

## The coupling that decides the order

This is the finding that made the two halves one document.

`HUC6_BOUNDS` in [`src/viz/extent.ts`](../src/viz/extent.ts) is the box the
storage map opens on, and `extent.test.ts` recomputes it from **whichever file
`reference.json` names as the roster scope's**. `ROSTER_SCOPE` is
`utah-connected` today, which is why ADR-063 could draw 75 basins and still open
on 14.

Admitting the western reservoirs moves `ROSTER_SCOPE` to `west-huc6` by
definition — the roster scope *is* the geography the reservoirs were admitted
from. So the box becomes the whole west, and the test enforces it. **The day the
roster goes west is the day the storage map opens on 19 degrees of longitude**,
and that is exactly the load the request describes as the thing to fix.

The order this forces:

> The chooser lands before the roster, or with it. Not after.

That is not a preference. Today, opening wide is a bug ADR-063 already refused.
After the roster moves, opening wide is the honest default and the chooser is
the only thing that makes it usable.

## Half one: the roster

### Where it stands

| | |
|---|---:|
| published today | **69** reservoirs |
| AWDB candidates measured (ADR-065) | 157 |
| already tracked, after the position dedupe | 68 |
| **admissible by the rules** | **137** |
| RISE reservoirs inside `west-huc6` not in that pool | ~81 |
| projected published roster | **~193** |

Findings 1 and 2 of the admission review are built (ADR-065; the dedupe against
the reviewed dam point). Finding 2 was built and then stopped working: the
lookup went on reading a name after the roster was rekeyed by station, so all
thirty reviewed dam points missed and the dedupe was silently dead from
`5bc9b4f` until `d564015`. The measurement below found it by offering Lake
Mead as a candidate for a roster that already publishes it. Finding 3 — the roster keyed by station rather than by
name — is built as well (ADR-066, `5bc9b4f`): `RESERVOIRS`,
`connected_reservoirs.json`, `capacities.json`, `counties.json` and
`normals.json` are all keyed by the provider's identity now, and
`reservoirLabel` in [`src/state/selection.ts`](../src/state/selection.ts)
already qualifies a shared name with its state. **The blocker the review named
is gone.** Step 4 of that document — "then admit" — is what is left.

### What admitting costs

Measured or projected from the committed files:

| | today | after |
|---|---:|---:|
| `reservoirs.json` | 41 KB gzip | **~95 KB** |
| storage map first load | ~47 KB | **~113 KB** |
| `normals.json`, one run | 1.6 min (69) | **~4.5 min** (`--missing`) |
| reservoir list rows | 69 | ~193 |
| drawn areas holding no reservoir | 61 of 75 | far fewer |

None of that is a constraint. The costs that are real are editorial rather than
numeric:

- **The reviewed file's name stops being true.** `connected_reservoirs.json`
  means "connected to Utah", and its own `selection` sentence says "the three
  published HUC-6 drainage areas that previously had no tracked reservoir". A
  western roster is neither. This is the same failure the site name had before
  `SITE_NAME` moved, and it wants the same fix.
- **The Python literal becomes the minority.** `BASE_AWDB_RESERVOIRS` holds 25
  Utah monthly stations in source; the reviewed JSON would hold ~150. Two
  rosters in two formats was survivable at 25 against 15.
- **Every addition needs four artefacts in the same change**: the capacity
  evidence, the county assignment, the climate normal, and the refresh that
  publishes it. `tests/test_refresh.py` already asserts every roster name is
  either published or withdrawn, with no pending state — which is the check that
  makes a half-finished admission fail loudly.

### The order inside the roster

1. **R1 — the AWDB west (137).** The rules have already run over this pool and
   the evidence is in the audit output. This is a review-and-commit job, not a
   research one.
2. **R2 — the RISE-only west (~81).** A different provider, the same rules, and
   a position dedupe against everything R1 admitted.
3. **R3 — the non-federal sources.** Colorado CDSS and California CDEC first,
   per [`WESTERN-SOURCE-CANDIDATES.md`](WESTERN-SOURCE-CANDIDATES.md); USGS NWIS
   third; USACE treated as two questions rather than one. Each is its own ADR
   and its own fetcher. **Out of scope for this plan** beyond saying where it
   sits.

## Half two: the chooser

### What has landed since the design

`INITIAL-SCOPE-SELECTION.md` ordered nine steps. Four are done:

| Step | Slice | State |
|---|---|---|
| 1 The rename | A | **done** — `SITE_NAME` is "Western Water Dashboard" |
| 2 Prefix-safe drainage clause | B | **done** (`ada826a`) — predicate and clause agree at 2, 4 and 6 digits |
| 3 Publish `bbox` per unit | D | not started — was blocked on schema v3, which has landed |
| 4 `?state=` on the three maps | C, F | **half done** — the model layer exists, no page reads it |
| 5 Carry the parameters across the navigation | E | **done** (`1f4914e`) — `portable-url.ts` |
| 6 The state control | G | not started |
| 7 Widen `?area=` to any code width | — | not started |
| 8 Persist the choice | H | not started |
| 9 The splash | I | not started |

Step 4's model half is worth being precise about, because it is more finished
than it looks. [`src/data/state-vocabulary.ts`](../src/data/state-vocabulary.ts)
publishes the vocabulary, `offeredStates` derives the list from the payloads
rather than a literal, and `areaReachesState` reads a drainage area's `states`.
`payloadForState` in [`src/snow-model.ts`](../src/snow-model.ts) already narrows
the snow payload to one state and **regroups from sites**, never from published
basin means. `reservoirInState` has been in `overview-model.ts` since ADR-060.
All of it is tested and **none of it is imported by a page**.

### What each state and each region actually holds

Recomputed from the committed payloads today. This is the table the splash tiles
are built from, and it is computed at runtime rather than written down, because
the reservoir counts move every morning.

| State | Drawn areas | Measured snow areas | Reservoirs | Snow sites |
|---|---:|---:|---:|---:|
| Utah | 15 | 15 | 52 | 140 |
| Colorado | 8 | 8 | 13 | 72 |
| Wyoming | 7 | 6 | 4 | 32 |
| Arizona | 18 | 8 | 2 | 23 |
| Idaho | 13 | 13 | 1 | 85 |
| Nevada | 16 | 13 | 1 | 47 |
| Oregon | 16 | 13 | 0 | 82 |
| Washington | 10 | 9 | 0 | 77 |
| Montana | 6 | 6 | 0 | 38 |
| California | 24 | 12 | 0 | 36 |
| New Mexico | 5 | 4 | 0 | 5 |

And by region, which is the axis the first visitor arrives on:

| Region | Drawn areas | Reservoirs | Snow sites |
|---|---:|---:|---:|
| 14 Upper Colorado | 10 | 34 | 137 |
| 15 Lower Colorado | 15 | 5 | 36 |
| 16 Great Basin | 12 | 30 | 152 |
| 17 Pacific Northwest | 22 | 0 | 289 |
| 18 California | 16 | 0 | 23 |

**Region 17 is the strongest argument in either table.** The Pacific Northwest
holds 289 of the 637 snow sites — 45% of the snow network — and zero published
reservoirs. A visitor who comes for snow is best served by the part of this site
that is already complete, and worst served by a chooser that only offers states
with reservoirs in them.

**`MX` and `CN` must never reach the chooser.** Eight drawn areas extend into
Mexico and four into Canada; the `states` attribute carries those codes.
`offeredStates` already intersects against an explicit fifty-plus-DC list, which
is what keeps them out no matter what a future payload publishes.

### Region is an entry vocabulary, not a drawn level

The first visitor asks for "the upper Colorado River basin", which is a
two-digit code. That must not become `?level=2`.

`?level=` picks how finely the ground is **drawn**, and ADR-064's rule is that
every drawn area has a figure behind it, which is what publishing every figure
at both levels buys. A region level would mean five drought rows, five storage
groups and five snow groups — a coarser answer to a question nobody asked, and
three more coverage files to publish and keep in one week.

A region is a **filter**, and `?area=14` already expresses it: `HUC_CODE`
accepts any even width to twelve, `matchesFilter` prefix-matches, and since
`ada826a` the `where` clause does too, at exactly 2, 4 and 6 digits. The drawn
level stays 4 or 6 and the reader's region narrows what is drawn at that level.

One gap: **region names are published nowhere.** `reservoirs.json` publishes
`watersheds.subregions` (four-digit names, and only for subregions the roster
occupies); `reference.json` publishes per-unit names at 4 and 6. Five region
names have to come from the same place every other name comes from —
`watershed_scopes.py`, the one place that decides which drainage areas exist —
and not from a table in a TypeScript file, which ADR-002 refuses and which would
go stale with nothing to catch it.

### What the three maps do with `?area=` today

| Page | `?area=` | Needs |
|---|---|---|
| Storage map | filters (`drainage=`, `area=` as alias), prefix-matched | nothing at 2 and 4 digits — it already works |
| Snow | narrows the whole page | narrowing the **drawn** areas as well, to measured ∩ chosen |
| Drought | **opens that area's row; does not filter** | a decision |

The drought map is the odd one, and deliberately so: its comment says fourteen
rows do not need filtering. At 75 rows, and with a reader who arrived asking for
Arizona, they do. **Recommendation: `?area=` filters on the drought map too, and
still opens the chosen row when it names one area.** Two behaviours from one
parameter is worse than the extra work.

### What a state selection is allowed to claim

Unchanged from `INITIAL-SCOPE-SELECTION.md`, and worth repeating because it is
the one honesty constraint in the feature:

- **Reservoirs** — `waterbody_states` (ADR-060). Exact.
- **Snow sites** — the site's own `state`. Exact, and the basin means are
  recomputed from the surviving sites (ADR-064).
- **Drainage areas** — `states`, which is "the water reaches this state". An
  area whose water reaches two states is drawn whole in both, because clipping
  to a state line needs polygon geometry in the browser and ADR-048/049 refuse
  it.

So the drought map — which has no points, only areas — prints that second half
in words. And ADR-046 is the live hazard: **no state-wide drought share.** A
share of Colorado's land in drought is a new number with a new denominator and
may not be produced by averaging or summing the areas' shares. The ranked list
of areas narrows correctly for free and is the answer.

### The splash

Three constraints from the earlier design, all still binding:

1. **It appears only when nothing else has answered**: no `?state=` and no
   `?area=`, no stored choice, not dismissed before. A shared link never lands
   on an interstitial.
2. **The control comes first, the splash second.** The control carries its
   weight regardless and is a solved shape (`createLevelControl`: built from
   what the export offers, returns `null` when there is nothing to choose, takes
   a Calcite scale, treats a change as a `location.replace` navigation). The
   splash over a working mechanism is an affordance; the splash as the only way
   in is load-bearing.
3. **`?state=all` has to be writable.** Once storage fills a silent address bar,
   absence stops meaning "the whole west" — so a reader with Utah stored cannot
   be sent a link to everything. This is a deliberate exception to the
   defaults-as-absence rule and needs recording as one.

What the request adds: **the splash's second row is the subject.** Storage,
Snowpack, Drought — and "Show the whole west" as the skip, which is a real
answer and needs to be one click. The subject is not persisted and not a
parameter; it decides which page the chosen scope is applied to. A reader who
picks Idaho + Snowpack gets `snow.html?state=ID`, and the navigation bar carries
`state=ID` onto the other two pages if they go looking.

New Calcite components this needs — `calcite-dialog`, `calcite-tile-group`,
`calcite-tile`, `calcite-segmented-control`, `calcite-chip` — are imported by
path, never package-wide (`architecture.test.ts` fails the build otherwise), and
**every icon they reach for is committed under `public/assets/icon/` in the same
change**. A missing icon is a 404 the page survives and only the browser suite
sees.

## Decisions taken

Settled 2026-08-19. Three of them were the ones that change what gets built,
and all three were taken by the owner rather than assumed here.

| | Decision | Taken |
|---|---|---|
| D1 | The splash asks **where and what** | A place (11 states, 5 regions) and a subject (Storage, Snowpack, Drought), plus "Show the whole west" as a one-click skip. It is what makes two of the three visitors land on the right page. |
| D2 | Region is a **filter**, not a drawn level | `?area=14`, never `?level=2`. The drawn level stays 4 or 6, so every drawn area keeps a figure behind it (ADR-064). |
| D3 | Region names come from the registry | A registered `west-huc2` scope in `watershed_scopes.py`, published in `reference.json` — not a table in a TypeScript file (ADR-002). |
| D4 | `?area=` **filters** the drought map | And still opens the row it names. Two behaviours from one parameter is worse than the extra work. |
| D5 | The drawn context follows the choice on drought and snow, not on storage | On storage the areas are context and context is the point; on the other two the areas are the subject. |
| D6 | The reviewed roster file is **renamed** with R1 | `connected_reservoirs.json` means "connected to Utah" and its selection sentence names three drainage areas. Neither is true of a western roster — the same failure `SITE_NAME` had. |
| D7 | **AWDB's 137 first**, RISE second | The rules have already run over that pool and the evidence exists. Two reviewable changes rather than one large one; the review is the real cost and it does not shrink by merging them. |
| D8 | The five reservoir-less states are offered | With the counts on the tile. Hiding them makes the site look smaller than it is, and region 17 alone holds 45% of the snow network. |

Three ADRs come out of this, written when the work lands rather than now:

- **The reader chooses the opening scope.** The address bar wins, storage is the
  returning reader's default, `all` is writable, and a stored choice that empties
  a page falls back rather than showing nothing.
- **A region is an entry vocabulary, not a drawn level** — against ADR-050 and
  ADR-064, which it is consistent with and should say so.
- **The roster goes west**, which moves `ROSTER_SCOPE` and the opening box with
  it, and supersedes the part of ADR-063 that decoupled them.

## The slices

Each leaves the site working and testable. The letters continue from the earlier
document, which is why they start at D.

### Track 1 — the chooser

**S1 — Publish a box per unit, and the region roster.** *(was step 3 / slice D)*
`watershed_scopes.py`, `tools/build_reference_export.py`,
`refresh_reservoirs.py`'s export sections, `reference.json`,
`src/data/boundaries.ts`, `src/viz/extent.ts`, `src/data-docs-schema.ts`,
`tests/test_watershed_scopes.py`, `extent.test.ts`, `boundaries.test.ts`.
Registers `west-huc2` for the names. **Unblocked** — the schema-v3 and roster-key
work it was waiting on has landed. Measure the gzipped delta and update
`docs/data-transfer.md`.

**S2 — The opening-scope module.** A new module that reads `?state=` and
`?area=` together, resolves them against the reference export and the payload,
narrows coarsest-first, keeps a surviving choice and drops a dead one to "all",
and answers with an opening box from the published unit boxes. No page edits, no
browser. Depends on S1 for the boxes.

**S3a/b/c/d — Wire the four surfaces.** Storage (`main.ts`), snow (`snow.ts`),
drought (`drought.ts`), charts (`overview.ts`). Disjoint files, so they can run
in parallel once S2 exists. Each one: the filter, the opening view, the summary
sentence that names the chosen place, and — for drought — the sentence about
what a state selection means for an area whose water crosses a line.

**S4 — The where control.** Modelled on `createLevelControl` and built beside
it: a state select and an area drill-down (region → subregion → basin), each
repopulated from what the one above leaves. Hosted in the storage panel and in
the snow and drought filter bars, at the two different Calcite scales those
already need.

**S5 — Persistence.** `localStorage`, address bar winning, the explicit `all`
token in `url.ts` and `portable-url.ts`, and the fallback when a stored choice
empties the page a reader has just opened.

**S6 — The splash.** Where × subject, first visit only, skippable in one action,
counts computed at runtime, and axe-clean at 1280, 390 and 360.

### Track 2 — the roster

**R1 — Admit the AWDB west.** Re-run `tools/audit_candidate_capacity.py --scope
west-huc6 --json`, review, commit the evidence into the reviewed roster file
(renamed, per D6), run `tools/build_county_assignments.py`, run
`tools/build_normal_baselines.py --missing`, run the refresh, move
`ROSTER_SCOPE` and `HUC6_BOUNDS` with it. **Gated on S3a at minimum and S4
preferably** — see the coupling above.

**R2 — Admit the RISE west.** The same shape, one provider later, deduped by
position against everything R1 published.

**R3 — Non-federal sources.** Not scoped here.

### What collides with what

| File | Wanted by | Rule |
|---|---|---|
| `reference.json`, `watershed_scopes.py`, `build_reference_export.py` | S1 and R1 | serialize; S1 first |
| `src/state/url.ts` | S2, S5 | byte-for-byte parity with `shared/reservoir-viz.js` — one at a time, `url.test.ts` green |
| `main.ts` / `snow.ts` / `drought.ts` / `overview.ts` | S3a–d | disjoint, safe in parallel |
| `src/viz/extent.ts` | S1 and R1 | S1 adds the box source; R1 moves the constant |

### The order

```
S1 ─→ S2 ─→ S3a ─┬─→ S4 ─→ S5 ─→ S6
         ├─ S3b ─┤
         ├─ S3c ─┤
         └─ S3d ─┘
                  └──────→ R1 ─→ R2
```

R1 may start its **measurement** at any time — the audit tools write nothing.
What it may not do is publish before the storage map has somewhere to open.

## Tests each slice owes

- **S1** — every published box contains its own rings
  (`tests/test_watershed_scopes.py`); the roster scope's published box equals
  `HUC6_BOUNDS` (`extent.test.ts`); a unit with a missing or malformed box costs
  that unit and not the other 74 (`boundaries.test.ts`).
- **S2** — state, region, subregion and area narrow each other coarsest-first; a
  surviving choice is kept and a dead one falls back to "all"; a state's box
  contains every one of its areas' boxes.
- **S3a–d** — `filters.test.ts` still holds the predicate and the clause against
  each other; a state filter on snow regroups **from sites** and a basin below
  its reporting floor publishes nothing rather than zero; no state-wide drought
  share exists anywhere in the drought view.
- **S4/S6** — `smoke-modern.mjs`: the navigation carries the choice; every page
  passes axe-core at 1280, 390 and 360; no console error from a missing icon;
  the bar does not clip at 360. `content-language.test.ts`: nothing the chooser
  renders says "HUC".
- **S5** — `url.test.ts`: a six-digit `?area=` link still means what it meant,
  and `searchWithState` parity with the frozen module survives the `all` token.
- **R1/R2** — `tests/test_refresh.py`: every roster station is published or
  withdrawn; every published reservoir has a capacity, a county and a normal, or
  states why not.

## Open questions

1. **What does the storage map open on when the reader has chosen nothing and
   the roster is western?** The honest answer is the whole west, and the splash
   is what stops that being the only answer. Worth confirming rather than
   assuming.
2. **Does a region tile belong on the splash beside the states, or behind a
   second tab?** Five regions and eleven states on one screen is a lot of tiles
   at 360 pixels.
3. **How many of the 137 have a traceable capacity that survives review?** The
   rules admitted them; a human has not read them one by one, and that reading
   is most of R1's real cost.
4. **Does `BASE_AWDB_RESERVOIRS` stay in Python once the reviewed file holds
   ~150 stations?** Two rosters in two formats was fine at 25 against 15.
   Measured since: its 25 entries carry none of the dam evidence the reviewed
   schema requires, so moving it means re-running the match against those 25
   dams rather than reformatting a literal. Worth doing, and not worth
   blocking the admission on.

5. **What does a reservoir held above its conservation pool read as?**
   Answered in part on 2026-08-19: not yet, and keep measuring. Five Pacific
   Northwest flood-control dams in the candidate pool operate routinely at
   1.31 to 2.89 times the denominator their capacity is taken from, so
   percent-full reads above 100 on an ordinary day and `ReservoirViz.CLASSES`
   has no class above full. None of the 69 published today exercises this,
   which is why the colour table has never had to answer it. The decision is
   deferred rather than taken, because R1's publishing half is gated on the
   chooser regardless and a class added to that table touches every renderer,
   legend, chart and filter generated from it, plus the frozen oracle's
   parity test. It needs an ADR when the roster work starts, and refusing the
   five is a real option that costs the Pacific Northwest five of the very few
   reservoirs it would have.

6. **Does ADR-065's ceiling survive one bad figure in the source record?**
   The rule takes the largest of three inventory figures as the ceiling, so a
   data-entry error widens the ceiling rather than tightening it. Lemon
   Reservoir, Colorado publishes a maximum of 487,660 acre-feet against a
   normal of 40,146 for a reservoir that holds about forty thousand. It
   changed no outcome here. It is the failure mode the rule is exposed to and
   the review found it on the first pool the rule was applied to at scale.
