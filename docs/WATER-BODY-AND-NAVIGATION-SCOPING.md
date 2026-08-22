# Water-body names, water-body type, navigation, and the states still unsourced

> **Scoping document.** It records what was measured on 2026-08-21 and what
> each item would cost; the delivered half is recorded in
> [ADR-076](decisions/ADR-076-nest-the-place-menus-and-let-the-heading-carry-the-state.md)
> and current architecture is [`docs/architecture/`](architecture/README.md).
> See [`docs/history/README.md`](history/README.md).

Status: Scoping, written 2026-08-21. **Partly delivered.** Item 3, the nested
drainage and county menus, shipped the same day, together with the cheap fix
this document asked for first -- narrowing the county list by the chosen state.
Items 1, 2, 4 and 5 are not started. Every measurement below is as it was
written; nothing here has been rewritten to describe today.

Five items were raised on 2026-08-21; this records what each one actually is,
what it costs, what it would break, and the order the next agent should work
them in.

Every count below was measured on this date against the committed payloads in
this worktree — `reservoirs.json` (375 published reservoirs), `counties.json`,
`admitted_cdec_reservoirs.json` and the source files named in each section.
Nothing here was fetched live. **Every item that needs a live measurement
before it can be estimated says so in its own section**, and the next agent
should treat those as the first task of that item rather than as a detail
inside it.

## The five items, as they were raised

1. **Normalize names** against a documented water-body source — the National
   Hydrography Dataset or an Esri equivalent. Operator initials and gauge
   numbering appear in published names and nobody wants to read them.
2. **Say which water bodies are lakes**, rather than calling everything a
   reservoir.
3. **Nest the navigation**: drainage areas under their hydrologic level,
   counties under their state, as menus with submenus rather than four
   parallel flat lists.
4. **Let a reader get back to the opening chooser**, so the state / region /
   subregion / basin / county question can be re-asked at any time, and
   answered onto storage, snow or drought.
5. **Keep scoping the remaining states** — Arizona, Nevada, Idaho, Oregon,
   Washington, Wyoming. Utah publishes nothing of its own; the rest have been
   surveyed once and not settled.

Items 1 and 2 are one piece of work against one service. Items 3 and 4 are one
piece of work against one control. Item 5 is independent of both and is the
only one that needs the network before it can be planned.

---

## 1 and 2. The name and the type come from the same service

### What is actually wrong with the names

375 published names were scanned. The damage is small, specific, and mostly
Californian — 21 of the 28 affected names come from the California Data
Exchange Center, the other 7 from the Natural Resources Conservation Service,
and none at all from Reclamation or Colorado:

| Pattern | Count | Examples |
|---|---:|---|
| A parenthetical carrying an operator | 9 | `Courtright (Pg&E)`, `Florence Lake (Sce)`, `Huntington Lake (Usbr)`, `Ice House (Smud)`, `Loon Lake (Smud)`, `Englebright (Usace)`, `Hell Hole (Pcwa)`, `Lake Davis (Dwr)`, `Caples Lake (Eid)` |
| A parenthetical carrying an alias or the dam | 7 | `Coyote (Lake Mendocino)`, `Warm Springs (Lake Sonoma)`, `Santiago Creek Res (Irvine Lake)`, `Mossyrock Dam (Riffe Lk)`, `Hidden Dam (Hensley)`, `Stumpy Meadows Reservoir(Mark Edson Dam)`, `Lake Natoma  (Nimbus Dam)` |
| Gauge abbreviations left in | 13 | `Res` ×5, `Lk` ×3, `nr`/`Nr` ×4, `No` ×2, and one each of `Vly`, `Sta`, `24Hr` — `Lake Pillsbury Nr Potter Vly 24Hr Avg`, `Marlette Lk nr Carson City`, `Coyote Res-Sta Clara`, `Viva Naughton Res` |
| Plant numbering rather than a water body | 2 | `Pit R No 6 Reservoir`, `Pit R No 7 Reservoir` |
| Whitespace and punctuation faults | 3 | `Lake Natoma  (Nimbus Dam)` and `Gem  Lake` (double space), `Stumpy Meadows Reservoir(Mark Edson Dam)` (no space) |
| A gauge description rather than a water body | 3 | `Rye Patch Re nr Rye Patch, NV`, `Stagecoach Reservoir nr Oak Creek`, `Marlette Lk nr Carson City` |

The rows overlap. **28 distinct names are affected, out of 375** — a small,
bounded correction rather than a re-labelling of the roster, which is the
strongest argument for doing it as a reviewed edit and not as an automatic
rule.

