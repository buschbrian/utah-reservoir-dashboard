import { loadReservoirs } from "./data/load";
import { statewideRollup } from "./data/rollup";
import { formatAcreFeet, formatDate, formatPercent } from "./viz/format";
import "./styles/app.css";

const root = document.querySelector<HTMLElement>("#app");
if (!root) throw new Error("Missing #app root");

try {
  const data = await loadReservoirs();
  const utahWithoutLakePowell = statewideRollup(data.reservoirs, {
    geography: "utah",
    lakePowell: "exclude"
  });
  const connected = statewideRollup(data.reservoirs, {
    geography: "connected",
    lakePowell: "include"
  });
  root.innerHTML = `
    <p class="eyebrow">Dashboard development check</p>
    <h1>The Utah reservoir data loaded correctly.</h1>
    <p class="intro">This page checks the data and the totals for the new dashboard.</p>
    <section class="metrics" aria-label="Reservoir data checks">
      <article class="metric"><span>Utah without Lake Powell</span>
        <strong>${formatPercent(utahWithoutLakePowell.percentFull)}</strong>
        <small>${formatAcreFeet(utahWithoutLakePowell.storageAf)} acre-feet for ${utahWithoutLakePowell.count} reservoirs</small></article>
      <article class="metric"><span>All connected reservoirs</span>
        <strong>${formatPercent(connected.percentFull)}</strong>
        <small>${formatAcreFeet(connected.storageAf)} acre-feet for ${connected.count} reservoirs</small></article>
      <article class="metric"><span>Reservoirs with late data</span>
        <strong>${connected.stale}</strong><small>Daily and monthly data use different update schedules.</small></article>
      <article class="metric"><span>Data update</span>
        <strong>${formatDate(data.generated_at.slice(0, 10))}</strong>
        <small>Reclamation: ${data.source_counts.rise} · Conservation Service: ${data.source_counts.awdb}</small></article>
    </section>
    <p class="status">This page checked ${data.reservoir_count} reservoir records. Open the
      <a href="./index.html">ArcGIS map</a>, the <a href="./maplibre/">MapLibre map</a>, or the
      <a href="./explore.html">statewide overview</a>.</p>`;
} catch (error) {
  console.error("Reservoir data check failed:", error);
  const heading = document.createElement("h1");
  heading.textContent = "The page cannot load the reservoir data.";
  const detail = document.createElement("p");
  detail.className = "status error";
  detail.textContent = "Reload the page. If the problem continues, try again later.";
  root.replaceChildren(heading, detail);
  throw error;
}
