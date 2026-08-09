import { loadReservoirs } from "./data/load";
import { statewideRollup } from "./data/rollup";
import { formatAcreFeet, formatDate, formatPercent } from "./viz/format";
import "./styles/app.css";

const root = document.querySelector<HTMLElement>("#app");
if (!root) throw new Error("Missing #app root");

try {
  const data = await loadReservoirs();
  const statewide = statewideRollup(data.reservoirs, { excludeLakePowell: true });
  const all = statewideRollup(data.reservoirs);
  root.innerHTML = `
    <p class="eyebrow">Phase 0–1 workbench</p>
    <h1>Utah reservoir data, now typed and validated.</h1>
    <p class="intro">This parallel entry proves the new runtime-data boundary and rollup modules
      before the current dashboards are replaced. The ArcGIS 5.1 + Calcite shell comes next.</p>
    <section class="metrics" aria-label="Modernization data checks">
      <article class="metric"><span>Utah statewide · no Powell</span>
        <strong>${formatPercent(statewide.percentFull)}</strong>
        <small>${formatAcreFeet(statewide.storageAf)} af across ${statewide.count} reservoirs</small></article>
      <article class="metric"><span>All monitored</span>
        <strong>${formatPercent(all.percentFull)}</strong>
        <small>${formatAcreFeet(all.storageAf)} af across ${all.count} reservoirs</small></article>
      <article class="metric"><span>Source cadence late</span>
        <strong>${all.stale}</strong><small>daily and monthly thresholds are evaluated separately</small></article>
      <article class="metric"><span>Generated</span>
        <strong>${formatDate(data.generated_at.slice(0, 10))}</strong>
        <small>${data.source_counts.rise} RISE + ${data.source_counts.awdb} AWDB</small></article>
    </section>
    <p class="status">Validated ${data.reservoir_count} records at runtime. Existing dashboards remain
      available at <a href="./index.html">ArcGIS 4.34</a>, <a href="./maplibre/">MapLibre</a>, and
      <a href="./explore.html">Overview</a>.</p>`;
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  const heading = document.createElement("h1");
  heading.textContent = "Modernization data check failed";
  const detail = document.createElement("p");
  detail.className = "status error";
  detail.textContent = message;
  root.replaceChildren(heading, detail);
  throw error;
}
