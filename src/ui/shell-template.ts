/*
 * Every string in this file is inside a JavaScript template literal, so a
 * backtick anywhere -- including in an HTML comment -- ends it and turns the
 * rest of the markup into code. Write names in plain words here.
 */
import "@esri/calcite-components/components/calcite-action";
import "@esri/calcite-components/components/calcite-button";
import "@esri/calcite-components/components/calcite-label";
import "@esri/calcite-components/components/calcite-loader";
import "@esri/calcite-components/components/calcite-option";
import "@esri/calcite-components/components/calcite-select";
import "@esri/calcite-components/components/calcite-slider";
import "@esri/calcite-components/components/calcite-switch";
import "@esri/calcite-components/components/calcite-navigation";
import "@esri/calcite-components/components/calcite-panel";
import "@esri/calcite-components/components/calcite-sheet";
import "@esri/calcite-components/components/calcite-shell";
import "@esri/calcite-components/components/calcite-shell-panel";

import { brandMarkup, pageLinksMarkup } from "./page-header";

function panelContents(suffix: string): string {
  return `
    <div class="panel-copy">
      <!-- The data state is a place for a problem to appear, not a receipt
           for a successful load: it carries the loading message and any
           error, and takes itself out of the panel once the data is in.
           Empty here on purpose: setDataState fills it from
           describeDataState, so the words a reader sees have one source.
           They used to be written here as well, which left the state
           machine's own loading copy unreachable and free to drift. -->
      <div class="data-state" data-suffix="${suffix}" role="status" aria-live="polite"></div>
      <p class="scope-copy" data-value="scope"></p>
      <section class="summary" aria-label="Current storage summary" hidden>
        <div class="summary-stat">
          <span>Storage</span><strong data-value="percent">—</strong>
          <small data-value="storage">—</small>
        </div>
        <div class="summary-stat">
          <span>Reservoirs</span><strong data-value="count">—</strong>
          <small data-value="updated">—</small>
        </div>
      </section>
      <!-- The key to the map, above the controls that change it: a reader
           meeting the circles for the first time needs to know what they
           mean before being asked to filter them. Filled by renderLegend
           from the class table, never written out here (ADR-008). -->
      <section class="legend" aria-labelledby="legend-${suffix}">
        <h3 id="legend-${suffix}">What the circles mean</h3>
        <div class="legend-host" data-legend="${suffix}"></div>
      </section>
      <!-- Before the list, not after it. The list scrolls inside its own
           box, so controls placed below it sat behind a nested scroller --
           238px below the fold on a desktop panel and 815px down a phone
           sheet. Controls come before the thing they control. -->
      <section class="filters" aria-labelledby="analysis-${suffix}">
        <h3 id="analysis-${suffix}">Analysis controls</h3>
        <calcite-label>
          Storage level
          <calcite-select data-filter="storage"
            label="Filter reservoirs by storage level"></calcite-select>
        </calcite-label>
        <calcite-label>
          Reporting
          <calcite-select data-filter="reporting"
            label="Filter reservoirs by reporting status"></calcite-select>
        </calcite-label>
        <!-- A filter, not a scope: choosing one drainage area greys the rest
             and leaves every total alone, so the reader reads one area
             against the whole map rather than instead of it. -->
        <calcite-label>
          Drainage area
          <calcite-select data-filter="drainage"
            label="Filter reservoirs by drainage area"></calcite-select>
        </calcite-label>
        <!-- Scope, not a filter, and separated from the two above because of
             that: the filters grey reservoirs the map still draws, while these
             change which reservoirs the map has (ADR-011). Both of that
             record's dimensions, both the reader's to choose. -->
        <calcite-label>
          Reservoirs
          <calcite-select data-scope="geography"
            label="Which reservoirs to show">
            <calcite-option value="utah">Utah waterbodies</calcite-option>
            <calcite-option value="connected">All connected reservoirs</calcite-option>
          </calcite-select>
        </calcite-label>
        <calcite-label layout="inline-space-between">
          Include Lake Powell
          <calcite-switch data-scope="powell"
            label="Include Lake Powell in every total"></calcite-switch>
        </calcite-label>
        <!-- Which period "normal" means. Not a filter and not a scope: it
             changes nothing about which reservoirs are drawn, only what the
             details panel compares them against. It lives here because it is
             the reader's choice and this is where the reader's choices are,
             and it carries its own sentence because the two periods answer
             genuinely different questions. -->
        <calcite-label>
          Compare against
          <calcite-select data-baseline="period"
            label="Which years to compare each reservoir against"></calcite-select>
        </calcite-label>
        <p class="baseline-note" data-baseline="note"></p>
        <p class="filter-summary" data-filter="summary" role="status" aria-live="polite"></p>
        <calcite-button data-filter="reset" appearance="outline" icon-start="erase"
          width="full" hidden>
          Show all reservoirs
        </calcite-button>
        <calcite-button data-share="copy" appearance="outline" width="full">
          Copy link to this view
        </calcite-button>
      </section>
      <!-- The twelve months already in the payload. A Calcite slider rather
           than the SDK's time slider: that component drives time-enabled
           layer features, and this layer is one feature per reservoir with
           the months in a side lookup, because neither engine will carry a
           nested array on a feature. -->
      <section class="months" aria-labelledby="months-${suffix}">
        <h3 id="months-${suffix}">Storage over the last year</h3>
        <p class="month-current" data-month="label" role="status" aria-live="polite"></p>
        <calcite-slider data-month="slider" min="0" max="12" step="1" value="12"
          label="Month to show"></calcite-slider>
        <calcite-button data-month="now" appearance="outline" icon-start="rotate"
          width="full" scale="s" hidden>
          Back to the newest reading
        </calcite-button>
      </section>
      <section class="reservoir-list" aria-labelledby="list-${suffix}">
        <h3 id="list-${suffix}">Reservoirs</h3>
        <p class="list-hint">Choose a reservoir to see its details, on the map or in this list.</p>
        <div class="list-host" data-list="reservoirs" role="group"
          aria-labelledby="list-${suffix}"></div>
      </section>
      <footer class="app-footer"><a href="./data.html">Use the public data API</a></footer>
    </div>`;
}

