# Changelog

Notable changes to the dashboard. The data itself is refreshed every morning
and is not listed here.

## [Unreleased]

### Added

- **The maps cover the west.** Seventy-five drainage areas instead of
  fourteen: everything draining to the Pacific, plus the Great Basin, which
  drains nowhere. The drought map has a real measurement for every one of them
  and draws every one of them. The snow map still draws fourteen, because the
  snow network reports in fourteen and an outline with nothing behind it is
  less to look at rather than more. The reservoir roster has not moved and is
  still 69, so 61 of the drawn areas hold none -- admitting a reservoir means
  tracing a full level and reviewing it, and that work is separate from
  drawing the ground (ADR-063).

- **Building the climate normals takes minutes rather than an hour.** The job
  spends almost all of its time waiting for the two providers to answer, so it
  now asks for six reservoirs at once rather than one: 69 reservoirs in 1.6
  minutes instead of about fourteen, and the same file byte for byte.
  `--missing` builds only what has no normal yet, which is what a roster
  addition costs and how an interrupted run is resumed.

- **Choose how finely the ground is divided.** Every map now offers two area
  sizes: 75 basins, which is what a map opens with, or 44 subregions. Each
  subregion holds whole basins, so the choice splits nothing, and every figure
  is measured again at the size chosen rather than averaged up from the
  smaller one -- the drought shares are computed over the larger areas, the
  reservoir totals are added over them, and the snow figures are the mean over
  the same sites grouped differently (ADR-064). The choice travels in the
  address, so a link carries it.

- **Drought is measured over larger areas too.** The same weekly measurement
  is now published over the 44 subregions of the west as well as its 75
  basins, so the site can offer a reader the choice of how finely the ground
  is divided. Nothing else about the data changed: the same snow sites and the
  same reservoirs, grouped differently (ADR-064). The engine reads and writes
  each area's code under the name its size implies, which is what it had
  always asked of the maps and never of itself.

- **The storage map still opens where the reservoirs are.** Where a reader may
  pan now comes from the areas that hold reservoirs rather than from every
  area drawn, so covering the west did not open the map on 19 degrees of
  longitude with every reservoir in one corner of it. The opening view is
  unchanged, and it will follow the reservoirs out when they go.

- **Lake Mead, and a control for it.** Lake Mead sits in Lower Colorado-Lake
  Mead, one of the fourteen drainage areas this site has always published, and
  had never been admitted -- so the area named after it carried none of it. At
  28,255,000 acre-feet it is larger than Lake Powell and would be
  substantially the whole of that area's storage, so it gets its own
  include/exclude control for the same reason Powell has one: a total with it
  and a total without are both true and are not the same measurement
  (ADR-062). Excluded by default. Its water is 67% in Nevada and 33% in
  Arizona and never reaches Utah, so it appears only under the connected
  geography.

- **Filter by state and by subregion, and drill down.** Three geographic
  controls that narrow each other, coarsest first: a state holds subregions, a
  subregion holds drainage areas, and a reader can start anywhere and stop
  anywhere. Picking Wyoming does not then offer a subregion Wyoming has none
  of. "In a state" means where the *water* is, so Bear Lake — whose point is
  in Idaho — is in Utah's list, which is what the site has always meant by it.
  Subregion codes cost nothing to publish: they are the first four digits of a
  code every record already carries. Only the eleven names are new.

- **Find a reservoir by its county.** Counties are a search and filter axis,
  not a grouping one -- measured first: 69 reservoirs fall in 35 counties and
  19 of those hold exactly one, so a county chart would be a reservoir chart
  wearing a county's name (ADR-058). The county comes from the reservoir's own
  waterbody point, deliberately not the dam point the drainage area uses: Glen
  Canyon Dam is in Coconino County, Arizona and Lake Powell is the lake in San
  Juan County, Utah.

