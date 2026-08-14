# Changelog

Notable changes to the dashboard. The data itself is refreshed every morning
and is not listed here.

## [Unreleased]

### Fixed

- **The weekly storage comparison now states its basis.** Reservoir details say how many
  earlier years support the value. The methods page explains that the comparison uses
  readings from 2015 through the preceding year within a seven-day window, and warns that
  this predominantly dry record is not a long-term climate average.

- **Reservoir symbols now separate when the map zooms in.** The ArcGIS 5.1
  map no longer enlarges circles with every zoom step, and its largest ring
  is narrower at the opening view. The initial regional extent now accounts
  for the storage panel before the view resolves. Each six-digit drainage
  area also has one name label source, including areas made from more than
  one polygon.

- **Browsers without WebGL 2 no longer get stuck on a loading map.** ArcGIS
  Maps SDK 5.1 requires WebGL 2, but the shell previously accepted a WebGL 1
  context and started a renderer that could never succeed. The capability
  check now requires WebGL 2 and directs unsupported Safari configurations to
  the accessible reservoir overview instead.
- **Four loading states could never end.** No data fetch had a deadline, so a
  request that hung left the storage summary on "Loading reservoir data"
  indefinitely and the overview holding a bare spinner with no error path ever
  reached. The map kept announcing itself as loading if its view neither
  started nor failed. The overview left both chart hosts announcing the same
  after a chart threw, and awaited a rendering event from the charts SDK that
  has been observed never to arrive even with the bars fully drawn. Every one
  of these now has a deadline and a terminal state — a spinner that cannot
  resolve is not a loading state, it is an error nobody is being told about.
- **The MapLibre title card covered its own zoom control on a phone.** The
  card ran the full width and pushed the control down by an offset measured
  after the reservoir data arrived, so until then — and whenever the data
  never arrived — the control sat underneath it. The card now keeps a right
  gutter below 640px, the same solution the ArcGIS page has used since the
  overlap was first found there, and the control stays in its corner. The
  browser test measured this on the ArcGIS page only, which is why it went
  unnoticed; it now checks both engines.
- **All three maps opened on a hand-drawn box.** The map's geography now
  comes from the drainage-area polygons it draws (ADR-017): every map opens
  one zoom level out from them, which is also the furthest out any of them
  goes, so the watersheds get the middle of the canvas instead of a third of
  it. Nothing caps the way in any more — the maps zoom to level 23, deep
  enough to read an individual dam.
- **The modern map could be panned out of the region entirely.** Both
  production maps have constrained navigation to the drainage areas around
  Utah since that fix landed; the modern shell had no constraints at all, so
  a reader could pan a Utah dashboard into open ocean and find an empty
  background with no way back except reloading.
- **The modern map's header cut off two controls on a phone.** At 375px the
  title, its second line and the "Table and charts" label came to 446px of
  content in a 375px bar. The header lays out in one row and clips what does
  not fit, so the page never scrolled sideways and the existing width test saw
  nothing wrong — while the reservoir details and theme controls sat entirely
  off screen with nothing to reveal them. The controls are now measured
  against the viewport by the browser test.
- **The analysis controls sat behind a nested scroller.** They followed the
  reservoir list, which scrolls inside its own box, leaving them 238px below
  the fold in the desktop panel and 815px down the phone sheet. Controls now
  come before the list they control, and the phone sheet is sized by
  `--calcite-sheet-height` — the property that sets the height, where the
  previous `--calcite-sheet-max-height` only capped it and left the sheet at
  365px of an 812px phone.
- The modern map keeps locally committed reservoirs and drainage areas visible
  when every anonymous ArcGIS basemap candidate is unavailable, with a clear
  degraded-background notice instead of an empty map.
- Both legacy map engines now enforce a Utah-region pan extent and minimum
  zoom, preventing accidental navigation to a world view.
- All map masks and `in_utah` classification now use the committed,
  authoritative UGRC Utah State Boundary instead of a six-corner approximation.

### Added

- **The primary map and data workspace can export CSV files.** The workspace export follows
  the current filters and table order. Reservoir details export the current record and its
  12-month history. Both exports keep raw numbers and include provider, identifier,
  observation date, full-level source and drainage area.

- **The dashboard data now has a documented public API.** Stable `/api/` paths publish
  reservoir, snow and reference JSON from the same files the site uses. A new documentation
  page lists every field, refresh and failure behavior, browser access, code examples and
  plain terms of use.

- **All 217 snow monitoring sites in the published drainage areas are now
  verified and refreshed independently.** The inventory uses full-resolution
  federal watershed geometry for sites near a divide, records the official
  1991–2020 comparison period, and refuses to replace the last complete file
  when even one listed station is missing. Seasonal drainage-area values
  average station percentages and state how many sites reported; late readings
  stay present and are marked as late data. The snow interface remains a
  separate view under ADR-021.

