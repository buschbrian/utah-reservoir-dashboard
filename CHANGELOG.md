# Changelog

Notable changes to the dashboard. The data itself is refreshed every morning
and is not listed here.

## [Unreleased]

### Added

- **The snowpack view has its map.** A map card now sits above the seasonal
  curve: each drainage area is filled by its mean percent of normal for a
  chosen day, and every measurement site is a point on the same red-to-blue
  scale, with its own legend and a day control across the whole water year.
  The day opens on the newest one where at least half the sites reported —
  the same floor the headline values use — and a shared link carries the
  chosen day. Areas and sites without a fair value for the shown day stay
  grey rather than borrowing a colour. The view frames the fourteen
  drainage areas exactly, the basemap uses the same keyless fallback chain
  as the storage map, and a map that cannot start leaves every number on
  the page in the chart and tables with a visible note.

- **A drought view.** The navigation now carries a Drought page reading the
  U.S. Drought Monitor's weekly map by drainage area, most severe first.
  Each area shows the share of its land in each class as a bar in the
  monitor's own colours, with the exact values in a table behind it — and
  beside each area, the combined reservoir storage that drains it, because
  the two can disagree and that disagreement is the story. The page states
  the map's week, its release date, and its age, and marks the data late
  when a weekly release has been missed. Each area links across to the
  storage map and the snowpack view with the same shared address. If the
  reservoir payload cannot be read the drought figures still render and
  each row says the storage comparison is missing. The methods page gains
  the Drought Monitor as a named, linked source.

- **Weekly drought coverage by drainage area, as published data.** A new
  analysis tool reads the committed U.S. Drought Monitor polygons and writes
  the percent of each drainage area's land in each drought class, with the
  monitor's own map and release dates. The figures ship beside the polygons
  in the published data directory and are held by tests to shapes with known
  answers and to their own arithmetic. Nothing on the pages reads them yet;
  they are the data half of the coming drought view.

- **A snowpack view.** The navigation now carries a Snowpack page showing the
  water stored in mountain snow: the seasonal curve of mean percent of normal
  for the whole region or one drainage area, the value on the first day of
  each month, and a table of every measurement site with its newest reading.
  Normal is the middle value for the same day in the years 1991 through 2020,
  and the page says so. Headline numbers require at least half the sites to
  report, so October's first flurries and June's last unmelted stations
  cannot become the page's largest numbers; the curve keeps the published
  two-site floor and breaks where it is not met. A shared link carries the
  drainage-area choice with the same name the storage map uses. The snow
  payload is validated at the fetch boundary like the reservoir payload, and
  a unit test holds the page's percent arithmetic to the pipeline's rollups
  value for value.

- **Every source on the methods page is now a link.** The sources and credit
  sections link to the pages the data is actually driven from — the
  Reclamation open-data service, the Natural Resources Conservation Service
  water and climate service, the National Inventory of Dams, the Watershed
  Boundary Dataset, the Utah Geospatial Resource Center, and the map and
  design tooling — and the credit section links the public repository with
  its pipeline and decision records. A new snow measurements entry names the
  1991 through 2020 comparison period the snowpack page uses.

- **A ranking chart beside the table under the map.** The bottom row now
  pairs the sortable table with a bar chart that ranks every reservoir the
  analysis controls match, lowest percent full first. It is drawn from the
  same rows the table renders and the CSV export writes, follows the month
  slider and the scope the same way, and its bar colors are the storage
  levels in the map key. Clicking a bar selects that reservoir, the same
  selection the map, the list and the table set. A reservoir with no
  readable percentage is not ranked, and the caption says how many are. The
  chart is loaded only when the row is opened, so the map does not wait on
  it.

- **A reservoir table under the map, with its own CSV file.** The header now
  carries a table control that opens a panel below the map listing every
  reservoir the analysis controls match, with its storage, full level,
  drainage area and reading date. Any column can be sorted, and the values
  follow the month slider the way the map and the storage summary do. The
  download button writes exactly the rows on screen, in the order they are
  shown. A shared link carries the table's order and whether it is open, so a
  sorted view can be sent to somebody else.

