# Scoping the three open backlog items

Scoped 2026-08-18, against the list in `MODERNIZATION_PLAN.md` (item 7 of the
interface-polish slice): the **county and conservancy district aggregation
axes**, **per-reservoir permanent pages**, and the **dam inventory
migration**. Every figure below came from a live query or a real run on this
machine.

Three items went in. One is nearly free, one is half-blocked on a source that
does not exist, and one needs a decision about what "permanent" means before
any of it is worth building. The order they should be worked in is not the
order they were written in.

## 1. The dam inventory migration is a metadata correction, not a review

The source inventory scopes this as a five-step parity exercise: query both
services, normalize field names from both schemas, compare every identifier,
require zero unexplained losses, then switch. Two of those five steps turn
out not to exist.

**The schemas are identical.** Both the retired hosted layer
(`services2.arcgis.com/.../NID_v1/FeatureServer/0`, service name "Dams") and
the owner-operated U.S. Army Corps layer
(`geospatial.sec.usace.army.mil/.../National_Inventory_of_Dams_Public_Service/FeatureServer/0`,
service name "National Inventory of Dams") publish **81 fields with the same
names** -- `NIDID`, `NAME`, `NID_STORAGE`, `MAX_STORAGE`, `NORMAL_STORAGE`,
`LATITUDE`, `LONGITUDE`. There is nothing to normalize. Step 2 is retired by
measurement.

**The parity report passes.** All **29** dam identifiers committed in
`capacities.json` are present in both services. Comparing name, the three
storage fields, and both coordinates:

| | |
|---|---:|
| identifiers committed | 29 |
| returned by the owner service | 29 |
| returned by the retired layer | 29 |
| unexplained losses | **0** |
| records differing in any compared field | **1** |

The one difference is **UT10156, Stateline**:

| field | owner service | retired layer | committed |
|---|---|---|---|
| `NAME` | `Stateline Dam` | `Stateline Dike A` | `Stateline Dam` |
| `LATITUDE` | 40.9885 | 40.9876 | 40.98851 |
| `LONGITUDE` | -110.3857 | -110.3924 | -110.38571 |

**The committed record already matches the owner service on all three.** It
was rebuilt from the new layer at some point and the file's `source_layer`
metadata was never moved with it. So this is not a migration that risks
changing a published assignment -- it is a correction of an attribution that
is already wrong. Nothing in `reservoirs.json` moves. The `Dike A` name in
the retired layer is the more interesting fact: it identifies a different
structure of the same project, which is exactly the kind of drift rule 6 of
the inventory exists to catch.

The 15 reservoirs in `connected_reservoirs.json` are already attributed to
the owner service and need no work.

**What the work actually is.** Four files still name the retired layer:
`tools/add_dam_points.py`, `tools/probe_huc_points.py`,
`tools/audit_connected_reservoirs.py`, and `capacities.json` (twice: the
top-level `source_layer` and the `dam_points.source` that `reference.json`
republishes). `tools/audit_candidate_capacity.py` already moved. Then flip
`src/source-inventory.test.ts`, which today asserts the *opposite* -- that
`add_dam_points.py` still contains the old URL, so the migration stays
visible -- to assert no active tool contains it, which is what the inventory's
step 5 asks for. Update the inventory row from "Migration candidate" to
"Adopted", and record the parity numbers above.

**This should go first.** It is the smallest item, it closes a documented
open source question, and it is the only one of the three that is finished
when it is done rather than opening a design conversation.

## 2. The county axis works. The conservancy district axis has no source.

These were written as one item and are two, with very different answers.

### There is no authoritative statewide conservancy district boundary

Searched the Utah Geospatial Resource Center's **891 published services** and
the public ArcGIS Online catalogue. Nothing owner-operated publishes Utah
water conservancy district boundaries statewide. The near misses are near
misses:

- **`UtahConservationDistricts`** -- soil conservation districts (`DistName`,
  `DistNo`, `ZoneNo`). An agricultural programme boundary, not a water
  wholesaler.
- **`UtahWaterServiceAreas`** -- retail drinking-water service territories
  (`DWSYSNUM`, `SYSTEMTYPE`, `WHOLESALER`). Closer to the subject and still
  not it, and its own description is copied from a telephone-provider dataset
  and dated 2005, which is its own reason not to compute anything from it.
- The only conservancy-district geometry in the public catalogue is
  consultant project work for individual districts -- watershed plan
  components for one district, a metering survey for another. Not a
  statewide layer, and not owner-operated.

Rule 1 of the source inventory is "use a public service operated or named by
the data owner". **No such service exists for this axis**, so the item cannot
be built as specified. It needs a decision rather than an implementation:
either drop it, or accept a hand-assembled reviewed boundary set with its
own ADR saying where each district's outline came from -- which is a real
piece of work and should not hide inside an aggregation feature.

### Counties assign cleanly, and are a worse grouping than they look

The source exists and is owner-operated: the **U.S. Census Bureau TIGERweb**
`State_County` service, layer 1. National, so it covers all seven states the
current roster reaches, and all eleven the western expansion would.

Assigning every published reservoir against it:

| | |
|---|---:|
| reservoirs | 68 |
| assigned a county | **68** |
| distinct counties | **34** |

**The ratio is the finding.** The drainage axis groups 68 reservoirs into 14
areas, about 5 per group. Counties group the same 68 into 34, about 2 per
group -- and **19 of the 34 counties hold exactly one reservoir**. A bar
chart of county storage is mostly a bar chart of individual reservoirs with
the county's name on it, and a box plot of within-group spread has nothing to
show for more than half its groups.