- **Three ways to ask about a state.** Where a reservoir is, where its water
  is, and what its water drains are three different questions, and the Utah
  pair only ever answered two of them for one state (ADR-060). Hyrum is wholly
  inside Utah and fed from Idaho; a reader asking what Idaho's snow feeds and
  one asking what is in Idaho now get different answers.

- **The drought engine knows the difference between dry and unmeasured.** The
  U.S. Drought Monitor stops at both borders, and every cell beyond one used
  to count as land with no drought on it. Nothing published today changes --
  all fourteen current areas are inside the country -- but at western coverage
  it mattered a great deal: Kootenai would have reported 75 points of
  drought-free area that is really British Columbia (ADR-059).

### Changed

- **The drought map is quieter.** No terrain under the classes, the state and
  county outlines above them rather than beneath, and thinner, fainter
  drainage lines. What may sit over the subject now depends on whether the
  subject is continuous or discrete: a line over a drought class partitions
  it, a line over a reservoir hides it (ADR-061).

- **The dam inventory is read from the agency that maintains it.** The
  National Inventory of Dams now comes from the U.S. Army Corps service rather
  than a hosted copy found by searching ArcGIS Online for the most-viewed
  result. No published number moved. A dam identifier turns out to name a
  project rather than a structure, and three of ours return several; the point
  is now chosen by rule instead of by whichever row arrived last (ADR-057).

### Fixed

- **A quiet feed no longer costs a reservoir its climate normal.** The
  thirty-year baselines are built from the reservoirs published that morning,
  and a reservoir whose provider has gone quiet is not among them — so a full
  rebuild would drop a fact about 1991 through 2020 over a fortnight of
  silence. Every build merges now, and says which normals it kept without
  being asked for them.

- **The histogram had two legends, and the numbers were in the wrong one.**
  The key naming its four lines had been moved under the chart, and the
  chart's own key was left where it was -- inside the plot, on the right,
  holding the values. One key now, under the horizontal axis, carrying both
  the names and the values: the mean, the middle value and one standard
  deviation. The values follow the filters, and the bars get back the width
  the old key was taking.

- **`--only` no longer destroys the file it is meant to add to.** Building one
  reservoir's climate normal wrote that reservoir as the whole of
  `normals.json`, discarding the other sixty-eight and the thirty-year job
  that produced them. It merges now.

- **The western boundaries were refetched at 56 metres.** They had been
  fetched at 100, the ordinary tolerance for a new scope, and publishing them
  made them the file every drought figure is measured against. At the coarser
  tolerance two of the fourteen areas published today moved by a tenth of a
  point -- one rounding step, with no weather behind it. Refetched, the
  fourteen are identical to the reviewed file they have always been measured
  with, and no published figure moved at all.

- **Groundwork for covering the whole west.** Nothing on the site looks
  different yet, and that is the point of this step. The machinery that
  decides which drainage areas the project reads now takes the size of those
  areas as a setting rather than assuming the six-digit ones, and the western
  scopes are registered so their geography can be fetched and checked before
  any page draws it. The scope is drawn by where the water goes, not by
  longitude: everything draining to the Pacific plus the Great Basin, which
  is 44 subregions, 75 basins and 571 subbasins across hydrologic regions 14
  through 18 (ADR-053). The Missouri, Arkansas, Texas-Gulf and Rio Grande are
  western in longitude, eastern in hydrology, and out.

- **The maps take their drainage outlines from the hosted Watershed Boundary
  Dataset, and the pages got much lighter for it.** The outlines used to
  travel inside `reference.json` — 982 KB of a 1,001 KB file, fetched whole
  by every map page on every visit — and the drainage-area names were placed
  as fixed text that cannot avoid covering things at western density. The
  hosted layer sends only what the current view can show, the label engine
  places the names and drops one it cannot fit (ADR-047, ADR-048), and
  `reference.json` now carries each area's code, name and states in 21 KB.
  The snowpack payload also stopped repeating its calendar once per site
  (ADR-052) — 54% off the wire — and runtime fetches now revalidate instead
  of re-downloading, so an unchanged file costs a "not modified" answer
  rather than its whole weight (ADR-051). `docs/data-transfer.md` holds the
  before-and-after measurements.

