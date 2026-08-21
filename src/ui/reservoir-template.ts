/*
 * The one-reservoir page's frame, less everything the payload supplies.
 *
 * The same split `ui/methods-template.ts` makes: static structure and rule
 * text here, readings filled in by the entry point. The navigation is the
 * bar every page carries, so a reader who landed here from a shared link can
 * leave by the doors they already know.
 */
import "@esri/calcite-components/components/calcite-action";
import "@esri/calcite-components/components/calcite-navigation";

import { brandMarkup, pageLinksMarkup } from "./page-header";

/** The complete frame, less the reservoir. */
export function reservoirTemplate(search: string): string {
  return `
  <calcite-navigation class="reservoir-nav" aria-label="Primary navigation">
    ${brandMarkup(2, "reservoir")}
    ${pageLinksMarkup("reservoir", search)}
    <calcite-action id="theme-toggle" slot="content-end" text="Theme: system"
      icon="brightness" label="Change color theme"></calcite-action>
  </calcite-navigation>
  <main class="reservoir-main" id="reservoir-main" aria-busy="true"
    aria-live="polite">
    <p class="initial-loading">Loading reservoir details&hellip;</p>
  </main>
  <footer class="app-footer reservoir-footer">
    <a href="./data.html">Use the public data API</a> ·
    <a href="./terms.html">Terms and license</a>
  </footer>`;
}
