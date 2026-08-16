/*
 * The navigation bar every page carries, in one place.
 *
 * Three pages render this bar. Written out three times it would be three
 * answers to "what is this site and what else is in it", and the first one
 * to be edited would be the one nobody noticed had drifted -- which is how
 * the SDK name came to sit under the title on one page and beside it on
 * another.
 *
 * Every string here is inside a template literal, so a backtick anywhere,
 * including in an HTML comment, ends it and turns the rest into code.
 */
import "@esri/calcite-components/components/calcite-action";
import "@esri/calcite-components/components/calcite-button";
import "@esri/calcite-components/components/calcite-dropdown";
import "@esri/calcite-components/components/calcite-dropdown-group";
import "@esri/calcite-components/components/calcite-dropdown-item";
import "@esri/calcite-components/components/calcite-icon";

export type PageId = "map" | "overview" | "snow" | "methods" | "data";

interface PageLink {
  id: PageId;
  href: string;
  icon: string;
  /** What the button says. Hidden below 64rem, where the menu takes over. */
  text: string;
  /** What the menu item says, which has room for more than the button does. */
  menuText: string;
  /** What a screen reader announces for the icon-only button. */
  label: string;
}

/**
 * Every page a reader can reach from the bar, in one table.
 *
 * The menu and the buttons are generated from it, so the two cannot offer
 * different sets -- a link added to one and forgotten in the other is a page
 * that exists only above or only below 64rem.
 */
const PAGES: readonly PageLink[] = [
  {
    id: "map", href: "./", icon: "map",
    text: "Storage map", menuText: "Storage map", label: "Open the storage map"
  },
  {
    id: "overview", href: "./overview.html", icon: "table",
    text: "Storage charts", menuText: "Storage charts",
    label: "Open the storage charts and table"
  },
  {
    id: "snow", href: "./snow.html", icon: "snow",
    text: "Snowpack", menuText: "Snowpack",
    label: "Open the mountain snowpack view"
  },
  {
    id: "methods", href: "./methods.html", icon: "question",
    text: "Methods", menuText: "Methods and sources",
    label: "Open methods and sources"
  }
] as const;

/**
 * The product mark and the two names, stacked.
 *
 * Our own markup rather than calcite-navigation-logo: that component lays
 * its description attribute out against the full 64px bar, which left an
 * 11px gap under the heading and put the subtitle on the bottom edge. The
 * arrangement that replaced it moved the SDK name into its own horizontal
 * slot, where it cost about 180px of a bar that clips whatever does not fit.
 *
 * ADR-016 requires the official SDK name in the navigation, and this is it.
 */
export function brandMarkup(headingLevel: 1 | 2): string {
  const tag = `h${headingLevel}`;
  return `
    <div id="brand" slot="logo">
      <calcite-icon icon="water-drop" scale="l" aria-hidden="true"></calcite-icon>
      <span class="brand-text">
        <${tag} id="brand-title" aria-label="Utah Reservoir Dashboard">
          <span class="brand-title-wide" aria-hidden="true">Utah Reservoir Dashboard</span>
          <span class="brand-title-narrow" aria-hidden="true">Utah Reservoirs</span>
        </${tag}>
        <span id="sdk-name">ArcGIS Maps SDK for JavaScript</span>
      </span>
    </div>`;
}

/**
 * The links to the other pages: a menu below 64rem, buttons above it.
 *
 * The current page is in the menu and out of the buttons. It stays in the
 * menu because a menu that changes length as you move around it is harder to
 * use than one that does not, and it carries aria-current there so the
 * reader is told which one they are on rather than left to notice a gap.
 */
export function pageLinksMarkup(current: PageId): string {
  const others = PAGES.filter((page) => page.id !== current);
  const items = PAGES.map((page) => `
        <calcite-dropdown-item id="menu-${page.id}-link" href="${page.href}"
          icon-start="${page.icon}"${page.id === current ? ' selected aria-current="page"' : ""}
          >${page.menuText}</calcite-dropdown-item>`).join("");
  const buttons = others.map((page) => `
    <calcite-button id="${page.id}-link" class="page-link" slot="content-end" href="${page.href}"
      appearance="transparent" kind="neutral" icon-start="${page.icon}"
      label="${page.label}"><span class="page-link-text">${page.text}</span></calcite-button>`).join("");

  return `
    <calcite-dropdown id="page-menu" slot="content-end" placement="bottom-end" scale="m">
      <calcite-action slot="trigger" id="page-menu-trigger" icon="hamburger"
        text="Pages" label="Open the page menu"></calcite-action>
      <calcite-dropdown-group group-title="Pages">${items}
      </calcite-dropdown-group>
    </calcite-dropdown>${buttons}`;
}
