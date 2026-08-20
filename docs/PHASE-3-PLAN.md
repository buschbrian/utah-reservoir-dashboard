# Phase 3 execution plan — symbology and map interactions

**Status:** complete on 2026-08-13. Later western-scope work expanded the
roster and geography without changing this interaction contract.

Phase 2 established the responsive shell, local data layers, anonymous basemap
fallback, and accessible reservoir list. Phase 3 improves how readers scan and
interact with those same 51 in-scope reservoirs. It does not change the
scientific scope or replace the production URLs.

## Recommendations

1. Land interaction behavior before replacing the symbol layer. Pointer
   events, selection, reduced motion, and browser gates can be proven against
   today's graphics without coupling every risk to CIM rendering.
2. Convert the reservoir graphics to one client-side `FeatureLayer` before
   adding `featureEffect` or SDK highlights. Both capabilities operate most
   cleanly on a layer view; implementing them against temporary parallel
   layers would create work we immediately remove.
3. Treat bloom and shadows as measured enhancements. Keep the current clear
   ring/fill encoding as the baseline, test an integrated-GPU profile, and
   retain the baseline when reduced motion or rendering cost calls for it.
4. Keep the focusable reservoir list as the keyboard interface. Canvas hit
   testing is a pointer enhancement, not a substitute for semantic controls.
5. Add one readiness fact and one browser assertion with each slice. A map can
   look plausible while an interaction path or whole operational layer is
   missing.

## Ordered implementation

### 3.1 Pointer interaction — complete

- Throttle `arcgisViewPointerMove` hit testing to one request per animation
  frame and ignore late responses.
- Show a lightweight card with reservoir name, percent full, and reading date.
- Hide it on pointer leave or selection and do not expose it as a noisy live
  region.
- Use the map component's documented `event.detail.x/y` contract for both
  hover and click selection.
- Browser-test hover and map click with deterministic hit-test results.

### 3.2 One reservoir feature layer and CIM symbols — complete

- Replace the two graphics per reservoir with one client-side `FeatureLayer`
  feature carrying stable object ID, name, size basis, fill percentage, and
  late-data state.
- Compose capacity ring, proportional storage fill, stale accent, and a light
  shadow in one CIM symbol while preserving the tested square-root size domain
  and class colors.
- Prove pointer selection, list selection, boundary independence, and the
  no-basemap fallback before removing the graphics implementation.
- Record bundle and frame-time measurements; do not enable a heavier effect
  solely because the SDK supports it.

The renderer is keyed on the object ID, one composed symbol per feature: every
reservoir's ring is a different width, so there are as many symbols as features
by construction, and a `UniqueValueRenderer` is the one renderer with no stop
limit. `src/viz/cim.ts` builds the symbol as a plain property object with no
SDK import, so its arrangement is asserted in the same node environment that
already holds the radii against `shared/reservoir-viz.js`.

Two new assertions, because a feature layer can fail at either end. The page
publishes `symbols`, the count the renderer holds, which catches a renderer
that quietly kept fewer than it was given. The browser gate queries the layer
itself, which catches a layer that accepted the renderer and rejected the
source.

### 3.3 Layer-view hover and filter effects — complete

- Move the visual hover emphasis to the layer view's named `temporary`
  highlight after 3.2 supplies a feature layer.
- Replace the disabled analysis placeholder with percent-full and late-data
  controls.
- Apply `featureEffect` so excluded reservoirs remain visible in grayscale at
  reduced opacity; the list and summary must report the same filter state.
- Disable bloom under reduced motion and when the performance measurement does
  not support it.

The storage control's choices are the storage classes, read from the class
table rather than written down again (ADR-008): the class a reservoir is
filtered into is the class it is coloured by, or the legend describes a
different map than the one on screen.

One filter, expressed twice, because the map filters on the layer's fields
and the list filters on reservoirs in memory. `src/state/filters.ts` derives
both from one set of bounds and `filters.test.ts` holds them against each
other over every state the two controls can reach — an agreement test, not an
assertion about today's numbers.

`featureEffect` is set on the layer rather than on the layer view. The layer
view inherits it, and the layer exists before the view that draws it does, so
a filter chosen while the map is still starting is applied rather than
dropped. It is also the form a headless browser can read back.

