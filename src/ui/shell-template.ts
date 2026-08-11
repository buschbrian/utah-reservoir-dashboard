import "@esri/calcite-components/components/calcite-action";
import "@esri/calcite-components/components/calcite-button";
import "@esri/calcite-components/components/calcite-label";
import "@esri/calcite-components/components/calcite-loader";
import "@esri/calcite-components/components/calcite-option";
import "@esri/calcite-components/components/calcite-select";
import "@esri/calcite-components/components/calcite-navigation";
import "@esri/calcite-components/components/calcite-navigation-logo";
import "@esri/calcite-components/components/calcite-panel";
import "@esri/calcite-components/components/calcite-sheet";
import "@esri/calcite-components/components/calcite-shell";
import "@esri/calcite-components/components/calcite-shell-panel";

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
            label="Filter reservoirs by reporting state"></calcite-select>
        </calcite-label>
        <!-- Scope, not a filter, and separated from the two above because of
             that: the filters grey reservoirs the map still draws, while this
             changes which reservoirs the map has (ADR-011). -->
        <calcite-label>
          Lake Powell
          <calcite-select data-filter="scope"
            label="Include or exclude Lake Powell">
            <calcite-option value="exclude">Excluded</calcite-option>
            <calcite-option value="include">Included</calcite-option>
          </calcite-select>
        </calcite-label>
        <p class="filter-summary" data-filter="summary" role="status" aria-live="polite"></p>
        <calcite-button data-filter="reset" appearance="outline" icon-start="erase"
          width="full" hidden>
          Show all reservoirs
        </calcite-button>
      </section>
      <section class="reservoir-list" aria-labelledby="list-${suffix}">
        <h3 id="list-${suffix}">Reservoirs</h3>
        <p class="list-hint">Choose a reservoir to see its details, on the map or in this list.</p>
        <div class="list-host" data-list="reservoirs" role="group"
          aria-labelledby="list-${suffix}"></div>
      </section>
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
        <!-- The product name is a sibling of the logo rather than the logo's
             own description attribute (ADR-016 still requires the official
             name in the navigation). Calcite lays that description out
             against the full 64px bar, which left an 11px gap under the
             heading and put the subtitle hard on the bottom edge. -->
        <calcite-navigation-logo slot="logo" heading="Utah Reservoir Dashboard"
          heading-level="1" icon="water-drop"></calcite-navigation-logo>
        <!-- Only the product name here. The scope and the publication date
             went in too and pushed the theme control to x=1366 in a 1280
             viewport: this bar clips rather than scrolls, so anything that
             does not fit is not merely ugly, it is unreachable. -->
        <div id="header-facts" slot="content-start">
          <span id="sdk-name">ArcGIS Maps SDK for JavaScript</span>
        </div>
        <calcite-button id="overview-link" slot="content-end" href="./overview.html"
          appearance="transparent" kind="neutral" icon-start="table"
          label="Open reservoir table and charts">
          <span class="overview-link-text">Table and charts</span>
        </calcite-button>
        <calcite-action id="controls-toggle" slot="content-end" text="Storage summary"
          text-enabled icon="sliders-horizontal" active></calcite-action>
        <calcite-action id="detail-toggle" slot="content-end" text="Reservoir details"
          text-enabled icon="information"></calcite-action>
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
