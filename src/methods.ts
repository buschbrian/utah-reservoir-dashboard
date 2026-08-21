/*
 * Where the numbers come from, how they are collected, and how each one is
 * worked out.
 *
 * The facts here already existed in the repository -- in the refresh script,
 * in the README and in the decision records -- and nowhere a reader of the
 * published site could see them. The two legacy maps credit their providers
 * in the panel beside the map; the typed stack credited them only inside a
 * details panel that has to be opened one reservoir at a time.
 *
 * The publication date and the provider counts are read from the payload
 * rather than written here, for the same reason the map reads it: a page
 * that states a number about the data is a page that can be wrong about it.
 * Everything else on this page is a rule, not a reading, so it is text.
 *
 * ADR-006 applies to every word of it.
 */
import "@esri/calcite-components/main.css";
import { setAssetPath as setCalciteAssetPath } from "@esri/calcite-components";
import "@esri/calcite-components/components/calcite-action";
import "@esri/calcite-components/components/calcite-navigation";

import { loadReservoirs } from "./data/load";
import { sizeBasis } from "./data/rollup";
import { stateName } from "./data/state-vocabulary";
import type { Reservoir, ReservoirPayload } from "./types";
import { brandMarkup, pageLinksMarkup } from "./ui/page-header";
import { wireTheme } from "./ui/theme";
import { formatAcreFeet, formatDate, formatPercent } from "./viz/format";
import "./styles/methods.css";

setCalciteAssetPath(new URL(/* @vite-ignore */ "../", import.meta.url).href);
const root = document.querySelector<HTMLElement>("#methods-app");
if (!root) throw new Error("Missing #methods-app root");