- **The pipeline is ready for a western roster.** Point-in-area assignment
  short-circuits on bounding boxes (30 seconds down to a tenth for a
  690-reservoir roster at HUC-8); the snow refresh tolerates up to 2% of
  stations not answering — solar radios in mountain winters — naming the
  absentees instead of refusing the whole day; and dam matching for new
  candidates confirms by position first and name second, screening out
  structures that could not hold the observed water, like the settling pond
  0.29 km from Huntington North's gauge.

- **The snowpack and drought maps can change their background.** Both now
  carry the basemap gallery the storage map has always had. It was left out
  because these maps follow the page theme and a background you picked would
  have been overruled by the next theme change; the theme now stands down
  once you have chosen one of your own.

- **The drought map names its drainage areas.** Every figure on that page is
  keyed to one of the fourteen areas by name, and the map carried none — so
  matching an outline to a table row meant counting positions. The names sit
  above the drought classes and below the reservoirs.

- **Its drainage boundaries are cased, so they read on every class.** The
  Drought Monitor's palette runs from bright yellow to near-black maroon, and
  one dark line cannot survive both: it was clear on the pale end and all but
  invisible on the dark end, which is exactly where a reader is trying to see
  which basin the worst class is inside. Each boundary is drawn twice now, a
  wide pale casing under a narrow dark core, so one of the two is always
  visible whatever is underneath.

- **A compass and a "find my location" control on all three maps.** Rotation
  was always possible and there was no way back to north. The location
  control uses the browser's own geolocation and asks no outside service.

- **The map and the table share a split you can drag.** The row under the map
  opens at two-fifths of the window and the divider between them moves, by
  pointer or by arrow keys, so both stay live at whatever ratio suits the
  reading. It stops short of hiding either one: the row cannot be dragged
  shut, which is what its close control is for, and it cannot be pulled over
  the whole map.

  Where you leave it is remembered for next time. It is kept as a share of
  the window rather than a number of pixels, so it means the same thing on a
  different screen, and it is *not* in the address bar — a link to a
  reservoir should not impose the sender's pane sizes on whoever opens it.

- **The drought pipeline keeps its weekly maps.** Every week the monitor
  publishes is now retained, so week-over-week change becomes possible for
  the first time. Two files do it: the current week's coverage carries the
  week before it, which is about a kilobyte and is all a change needs, and a
  separate archive keeps ten years of Thursdays for work that wants a series.
  Reruns replace a week rather than repeating it, which also lets a revised
  map correct its own entry.

  The weekly digest uses it straight away. It counts the drainage areas that
  gained or lost land in severe drought or worse and names the one that moved
  most — counted rather than averaged, because a share of land averaged
  across areas of very different sizes is not a quantity anybody can act on.
  Until a second week is published it says so plainly.

- **Two new charts on the drought page.**

  **How the areas are divided** counts every drainage area once, at the most
  severe class with land in it. The page reported this as a single number —
  "areas in extreme drought or worse: 11 of 14" — which hides the shape
  behind it: nine clear areas and nine areas sitting one class below the line
  give the same count and are not the same week. Drawn for this week, it
  shows that no drainage area at all is clear, abnormally dry or in moderate
  drought — every one of the fourteen is at severe drought or worse.

  **The same comparison, in order** ranks the areas by how far their banked
  water sits from their dry land, worst first. The scatter above it shows the
  same relationship as a cloud and asks the reader to judge each point's
  distance from a diagonal that is not drawn. This states the order: this
  week it leads with Escalante Desert-Sevier Lake, 91% of its land in severe
  drought with its reservoirs 6.6% full.

  Each area is two dots on one scale with a line between them, rather than
  one bar of the difference. The two shares divide by different things — one
  by land, one by reservoir capacity — so their difference is not a quantity
  of anything, and the site never states it as a number.