- **Every published drainage area now has tracked reservoir storage.** The
  connected view adds 15 reviewed Colorado and Wyoming sites: ten in Colorado
  Headwaters, four in White-Yampa, and one in Lower San Juan. Each capacity is
  tied to a position-confirmed dam in the National Inventory of Dams. Nine
  sites update daily and six update monthly; old readings continue to be
  marked as late data.
- **Current U.S. Drought Monitor polygons are now available as GeoJSON.** A
  checked downloader retrieves every national D0-D4 feature from the official
  service, verifies that all features describe the same week, and keeps the
  last good file if that independent service is unavailable during a daily
  reservoir update.

- **The primary application filters by drainage area.** The overview has had
  this control since it gained drainage areas; the map did not, so a reader who
  wanted one basin had to read fifty-one circles for it. It is a filter and not
  a scope: the reservoirs outside the chosen area stay on the map in grey and
  stay in every total, so an area is read *against* the state rather than
  instead of it. The choices come from the reservoirs the map currently holds,
  so they follow the Utah and connected scopes, and a choice that leaves the
  scope falls back to all areas rather than dimming everything. It joins the
  address bar as `?area=…` with the rest of the view.
- **A shared link now carries the whole view.** The analysis controls join the
  address bar beside the selection: `?reservoir=…&storage=…&reporting=…&powell=…`
  restores the filters and the Lake Powell scope as well as the reservoir, so a
  filtered view can be handed to somebody else and arrive as what the sender was
  looking at. Anything left at its default is written as absence, so an
  untouched dashboard still has a clean URL, and a parameter belonging to
  another page is preserved rather than dropped.

- **Shareable links on the modern map.** Selecting a reservoir now writes
  `?reservoir=` into the address bar without a reload, and opening such a link
  restores the selection and eases the map to it. The parameter name and its
  encoding are the ones the statewide overview has always produced, so a link
  opens the same reservoir on all four pages. History is replaced rather than
  pushed: the address bar describes the view, it does not log how the reader
  reached it.

- **Analysis controls on the modern map.** The storage summary's placeholder
  is now two working filters: storage level, whose choices are the storage
  classes themselves, and reporting state. Reservoirs the filter excludes stay
  on the map in grey and stay in the list, dimmed and still selectable — the
  panel reports how many of how many are shown. Moving the pointer over a
  reservoir now uses the SDK's own emphasis on the layer view instead of a
  drawn ring.

- **One reservoir feature layer, one composed symbol.** The modern map draws
  each reservoir as a single feature of a client-side `FeatureLayer` rather
  than as a pair of stacked markers. Capacity ring, proportional storage fill,
  the dashed late-reading accent and a soft shadow are now one CIM symbol
  built from the same tested radii and class colours as before. The layer
  carries the object ID, name, size basis, fill percentage and late-reading
  state that the upcoming map filters need, and the readiness signal reports
  how many symbols the renderer actually holds.

- **ArcGIS Charts data workspace.** The primary overview now cross-filters its
  KPI strip, largest-reservoir chart, drainage-area chart, and semantic table
  by reservoir, drainage area, and reporting status. Esri chart action bars
  provide interactive inspection and export, and a muted Southwest theme keeps
  the analytical layout usable from desktop to phone widths.

- **ArcGIS is the primary application.** `modern.html` now carries the official
  ArcGIS Maps SDK for JavaScript name; MapLibre and the original chart/table
  page remain clearly labeled legacy comparisons.

- **Phase 3 pointer interaction.** The modern map now throttles hover hit tests,
  shows reservoir name, percent full, and reading date in a lightweight card,
  and supports pointer selection through the map component's documented event
  coordinates.
- **A browser smoke test for the Phase 2 shell**, at 1280, 390 and 360 pixels,
  asserting every reservoir drew, the details a selection produces, no
  sideways scroll, and no retired vocabulary anywhere a reader can see it —
  open shadow roots included.
- **Reservoirs on the Phase 2 shell.** `modern.html` now draws every reservoir
  in the selected Utah waterbody scope, excluding Lake Powell, from the
  committed data, over the Utah mask and the
  drainage-area outlines, with the same class colours and the same size basis
  the production maps use. Selecting one — by pointer on the map, or from a
  focusable list of every reservoir in the storage summary — gives its name,
  percent full, what that percentage is measured against, stored volume,
  reading date, measuring agency and drainage area, and says so when the
  reading is late. Boundaries load on their own path: a missing or malformed
  boundary file costs the reader context and leaves every reservoir drawn.
- **The Phase 2 application shell.** `modern.html` now uses the ArcGIS 5.1 and
  Calcite 5 components with responsive summary and detail surfaces, persisted
  system/light/dark themes, anonymous-only map authentication, and visible
  loading, empty, data-error, map-error, and unsupported-browser states.
- **Hover reading on both maps.** Pointing at a reservoir shows its name,
  percent full and reading date without a click.