Excluded reservoirs stay on the map in grey, so the list dims the same rows
rather than removing them, and leaves them operable: the reservoir is still
visible and still worth reaching from the keyboard.

**Bloom is not enabled, and this is the measured decision, not an omission.**
The baseline ring/fill encoding already carries the data, the composed CIM
symbol added a shadow for separation in 3.2, and nothing has been measured on
integrated graphics yet. Recommendation 3 says to keep the baseline until a
measurement says otherwise, so there is no bloom to disable under reduced
motion. 3.5 profiles the symbol and filter path; if that measurement supports
an emphasis effect, it arrives with the reduced-motion gate attached.

### 3.4 Selection motion and shareable state — complete

- Ease `goTo` toward a selected reservoir without exceeding the constrained
  regional extent; skip animation under reduced motion.
- Keep list and map selection synchronized and update `?reservoir=` without a
  reload.
- Restore selection from the URL and preserve focus when mobile sheets open or
  close.

The constrained regional extent did not exist on this shell. Both production
maps have refused to leave the region since the navigation fix, and the modern
map had no constraints at all, so a reader could pan a Utah dashboard into open
ocean and find an empty basemap with no way back except reloading. The bounds
and minimum zoom are now ported into `src/viz/extent.ts` and asserted against
`shared/reservoir-viz.js`, and the readiness signal reports both — the same two
facts the legacy page already publishes.

Selecting never zooms out and never leaves the region. A reader who has zoomed
into a valley and then picks a reservoir from the list wants to see that
reservoir, not to lose the detail they navigated to, so the target zoom is the
closer of the current zoom and `SELECTION_ZOOM`. The centre is clamped rather
than trusted: the SDK's constraint would drag the view back afterwards, and an
eased animation that flies out of bounds and is yanked back reads as a bug even
though it ends up correct.

`goTo` is held until the view is ready. It rejects outright on a view that is
not, and a selection restored from a link routinely lands before that — which
is a link that silently opens the details panel and leaves the map where it
started. That is what the browser gate checks: not that the panel filled in,
but that the map moved.

The URL half is a port of `selectionFromSearch` / `searchWithSelection` from
the shared module, held against it character for character, including the
`%20`-not-`+` spelling that keeps a link interchangeable with the ones
`explore.html` produces. `replaceState`, never `pushState`: comparing five
reservoirs means five clicks, and the address bar describes the current view
rather than logging how the reader reached it.

### Still to decide, before the phases that need it — both decided 2026-08-13

**Answered, after the fact for the first one.** The out-of-scope reservoirs are
reached through the two controls that already exist, and no third dimension is
added (ADR-020) -- the question was written on the morning of 2026-08-11 and
the code answered it that afternoon, when both scope dimensions became the
reader's; a test now holds the property. Snow telemetry gets a view of its own
rather than a layer on this map (ADR-021), which is what let Phase 3 close
without a second quantity arriving to reopen the symbology.

The questions as they stood:

Two questions are open and are not 3.5's to answer. They change what the map
is *of*, so they want deciding before more UI is built on top of the current
answer:

- **The reservoirs outside the current scope.** The payload publishes more
  than the map draws. What the out-of-scope records are for -- context,
  comparison, or nothing -- decides whether they need a scope control of
  their own beside Lake Powell's, or simply stay out.
- **The snow telemetry sites.** They are a different kind of thing from a
  reservoir: a point measurement of what is going to arrive rather than a
  volume that is already there. Whether they belong on this map at all, on
  a layer of their own, or on a separate view, is a question about the
  dashboard's subject rather than about symbology.

Whatever is decided, the answer has to reach all three engines and both
surfaces at once. The scope control, the storage classes, the opening extent
and the analysis controls each took a pass to bring back into line after one
engine moved first.

### 3.5 Loading and release gates — complete

- Replace remaining loading copy with Calcite loader/skeleton states without
  hiding error explanations.
- Run unit/type/build, all three modern viewports, first-basemap refusal, and
  all-basemap refusal.
- Profile the final symbol and filter path on integrated graphics, then record
  the measured decision in the modernization plan.

