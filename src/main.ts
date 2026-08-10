import "@esri/calcite-components/main.css";
import { setAssetPath as setCalciteAssetPath } from "@esri/calcite-components";

import { installAnonymousAuthPolicy } from "./arcgis/basemaps";
import { loadReservoirs } from "./data/load";
import { statewideRollup } from "./data/rollup";
import { supportsDashboard } from "./state/shell";
import { loadMap } from "./ui/map";
import {
  browserCapabilities,
  renderUnsupported,
  setDataState,
  setSummary,
  wirePanels
} from "./ui/shell";
import { renderShell } from "./ui/shell-template";
import { wireTheme } from "./ui/theme";
import { formatAcreFeet, formatDate, formatPercent } from "./viz/format";
import "./styles/app.css";

// Vite emits this entry inside /assets; using its parent makes Calcite's
// `assets/...` requests resolve to the small, versioned subset in public/assets.
setCalciteAssetPath(new URL(/* @vite-ignore */ "../", import.meta.url).href);

const rootCandidate = document.querySelector<HTMLElement>("#app");
if (!rootCandidate) throw new Error("Missing #app root");
const root: HTMLElement = rootCandidate;

async function loadData(): Promise<void> {
  try {
    const data = await loadReservoirs();
    if (data.reservoirs.length === 0) {
      setDataState({ kind: "empty" });
      return;
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
  } catch (error) {
    console.error("Reservoir data failed validation or could not load:", error);
    setDataState({ kind: "error" });
  }
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
  await Promise.all([loadData(), loadMap()]);
}