root.innerHTML = `
  <calcite-navigation class="methods-nav" aria-label="Primary navigation">
    ${brandMarkup(2, "methods")}
    ${pageLinksMarkup("methods", window.location.search)}
    <calcite-action id="theme-toggle" slot="content-end" text="Theme: system"
      icon="brightness" label="Change color theme"></calcite-action>
  </calcite-navigation>
  <main class="methods-main">
    <header class="methods-intro">
      <p class="eyebrow">Methods and sources</p>
      <h1>How these numbers are made</h1>
      <aside class="methods-disclaimer" aria-labelledby="disclaimer-heading">
        <h2 id="disclaimer-heading">This is not an official product</h2>
        <p>This site is a personal open-source project. It is not made, endorsed, sponsored or checked by any government agency, any
        water district, or any other organization. It does not speak for any of
        them. Nothing on it is
          an official record.</p>
        <p>It reads public data services that anyone can use. It also names every source
        and identifier, so a reader can check any value here against the agency that
        published it. Where this site and an agency disagree, the agency is right.
          Do not use this site for an operating decision, a legal purpose, or anything
          where being wrong would matter — go to the publisher.</p>
        <p>It is also built in the open in another sense: much of the code is written
        by AI agents working from stated requirements. A person reviews every change,
        the change is tested, and the project's decision records keep it. The code, the daily pipeline and every decision behind them are public. A
        reader can follow how each number is made rather than take it on trust.</p>
      </aside>

      <p class="methods-lede">Every value on this site comes from a public agency. Most are
        instrument measurements: a reservoir's storage and a mountain site's snow are both
        read from a gauge. The drought map is different in kind. It is a weekly expert
        assessment, described <a href="#sources">below</a>, and it is labelled as one
        wherever it appears. The rest are figures worked out from those published values,
        by a rule written down below. Nothing here is predicted or smoothed.</p>
      <p class="methods-lede">Four things are worth reading before the numbers. These
        reservoirs are <a href="#limits">operated</a>, so storage reflects releases
        as well as weather. Snow and storage use
        <a href="#limits">different periods</a>. "Full" can mean
        <a href="#values">more than one kind of full level</a>. And a combined figure is
        <a href="#values">added up across readings taken on different days</a>.</p>
      <p class="methods-status" id="methods-status" role="status" aria-live="polite"
        aria-busy="true">Reading the published data&hellip;</p>
      <p><a href="./data.html">Use the public data API</a> to download the published
        reservoir, snow and reference files directly.</p>
    </header>

    <nav class="methods-toc" aria-label="On this page">
      <ul>
        <li><a href="#disclaimer-heading">This is not an official product</a></li>
        <li><a href="#sources">Where the numbers come from</a></li>
        <li><a href="#collection">How the data is collected</a></li>
        <li><a href="#values">How each value is worked out</a></li>
        <li><a href="#scope">Which reservoirs are included</a></li>
        <li><a href="#coverage">How complete this is</a></li>
        <li><a href="#limits">What this data cannot tell you</a></li>
        <li><a href="#credit">Credit</a></li>
      </ul>
    </nav>

    <section class="methods-section" id="sources" aria-labelledby="sources-heading">
      <h2 id="sources-heading">Where the numbers come from</h2>
      <p>Storage observations come from two federal programmes. Each reservoir record names the one it came from, with the identifier that
        requested it. Any value on this site therefore traces back to its publisher.</p>
      <dl class="methods-list">
        <dt>Bureau of Reclamation</dt>
        <dd>Daily storage for the larger reservoirs, through the agency's public data
          service. Read the source at
          <a href="https://data.usbr.gov/" target="_blank" rel="noreferrer">data.usbr.gov</a>.</dd>
        <dt>Natural Resources Conservation Service</dt>
        <dd>Daily and month-end storage for the rest of the statewide inventory, through
          the agency's public water and climate service. Read the source at
          <a href="https://wcc.sc.egov.usda.gov/awdbRestApi/swagger-ui.html"
            target="_blank" rel="noreferrer">the water and climate data service</a>.</dd>
        <dt>Full level for Bureau of Reclamation sites</dt>
        <dd>The U.S. Army Corps of Engineers National Inventory of Dams. The repository holds these figures rather than requesting them each morning. A
        full level is a property of the dam and does not change daily. Read the source at
          <a href="https://nid.sec.usace.army.mil/" target="_blank"
            rel="noreferrer">the National Inventory of Dams</a>.</dd>
        <dt>Full level for the other sites</dt>
        <dd>The reservoir details published by the Natural Resources Conservation Service
          alongside the storage readings.</dd>
        <dt>Snow measurements</dt>
        <dd>Daily snow water equivalent for the mountain sites on the snowpack page. It
        comes from the same Natural Resources Conservation Service water and climate
        service as the storage readings. Each reading is compared with the middle value for the
          same day in the years 1991 through 2020, the standard comparison period that
          service publishes.
          <br /><strong>A drainage area's snow figure is the plain average of the sites
          reporting in it, and every site counts once.</strong> It is a figure about the
          measuring sites, not a measure of the snow lying across the whole area. The sites
          are placed where snow can be measured reliably. That is neither evenly across the
          land nor evenly up the mountainside. An area with four sites and an area with
          thirty are each an average of what they have. Every area's figure is published
          with the number of sites reporting that day. No area is given a figure until at
          least two sites report.
          <br /><strong>Early and late in the season, a percent of normal means very
          little.</strong> In October the usual amount of snow for the date is close to
          zero. A small amount of new snow divided by it gives a very large percentage. On
          27 October 2025, 147 sites reported and the figure was 266% of normal, against a
          usual amount of about a quarter of an inch. There was almost no snow and almost
          no usual snow. Where the usual amount for the date is below one inch, this site
          leads with the depth of water in the snow instead. The season curve still draws
          the percentage, because that is where the shape of a season is read.</dd>
        <dt>Drought conditions</dt>
        <dd>The U.S. Drought Monitor's weekly national map, produced by the National
          Drought Mitigation Center with the U.S. Department of Agriculture and the
          National Oceanic and Atmospheric Administration.
          <br /><strong>The map is a judgement, not a reading.</strong> Authors draw it
          each week by weighing many kinds of evidence together. Those include rain and
          snow records, soil moisture and streamflow. They also include reservoir and
          groundwater levels, satellite pictures of vegetation, and reports from people on
          the ground. The authors then agree on where each class belongs. It is the most careful summary of drought available,
          and it is not a single instrument reading like the other numbers here.
          <br /><strong>The first class is not drought.</strong> D0 means abnormally dry.
          D1 to D4 are the drought classes, from moderate to exceptional. Where this site
          counts areas in drought, it counts D1 and worse, and any figure that includes D0
          says so.
          <br />The drawn areas are downloaded each week. The share of each drainage area's
          land in each class is worked out from them by this project. That share is this
          site's own calculation, not a figure the monitor publishes. Read the source at
          <a href="https://droughtmonitor.unl.edu/" target="_blank"
            rel="noreferrer">droughtmonitor.unl.edu</a>.</dd>
        <dt>Drainage areas</dt>
        <dd>The U.S. Geological Survey Watershed Boundary Dataset, at the six-digit level.
          Read the source at
          <a href="https://www.usgs.gov/national-hydrography/watershed-boundary-dataset"
            target="_blank" rel="noreferrer">the Watershed Boundary Dataset</a>.</dd>
        <dt>State outlines</dt>
        <dd>State boundaries drawn on the maps come from Esri's Living Atlas service,
          built from U.S. Census Bureau boundaries. Read the source at
          <a href="https://livingatlas.arcgis.com/" target="_blank"
            rel="noreferrer">livingatlas.arcgis.com</a>.</dd>
      </dl>
    </section>

    <section class="methods-section" id="collection" aria-labelledby="collection-heading">
      <h2 id="collection-heading">How the data is collected</h2>
      <ol class="methods-steps">
        <li><strong>Once every morning.</strong> A scheduled job starts at 12:00
        Coordinated Universal Time. That is 6 in the morning mountain daylight time, and 5
        in the morning mountain standard time. It asks each provider for the newest
        readings for every reservoir in the inventory.</li>
        <li><strong>Each reservoir is requested by a fixed identifier.</strong> The refresh script holds the identifiers and does not discover them at run
        time. It makes the same request every day, so a reservoir cannot quietly
        change meaning between one morning and the next.</li>
        <li><strong>A failed request is retried, then given up on.</strong> If a provider
          cannot be reached, the reservoir keeps its last known reading and is marked as
          having late data. It is never dropped from the map and its old value is never
          presented as today's.</li>
        <li><strong>Every value is checked before it is published.</strong> The complete
          payload is validated against the shape the pages expect. A payload that fails is
          not published, so the site keeps yesterday's numbers rather than showing
          something unchecked.</li>
        <li><strong>The published file is the release.</strong> The checked data is
          committed to the repository, and that commit is what publishes the site. There is
          no separate database, and no step between what was checked and what you are
          reading.</li>
        <li><strong>Reservoirs whose readings stop are reported in public.</strong> When a
          feed goes quiet the refresh opens an issue in the repository listing the affected
          reservoirs, and closes it again when they resume.</li>
      </ol>
      <p>The pages themselves fetch that file when they load. They never receive it as part
        of their own code, which is what lets the numbers change every morning without the
        site being rebuilt.</p>
    </section>

    <section class="methods-section" id="values" aria-labelledby="values-heading">
      <h2 id="values-heading">How each value is worked out</h2>
      <dl class="methods-list">
        <dt>Percent full</dt>
        <dd>Storage now, divided by the full level. The full level is the reservoir's
          capacity where a traceable capacity exists. Where it does not, the site uses the highest storage recorded since 2015
        instead. The reservoir details say which of the two the percentage measures
        against.</dd>
        <dt>Which full level</dt>
        <dd>Three different full levels reach this site, and they do not mean the same
          thing. A <strong>normal full level</strong> is the amount a reservoir is operated
          to hold. A <strong>maximum level</strong> includes storage above that, which is
          kept empty to catch a flood and is not meant to be occupied. A third group carries
          the full level the water and climate service publishes beside its readings. Each
          reservoir's details name the one used for it.
          <br />This matters most where it is least visible. A reservoir measured against
          a maximum level reads lower than the same reservoir measured against a normal
          one. So a combined percentage that adds the three kinds together is slightly
          lower than a single basis would give. Lake Powell is measured against a maximum
          level, which is why its share of any total it enters matters.
          <span data-live="basis-mix"></span>
          We publish the basis rather than silently converting between them, because
          converting would mean inventing numbers the dam owners have not published.</dd>
        <dt>Normal for this week</dt>
        <dd>The middle value of readings taken within seven days before or after the same
          date in earlier years. It answers "is this a normal amount of water for the time
          of year". Percent full on its own cannot: the same percentage means
          different things in April and in September.
          <br /><strong>You choose which years.</strong> The storage map has a "Compare against" control with two periods. Each
        reservoir says which one its number came from, and how many years stand behind
        it.
          <ul>
            <li><strong>1991 through 2020</strong> is the thirty-year period the World
              Meteorological Organization defines as standard, and the same period the
              mountain snow measurements use. The map opens on it. The site builds it once from the full provider records and keeps it in the
        repository. A middle value over a period that ended cannot change.</li>
            <li><strong>2015 through last year</strong> is every year this site collects.
              Those years were unusually dry here, so a reservoir can look ordinary against them and still be low.</li>
          </ul>
          <span data-live="climate-coverage"></span>
          The standard period is built from the full provider record, one reservoir at a
          time. The roster has grown faster than that record has been built. A reservoir
          without it says so in its details. It gives the other period's value instead of a
          middle value taken from three or four years. Some
          reservoirs are simply newer than the period: Jackson Flat's dam dates from
          2017.</dd>
        <dt>History rank</dt>
        <dd>How this reading compares with readings near the same date in earlier years.
          90% means it is higher than 90% of them. The current year is not counted against
          itself.
          <br />The record starts in 2015, so every rank rests on eight to eleven earlier
          years. That is a small number to take a position in, and two ranks a few points
          apart are not meaningfully different. Each reservoir's details give the number of
          years its own rank was taken from. Treat a rank as an indication of where a
          reading sits, not as a measurement.</dd>
        <dt>Change</dt>
        <dd>The difference between the newest reading and the reading nearest 7, 30 or 365
        days before it. Shown where the provider publishes often enough to support
        it.</dd>
        <dt>The last 12 months</dt>
        <dd>For each month, the average, lowest, highest and closing storage, and the normal
          value for that month against whichever period is selected. The chart in the
          reservoir details shows the average, and the percentages under it use the same
          full level the map colours by. A monthly normal value is the middle of that calendar month's average storage
        across the years in the period. A reservoir read once a month and one read
        every day therefore carry the same weight.</dd>
        <dt>Combined percentages</dt>
        <dd>Storage added up across reservoirs, divided by their full levels added up. A large reservoir therefore counts for more than a small one. That is why Lake
        Powell has its own control: it is large enough to hide local conditions inside
        a single total. The same is true of Lake Mead, which has its own control for the
        same reason. Both start included, and every page states which of the two the
        figure beside it holds.
          <br /><strong>A combined figure is the newest reading from each reservoir, and
          those readings were not all taken on the same day.</strong> Some providers
          publish every day and some publish once a month. So a total can hold yesterday's
          reading beside a month-end reading several weeks old. It is the newest picture
          available rather than a picture of one moment. Every page that shows a combined
          figure says how many reservoirs are behind it. It also says how much of the
          combined full level was read on time. And it gives the range of dates the
          readings span.
          <br /><strong>The full levels added up do not all mean the same thing.</strong>
          They are the three kinds described above. So the combined figure is storage
          against the full levels this site can trace. It is not storage against one single
          definition of full. Each page that shows one can say how that total divides
          between the three.</dd>
        <dt>Late data</dt>
        <dd>A reading is late when it is older than the schedule its provider publishes on.
        That is more than two days for daily readings, and more than 45 days for
        month-end readings.
          Late reservoirs stay on the map, marked, with the date of the reading they
          carry.</dd>
      </dl>
    </section>

    <section class="methods-section" id="terms" aria-labelledby="terms-heading">
      <h2 id="terms-heading">Meaning of terms</h2>
      <dl class="methods-list">
        <dt>Capacity</dt>
        <dd>The amount of water that a reservoir is designed to hold.</dd>
        <dt>Acre-foot</dt>
        <dd>A unit of water volume. One acre-foot covers one acre with water that is one
          foot deep.</dd>
        <dt>Update schedule</dt>
        <dd>How often a source supplies new data.</dd>
        <dt>CSV file</dt>
        <dd>A plain-text file that stores table data.</dd>
      </dl>
    </section>

    <section class="methods-section" id="scope" aria-labelledby="scope-heading">
      <h2 id="scope-heading">Which reservoirs are included</h2>
      <p><strong>A reservoir is placed in a drainage area by its dam or outlet point,
        not by the middle of its water surface.</strong> A large reservoir can cross a
        boundary, and what matters is where the stored water leaves it. That area is
        called the reservoir's <strong>outlet drainage area</strong> on this site.</p>
      <p><strong>An outlet drainage area is not the land that fills the reservoir.</strong>
        It is the area holding the dam, and it is used to put each reservoir in exactly one
        group. Large western reservoirs collect water from many areas upstream, and some
        also receive water carried in from another river system altogether. So this site
        sometimes shows a reservoir beside the snow or drought conditions of its own area.
        Read those as conditions near the dam. They are not a measure of everything that
        fills the reservoir.</p>
      <p>The maps draw every drainage area of the west. That is all the land that drains
        to the Pacific Ocean, and the Great Basin, whose water reaches no ocean at
        all. That is
        75 areas. Drought is measured for all of them.</p>
      <p>Each map offers two area sizes, and the reader chooses. Basins are the smaller
        of the two, 75 of them, and are what a map opens with. Subregions are larger and
        there are 44; each one holds whole basins, so nothing is split by the choice.
        Every figure on the page is measured again at the size chosen. The drought shares cover the larger areas, and the reservoir totals add up
        over them. The snow figures are the mean over the same measurement sites in a
        different grouping. No figure is an average of the smaller areas' figures.</p>
      <p><strong>A reservoir is included when one of the two federal programmes above
        publishes its storage, and this project can trace a full level for it.</strong>
        There is no separate geographic test beyond the west itself. The roster used to be
        narrower — a reservoir had to be connected to Utah by drainage — and it is not any
        more.</p>
      <p data-live="scope-counts" class="methods-live"></p>
      <p><strong>These are the reservoirs this site tracks. They are not all the stored
        water in the west.</strong> The two federal programmes cover the large federal
        projects well and cover other reservoirs unevenly. Several states publish their own
        reservoir records that this site does not yet read. A drainage area can therefore
        hold much more stored water than the total here shows. Read every combined figure on
        this site as a figure about the reservoirs it names.</p>
      <p>The maps and tables can narrow the list by state, and that filter follows the
        water. Where a reservoir's water reaches a state, it is counted in that state's
        list. That holds even when the provider's published point sits over the border.
        Utah is one of those choices, not the subject of the site.</p>
    </section>

    <section class="methods-section" id="coverage" aria-labelledby="coverage-heading">
      <h2 id="coverage-heading">How complete this is</h2>
      <p>The two federal programmes cover the large federal projects well. They cover
        everything else unevenly, so the reservoirs this site tracks and the stored water
        in a state are different quantities. In some states they are very different.</p>
      <p>The table says what this site holds for each state, and what it is known to be
        missing. A state is counted here the way the state filter counts it: where a
        reservoir's water reaches a state, it is in that state's row. So a reservoir on a
        border appears in two rows, and the rows do not add up to the roster.</p>
      <p><strong>"None found" does not mean complete.</strong> It means this project looked
        for another public source of current storage and did not find one. Each source
        below was requested and checked rather than taken from a description of it.</p>
      <div class="table-scroll" tabindex="0" role="region"
        aria-label="Coverage by state, scrolls sideways">
        <table class="methods-table" id="coverage-table">
          <thead><tr>
            <th scope="col">State</th>
            <th scope="col">Tracked</th>
            <th scope="col">Full level</th>
            <th scope="col">Standard period</th>
            <th scope="col">Known to be missing</th>
          </tr></thead>
          <tbody></tbody>
        </table>
      </div>
      <p class="methods-live" data-live="coverage-note"></p>
    </section>

    <section class="methods-section" id="limits" aria-labelledby="limits-heading">
      <h2 id="limits-heading">What this data cannot tell you</h2>
      <ul class="methods-plain">
        <li>These are the reservoirs this dashboard tracks, not all the water in a drainage
          area. Rivers, snowpack, groundwater and untracked reservoirs are not counted.</li>
        <li>Published values are provisional. A provider can revise a reading after the
          fact, and the next morning's refresh will carry the revision.</li>
        <li>A full level taken from the highest storage since 2015 is a floor, not a
        capacity. A reservoir that never filled in that period reads higher than it
        would against its true capacity.</li>
        <li><strong>The years you compare against change the answer, and by a lot.</strong>
          Lake Powell in August 2026 is at 44.6% of normal measured against 2015 through
          2025, and at 35.0% measured against 1991 through 2020. Both are correct. The
          second is the standard period; the first is measured against a decade of drought,
          which is a lower bar. The map opens on the standard period for that reason, and
          every comparison on the site names the years it used.</li>
        <li>The history rank is a separate measure and always uses the years this site
          collects, which start in 2015. It is not affected by the "Compare against"
          control. A rank therefore rests on eight to eleven years however the normal value
          beside it is measured.</li>
        <li>A full level taken from the highest storage since 2015 is still a floor rather
          than a capacity, whichever period the normal value uses. The two are different
          denominators answering different questions.</li>
        <li><strong>These reservoirs are operated, and much of what the numbers show is
          operation rather than weather.</strong> Water is released to meet downstream
          deliveries, power generation, environmental flows and obligations between states.
          A reservoir can fall through a wet month because it is releasing water, and hold
          steady through a dry one because it is not. Storage is the result of what arrived
          and what was let out, and this site publishes only the result. Do not read a
          falling reservoir as a drying watershed without checking what was released.</li>
        <li><strong>Storage and drought are not independent of each other.</strong> The
          Drought Monitor's authors already weigh water-supply conditions, including
          reservoir and streamflow records, when they draw the map. So a chart putting
          storage beside drought class shows how two related pictures line up. It is not a
          test of one against the other.</li>
        <li><strong>Storage and drought can disagree for good reasons.</strong> A reservoir
          holds water that arrived in earlier years, and receives water from land far
          upstream. It is emptied and filled by decisions, not by weather alone. A full
          reservoir in a dry area, or an empty one in a wet area, is an ordinary result
          rather than a contradiction.</li>
        <li><strong>The colours are display bands, not thresholds.</strong> The storage map
          divides percent full into equal bands so the map can be read at a glance. They do
          not mark a drought declaration, a shortage trigger, an operating rule or a safety
          level. The snow map's bands follow the comparison ranges the snow service
          commonly uses. One extra division is added so the highest values can be told
          apart.</li>
        <li><strong>This site measures water supply, not the health of a river or a
          lake.</strong> It carries three things: how much water is stored, how much is
          lying as mountain snow, and how dry the land is. A full reservoir is not a
          healthy river, and a dry drainage area is not a failing one. Water temperature,
          streamflow, groundwater, water quality and the condition of habitat are all
          absent, and nothing here should be read as standing in for them.</li>
        <li>Nothing here is a forecast. Every number is a measurement, a published
          assessment, or an arithmetic comparison of those.</li>
      </ul>
    </section>

    <section class="methods-section" id="credit" aria-labelledby="credit-heading">
      <h2 id="credit-heading">Credit</h2>
      <p><strong>Naming an organization below credits its work. It does not mean the
        organization is involved with this site, has checked it, or endorses it.</strong>
        None of them are, none of them have, and none of them do.</p>
      <p>This dashboard displays public data collected and published by others. The
        measurements are theirs; the presentation is this project's.</p>
      <ul class="methods-plain">
        <li><a href="https://data.usbr.gov/" target="_blank" rel="noreferrer">Bureau of
          Reclamation</a>, for the daily reservoir storage record.</li>
        <li><a href="https://wcc.sc.egov.usda.gov/" target="_blank"
          rel="noreferrer">Natural Resources Conservation Service</a>, for the statewide
          storage inventory and the snow measurements.</li>
        <li><a href="https://nid.sec.usace.army.mil/" target="_blank"
          rel="noreferrer">U.S. Army Corps of Engineers</a>, for the National Inventory
          of Dams.</li>
        <li><a href="https://www.usgs.gov/national-hydrography/watershed-boundary-dataset"
          target="_blank" rel="noreferrer">U.S. Geological Survey</a>, for the Watershed
          Boundary Dataset.</li>
        <li><a href="https://droughtmonitor.unl.edu/" target="_blank"
          rel="noreferrer">The National Drought Mitigation Center</a>, with the
          U.S. Department of Agriculture and the National Oceanic and Atmospheric
          Administration, for the U.S. Drought Monitor.</li>
        <li><a href="https://www.census.gov/" target="_blank" rel="noreferrer">U.S.
          Census Bureau</a>, for the state boundaries, published through Esri's Living
          Atlas.</li>
        <li><a href="https://developers.arcgis.com/javascript/" target="_blank"
          rel="noreferrer">Esri</a>, for the ArcGIS Maps SDK for JavaScript, the Calcite
          design system, the basemap services and the Living Atlas.</li>
        <li><a href="https://pandas.pydata.org/" target="_blank"
          rel="noreferrer">pandas</a> and <a href="https://numpy.org/" target="_blank"
          rel="noreferrer">NumPy</a>, for the work that turns the published
          measurements into the map data. Every daily storage record, every
          snow season and the share of each drainage area in each drought class
          are computed with them.</li>
        <li><a href="https://requests.readthedocs.io/" target="_blank"
          rel="noreferrer">Requests</a>, for every call to a data provider, and
          <a href="https://docs.pytest.org/" target="_blank" rel="noreferrer">pytest</a>,
          for the tests that hold the pipeline to its own arithmetic.</li>
        <li>The <a href="https://www.python.org/" target="_blank"
          rel="noreferrer">Python</a> community, whose freely given libraries do the
          part of this project that the maps only show.</li>
      </ul>
      <p>The complete source code, the daily refresh pipeline and every architecture
        decision record are public at
        <a href="https://github.com/buschbrian/western-water-dashboard" target="_blank"
          rel="noreferrer">github.com/buschbrian/western-water-dashboard</a>.
        The code is copyright &copy; 2026 Brian Busch, licensed for
        noncommercial use. The <a href="./terms.html">terms and license page</a>
        states what that means, and how to license the dashboard commercially.</p>
    </section>
  </main>`;