One of the 28 deserves its own line. **`Rye Patch Re nr Rye Patch, NV` ends in
a comma and a state code**, which is exactly the format `reservoirLabel`
produces to disambiguate two reservoirs that share a name. A name that already
looks like a disambiguated label is a collision waiting for a second Rye Patch,
and it is the clearest single example of a provider's field being published as
though it were a name.

Two further facts matter more than the counts.

**The acronyms are damaged, and the damage has an address.**
`Pg&E`, `Usbr`, `Usace`, `Sce`, `Smud`, `Dwr`, `Eid` and `Pcwa` are not how
anyone writes those names. They are `str.title()` applied to an
all-uppercase station name: `tools/audit_cdec_stations.py:193` does exactly
that, and the result was carried into `admitted_cdec_reservoirs.json` by hand
during admission. **This is where a rule has to be applied.** The admitted
rosters are reviewed evidence edited by a person (`data/AGENTS.md`), not
generated files — so a normalization pass is a reviewed edit to those files,
or a committed name table beside them, and never a transformation applied
during the daily refresh.

**The operator is already its own field.** `admitted_cdec_reservoirs.json`
carries `"operator": "Pacific Gas & Electric"` on the same record whose name
reads `Courtright (Pg&E)`. The parenthetical is duplicated data, rendered
badly, in the one place a reader cannot avoid it. Removing it loses nothing
the payload does not already hold.

### The type question has never been asked

The word "reservoir" is used throughout this project for anything that stores
water, and the roster does not distinguish. Of the 375 names, 105 end in
"Reservoir", 99 contain "Lake", and **173 say neither** (`Flaming Gorge`,
`Strawberry`, `Detroit`, `Ross`, `Jordanelle`). The name is not the type and
never was: `Lake Almanor` is an impounded reservoir, and Bear Lake is a
natural lake with regulated storage. Nothing in the payload today says which.

This matters beyond tidiness. A published percentage of capacity means a
different thing for a natural lake operated between an upper and a lower
limit than it does for a dam impoundment, and the seasonal comparison is read
differently too. **Publishing the type is a labelling change; changing any
figure because of the type would be a method change** and needs the
`science-method-change` skill, `METHOD_VERSION` and an ADR. The next agent
should keep those apart deliberately — this item is the first, not the second.

### One service answers both

The USGS National Hydrography Dataset is already a reviewed reference in this
project. `huc.py:45` names
`https://hydro.nationalmap.gov/arcgis/rest/services/NHDPlus_HR/MapServer/9`
(NHDWaterbody) as the layer the cross-border water-body reviews were done
against, and `CROSS_BORDER_WATERBODIES` already stores an
`nhd_permanent_id` for Bear Lake and Lake Mead. So there is an existing,
owner-operated, keyless precedent, and it carries both fields this work
needs on one record:

- `GNIS_Name` — the water body's own documented name, the answer to item 1.
- `FType` — `390` for LakePond and `436` for Reservoir, the answer to item 2.
- `Permanent_Identifier` — a stable key, so the review is reproducible without
  a runtime dependency, exactly as the two existing entries are.

Rule 1 of [`AUTHORITATIVE-SOURCE-INVENTORY.md`](AUTHORITATIVE-SOURCE-INVENTORY.md)
prefers the owner's own service, so **NHD is preferred over Esri's Living Atlas
water-body layers**, which are republications. Esri's copy is worth a look only
if NHD's coverage fails, and any such fallback needs its own inventory row.

**Not measured yet, and the first task of this item:** how many of the 375
published points resolve to exactly one NHD water body. Reservoirs are
published at a provider point, which may sit on a dam, a gauge, or an outlet
rather than inside the polygon. A resolution rate is the difference between
"normalize every name" and "normalize the twenty-eight that are wrong".

### What this breaks, and it is not a small thing

**`?reservoir=<name>` is a name-keyed link.** `findReservoir`
([selection.ts:72](../src/state/selection.ts:72)) resolves a station id
first, then the qualified label, then a bare name. Renaming a reservoir
therefore **breaks every saved link written against the old name** — and
those links exist: the retired-route translation in `public/retired-route.js`
produces them, and the smoke suite follows one.

Three ways out, and the next agent has to choose one before renaming
anything:

1. **A committed former-name table** read by `findReservoir` as a fourth and
   last resolution step. Keeps every old link working, costs one small file
   and one branch, and makes the rename reversible.
2. **Publish the display name beside the roster name**, leaving the resolution
   key alone. Cheapest, and it leaves a name in the payload nobody wants to
   read, which is the item.