That is worth stating plainly because the western expansion scoping called
the county and district axes "the strongest argument" for keeping a ~193-row
reservoir list browsable. **The measurement points the other way.** County
count grows with roster size roughly as fast as reservoir count does, so at
193 reservoirs across eleven states the axis gets *thinner*, not richer. The
argument for counties is not aggregation. It is **search and filter** -- "how
is Washington County doing" is how people ask, which is the reason the snow
view already searches by county name. That is a smaller, better-aimed
feature than an aggregation axis, and it is what should be built.

### Two traps, both measured

**Generalized geometry is not good enough to assign points with.** Fetched at
`0.001` degrees -- the project's 100-metre default, rule 5 -- the county
polygons misplace **Lost Lake**, which falls just outside Wasatch County's
generalized outline in the Uintas. The same point queried against the
service's full-resolution geometry returns Wasatch County without ambiguity.
This is ADR-037's lesson arriving again from a different direction, and it
matches what `snow_sites.json` already does: the inventory records that
station assignment uses "full-resolution drainage-area geometry". A county
assignment has to do the same. Assign server-side at full resolution, commit
the answer, and let the drawn outlines stay the generalized runtime layer
already adopted.

**The county name is not a key.** The current roster alone contains two
Summit Counties (UT and CO), two Carbon Counties (UT and WY), and two
Garfield Counties (UT and CO). The axis key must be the five-digit `GEOID`
and the reader-facing label must carry the state, or six reservoirs merge
into three groups that do not exist.

**One more thing this changes.** The county boundaries already on the drought
map are Esri Demographics generalizations, adopted as optional runtime
context, and the inventory says of them: "if either is ever used for an
analytical result, it stops being optional context and has to be re-sourced
from the owner at a stated tolerance." Computing a county assignment is that
trigger. The assignment source becomes Census TIGERweb, committed; whether
the *drawn* outlines also move is a separate and much smaller question.

## 3. Per-reservoir pages: decide what "permanent" means first

`?reservoir=<name>` on the storage map is already a permanent, shareable,
translated-from-retired-routes URL for one reservoir. So this item is not
about linkability. It is about a page that is *about* one reservoir -- its
own history, its record extremes, its sources, its comparison periods --
rather than a details panel beside a map.

Two shapes, and they differ in one thing that matters:

**One entry, `reservoir.html?name=...`.** Consistent with every other surface
here and with ADR-002: the shell is static, the payload is fetched at
runtime, nothing is generated. One indexable URL for all 68 reservoirs.

**Sixty-eight generated shells.** A build-time generator reads the roster and
writes one HTML file per reservoir with its own `<title>` and description.
This does not violate ADR-002 -- writing shells is not importing the payload
into `dist/assets` -- and it is the only version that gives search engines,
link previews and a sitemap something per reservoir. If the point of the item
is *permanent pages*, this is the point.

**The trap is ADR-056.** The deploy is the morning's data commit, and the
build runs on it, so a generated page set is rebuilt every morning from that
morning's roster. A reservoir withdrawn for going quiet past
`WITHDRAW_AFTER_DAYS` **loses its page**, and a permanent URL that 404s
because a gauge stopped reporting for sixty days is worse than no permanent
URL. If the generated shells are chosen, the generator must read the
**committed roster** -- `connected_reservoirs.json` and `capacities.json`,
which are reviewed and do not move when a feed goes quiet -- and never
`reservoirs.json`. That is the same rule `CLAUDE.md` already states for tests
about where a reservoir is, arriving in a new place.

This is the largest of the three and the only one that needs a product
decision before an estimate is meaningful.

## The order, and what was decided

Decided 2026-08-18, from the measurements above.

1. **The dam inventory migration.** Measured above and ready. Small, closes a
   documented open question, no design conversation attached.
2. **County as a search and filter axis**, assigned server-side at full
   resolution, keyed on `GEOID`, labelled with the state. **The aggregation
   framing is dropped** -- 19 of 34 groups hold one reservoir, so a county
   bar chart is a reservoir bar chart wearing a county's name. No county
   grouping is added to the charts.
3. **The conservancy district axis: not built.** There is no owner-operated
   statewide boundary, and rule 1 of the source inventory does not bend for a
   consultant's project layer. Reopen only with an ADR that says where each
   district's outline came from.
4. **Per-reservoir pages: one entry, `reservoir.html?name=...`.** The static
   shell fetches at runtime like every other surface, so nothing is generated
   and nothing has to be kept in sync with a roster that changes every
   morning. This is the shape ADR-002 already implies, and it is the one that
   cannot be broken by an ADR-056 withdrawal: a page for a withdrawn
   reservoir still loads and can say the reading was withdrawn, where a
   generated shell would simply stop existing.

   The cost accepted with it: one indexable URL rather than 68, so search
   engines and link previews see the page and not each reservoir. That is a
   discoverability trade, not a correctness one, and it can be revisited
   without moving the URL contract.

## Open questions this did not answer

- **Does the drawn county layer move too?** Making counties analytical
  re-sources the assignment from the Census. Whether the drought map's
  outlines should also come from TIGERweb rather than Esri Demographics is a
  separate call, and the answer may reasonably be no -- the drawn layer is
  quantized to the view and the analytical one is not published at all.
- **What does a county filter do with a reservoir whose dam and waterbody sit
  in different counties?** The drainage assignment already faced this and
  answered it: assign at the dam point, because that is where the stored
  water leaves. Counties should almost certainly follow the same rule, but it
  has not been measured how many of the 68 would move if they did.
- **Does the western expansion change the county answer?** The ratio argument
  says no. It has not been measured against the ~193-reservoir projection.