- **The drought map is drawn on terrain.** A public hillshade is multiplied
  over the drought classes, so the pattern now sits on ground that shows
  where the mountains and the desert basins are. It is drawn *above* the
  classes rather than beneath them, which keeps every class exactly the
  colour the Drought Monitor published and varies only its lightness.

- **The snowpack map carries its key inside the map**, as the drought map
  already did. Matching a colour to a class no longer means looking away
  from the pattern.

- **The histogram on the storage charts page says what its lines mean.** It
  draws a mean, a middle value, a standard deviation band and a fitted
  normal curve in four line styles, and carried no key at all. The key sits
  under the chart, so the bars keep the full width of the card.

- **You can choose which years "normal" means.** The storage map has a
  "Compare against" control with two periods: **1991 through 2020**, the
  standard thirty-year climate period and the same one the mountain snow
  measurements already used, and **2015 through last year**, every year this
  site collects. Each reservoir's details now name the period its comparison
  came from and how many years stand behind it.

  This matters more than it sounds. The site's only "normal" used to be the
  2015-onward one, and it was that period by accident — 2015 is simply where
  the data pipeline starts asking. Those years are the driest stretch in the
  modern record here, so every reservoir was being measured against a drought.
  Lake Powell reads **44.6% of normal against 2015 through 2025 and 35.0%
  against 1991 through 2020**. Both are correct; the second is the standard.

  Sixty-three of the sixty-nine reservoirs have enough years for the standard
  period. The rest are newer than it — Jackson Flat's dam dates from 2017 —
  and their details say so and show the other period instead of a middle value
  drawn from three years. The history rank is unaffected and still uses the
  years this site collects, which the reservoir details and the methods page
  both state.

- **A weekly summary of what moved.** The storage charts page opens with the
  last seven days in plain sentences: how much water the region gained or
  lost, how far the combined level moved, how many reservoirs rose and fell,
  and which ones moved most — by volume, and separately by share of their own
  size, because those are usually different reservoirs and calling either one
  "the biggest" without saying which measure would mislead. It also says what
  it could not measure: the twenty-nine reservoirs that report monthly cannot
  show a weekly change, snow has no comparison once the sites melt out, and
  only one week of drought coverage is kept so there is no change to report
  yet. It describes the whole region and does not follow the filters below it.

### Changed

- **The drought map sits above the charts**, which is the order the page is
  read in: the map first, then the figures that describe it.

- **The drought page's charts no longer stretch to fill the window.** All
  three are drawn as SVG with a fixed 640-unit frame, so on a wide screen
  they scaled up bodily — measured at 1280px, everything inside them grew by
  1.88 times, padding and gaps included. The ranked comparison was 796 pixels
  tall and the scatter 639. They are capped and centred now, and the ranked
  rows are tighter: 478 and 459.

- **One set of state names on the drought map.** That map draws its own state
  and county boundaries and labels them, and the background was labelling the
  same states underneath — a duplicate buried under the drought classes,
  where it read as mush. The background's copy is removed there rather than
  moved down.

- **The drought map's terrain now brightens as well as shades.** It was
  combined with `multiply`, which can only darken — where the hillshade is
  light it does nothing at all, so lit slopes disappeared and only shadows
  showed. `soft-light` lightens above mid-grey and darkens below it, which is
  what relief shading is for.

- **The map key lines up.** Five classes in a wrapping row broke wherever
  they fitted, so the swatches started at a different place on every line.

- **The month table in the reservoir details no longer scrolls sideways.**
  The values always fitted; the column headings held on one line each are
  what pushed it past the panel. They wrap now and the values do not.