3. **Accept the breakage.** Not recommended: a link that resolves to nothing
   is silent, and ADR-066 chose station keying precisely so that a name could
   never quietly stand for the wrong water.

Option 1 is the recommendation. It is the same shape as the retired-route
translation this project already ships for URLs, applied to one more thing
that readers keep.

**Also touched:** `reservoirLabel` appends `, ST` to a shared name, and two
names are already shared (`Lost Creek` ×2, `Clear Lake` ×2). A normalization
pass that resolves two different water bodies to the same GNIS name would
create a third such pair — which is handled, but it must be checked rather
than assumed. And the CSV export and the copied-search-term path in
`overview-model.ts` both carry the visible name, so a rename shows up there.

---

## 3 and 4. The navigation is four flat lists and a dialog that never comes back

### What is on screen today

Two controls, built independently:

- **`createWhereControl`** ([where-control.ts](../src/ui/where-control.ts))
  builds up to four `calcite-select`s — state, region, subregion, drainage
  area — each narrowed by the ones above it. The narrowing is real and
  already correct: `resolveOpeningScope` does it coarsest-first. What it is
  not is *nested* — four sibling dropdowns in a row, with no visible
  statement that a subregion lives inside a region.
- **The Storage Charts filter bar** ([overview.ts:537](../src/overview.ts:537))
  builds its own State, Subregion, Drainage area and **County** selects. The
  county list is built once from the widest scope and **never narrowed by the
  state select** — the code says so: "The state list is built once from the
  widest scope, like the county list."

The measurement that makes item 3 worth doing:

| | |
|---|---:|
| counties in the county select | **157** |
| states they span | 11 |
| counties holding exactly one reservoir | 73 |
| reservoirs with no county | 0 |

**A 157-row flat dropdown is the whole complaint.** California alone
contributes 49 rows, Utah 24, Idaho and Oregon 18 each. Choosing California
should leave 49 choices, not 157 — and today it leaves 157, because the county
list is built once from the widest scope and nothing narrows it, while the
subregion list beside it *is* narrowed by the state on every update. The
narrowing machinery is already there; county was simply left out of it. The
labels already carry the state
(`Summit County, CO`) precisely because the flat list holds two Summit
Counties; nesting removes the need for that suffix at the same time.

Note what the county axis is and is not.
[ADR-058](decisions/ADR-058-assign-the-county-from-the-water-not-the-dam.md)
made county a **search and filter** axis and
[`OPEN-BACKLOG-SCOPING.md`](OPEN-BACKLOG-SCOPING.md) explicitly dropped the
aggregation framing after measuring it. Nesting county under state is a
navigation change and does not reopen that decision. **Do not add a county
grouping to the charts on the back of this item.**

### The chooser closes and never reopens

`createOpeningSplash` ([opening-splash.ts](../src/ui/opening-splash.ts)) asks
two questions — which place, and which of storage / snow / drought — and it
asks them **once**. It writes
`utah-reservoir-dashboard-splash-dismissed` to `localStorage` on any choice,
and `shouldAskWhere` returns false forever after. There is no control anywhere
that reopens it. A reader who picks Utah on their first visit and later wants
the Upper Colorado region has to know that the four selects in the panel do
the same job, or clear their site data.

That is item 4, and it is genuinely small: the dialog is already built, already
returns an object with `open()`, already traps focus and closes on Escape, and
is already tested. What is missing is an entry point.

### The recommendation for both

Treat these as one change to one control, because a submenu that nests
region → subregion → basin and a submenu that nests state → county are the
same widget twice, and because the reopened chooser should show the *nested*
list rather than a second, differently-shaped one.

**Constraints the next agent inherits, none of them negotiable:**

- **No `@arcgis/core/widgets/*`** (`.claude/rules/frontend.md`). Whatever the
  nesting is built from, it is Calcite or native.
- **The splash is a native `<dialog>` on purpose.** Its own header records
  that Calcite's switch was refused by axe-core at all three widths. A
  submenu component has to clear the same gate — `npm run verify:browser`
  runs axe-core at three widths and is the only thing that can see it.
- **[ADR-071](decisions/ADR-071-one-drainage-area-control-to-a-page.md): one
  drainage-area control to a page.** The storage and snow pages already own a
  drainage-area picker, which is why `WhereControlOptions.finest` exists. A
  nested menu must not become a second control offering a different list.
- **[ADR-064](decisions/ADR-064-offer-two-levels-and-let-the-reader-choose.md)
  and the level control.** "Area size" (`createLevelControl`) chooses how
  finely the ground is divided and is a *different question* from which area
  is chosen. Nesting drainage areas under their level is the item; merging the
  level control into the nest is not, and would take a decision of its own.