**The first bullet turned out to be mostly about the second half of its own
sentence.** There were four paths where a loading state could never resolve,
and a spinner that cannot resolve is not a loading state -- it is an error the
reader is not being told about:

- No deadline on any data fetch. A request that hangs never rejects, so
  `setDataState` was never reached and the panel sat on "Loading reservoir
  data" indefinitely. The basemap chain has had a deadline since the fallback
  work; the data path had none. `src/data/fetch.ts` now gives every runtime
  load one, and cancels the request rather than abandoning it.
- The loading copy was hard-coded in the template *and* in
  `describeDataState`, which left the state machine's own `loading` branch
  unreachable and free to drift. The template no longer carries the words.
- `#map-host` keeps `aria-busy="true"` if the view neither becomes ready nor
  errors, after its visible loader has already been replaced by the map
  element -- a screen reader told "busy" forever with nothing to read.
- The overview clears chart `aria-busy` only on the winning revision, so a
  superseded update leaves both hosts busy.

All four are done and gated, and a fifth turned up while verifying them: the
overview awaited the SDK's `arcgisRenderingComplete` with no deadline, and the
charts have been observed fully drawn -- bars measurable in the shadow root --
with the event never arriving. The page then awaited it forever, both chart
hosts announcing `aria-busy`, and the readiness signal was never published.
The wait now races a timer, because the chart being on screen is the fact that
matters and the event is only how we hoped to learn it.

The browser gate covers the data state (a payload that answers 503 and one
that never answers) and asserts that neither the map host nor either chart
host is left claiming to be busy.

#### Pre-registered decision rule for the profiling — written before any number

Recorded here first so the result cannot be re-narrated afterwards.

**Bloom is rejected on encoding grounds, not on cost.** Its only candidate job
on this map is emphasising the hovered or selected reservoir, and 3.3 already
gave that job to the layer view's named `temporary` highlight. An effect that
is free but redundant still loses; recommendation 3 says "measured
*enhancement*", not "enhancement if affordable". This is decidable now and does
not need a measurement.

**So the measurement's job is to confirm the baseline is affordable on
integrated graphics, not to shop for an effect.** It passes when, on one
machine in one session:

- the 95th-percentile frame interval during a scripted pan stays within twice
  the median idle frame interval measured on that same machine -- at most one
  dropped frame at the tail;
- the median frame interval with the reservoir layer present differs from the
  same script with the layer removed by no more than a quarter of one frame;
- no task over 50ms is attributable to applying `featureEffect`. 50ms is the
  browser's own `longtask` threshold, borrowed rather than invented.

Any difference smaller than the run-to-run spread of three repeated baseline
runs is "no measurable difference", not a result.

If the baseline fails, the response is to reduce cost -- drop the shadow layer,
or halve `CIRCLE_POINTS` from 64, where `src/viz/cim.ts` records the polygon
error as under a tenth of a pixel -- not to relax the threshold.

#### The measurement, read against that rule — 2026-08-13

All three thresholds pass, and by margins that are not close. Drawing all 51
reservoirs and drawing none of them produce the same median frame interval on
an Apple M4, which is to say the composed symbol costs less than the display
can resolve. Nothing is reduced: the shadow layer stays and `CIRCLE_POINTS`
stays at 64. Bloom stays rejected on the encoding grounds recorded above,
which no number was ever going to change. The table, the machine, the browser
version and the limits of the result are in the modernization plan under
"Symbol and filter cost measured".

## Phase acceptance

Phase 3 is complete when one reservoir feature layer drives symbology,
pointer feedback, selection, and filters; keyboard users retain an equivalent
list path; reduced motion removes nonessential animation; and the production
browser gates pass with and without a basemap.

**Met on 2026-08-13.** Increments 3.1 through 3.5 are complete, and the gates
pass: `npm run build`, 99 Python tests, `tests/smoke.mjs` over the three
comparison views at all three widths, and `tests/smoke-modern.mjs` over the
primary application at all three widths, with the first basemap refused, with
every basemap refused, with the payload refused, and with the payload never
answering.

The two questions under "Still to decide" are deliberately still open. They
are about what the map is *of* rather than how it draws, they were never
3.5's to answer, and they now sit in the modernization plan's open decisions
where the phases that depend on them will meet them.