- **Every page now names itself.** The site is the **Utah Water Dashboard** —
  it carries mountain snow and the weekly drought map beside the storage, and
  two of its five surfaces are not about reservoirs at all, so the old name
  described a third of it. Each page is now "Utah Snowpack", "Utah Drought",
  "Utah Reservoir Storage" and so on, in the browser tab and as the page's
  own heading. Every page's heading used to be the site name, so moving
  between five surfaces told you the same thing five times.

- **Borrowed map boundaries no longer draw over the reservoirs.** A basemap
  has two layer stacks, and its reference stack draws above everything a map
  puts on top of the ground — so the background's own state boundaries were
  landing on the data, most visibly as a line straight through Flaming Gorge,
  which sits on the Utah–Wyoming border. Those layers are now moved beneath
  this project's own. An earlier attempt reordered the wrong stack and could
  never have worked.

- **The reservoir details panel stacks its labels above their values.** The
  two columns worked while every label was two words; once a label had to
  name a period, the label column took 261 of 320 pixels and left the values
  14 pixels to wrap inside.

- **The maps hold a tighter zoom envelope.** They could be zoomed out to
  about 1:37,000,000 — most of North America — and in to about 1:70, well
  past the point where there is anything left to draw. The range is now
  1:18,500,000 to about 1:9,000. Holding the view inside the region does not
  do this on its own: that restricts where the centre may go, not how far
  out you may zoom.

- **The snow and drought maps are taller, and show far less empty ground.**
  The drawn region is 869 km wide by 923 km tall and the cards were nearly
  three times wider than they were tall, so the view fitted the height and
  spent the rest on emptiness — 2,509 km of width for an 869 km region. They
  are now slightly narrower in proportion than the storage map's own stage.

- **Reservoirs on the drought map are a dark point inside a light ring.** A
  single dark dot is clearly visible on the pale end of the drought ramp and
  effectively invisible on the dark end, which is exactly where a reservoir
  inside extreme drought is most worth seeing.

- **The weekly summary follows the reservoirs you are looking at.** It always
  described every published reservoir, so the Lake Powell switch above it did
  nothing — and Lake Powell is roughly half of the region's weekly movement.
  The snow and drought parts still describe the whole region, because they
  are not made of reservoirs, and each says so.

- **The header actions report whether their panel is open.** The storage
  summary's was written as always-on in the markup, so it was lit from first
  paint whether the panel was open or shut, and the reservoir details action
  never lit at all.

- **The map now opens on the standard climate period, so most numbers read
  lower than they did.** That is the correction, not a fault: comparing
  against a period that includes wet years is a higher bar than comparing
  against a decade of drought. Choose "Recent years" in the "Compare against"
  control to see the previous figures, and a shared link carries whichever you
  picked.

- **State and county outlines now draw behind everything else on the map.**
  They are borrowed reference geography — they say which land the pattern
  crosses — and drawing them over the drought classes put a borrowed line on
  top of the subject. Their names are unaffected and still read clearly.

- **The snowpack map opens on the season's peak snow.** It used to open on the
  most recent day half the sites reported — which, late in the melt season, is
  the most melted day that still counts, so the map showed the worst picture
  of the year every time you arrived. It now opens on the day the region held
  the most snow, which is the day the rest of the season is judged against.
  Peak snow, not peak percent of normal: the highest-percentage day this
  season was in early December on two inches of snow, because December's
  normal is small too. The slider still reaches every other day, and a shared
  link still carries whichever day its author chose.

- **The storage map's colours run one direction now.** Percent full goes from
  empty to full and nothing happens in the middle, but it was drawn with a
  scale that fades from red through pale yellow to blue — a shape that says
  something changes at halfway. It now runs pale and dry at empty to deep
  water at full, getting steadily darker, so the order reads even in black and
  white or to someone who cannot separate the colours. The five 20-point bands
  are unchanged.