- **The primary map and data workspace can export CSV files.** The workspace export follows
  the current filters and table order. Reservoir details export the current record and its
  12-month history. Both exports keep raw numbers and include provider, identifier,
  observation date, full-level source and drainage area.

- **The dashboard data now has a documented public API.** Stable `/api/` paths publish
  reservoir, snow and reference JSON from the same files the site uses. A new documentation
  page lists every field, refresh and failure behavior, browser access, code examples and
  plain terms of use.

- **A shared map link now has a visible copy control and public filter names.** The
  map writes drainage area, storage class, late-data choice and month as
  `?drainage=`, `?class=`, `?late=` and `?month=`. Older links using `?area=`,
  `?storage=` and `?reporting=` still open correctly. The copy button confirms
  success without adding another repeating announcement.

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

### Changed

- **Storage colours now use an accessible red-to-blue scale and regular
  intervals.** Five equal 20-point bands replace the uneven red-to-green
  classes. Low storage is red, high storage is blue, and the pale middle
  colours have visible edges on map and chart marks. Overview counts choose
  dark or light text from their background colour instead of assuming one
  foreground works across the scale.
- **Reservoir summaries now make changes comparable across reservoir sizes.**
  The details panel and comparison-map popup show both acre-feet and percentage
  change for 30 days and one year. The primary-map hover summary also includes
  current storage and the 30-day percentage change. Monthly comparison tables
  use the same full-level basis as their map symbols.

- The starting extent is one zoom level wider. It is marked provisional: it
  stops making sense once connected out-of-state reservoirs land.
- All visible text now follows Simplified Technical English, enforced by tests
  (ADR-006).
- The statewide trend chart is drawn with Observable Plot, with pointer tips
  and controls for scope and units.
- The site is built with Vite and published to GitHub Pages by Actions.

### Fixed

- **The twelve-month trend chart now draws twelve months.** Every reservoir
  carries twelve months of history, but a reservoir with late data carries an
  *older* twelve, so the months across the whole set span further back than
  any single reservoir's window -- the chart drew fourteen or fifteen bars
  under a title that said twelve. The trend now keeps the newest twelve
  months it can see. The map's month slider is unchanged on purpose: a
  slider position claims only that some reservoir reported that month, not
  that the last year contains it.

- **The scatter chart's pointer summary names the dot's drainage area
  again.** The charts SDK asks the layer only for numeric fields and for the
  field its renderer colours by, so the drainage-area name -- a text field
  that is neither -- never arrived, and every dot read "Drainage area: Not
  reported". The summary now looks the reservoir up by the stable object id
  the SDK does deliver, which also stops the reservoir's own name depending
  on how the SDK treats the renderer's field.

- **The overview charts no longer reserve a white rail for an empty menu.**
  The charts action bar had no actions to show, so its expand control only
  opened and closed blank space while taking width away from every chart. The
  rail and its inactive collapse state are removed, and each chart now uses
  the full card width.
- **Chart pointer summaries now have a consistent reading order.** Reservoir
  or month names lead, followed by one fact per line with the correct unit.
  The storage-against-normal chart no longer puts text fields into an SDK
  option that supports numbers only, and the trend no longer repeats the same
  value for its matching bar and line. Runtime names are escaped before the
  charts SDK interprets the summary as markup.
- **The reservoir bar chart now keeps the selected ranking.** The data was
  prepared in Capacity, Storage, Percent full or Name order, then the chart
  model sorted it by bar length again. It now preserves the order the reader
  chose, including when acre-feet stored is the selected measure.
- **Primary-map pointer input is limited to the current reservoir layer.** A
  click now uses the SDK's immediate feedback event, and click and hover tests
  exclude drainage areas, labels and old layers from their results. Late
  answers from a layer that has since been replaced are ignored, and the
  pointer changes shape when it is over a reservoir.

