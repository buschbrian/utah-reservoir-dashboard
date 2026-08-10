import "@esri/calcite-components/components/calcite-action";
import "@esri/calcite-components/components/calcite-button";
import "@esri/calcite-components/components/calcite-loader";
import "@esri/calcite-components/components/calcite-navigation";
import "@esri/calcite-components/components/calcite-navigation-logo";
import "@esri/calcite-components/components/calcite-panel";
import "@esri/calcite-components/components/calcite-sheet";
import "@esri/calcite-components/components/calcite-shell";
import "@esri/calcite-components/components/calcite-shell-panel";

function panelContents(suffix: string): string {
  return `
    <div class="panel-copy">
      <p class="eyebrow">Current conditions</p>
      <p class="scope-copy">Utah waterbodies, excluding Lake Powell</p>
      <div class="data-state" data-suffix="${suffix}" role="status" aria-live="polite">
        <calcite-loader inline label="Loading reservoir data" scale="s"></calcite-loader>
        <span>Loading reservoir data&hellip;</span>
      </div>
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
      <section class="reservoir-list" aria-labelledby="list-${suffix}">
        <h3 id="list-${suffix}">Reservoirs</h3>
        <p class="list-hint">Choose a reservoir to see its details, on the map or in this list.</p>
        <div class="list-host" data-list="reservoirs" role="group"
          aria-labelledby="list-${suffix}"></div>
      </section>
      <section class="coming-soon" aria-labelledby="analysis-${suffix}">
        <h3 id="analysis-${suffix}">Analysis controls</h3>
        <p>Drainage-area filters and storage comparisons arrive in a later Phase 2 increment.</p>
        <calcite-button appearance="outline" disabled icon-start="sliders-horizontal" width="full">
          Filters coming soon
        </calcite-button>
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
        <calcite-navigation-logo slot="logo" heading="Utah Reservoir Dashboard"
          description="Modern preview" heading-level="1" icon="water-drop"></calcite-navigation-logo>
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