- **A reservoir's outline no longer takes its storage colour.** The circle's
  size has always meant capacity and the filled part how full it is; colouring
  the outline by storage too meant a nearly empty reservoir was a pale ring
  with nothing inside — the hardest thing to see on the map, and the one that
  matters most. The outline is now a constant dark edge, so every reservoir is
  visible whatever its level, and the colour means one thing.

- **The snowpack map now has six classes instead of five, and the extra one is
  where the readings actually are.** The four thresholds the measuring service
  reports against are unchanged; a fifth was added at 25% of normal, because
  the old set put 62% of every published day into the single lowest class. In
  a dry year the map was one colour and four of the five colours only ever
  appeared in the legend. The season now spreads across the whole range.

- **Its colours come from a published scientific colour map.** Crameri's
  *roma*, chosen by testing every candidate against four rules at once — every
  class visible as a see-through fill over terrain, every class distinct from
  its neighbours, dry reading warm and wet reading cool, and nothing close to
  a colour used on the storage or drought maps.

### Added

- **The methods page opens by saying what this site is not.** It is a personal
  open-source project, not made, endorsed, sponsored or checked by any agency
  or organization, and it does not speak for any of them. Where this site and
  a publisher disagree, the publisher is right. Naming an agency in the
  credits thanks it for its work and means nothing more than that. The page
  also says how the project is built: much of the code is written by AI agents
  from stated requirements, with every change reviewed by a person, tested,
  and recorded — so the way each number is produced can be read rather than
  taken on trust.

- **The methods page now says three things it should have said all along.**
  These reservoirs are operated, so a falling level can be a release rather
  than a dry watershed. Snow is compared against thirty years and storage
  against eleven, so the two "normals" are not equivalent and storage will
  tend to look better against its own. And "full" is measured against more
  than one kind of full level.

- **Every reservoir now says which full level its percentage is measured
  against.** Three different quantities arrive as "capacity": a normal full
  level, a maximum level that includes storage kept for floods, and the level
  the water and climate service publishes with its readings. Four reservoirs
  use the maximum — and because Lake Powell is one, those four are about
  seven tenths of the combined full level every regional percentage is
  divided by.

- **Every history rank says how many years it came from.** The record starts
  in 2015, so each rank is a position among eight to eleven values. Two ranks
  a few points apart are not meaningfully different, and the panel now says
  so instead of presenting a percentile as a measurement.

### Changed

- **The drainage-area outlines are drawn from much finer boundaries.** They
  were simplified to about 500 metres, which was invisible while they were
  background context and obvious once you could zoom to a dam: neighbouring
  areas whose shared ridge had been simplified separately no longer met, so
  the map showed slivers and gaps that do not exist on the ground. They are
  now at about 56 metres, which is the point where the source stops adding
  detail — past it you are downloading decimal places, not shape. The
  published drought figures moved by at most a tenth of a percentage point,
  which confirms the coarse file was never producing wrong numbers; it just
  drew badly up close.

- **The drought map has a quieter background, and its key sits on the map.**
  It labels states itself, and the previous background labelled them too, so
  every state carried two names in two typefaces. It now uses the plain
  canvas that matches the theme. The class key moved from a band above the
  map to a panel in the corner of it, so the colour and its name are inches
  apart instead of a glance apart — on a phone it stays below the map, where
  a short map cannot afford to lose a third of itself to it.

- **The reservoir dots on the drought map are quieter.** They were a
  translucent dot inside a near-opaque white ring, and at that size the ring
  was a third of the symbol — a field of them read as pale specks and the
  white fought the monitor's yellows. Solid, smaller, with a hairline edge.

### Added

- **Every page now carries a content policy.** Fetches, images and fonts are
  confined to this site and the named Esri services, forms cannot post
  anywhere, and no plugin can load. It was written from a measurement of what
  the pages actually request rather than from a template, and the whole
  browser test suite runs with it in place.

### Fixed

- **Every map label was rendering in the wrong typeface.** The new reading
  font was requested by a name that already included its weight, which asked
  for a font file that does not exist — and a missing label font does not
  fail, it quietly falls back. The maps looked fine and were not using the
  font at all. The browser tests now watch for this directly, because it is
  invisible on the page.