- **Clicking a reservoir on the primary map now selects it straight away.**
  The map answered a click with a reservoir that carried no name, so the click
  cleared the details panel instead of opening it. It only affected the map as
  first drawn: changing which reservoirs are shown built the layer again, and
  from then on every click worked, which is why the fault looked intermittent.
  The map now asks for every field it reads and falls back to the stable
  reservoir object ID when the SDK still omits the name. The ring around the
  selected reservoir also stayed above the circles only until the reservoirs
  were redrawn, and now stays above them.

- **Clicking or hovering a reservoir on the primary map worked again.** The
  object-ID fallback above read the hit's layer off `graphic.layer`, which
  the 2D feature layer view leaves `undefined` for an ordinary feature hit --
  it only sets that property for track and aggregate hits. The SDK's own
  `GraphicHit` type carries the layer on the hit result itself, not the
  graphic, so the fallback silently never matched and every click and hover
  on a reservoir point fell through to "nothing here," while the reservoir
  list kept working because it never goes through `hitTest`. Reading
  `result.layer` instead resolves both.

- **The overview's six charts now match the page's own light or dark theme.**
  `createModel` builds every chart against its own defaults -- a white
  background, near-black axis text and lines -- and nothing here ever told
  it otherwise, so a chart sat inside a card looking like neither theme. The
  first attempt at this read Calcite's own stock colour ramp, which is nearer
  to plain grey and white than this app's own warm, muted cream-and-charcoal
  tokens (`app.css`) -- so the fix "worked" and still looked wrong. Reading
  the app's own `--app-surface-raised`, `--app-text` and `--app-border`
  instead is what actually matches the card each chart already sits inside.
  Colours are re-read and reapplied if the reader flips the theme toggle
  after the charts have drawn, since a chart bakes the colours it read at
  mount time into its own config rather than tracking the CSS variables live.
- **Chart tooltips now name the reservoir or drainage area they are over.**
  Four of the five chart layers had no `displayField`, so their tooltips
  listed every field with its raw alias rather than opening with the one
  that says what the mark *is*. The fifth -- the box plot behind "spread
  within each drainage area" -- did have a name for its category, but never
  named its own series, so its tooltip opened with `Field: series_1786…`, a
  generated id, sitting right above the `Drainage area` row that already
  answered the same question. And the scatter chart ("stored now against
  normal") plots two numbers with no category field between them, so neither
  fix touched it: nothing in its axes or `displayField` carries the
  reservoir's name into a tooltip built only from what a point is plotted
  against, and the tooltip read three numbers with no way to say whose they
  were. Its name and drainage area are now listed explicitly instead, the
  one lever a scatterplot tooltip actually exposes -- the two plotted values
  still list first, which this chart type does not allow changing, so the
  name is the first line after them rather than the very first line.

- **The overview's charts say what kind of chart they are.** Every chart
  card carried the same "ArcGIS Chart" badge, which named the SDK rather
  than the chart -- a bar chart, a histogram and a box plot all wear the
  same label. Each now says which one it is.

- **The twelve-month trend is a bar chart with a line over it, not a bare
  line.** Twelve points and nothing else read as mostly empty space, and a
  bar gives every month the same visual weight the rest of the page's bars
  do. The line stays, drawn over the bars, for the one thing a bar chart
  alone cannot show: which way the last twelve months are going.

- **The distribution histogram's axis reads whole numbers.** Its bins are
  computed from the data's own range rather than fixed ten-point bands (see
  the note in the source on why), so the bin edges -- and the axis labels at
  them -- used to carry the data's own fractional digits, printing edges
  like 40.74 instead of 41. The axis now rounds its own display.

- **The primary map now draws the symbol sizes its code specifies.** CIM
  marker dimensions are points, but the renderer passed CSS-pixel diameters
  into them unchanged, making every reservoir circle one third wider than
  intended. The renderer now converts units at its boundary. Drainage-area
  names are eligible at the opening scale and use a stronger white halo, so
  they remain readable over boundaries, circles and varied map backgrounds.

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
