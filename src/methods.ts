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
      <p class="methods-lede">Every value on this site is an observation published by a
        public agency, or something worked out from those observations by a rule written
        down below. Nothing here is modelled, predicted or smoothed.</p>
      <p class="methods-status" id="methods-status" role="status" aria-live="polite"
        aria-busy="true">Reading the published data&hellip;</p>
      <p><a href="./data.html">Use the public data API</a> to download the published
        reservoir, snow and reference files directly.</p>
    </header>

    <nav class="methods-toc" aria-label="On this page">
      <ul>
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
          level is a property of the dam and does not change daily.</dd>
        <dt>Full level for the other sites</dt>
        <dd>The reservoir details published by the Natural Resources Conservation Service
          alongside the storage readings.</dd>
        <dt>Drainage areas</dt>
        <dd>The U.S. Geological Survey Watershed Boundary Dataset, at the six-digit level.</dd>
        <dt>State outline</dt>
        <dd>The Utah Geospatial Resource Center's maintained Utah State Boundary. It draws
          the shaded area on the map and decides which reservoirs count as reaching Utah.</dd>
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
        <dt>Normal for this week</dt>
        <dd>The middle value of readings from 2015 through the year before the current
          reading, taken within seven days before or after the same date. It answers "is
          this a normal amount of water for the time of year", which percent full on its
          own cannot: the same percentage means different things in April and in
          September.</dd>
        <dt>History rank</dt>
        <dd>How this reading compares with readings near the same date in earlier years.
          90% means it is higher than 90% of them. The current year is not counted against
          itself.</dd>
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
        <li>Nothing here is a forecast. Every number is a measurement or an arithmetic
          comparison of measurements.</li>
      </ul>
    </section>

    <section class="methods-section" id="credit" aria-labelledby="credit-heading">
      <h2 id="credit-heading">Credit</h2>
      <p>This dashboard displays public data collected and published by others. The
        measurements are theirs; the presentation is this project's.</p>
      <ul class="methods-plain">
        <li>Bureau of Reclamation, for the daily reservoir storage record.</li>
        <li>Natural Resources Conservation Service, for the statewide storage inventory.</li>
        <li>U.S. Army Corps of Engineers, for the National Inventory of Dams.</li>
        <li>U.S. Geological Survey, for the Watershed Boundary Dataset.</li>
        <li>Utah Geospatial Resource Center, for the maintained state boundary.</li>
        <li>Esri, for the ArcGIS Maps SDK for JavaScript, the Calcite design system and the
          basemap services.</li>
        <li>MapLibre and CARTO, for the second map engine kept alongside this one for
          comparison.</li>
      </ul>
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