function detailContents(suffix: string): string {
  return `
    <div class="panel-copy detail-copy" data-detail="${suffix}" aria-live="polite">
      <div class="detail-placeholder">
        <p class="eyebrow">Reservoir details</p>
        <h2 id="detail-${suffix}">No reservoir selected</h2>
        <p>Choose a reservoir on the map, or in the list in the storage summary.</p>
        <a href="./overview.html">Browse every reservoir in the current overview</a>
      </div>
    </div>`;
}

export function renderShell(root: HTMLElement): void {
  root.innerHTML = `
    <a class="skip-link" href="#map-host">Skip to the reservoir map</a>
    <calcite-shell id="dashboard-shell" content-behind>
      <calcite-navigation slot="header" aria-label="Primary navigation">
        ${brandMarkup(1, "map")}
        ${pageLinksMarkup("map")}
        <!-- Icon only. With their text these were 152px and 145px in a bar
             whose contents have to fit inside the viewport, spent on two
             words each that the panel they open repeats as its own heading.
             The label attribute is what a screen reader announces either way. -->
        <calcite-action id="controls-toggle" slot="content-end" text="Storage summary"
          icon="sliders-horizontal" label="Show or hide the storage summary"></calcite-action>
        <calcite-action id="detail-toggle" slot="content-end" text="Reservoir details"
          icon="information" label="Show or hide the reservoir details"></calcite-action>
        <calcite-action id="table-toggle" slot="content-end" text="Table and chart"
          icon="table" label="Show or hide the reservoir table and chart"></calcite-action>
        <calcite-action id="theme-toggle" slot="content-end" text="Theme: system"
          icon="brightness" label="Change color theme"></calcite-action>
      </calcite-navigation>

      <calcite-shell-panel id="start-panel" slot="panel-start" width="m">
        <calcite-panel heading="Storage summary" heading-level="2">
          ${panelContents("desktop")}
        </calcite-panel>
      </calcite-shell-panel>

      <section class="map-stage" aria-labelledby="map-heading">
        <h2 id="map-heading" class="visually-hidden">Reservoir map</h2>
        <div id="map-host" aria-busy="true">
          <div class="map-state" role="status" aria-live="polite">
            <calcite-loader label="Loading map"></calcite-loader>
            <p>Loading the map&hellip;</p>
          </div>
        </div>
        <div id="map-hover" class="map-hover" aria-hidden="true" hidden></div>
      </section>

      <!-- The numbers behind the circles, under the map rather than beside
           it: the columns need the width, and the map keeps its height
           whenever the row is closed. Closed is the default -- this is a map
           first, and a reader who wants the table asks for it from the
           header, or arrives on a link that already says table=open.

           A shell panel laid out horizontally, not the shell center row the
           Phase 2 sketch named: that component does not exist in Calcite 5.
           The panel-bottom slot is what the shell publishes for this, and it
           takes a shell panel like the two beside the map, which is why this
           one collapses the same way they do rather than needing a rule of
           its own. -->
      <calcite-shell-panel id="table-row" slot="panel-bottom" layout="horizontal"
        height="m" position="end" collapsed>
        <calcite-panel heading="Reservoir table and chart" heading-level="2">
          <calcite-action id="table-close" slot="header-actions-end" icon="x"
            text="Close the table and chart" label="Close the table and chart"></calcite-action>
          <div class="table-copy">
            <div class="bottom-row">
              <!-- Phase 4's layer-driven ranking chart. Built from the same
                   rows the table renders and the CSV export writes, so the
                   three surfaces in this row are one filter answered three
                   ways. The chart itself is loaded and drawn only once the
                   reader opens the row: the charts package is the heaviest
                   optional part of the application, and a closed row is not
                   a reason to pay for it. -->
              <section class="ranking-region" aria-labelledby="ranking-heading">
                <div class="ranking-head">
                  <h3 id="ranking-heading">How full each reservoir is</h3>
                  <p class="ranking-caption" data-ranking="caption"></p>
                </div>
                <div class="ranking-scroll" tabindex="0" role="region"
                  aria-label="Ranking chart, scrolls down">
                  <div class="ranking-host" data-ranking="host" aria-busy="false"></div>
                </div>
              </section>
              <section class="table-region" aria-labelledby="table-region-heading">
                <h3 id="table-region-heading" class="visually-hidden">Reservoir table</h3>
                <!-- Before the rows, not after them. The rows scroll inside
                     their own box, so a control placed below them sits behind a
                     nested scroller -- the same trap the analysis controls were
                     moved out of above the reservoir list. -->
                <div class="table-tools">
                  <p class="table-caption" data-table="caption" role="status" aria-live="polite"></p>
                  <calcite-button data-table="export" appearance="outline" icon-start="export"
                    scale="s">
                    Download these rows (CSV file)
                  </calcite-button>
                </div>
                <!-- Its own scroller. The page is tested at 360px and may not
                     scroll sideways at any width, and six columns of numbers
                     will not fit there however they are styled. -->
                <div class="table-scroll" data-table="rows" tabindex="0" role="region"
                  aria-label="Reservoir table, scrolls sideways"></div>
              </section>
            </div>
          </div>
        </calcite-panel>
      </calcite-shell-panel>

      <calcite-shell-panel id="detail-panel" slot="panel-end" width="m" collapsed>
        <calcite-panel heading="Reservoir details" heading-level="2">
          ${detailContents("desktop")}
        </calcite-panel>
      </calcite-shell-panel>

      <calcite-sheet id="start-sheet" slot="sheets" label="Storage summary"
        position="block-end" height="m">
        <calcite-panel heading="Storage summary" heading-level="2">
          <calcite-action id="start-sheet-close" slot="header-actions-end" icon="x"
            text="Close storage summary" label="Close storage summary"></calcite-action>
          ${panelContents("mobile")}
        </calcite-panel>
      </calcite-sheet>
      <calcite-sheet id="detail-sheet" slot="sheets" label="Reservoir details"
        position="block-end" height="m">
        <calcite-panel heading="Reservoir details" heading-level="2">
          <calcite-action id="detail-sheet-close" slot="header-actions-end" icon="x"
            text="Close reservoir details" label="Close reservoir details"></calcite-action>
          ${detailContents("mobile")}
        </calcite-panel>
      </calcite-sheet>
    </calcite-shell>`;
}