- **Small text and scrolling regions now meet the accessibility standard.**
  The badge on each card was slightly too light against its own background;
  six tables and two code samples could be scrolled with a mouse but not with
  a keyboard; and both sliders announced a number to a screen reader without
  saying what the number was. All found by an automated audit that now runs
  over every page, at every screen width, on every test run.

- **The drought map would have broken on the next weekly release.** The daily
  job downloaded the new drought polygons but never recomputed the coverage
  figures the page draws from them, so the two files would have described
  different weeks — and the page refuses to draw that, correctly, rather than
  showing one week's map over another week's numbers. It now recomputes the
  coverage from the polygons it just downloaded and commits both together, so
  either both move to the new week or neither does.

### Added

- **The drought data says when it has stopped arriving.** The monitor
  publishes each Thursday. When a week goes by without one, the page has
  always shown the age — but nothing told anyone. A missed release now opens
  an issue on its own and closes it again when the next map arrives, the same
  way the quiet-reservoir-feed alert already works.

- **Dry land against banked water, as a chart.** The drought page now plots
  every drainage area as one point: how much of its land is in severe drought
  or worse across the bottom, how full its reservoirs are up the side. The two
  do not have to agree, and where they disagree is the whole point — an area
  to the right and high up is living on water banked in better years; one to
  the right and low has neither the rain nor the savings. An area with no
  reservoir reading is left out rather than drawn at the bottom, and the page
  says how many were left out.

- **The drought page can be narrowed.** Show only the areas with land in a
  chosen class or worse, and order them by severity, by emptiest reservoirs
  first, or by name. A sentence under the controls says what is being shown,
  and the address bar carries both choices, so a narrowed view can be shared.

- **The snowpack site table can be searched and narrowed.** Search by site
  name or county, filter to an elevation band — snow behaves differently high
  and low, so a single average mixes two seasons — and show only the sites
  with late data, or only the ones still sending values. All three combine,
  all three are in the address bar, and the sentence above the table says
  which are applied.

- **How the snow sites are spread on the chosen day.** A bar above the site
  table shows how many sites fell in each class, in the same colours and the
  same shape as the drought page's coverage bars. The average on the chart is
  one number over more than two hundred stations, and it cannot tell a region
  that is evenly poor from one where half the sites are bare and half are near
  normal. Those are different winters.

- **Reservoirs draw in less detail when you are far away.** Zoomed out, each
  reservoir is a plain circle: still sized by its capacity, still coloured by
  how full it is. Zoom past about one step in and the full drawing returns —
  the drop shadow, the outlined water level, the dashed ring on an old
  reading — at the same moment the names appear. One threshold, so the map
  gets more detailed in every way at once instead of piece by piece.

### Changed

- **Every label is set in Atkinson Hyperlegible Next.** It was drawn for the
  Braille Institute to be read by people with low vision: the characters that
  usually blur together at small sizes — capital I and lowercase l, 0 and O —
  are given clearly different shapes. Every name on these maps is small type
  over a detailed background, which is exactly what it is for.

- **The snowpack map has its own colours.** It ran brown for the driest
  through to teal for the wettest, replacing a red-to-blue scale that
  overlapped the storage map's — two of the five colours were the same in
  both. Brown to teal is the usual way of showing wet and dry, so the map
  reads without the legend, and every step stays visible over the background
  relief. The scale is one Esri publishes and has tested for colour blindness.

- **The snowpack map no longer shows reservoirs.** It already carries fourteen
  filled drainage areas and 217 measurement sites; adding sixty-nine named
  points on top buried the readings the page is for. They stay on the drought
  map, which has room for them, and they have their own map besides.

- **The credits name the right tools.** MapLibre and CARTO are gone — those
  were for a second map engine the site no longer runs. In their place: the
  Python libraries that turn the published measurements into everything the
  maps draw.

