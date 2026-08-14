import "@esri/calcite-components/main.css";
import { setAssetPath as setCalciteAssetPath } from "@esri/calcite-components";
import "@esri/calcite-components/components/calcite-action";
import "@esri/calcite-components/components/calcite-navigation";

import {
  REFERENCE_GROUPS,
  RESERVOIR_GROUPS,
  SNOW_GROUPS,
  type ApiFieldGroup
} from "./data-docs-schema";
import { brandMarkup, pageLinksMarkup } from "./ui/page-header";
import { wireTheme } from "./ui/theme";
import "./styles/data-docs.css";

setCalciteAssetPath(new URL(/* @vite-ignore */ "../", import.meta.url).href);
const root = document.querySelector<HTMLElement>("#data-docs-app");
if (!root) throw new Error("Missing #data-docs-app root");

const base = "https://buschbrian.github.io/utah-reservoir-dashboard/api";

root.innerHTML = `
  <calcite-navigation class="methods-nav" aria-label="Primary navigation">
    ${brandMarkup(2)}
    ${pageLinksMarkup("data")}
    <calcite-action id="theme-toggle" slot="content-end" text="Theme: system"
      icon="brightness" label="Change color theme"></calcite-action>
  </calcite-navigation>
  <main class="methods-main api-main">
    <header class="methods-intro">
      <p class="eyebrow">Public data API</p>
      <h1>Use the published dashboard data</h1>
      <p class="methods-lede">These JSON files are the same checked files the dashboard
        reads. The stable API paths are copies made during the site build, not separate
        datasets.</p>
    </header>

    <nav class="methods-toc" aria-label="On this page">
      <ul>
        <li><a href="#files">Published files</a></li>
        <li><a href="#reservoir-fields">Reservoir fields</a></li>
        <li><a href="#snow-fields">Snow fields</a></li>
        <li><a href="#reference-fields">Reference fields</a></li>
        <li><a href="#examples">Examples</a></li>
        <li><a href="#access">Browser access and terms</a></li>
      </ul>
    </nav>

    <section class="methods-section" id="files" aria-labelledby="files-heading">
      <h2 id="files-heading">Published files</h2>
      <article class="api-file">
        <h3>Reservoir storage</h3>
        <p><a href="./api/reservoirs.json"><code>/api/reservoirs.json</code></a></p>
        <p>Current storage, changes, weekly comparisons, 12-month histories, provider
          details and drainage-area assignments. Structure version 1. Refreshed each
          morning. If one provider request fails, the last good reservoir record stays in
          the file and is marked as late data. A broadly failed run does not replace the
          last published file.</p>
      </article>
      <article class="api-file">
        <h3>Snow monitoring</h3>
        <p><a href="./api/snowpack.json"><code>/api/snowpack.json</code></a></p>
        <p>Daily site readings and drainage-area summaries for the current water year,
          compared with the 1991–2020 standard climate period. Structure version 1.
          Refreshed independently each morning. An incomplete provider response does not
          replace the last complete file.</p>
      </article>
      <article class="api-file">
        <h3>Capacity and geography reference</h3>
        <p><a href="./api/reference.json"><code>/api/reference.json</code></a></p>
        <p>Reviewed full levels, dam-point evidence, Utah boundaries and named
          drainage-area scopes. Structure version 1. Updated when reviewed source data
          changes, not on the daily observation schedule. If a source cannot be checked,
          the last published reference file remains available.</p>
      </article>
    </section>

    <section class="methods-section api-fields" id="reservoir-fields"
      aria-labelledby="reservoir-fields-heading">
      <h2 id="reservoir-fields-heading">Reservoir fields</h2>
    </section>
    <section class="methods-section api-fields" id="snow-fields"
      aria-labelledby="snow-fields-heading">
      <h2 id="snow-fields-heading">Snow fields</h2>
    </section>
    <section class="methods-section api-fields" id="reference-fields"
      aria-labelledby="reference-fields-heading">
      <h2 id="reference-fields-heading">Reference fields</h2>
      <p>Boundary collections follow GeoJSON. Coordinate pairs are longitude, latitude in
        decimal degrees.</p>
    </section>

    <section class="methods-section" id="examples" aria-labelledby="examples-heading">
      <h2 id="examples-heading">Examples</h2>
      <h3>Browser JavaScript</h3>
      <pre><code>const response = await fetch("${base}/reservoirs.json");
if (!response.ok) throw new Error(&#96;Request failed: \${response.status}&#96;);
const data = await response.json();
console.log(data.reservoirs);</code></pre>
      <h3>Python</h3>
      <pre><code>import requests

response = requests.get("${base}/reservoirs.json", timeout=30)
response.raise_for_status()
data = response.json()
print(data["reservoirs"])</code></pre>
    </section>

    <section class="methods-section" id="access" aria-labelledby="access-heading">
      <h2 id="access-heading">Browser access and terms</h2>
      <p>GitHub Pages returned <code>Access-Control-Allow-Origin: *</code> for all three
        files when checked on August 14, 2026. A browser application on another origin can
        fetch them directly. Responses can be cached for up to 10 minutes, so a newly
        published file may not appear at every edge immediately.</p>
      <ul class="methods-plain">
        <li>This site republishes public data from the agencies named in each file.</li>
        <li>Values are provisional and their publisher can revise them.</li>
        <li>There is no uptime guarantee or service-level agreement.</li>
        <li>Consumers should check the structure version and tolerate null values.</li>
      </ul>
    </section>
  </main>`;

function renderGroups(hostId: string, groups: readonly ApiFieldGroup[]): void {
  const host = document.querySelector<HTMLElement>(`#${hostId}`);
  if (!host) return;
  for (const group of groups) {
    const section = document.createElement("section");
    section.className = "api-field-group";
    const heading = document.createElement("h3");
    heading.textContent = group.title;
    const path = document.createElement("p");
    path.className = "api-path";
    const code = document.createElement("code");
    code.textContent = group.path;
    path.append("Path: ", code);

    const wrapper = document.createElement("div");
    wrapper.className = "api-table-scroll";
    const table = document.createElement("table");
    table.className = "api-table";
    table.innerHTML = "<thead><tr><th>Field</th><th>Units or type</th><th>Meaning</th></tr></thead>";
    const body = document.createElement("tbody");
    for (const field of group.fields) {
      const row = document.createElement("tr");
      const name = document.createElement("th");
      name.scope = "row";
      const fieldCode = document.createElement("code");
      fieldCode.textContent = field.key;
      name.append(fieldCode);
      const units = document.createElement("td");
      units.textContent = field.units;
      const meaning = document.createElement("td");
      meaning.textContent = `${field.meaning}${field.optional ? " This field appears only when needed." : ""}`;
      row.append(name, units, meaning);
      body.append(row);
    }
    table.append(body);
    wrapper.append(table);
    section.append(heading, path, wrapper);
    host.append(section);
  }
}

renderGroups("reservoir-fields", RESERVOIR_GROUPS);
renderGroups("snow-fields", SNOW_GROUPS);
renderGroups("reference-fields", REFERENCE_GROUPS);
wireTheme();

window.__dataDocsReady = {
  files: document.querySelectorAll(".api-file").length,
  groups: RESERVOIR_GROUPS.length + SNOW_GROUPS.length + REFERENCE_GROUPS.length
};