wireTheme();

/**
 * The one live fact on the page: when the data was published, and how many
 * reservoirs came from each provider.
 *
 * Every path clears `aria-busy`, the failure included. A page that keeps
 * announcing itself busy after the fetch has failed is telling a screen
 * reader to wait for something that is never coming.
 */
function providerCounts(
  reservoirs: readonly Reservoir[]
): { rise: number; awdb: number; cdec: number } {
  return {
    rise: reservoirs.filter((reservoir) => reservoir.source_key === "rise").length,
    awdb: reservoirs.filter((reservoir) => reservoir.source_key === "awdb").length,
    cdec: reservoirs.filter((reservoir) => reservoir.source_key === "cdec").length
  };
}

/**
 * The counts this page used to state in prose, read from the payload instead.
 *
 * Every one of them was written as a word -- "four reservoirs", "sixty-three of
 * the sixty-nine" -- and every one of them was wrong by the time it was read.
 * The roster went from 69 reservoirs to 198 without a single sentence here
 * changing, and the page went on telling readers that four reservoirs carried
 * seven tenths of the combined full level when fifteen carried a quarter of it.
 *
 * A count about the data belongs in a slot the data fills. The rules around
 * them stay as text, because a rule cannot drift.
 */
function fillLiveCounts(
  reservoirs: readonly Reservoir[], minimumBaselineYears: number
): void {
  const total = reservoirs.length;
  const fullLevel = reservoirs.reduce((sum, reservoir) => sum + sizeBasis(reservoir), 0);
  const shareOf = (rows: readonly Reservoir[]): string => formatPercent(
    fullLevel > 0 ? rows.reduce((sum, row) => sum + sizeBasis(row), 0) / fullLevel * 100 : null);

  const states = new Set(reservoirs.flatMap((reservoir) =>
    reservoir.waterbody_states ?? [reservoir.state]).filter(Boolean));
  const areas = new Set(reservoirs.map((reservoir) => reservoir.huc6).filter(Boolean));
  const maximum = reservoirs.filter((reservoir) => reservoir.capacity_basis === "max_storage");
  const withClimate = reservoirs.filter((reservoir) => {
    const climate = reservoir.baselines?.climate;
    return climate && climate.sample_years >= minimumBaselineYears;
  });

  const text: Record<string, string> = {
    "scope-counts":
      `Today that is ${total} reservoirs, in ${areas.size} drainage areas and `
      + `reaching ${states.size} states. Their full levels add up to `
      + `${formatAcreFeet(fullLevel)} acre-feet. Other drawn areas hold no `
      + "reservoir this site tracks.",
    "basis-mix":
      `Today ${maximum.length} of the ${total} reservoirs are measured against a maximum `
      + `level. They are ${shareOf(maximum)} of the combined full level every regional `
      + "percentage divides by.",
    "climate-coverage":
      `Today the standard period is available for ${withClimate.length} of the ${total} `
      + `reservoirs, holding ${shareOf(withClimate)} of the combined full level.`
  };
  for (const [name, value] of Object.entries(text)) {
    const element = document.querySelector<HTMLElement>(`[data-live="${name}"]`);
    if (element) element.textContent = value;
  }
}

