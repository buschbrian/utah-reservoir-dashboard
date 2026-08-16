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
import type { Reservoir } from "./types";
import { brandMarkup, pageLinksMarkup } from "./ui/page-header";
import { wireTheme } from "./ui/theme";
import { formatDate } from "./viz/format";
import "./styles/methods.css";

setCalciteAssetPath(new URL(/* @vite-ignore */ "../", import.meta.url).href);
const root = document.querySelector<HTMLElement>("#methods-app");
if (!root) throw new Error("Missing #methods-app root");

root.innerHTML = `
  <calcite-navigation class="methods-nav" aria-label="Primary navigation">
    ${brandMarkup(2)}
    ${pageLinksMarkup("methods")}
    <calcite-action id="theme-toggle" slot="content-end" text="Theme: system"
      icon="brightness" label="Change color theme"></calcite-action>
  </calcite-navigation>
  <main class="methods-main">
    <header class="methods-intro">
      <p class="eyebrow">Methods and sources</p>
      <h1>How these numbers are made</h1>
      <aside class="methods-disclaimer" aria-labelledby="disclaimer-heading">
        <h2 id="disclaimer-heading">This is not an official product</h2>
        <p>This site is a personal open-source project. It is not made, endorsed,
          sponsored or checked by any government agency, any water district, or any
          other organization, and it does not speak for any of them. Nothing on it is
          an official record.</p>
        <p>It reads public data services that anyone can use, and it names every source
          and identifier so any value here can be checked against the agency that
          published it. Where this site and an agency disagree, the agency is right.
          Do not use this site for an operating decision, a legal purpose, or anything
          where being wrong would matter — go to the publisher.</p>
        <p>It is also built in the open in another sense: much of the code is written
          by AI agents working from stated requirements, with every change reviewed by
          a person, tested, and recorded in the project's decision records. The code,
          the daily pipeline and every decision behind them are public, so the way each
          number is produced can be read rather than taken on trust.</p>
      </aside>

      <p class="methods-lede">Every value on this site is an observation published by a
        public agency, or something worked out from those observations by a rule written
        down below. Nothing here is modelled, predicted or smoothed.</p>
      <p class="methods-lede">Three things are worth reading before the numbers:
        these reservoirs are <a href="#limits">operated</a>, so storage reflects releases
        as well as weather; snow and storage are compared against
        <a href="#limits">different periods</a>; and "full" is measured against
        <a href="#values">more than one kind of full level</a>.</p>
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
        <li><a href="#limits">What this data cannot tell you</a></li>
        <li><a href="#credit">Credit</a></li>
      </ul>
    </nav>

    <section class="methods-section" id="sources" aria-labelledby="sources-heading">
      <h2 id="sources-heading">Where the numbers come from</h2>
      <p>Storage observations come from two federal programmes. Each reservoir record
        names the one it came from, together with the identifier used to request it, so
        any value on this site can be traced back to its publisher.</p>
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
        <dd>The U.S. Army Corps of Engineers National Inventory of Dams. These figures are
          committed to the repository rather than requested each morning, because a full
          level is a property of the dam and does not change daily. Read the source at
          <a href="https://nid.sec.usace.army.mil/" target="_blank"
            rel="noreferrer">the National Inventory of Dams</a>.</dd>
        <dt>Full level for the other sites</dt>
        <dd>The reservoir details published by the Natural Resources Conservation Service
          alongside the storage readings.</dd>
        <dt>Snow measurements</dt>
        <dd>Daily snow water equivalent for the mountain sites on the snowpack page, from
          the same Natural Resources Conservation Service water and climate service the
          storage readings use. Each reading is compared with the middle value for the
          same day in the years 1991 through 2020, the standard comparison period that
          service publishes.</dd>
        <dt>Drought conditions</dt>
        <dd>The U.S. Drought Monitor's weekly national map, produced by the National
          Drought Mitigation Center with the U.S. Department of Agriculture and the
          National Oceanic and Atmospheric Administration. The polygons are downloaded
          each week, and the share of each drainage area's land in each class is
          calculated from them and published beside them. Read the source at
          <a href="https://droughtmonitor.unl.edu/" target="_blank"
            rel="noreferrer">droughtmonitor.unl.edu</a>.</dd>
        <dt>Drainage areas</dt>
        <dd>The U.S. Geological Survey Watershed Boundary Dataset, at the six-digit level.
          Read the source at
          <a href="https://www.usgs.gov/national-hydrography/watershed-boundary-dataset"
            target="_blank" rel="noreferrer">the Watershed Boundary Dataset</a>.</dd>
        <dt>State outline</dt>
        <dd>The Utah Geospatial Resource Center's maintained Utah State Boundary. It draws
          the shaded area on the map and decides which reservoirs count as reaching Utah.
          Read the source at
          <a href="https://gis.utah.gov/" target="_blank" rel="noreferrer">gis.utah.gov</a>.</dd>
      </dl>
    </section>

    <section class="methods-section" id="collection" aria-labelledby="collection-heading">
      <h2 id="collection-heading">How the data is collected</h2>
      <ol class="methods-steps">
        <li><strong>Once every morning.</strong> A scheduled job runs at 5 in the morning,
          mountain standard time, and asks each provider for the newest readings for every
          reservoir in the inventory.</li>
        <li><strong>Each reservoir is requested by a fixed identifier.</strong> The
          identifiers are held in the refresh script and are not discovered at run time, so
          the same request is made every day and a reservoir cannot quietly change meaning
          between one morning and the next.</li>
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
          capacity where a traceable capacity exists. Where it does not, the highest storage
          recorded since 2015 is used instead, and the reservoir details say which of the
          two the percentage is measured against.</dd>
        <dt>Which full level</dt>
        <dd>Three different full levels reach this site, and they do not mean the same
          thing. A <strong>normal full level</strong> is the amount a reservoir is operated
          to hold. A <strong>maximum level</strong> includes storage above that, which is
          kept empty to catch a flood and is not meant to be occupied. A third group carries
          the full level the water and climate service publishes beside its readings. Each
          reservoir's details name the one used for it.
          <br />This matters most where it is least visible. Four reservoirs are measured
          against a maximum level, and because Lake Powell is one of them, those four make up
          about seven tenths of the combined full level that every regional percentage is
          divided by. A reservoir measured against a maximum level reads lower than the same
          reservoir measured against a normal one, so combined figures on this site are
          slightly lower than they would be if one basis were used throughout. We publish the
          basis rather than silently converting between them, because converting would mean
          inventing numbers the dam owners have not published.</dd>
        <dt>Normal for this week</dt>
        <dd>The middle value of readings from 2015 through the year before the current
          reading, taken within seven days before or after the same date. It answers "is
          this a normal amount of water for the time of year", which percent full on its
          own cannot: the same percentage means different things in April and in
          September.</dd>
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
          days before it, where the provider publishes often enough to support it.</dd>
        <dt>The last 12 months</dt>
        <dd>For each month, the average, lowest, highest and closing storage, and the normal
          value for that month. The chart in the reservoir details shows the average, and
          the percentages under it use the same full level the map colours by.</dd>
        <dt>Combined percentages</dt>
        <dd>Storage added up across reservoirs, divided by their full levels added up. A
          large reservoir therefore counts for more than a small one, which is why Lake
          Powell can be added and removed: it is large enough to hide local conditions
          inside a single total.</dd>
        <dt>Late data</dt>
        <dd>A reading is late when it is older than the schedule its provider publishes on:
          more than two days for daily readings, more than 45 days for month-end readings.
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
      <p>A reservoir is placed in a drainage area by its dam or outlet point, not by the
        middle of its water surface. A large reservoir can cross a boundary, and what
        matters is where the stored water leaves it.</p>
      <p>A drainage area is included when it touches Utah and belongs to the Colorado River
        or Great Basin systems. Areas that drain to the Columbia River system are excluded,
        because water stored in them never reaches Utah.</p>
      <p>This admits connected reservoirs that sit outside the state, and the map offers
        both readings: Utah waterbodies alone, or every connected reservoir. Where a
        reservoir's water reaches Utah, it is counted as a Utah waterbody even when the
        provider's published point sits over the border.</p>
    </section>

    <section class="methods-section" id="limits" aria-labelledby="limits-heading">
      <h2 id="limits-heading">What this data cannot tell you</h2>
      <ul class="methods-plain">
        <li>These are the reservoirs this dashboard tracks, not all the water in a drainage
          area. Rivers, snowpack, groundwater and untracked reservoirs are not counted.</li>
        <li>Published values are provisional. A provider can revise a reading after the
          fact, and the next morning's refresh will carry the revision.</li>
        <li>A full level taken from the highest storage since 2015 is a floor, not a
          capacity: a reservoir that has never filled during that period will read higher
          than it would against its true capacity.</li>
        <li>The storage record starts in 2015, and those years were predominantly dry in
          this region. A normal built from this record is a dry-period normal. A reservoir
          near 100% of that normal is near normal for a dry period, not near its long-term
          average.</li>
        <li><strong>Storage and snow are compared against different periods, and the two
          numbers are not equivalent.</strong> Snow is compared with 1991 through 2020, the
          thirty-year period the measuring service publishes and the standard length for a
          climate comparison. Storage is compared with 2015 onward, because that is where
          the storage record this site collects begins. So "snow at 70% of normal" is
          measured against thirty years including wet ones, while "storage near normal" is
          measured against eleven mostly dry ones. Storage will therefore tend to look
          better against its normal than snow does against its own. Read each against its
          own period, and do not read one as confirming the other.</li>
        <li><strong>These reservoirs are operated, and much of what the numbers show is
          operation rather than weather.</strong> Water is released to meet downstream
          deliveries, power generation, environmental flows and obligations between states.
          A reservoir can fall through a wet month because it is releasing water, and hold
          steady through a dry one because it is not. Storage is the result of what arrived
          and what was let out, and this site publishes only the result. Do not read a
          falling reservoir as a drying watershed without checking what was released.</li>
        <li>Nothing here is a forecast. Every number is a measurement or an arithmetic
          comparison of measurements.</li>
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
        <li><a href="https://gis.utah.gov/" target="_blank" rel="noreferrer">Utah
          Geospatial Resource Center</a>, for the maintained state boundary.</li>
        <li><a href="https://developers.arcgis.com/javascript/" target="_blank"
          rel="noreferrer">Esri</a>, for the ArcGIS Maps SDK for JavaScript, the Calcite
          design system and the basemap services.</li>
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
        <a href="https://github.com/buschbrian/utah-reservoir-dashboard" target="_blank"
          rel="noreferrer">github.com/buschbrian/utah-reservoir-dashboard</a>.</p>
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
function providerCounts(reservoirs: readonly Reservoir[]): { rise: number; awdb: number } {
  return {
    rise: reservoirs.filter((reservoir) => reservoir.source_key === "rise").length,
    awdb: reservoirs.filter((reservoir) => reservoir.source_key === "awdb").length
  };
}

async function showPublishedData(): Promise<void> {
  const status = document.querySelector<HTMLElement>("#methods-status");
  if (!status) return;
  try {
    const data = await loadReservoirs();
    const counts = providerCounts(data.reservoirs);
    status.textContent =
      `The data on this site was published on ${formatDate(data.generated_at.slice(0, 10))}. ` +
      `It covers ${data.reservoirs.length} reservoirs: ${counts.rise} measured by the ` +
      `Bureau of Reclamation and ${counts.awdb} by the Natural Resources Conservation Service.`;
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
