import "@esri/calcite-components/main.css";
import { setAssetPath as setCalciteAssetPath } from "@esri/calcite-components";

import { installAnonymousAuthPolicy } from "./arcgis/basemaps";
import { loadDrainageAreas } from "./data/boundaries";
import { loadReservoirs } from "./data/load";
import { isLateForCadence, statewideRollup } from "./data/rollup";
import { describeReservoir } from "./state/detail";
import { createSelectionStore, findReservoir } from "./state/selection";
import { supportsDashboard } from "./state/shell";
import { loadMap, type MapController } from "./ui/map";
import {
  browserCapabilities,
  markSelectedInList,
  renderUnsupported,
  revealDetail,
  setDataState,
  setDetail,
  setReservoirList,
  setSummary,
  wirePanels
} from "./ui/shell";
import { renderShell } from "./ui/shell-template";
import { wireTheme } from "./ui/theme";
import type { Reservoir } from "./types";
import { storageColor } from "./viz/classes";
import { formatAcreFeet, formatDate, formatPercent } from "./viz/format";
import { headlinePercent } from "./viz/symbols";
import "./styles/app.css";

// Vite emits this entry inside /assets; using its parent makes Calcite's
// `assets/...` requests resolve to the small, versioned subset in public/assets.
setCalciteAssetPath(new URL(/* @vite-ignore */ "../", import.meta.url).href);

const rootCandidate = document.querySelector<HTMLElement>("#app");
if (!rootCandidate) throw new Error("Missing #app root");
const root: HTMLElement = rootCandidate;

const selection = createSelectionStore();

/* The headline scope: waterbodies that touch Utah, without Lake Powell,
 * whose 25 million acre-feet otherwise dominate every statewide number
 * (ADR-011). The map draws exactly the reservoirs the summary counts, so a
 * reader cannot find a point the totals do not include. */
function inScope(reservoirs: readonly Reservoir[]): Reservoir[] {
  return reservoirs.filter((reservoir) =>
    reservoir.intersects_utah && reservoir.name.trim().toLowerCase() !== "lake powell");
}

async function loadData(): Promise<Reservoir[] | null> {
  try {
    const data = await loadReservoirs();
    if (data.reservoirs.length === 0) {
      setDataState({ kind: "empty" });
      return null;
    }
    const rollup = statewideRollup(data.reservoirs, {
      geography: "utah",
      lakePowell: "exclude"
    });
    setSummary({
      percent: formatPercent(rollup.percentFull),
      storage: `${formatAcreFeet(rollup.storageAf)} acre-feet stored`,
      count: String(rollup.count),
      updated: `Published ${formatDate(data.generated_at.slice(0, 10))}`
    });
    setDataState({ kind: "ready", count: data.reservoir_count });
    return inScope(data.reservoirs);
  } catch (error) {
    console.error("Reservoir data failed validation or could not load:", error);
    setDataState({ kind: "error" });
    return null;
  }
}

/* The boundaries are context and are loaded on their own path: a missing or
 * malformed file leaves the reservoirs exactly where they are. */
async function loadContext(map: MapController | null): Promise<void> {
  if (!map) return;
  try {
    map.drawDrainageAreas(await loadDrainageAreas());
  } catch (error) {
    console.warn("Drainage-area boundaries are unavailable:", error);
  }
}

function wireSelection(reservoirs: readonly Reservoir[]): void {
  setReservoirList(
    reservoirs.map((reservoir) => ({
      name: reservoir.name,
      percent: formatPercent(headlinePercent(reservoir)),
      color: storageColor(headlinePercent(reservoir)),
      late: isLateForCadence(reservoir)
    })),
    (name) => selection.set(name, { source: "list" })
  );

  selection.subscribe((name) => {
    const reservoir = findReservoir(reservoirs, name);
    markSelectedInList(reservoir?.name ?? null);
    setDetail(reservoir
      ? describeReservoir(reservoir, storageColor(headlinePercent(reservoir)))
      : null);
    if (reservoir) revealDetail();
    // The readiness signal is written once, after the first draw; the
    // selection keeps changing after that, so the field is kept current
    // rather than left reporting the state the page loaded in.
    if (window.__dashboardReady) window.__dashboardReady.selected = reservoir?.name ?? null;
  });
}

if (!supportsDashboard(browserCapabilities())) {
  renderUnsupported(root);
} else {
  // This policy must precede renderShell and loadMap. It turns secured-resource
  // challenges into failures the basemap fallback can handle without a prompt.
  installAnonymousAuthPolicy((error) => {
    console.warn("Secured map resource refused:", error.url);
  });
  renderShell(root);
  wirePanels();
  wireTheme();

  const [reservoirs, map] = await Promise.all([loadData(), loadMap(selection)]);
  if (reservoirs) {
    wireSelection(reservoirs);
    map?.drawReservoirs(reservoirs);
  }
  await loadContext(map);

  /* One fact per field, and fields are only ever added (never removed or
   * re-pointed at an expression another field already reads): two fields
   * reading one expression is how a whole map layer was deleted without a
   * test noticing. */
  window.__dashboardReady = {
    engine: "arcgis-5",
    reservoirs: reservoirs?.length ?? 0,
    drawn: map?.status.reservoirsDrawn ?? 0,
    late: reservoirs?.filter(isLateForCadence).length ?? 0,
    basemap: map?.status.basemap ?? false,
    basemapDegraded: map?.status.basemapDegraded ?? false,
    masked: map?.status.masked ?? false,
    drainageAreas: map?.status.drainageAreas ?? 0,
    listItems: document.querySelectorAll("#start-panel .list-btn").length,
    selected: selection.get()
  };
}