- **A shared link is never interrupted.** `shouldAskWhere` refuses to open
  over any query string at all, and the reasoning in its comment is that a
  list of place parameters would rot. A reopen control is a reader asking,
  which is a different path — but it must not weaken that rule for the
  automatic case.
- **Visible text is Simplified Technical English** (ADR-006), `aria-label`s
  included.

**Not measured yet, and the first task of this item:** whether a nested menu
fits at 360 pixels. The splash's own header records that sixteen choices at
that width was already the argument for tabs, and that tabs were refused
because they hide half the answers. A three-deep submenu at 360 pixels may
land in the same trap from the other side, and the answer decides whether the
nesting is a menu, an indented list, or a drill-down that replaces its own
contents.

---

## 5. The six states that were surveyed once and never settled

### Where the roster stands today

375 published reservoirs, by state and by provider:

| State | Reservoirs | Providers |
|---|---:|---|
| California | 160 | CDEC 141, Reclamation 11, NRCS 8 |
| Utah | 58 | Reclamation 27, NRCS 31 |
| **Oregon** | **45** | NRCS 43, Reclamation 2 |
| Colorado | 40 | NRCS 27, Colorado DWR 10, Reclamation 3 |
| **Idaho** | **25** | NRCS 21, Reclamation 4 |
| **Washington** | **18** | NRCS 14, Reclamation 4 |
| Montana | 9 | NRCS 9 |
| **Wyoming** | **9** | NRCS 6, Reclamation 3 |
| **Nevada** | **6** | NRCS 5, Reclamation 1 |
| **Arizona** | **4** | NRCS 3, CDEC 1 |
| New Mexico | 1 | NRCS 1 |

**Utah's 58 all come from the two federal providers.** No Utah state agency
publishes reservoir storage this project has found, and the survey named none
to add — the same answer the conservancy-district search reached from another
direction in [`OPEN-BACKLOG-SCOPING.md`](OPEN-BACKLOG-SCOPING.md). Treat that
as settled rather than as a gap to re-search; the state to search again is
Nevada, whose own survey entry says it was not exhaustive.

The six states raised hold **107 reservoirs between them**, but 45 of those are
Oregon's. The other five — Idaho, Washington, Wyoming, Nevada and Arizona —
hold **62**, barely more than Utah's 58, and 61 of the 62 come from the same
two federal providers. Arizona at 4 and Nevada at 6 are the ones that look
wrong on a map: the lower Colorado's storage is the largest in the west and
almost none of it is published from those two states.

The 62nd is worth a sentence, because it is a finding rather than a number.
**Arizona's Lake Mohave is published by the California Data Exchange
Center** — a Colorado River reservoir on the Arizona–Nevada line, reaching the
roster through a California state agency. Whatever else the next pass finds,
it should expect coverage to follow river systems and district boundaries
rather than state lines, and should not assume a state's reservoirs come from
that state's publisher.

### What the survey already found, and what it left open

[`WESTERN-SOURCE-CANDIDATES.md`](WESTERN-SOURCE-CANDIDATES.md) is the
authority for this question and **should be extended rather than restated**.
Its findings for the six states, checked 2026-08-20:

| State | Finding | Left open |
|---|---|---|
| Arizona | Salt River Project publishes real storage for **six** reservoirs — two of them federally owned with no current data in RISE — as an HTML report only, **name-keyed**, so it fails ADR-066 before anything else is measured. ADWR is groundwater only. | Whether an SRP machine-readable form or a stable per-reservoir identifier exists that the survey did not find. It would more than double Arizona's four |
| Nevada | No reservoir-storage source found — and the survey says **"not exhaustively searched"** | The only state whose survey admits it is incomplete |
| Idaho | IDWR's own data-sources page points every reservoir row at USGS, USBR or USACE | Nothing state-side; the question moves to USGS and USACE |
| Oregon | OWRD is a stateful ASP.NET application with no queryable endpoint | Same |
| Washington | Ecology has no independent source; the Yakima system routes to Reclamation's older Hydromet, **not confirmed inside RISE** | Whether Yakima storage is reachable at all |
| Wyoming | WRDS is visualization-only, name-keyed, likely a mirror | Whether it holds anything USGS/USBR/NRCS does not |

So the state agencies are, with one exception, a closed question. **The open
question is federal, and the survey already named it:** USGS NWIS parameter
`00054` (reservoir storage) has confirmed coverage in nine states including
all six of these, needs no key today, and carries the most stable identifier
in this space — a USGS site number. The survey's verdict was "build for the 9
states with coverage". That has not been done, and it is the single highest-
value measurement left.