- **Filter dimming.** A percent-full class filter and a "show only late data"
  switch keep matching reservoirs bright and let the rest recede, rather than
  removing them — the empty reservoirs being the southern half of the state is
  the answer, and deleting the others deletes it.
- **A twelve-month time slider** on both maps, with play, pause and a return to
  today. The data already held twelve months per reservoir and the maps only
  ever drew today. A month a reservoir never reported draws as a small grey
  circle, not as an empty one.
- **Deep links on both maps.** `?reservoir=Deer+Creek` opens that reservoir,
  selecting one updates the address bar, and the back and forward buttons work.
  The parameter matches the overview's, so links are interchangeable across all
  three pages.
- **A keyboard path to every reservoir.** Both maps now carry a focusable list
  of every published reservoir, in size order, with focus moving into a popup
  when it opens and back to the button when it closes. Chart bars are reachable,
  and selections are announced politely.
- **Drainage areas on the overview.** A capacity-weighted total per hydrologic
  unit, with the reservoir count and combined full level beside each one.
  Selecting an area filters the ranking, table and cards together and is
  shareable as `?area=160201`.
- **Upper Snake is out of scope.** The drainage areas are now those that touch
  Utah *and* belong to the Colorado River or Great Basin systems. Upper Snake
  clips Utah's northern edge but drains to the Columbia, and its thirteen
  storage stations are Idaho reservoirs. Fourteen areas, not fifteen; no
  published number changes, because it never held a tracked reservoir.
- **Fontenelle Reservoir**, in Wyoming on the Green above Flaming Gorge. The
  54th reservoir, and the only one of Reclamation's five Upper Colorado
  candidates whose drainage area touches Utah.
- **Watershed assignment now uses each dam's own coordinates** where the
  National Inventory of Dams has them (29 of 54), instead of a point out on
  the lake. No reservoir changed drainage area; each record says which kind
  of point was used.
- **Watershed membership.** Every reservoir carries the six-digit hydrologic
  unit its water drains through, whether it is in Utah, and the point the
  assignment used. Boundaries ship as a committed `huc6.geojson`.
- Architecture decision records, in [`docs/decisions/`](docs/decisions/).

### Fixed

- Lake Powell is excluded from the default modern map, metrics, charts, and
  table by its stable RISE item identifier (509), with a normalized-name
  fallback for older payloads.

- **The basemap fallback now notices a refused background.** A basemap whose
  style answers 401 still resolved its own `load()`, so the preferred
  background "succeeded" onto a frame that could not draw and no fallback was
  ever taken. Candidates carry a verification step now, and a refused style is
  an ordinary candidate failure. Found by running the new smoke test with the
  first basemap refused; with the anonymous-auth policy removed, that same run
  puts a password field on the page.
- **MapLibre hover no longer throws.** Its pointer handler referenced a
  reservoir lookup that the page never constructed; a regression test now
  keeps the lookup and handler together.
- **Cross-border reservoirs now count as Utah waterbodies.** Bear Lake and
  Meeks Cabin Reservoir extend into Utah even though their published points
  are in Idaho and Wyoming. The Utah total now uses reviewed USGS waterbody
  footprints instead of point location alone.
- **Upper Snake is removed from the live map query.** The committed boundary
  file already excluded region 17, but the two legacy maps still asked the
  live service for every area that touched Utah and could draw Upper Snake.
- **`Ken's Lake` was unclickable.** The shared HTML escaper never escaped
  apostrophes, so the name broke out of its own `data-name='…'` attribute and
  shattered into junk attributes. Its ranking row, table row and sparkline card
  all rendered, counted toward the tests' expected total, and did nothing when
  activated.
- **The ArcGIS colour ramp was silently truncated.** A `MapView` supports at
  most 8 stops on a colour visual variable and the ramp needed 10; the map drew
  an SDK-simplified approximation of the class table rather than the table.
  Now a `UniqueValueRenderer` with no such limit.
- **The Utah mask had been deleted** several commits earlier while the README
  still described it. Restored, under the drainage-area outlines.
- **Focus never returned from an ArcGIS popup.** Opening one fires a spurious
  "not visible" first, which was read as a close and consumed the stored
  opener, so Escape dropped focus on the document body.
- **The reservoir list ran underneath the legend** at common window sizes.
  Both were capped by a guessed constant that had gone stale as each grew.
- **The overview scrolled sideways on a phone.** A `<select>` sized itself to
  its longest option inside a grid item that would not shrink.
- **The ArcGIS zoom control overlapped the title card** on a phone, and was
  missing entirely at phone widths in CI after a first attempt to move it.
- Contrast failures on link, caption and axis text across all three pages.

### Changed

- The starting extent is one zoom level wider. It is marked provisional: it
  stops making sense once connected out-of-state reservoirs land.
- All visible text now follows Simplified Technical English, enforced by tests
  (ADR-006).
- The statewide trend chart is drawn with Observable Plot, with pointer tips
  and controls for scope and units.
- The site is built with Vite and published to GitHub Pages by Actions.