- **The snow and drought maps work like the storage map now.** Both had
  shipped as pictures: a background, some shapes, and one zoom button.
  They now carry the same tools in the same corner — zoom, home, full
  screen and a scale bar — refuse to be dragged out of the region, and
  stop at the same widest view. Pointing at anything on any of the three
  maps brings up a card that travels with the pointer: a reservoir gives
  how full it is and what that is a percent *of*, a drainage area gives
  its mean snow or its drought share with the storage banked in it, and a
  measurement site gives its reading beside the normal depth for the day.

- **The reservoirs are named on every map.** They appear on the snow and
  drought maps as small neutral points — no storage colours there, because
  each map keeps one colour language — so a reader can see which
  reservoirs sit in the basin at half its normal snow, or under the
  driest land, without matching two lists of names by eye.

- **The names come in as you zoom, not all at once.** State names carry
  the widest views and step aside; drainage-area names hold the middle;
  reservoir names arrive one zoom step in from where each map opens;
  county names last. A name is never larger than the shape it sits
  inside, and only the drainage-area names are bold. The result is that
  no view is a wall of text and no name is lost — the crowded ones step
  back and return as you zoom toward them.

- **State and county outlines on the drought map.** The drought map draws
  the whole national pattern, so it now says which land that pattern
  crosses. Both come from Esri's public boundary services rather than from
  files in this repository; the counties stay hidden until you are close
  enough for them to mean something, and if either service does not answer
  within eight seconds the map simply draws without it.

- **The drought page has its map.** A map card above the coverage bars draws
  the monitor's weekly national polygons in the monitor's own colours, with
  the fourteen drainage areas outlined over them — drought does not stop at
  the region's edge, so the wider pattern is drawn whole while the outlines
  say which land the figures describe. The polygons are the same committed
  weekly download the coverage shares were computed from, and the page
  refuses to draw them over figures from a different week. The map follows
  the color theme like the others, one degenerate sliver in a future weekly
  file cannot blank it, and if it cannot start the bars and table keep
  every share with a visible note.

- **The map background follows the color theme.** Both maps now open on the
  canvas that matches the page: light gray in the light theme, dark gray in
  the dark one, and they swap when the theme control is used. A background
  the reader has chosen from the storage map's gallery is a choice, and a
  theme change does not overrule it. The dark canvas serves without
  credentials like the two verified backgrounds, and its chain falls
  through to the light canvas if that ever changes.

- **The data reference documents everything the site publishes.** The
  drought coverage file joins the published-files list with all of its
  fields explained — the calculation method, the share of each drainage
  area's land in exactly each class, and the "this class or worse" sums —
  and a test holds the documentation to the committed file, field for
  field. Each file card now links to the page that displays it, and the
  snow card notes the per-site season timing the snowpack page draws.

- **Every snow site has its own season.** A new card on the snowpack page
  draws one measurement site's water year in inches, day by day, against
  the middle value for the same days in 1991 through 2020 — with the site's
  published normal season marked: when snow usually starts to build, its
  usual highest value, and when it has usually melted. The reader reaches a
  site through a grouped picker or by selecting its name in the site table,
  a shared link carries the choice, and the exact first-of-month values sit
  in a table behind the chart. A site whose normal timing the data service
  does not publish says so rather than inventing one.

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

- **Every map opens on the Oceans background.** It carries seafloor and
  land relief under a quiet set of labels, so the terrain the water sits
  in is visible — which the deliberately blank gray canvases could not
  show. The theme-matching canvases are kept as the next choice, so a
  reader on the dark page still gets a dark background if the preferred
  one is ever unavailable.

- **The snow and drought map cards are taller, and open on the drainage
  areas.** A wide, short card has to sit much further out to hold the same
  region, which had left both maps opening about a third further out than
  the storage map. They now open within half a zoom step of it.

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