/** The words for what a state's coverage was reviewed to be. */
const COVERAGE_STATUS: Record<string, string> = {
  "more to add": "More to add",
  "not machine readable": "Published, but not in a form a program can read",
  "none found": "None found",
  "not reviewed": "Not reviewed"
};

/**
 * What this roster holds for each state, beside what it is known to miss.
 *
 * The counts are the payload's own; the gaps are a reviewed judgement it
 * cannot contain. A dashboard that shows the first without the second is not
 * wrong in any single number and is misleading as a whole: California's row
 * reads eight reservoirs, and the state's own service publishes 154.
 *
 * The section is left empty rather than half-filled when a payload predates
 * the coverage block, because a table of counts with the gaps column missing
 * is exactly the impression this exists to prevent.
 */
function fillCoverage(payload: ReservoirPayload): void {
  const section = document.querySelector<HTMLElement>("#coverage");
  const body = document.querySelector<HTMLElement>("#coverage-table tbody");
  const states = payload.coverage?.states;
  if (!section || !body || !states || Object.keys(states).length === 0) {
    if (section) section.hidden = true;
    return;
  }
  const rows = Object.entries(states)
    .sort((a, b) => b[1].tracked_reference_capacity_af - a[1].tracked_reference_capacity_af);
  body.replaceChildren(...rows.map(([code, entry]) => {
    const missing = entry.known_additional_source
      ? `${COVERAGE_STATUS[entry.status] ?? entry.status}: `
        + `${entry.known_additional_source}`
        + (entry.known_additional_about
          ? `, about ${entry.known_additional_about} reservoirs` : "")
      : COVERAGE_STATUS[entry.status] ?? entry.status;
    const row = document.createElement("tr");
    for (const [text, isNumber] of [
      [stateName(code), false],
      [String(entry.tracked_reservoir_count), true],
      [`${formatAcreFeet(entry.tracked_reference_capacity_af)} acre-feet`, true],
      [`${entry.climate_baseline_count} of ${entry.tracked_reservoir_count}`, true],
      [missing, false]
    ] as [string, boolean][]) {
      const cell = document.createElement("td");
      cell.textContent = text;
      if (isNumber) cell.className = "methods-num";
      row.append(cell);
    }
    return row;
  }));
  const note = payload.coverage?.reviewed;
  const element = document.querySelector<HTMLElement>('[data-live="coverage-note"]');
  if (element && note) {
    element.textContent = `The sources were last reviewed on ${formatDate(note)}. `
      + "A reservoir whose water reaches two states is counted in both, so these "
      + "rows do not add up to the roster.";
  }
}

async function showPublishedData(): Promise<void> {
  const status = document.querySelector<HTMLElement>("#methods-status");
  if (!status) return;
  try {
    const data = await loadReservoirs();
    const counts = providerCounts(data.reservoirs);
    fillLiveCounts(data.reservoirs, data.climate_normals?.minimum_years ?? 0);
    fillCoverage(data);
    status.textContent =
      `The data on this site was published on ${formatDate(data.generated_at.slice(0, 10))}. ` +
      `It covers ${data.reservoirs.length} reservoirs. ` +
      `The Bureau of Reclamation measures ${counts.rise}. ` +
      `The Natural Resources Conservation Service measures ${counts.awdb}. ` +
      `The California Department of Water Resources measures ${counts.cdec}.`;
  } catch (error) {
    console.warn("The published data could not be read for the methods page:", error);
    /* The page is still worth reading without it -- everything else here is
     * a rule rather than a reading -- so this says what is missing and does
     * not pretend the whole page failed. */
    status.textContent = "The published data could not be read just now, "
      + "so the publication date is not shown. The methods below are unaffected.";
  } finally {
    status.setAttribute("aria-busy", "false");
    window.__methodsReady = { published: status.textContent !== "" };
  }
}

void showPublishedData();
