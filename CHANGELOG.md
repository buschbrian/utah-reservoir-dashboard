# Changelog

Notable changes to the dashboard. The data itself is refreshed every morning
and is not listed here.

## [Unreleased]

### Fixed

- The modern map keeps locally committed reservoirs and drainage areas visible
  when every anonymous ArcGIS basemap candidate is unavailable, with a clear
  degraded-background notice instead of an empty map.
- Both legacy map engines now enforce a Utah-region pan extent and minimum
  zoom, preventing accidental navigation to a world view.
- All map masks and `in_utah` classification now use the committed,
  authoritative UGRC Utah State Boundary instead of a six-corner approximation.

### Added

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