The second is **USACE CWMS**, which the survey confirmed live for the Missouri
and Sacramento districts but found **absent from the national API for the
Columbia Basin** — which is exactly Oregon, Washington and Idaho. That
absence is the one confirmed coverage gap the survey called worth closing.

### The next pass, in order

1. **Count first, build never.** Query USGS NWIS `00054` for active sites in
   AZ, NV, ID, OR, WA and WY, and report the count per state. If it is twenty
   sites the item is a provider; if it is two hundred it is a project. Nobody
   can size this item until that number exists.
2. **Deduplicate against the roster by dam identity**, per
   [ADR-069](decisions/ADR-069-deduplicate-reservoirs-by-dam-identity.md), not
   by name — the western pool already holds two Lost Creeks and two Clear
   Lakes. The count that matters is *new* reservoirs, not sites.
3. **Answer the capacity question before admitting anything.** The survey
   confirmed USGS publishes **no capacity**. Under
   [ADR-072](decisions/ADR-072-divide-by-a-figure-the-water-has-not-been-seen-above.md)
   every denominator would come from the dam inventory, which is fine — but it
   means each candidate needs a dam match, and that is the expensive step, not
   the fetch.
4. **Note the retirement.** The legacy NWIS service retires around 2027 and its
   successor rate-limits without a free key. ADR-004's working rule — a source
   that needs a credential for a read-only request is a conflict with an
   accepted decision, not a detail to work around — has to be settled *before*
   a provider is built on it, not after the retirement lands.
5. **Search Nevada properly, once.** It is the only state whose survey admits
   it was incomplete, and six reservoirs is a thin answer for a state holding
   part of Lake Mead.
6. **Record the result in `WESTERN-SOURCE-CANDIDATES.md`**, which owns this
   topic. A provider that clears all of the above is then an admission review
   under the `reservoir-source` skill, with its own `admitted_*.json` and its
   own findings for anything held back — the shape California and Colorado
   already have.

---

## The order, and why

1. **Item 4, the reopen control.** Smallest by a wide margin. The dialog
   exists, is tested, and is one entry point away from answering a real
   complaint. It is also independent of item 3, so it does not have to wait
   for the nesting question to be settled.
2. **Items 1 and 2, names and type, as one NHD pass.** One service answers
   both, and doing them separately means resolving 375 points twice. Start
   with the resolution-rate measurement; the former-name decision is the gate
   on everything after it.
3. **Item 3, the nested navigation.** Larger than item 4 and needs the
   360-pixel answer first. Worth doing after item 1, because a normalized name
   is what the nested lists would display, and reworking the menus twice is
   the avoidable cost here.

   **Delivered 2026-08-21, out of this order.** The cheap fix landed first as
   its own commit, as this document asked, and the nesting followed as indented
   option groups. It went before item 1 rather than after, so the names it
   displays are still the provider's -- which is the cost this ordering was
   trying to avoid, and it is now a reason to do items 1 and 2 sooner rather
   than a reason to redo item 3.
4. **Item 5, the six states.** Independent of all of the above and gated on
   one live count. It can be started in parallel by a different agent; it must
   not be started by *guessing* the count.

## Open questions this scoping did not answer

- **Does an NHD water body exist for every published point?** Not measured.
  The whole size of items 1 and 2 turns on it.
- **What is a "lake" for a reader?** NHD's `FType` is a hydrographic
  classification, not a plain-language one. Bear Lake is a natural lake with a
  regulated pool, and calling it either a lake or a reservoir tells only half
  its story. Whether the published word follows `FType` exactly, or whether a
  third state ("regulated lake") is needed, is a product decision that has not
  been taken.
- **Does the type change any published figure?** It must not, under this
  scoping. If a reviewer decides a natural lake's percentage should be
  computed against an operating range rather than a capacity, that is a
  separate method change with its own ADR — and it should be recorded as such
  the moment anyone proposes it.
- **Should the county axis join the where control, or stay on Storage Charts?**
  Today county exists only in the Storage Charts filter bar, while the where
  control is on three pages. Nesting county under state raises the question of
  which control gets it, and ADR-071's one-control rule is the precedent for
  answering it deliberately rather than by adding it everywhere.
- **How many reservoirs would a normalized name move in the search box?** The
  Storage Charts search matches name, drainage area and county at once. A
  reader searching "PG&E" today finds seven reservoirs; after normalization
  they find none, unless the operator becomes a searchable field. That may be
  an argument for publishing `operator` rather than only for deleting it from
  the name.
