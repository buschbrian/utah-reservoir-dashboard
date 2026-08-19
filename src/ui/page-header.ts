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
import { linkHref, portableSearch } from "../state/portable-url";

export type PageId = "map" | "overview" | "snow" | "drought" | "methods" | "data";

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
 * What each page is, said in full.
 *
 * Separate from the table above because the two lists are not the same list.
 * `PAGES` is what appears in the bar, and the public data documentation is
 * deliberately not in it — but it is still a page a reader can be on, and it
 * still needs a name for a browser tab. Keying this by `PageId` rather than
 * building it from `PAGES` is what lets the two differ without either one
 * quietly losing an entry.
 *
 * These are longer than the bar's button text on purpose. The navigation
 * clips rather than scrolls, so "Snowpack" is all that fits beside the other
 * buttons; "Western Snowpack" is what a tab, a bookmark or a shared link
 * needs, where there is no bar around it to supply the context.
 */
const PAGE_SUBJECTS: Record<PageId, string> = {
  map: "Western Reservoir Storage",
  overview: "Western Storage Charts",
  snow: "Western Snowpack",
  drought: "Western Drought",
  methods: "Methods and Sources",
  data: "Public Data API"
};

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
    id: "drought", href: "./drought.html", icon: "gauge",
    text: "Drought", menuText: "Drought",
    label: "Open the weekly drought conditions"
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
/**
 * The site's name.
 *
 * It was "Utah Reservoir Dashboard", which was accurate when reservoirs were
 * all there was, then "Utah Water Dashboard" once mountain snow and the
 * weekly drought map joined the storage. The site has since expanded west
 * (ADR-053, ADR-063): it publishes drought coverage for 75 drainage areas
 * across regions 14-18 and snow for 637 sites across 51 areas in 11 states,
 * while only the reservoir roster stays Utah-connected. "Utah" now describes
 * a fraction of it.
 */
export const SITE_NAME = "Western Water Dashboard";
/** The same name where the bar is too narrow for the whole of it. */
export const SITE_NAME_SHORT = "Western Water";

/** What a page calls itself in a browser tab, a bookmark or a shared link. */
export function pageTitle(current: PageId): string {
  return `${PAGE_SUBJECTS[current]} — ${SITE_NAME}`;
}

/**
 * The product mark, the site name, and what this page is.
 *
 * Our own markup rather than calcite-navigation-logo: that component lays
 * its description attribute out against the full 64px bar, which left an
 * 11px gap under the heading and put the subtitle on the bottom edge. The
 * arrangement that replaced it moved the SDK name into its own horizontal
 * slot, where it cost about 180px of a bar that clips whatever does not fit.
 *
 * The heading names the page and not the site, which is the way round it
 * should always have been: every page's `h1` was "Utah Reservoir Dashboard",
 * the name this site once carried, so a reader moving between five surfaces
 * was told the same thing five times and never which one they were on. The
 * site name stays above it as ordinary text, because the site is the context
 * and the page is the subject.
 *
 * ADR-016 requires the official SDK name in the navigation, and this is it.
 */
export function brandMarkup(headingLevel: 1 | 2, current: PageId): string {
  const tag = `h${headingLevel}`;
  const subject = PAGE_SUBJECTS[current];
  return `
    <div id="brand" slot="logo">
      <calcite-icon icon="water-drop" scale="l" aria-hidden="true"></calcite-icon>
      <span class="brand-text">
        <span id="site-name">
          <span class="brand-title-wide" aria-hidden="true">${SITE_NAME}</span>
          <span class="brand-title-narrow" aria-hidden="true">${SITE_NAME_SHORT}</span>
        </span>
        <${tag} id="brand-title">${subject}</${tag}>
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
export function pageLinksMarkup(current: PageId, search: string = ""): string {
  const carried = portableSearch(search);
  const others = PAGES.filter((page) => page.id !== current);
  const items = PAGES.map((page) => `
        <calcite-dropdown-item id="menu-${page.id}-link" href="${linkHref(page.href, carried)}"
          icon-start="${page.icon}"${page.id === current ? ' selected aria-current="page"' : ""}
          >${page.menuText}</calcite-dropdown-item>`).join("");
  const buttons = others.map((page) => `
    <calcite-button id="${page.id}-link" class="page-link" slot="content-end" href="${linkHref(page.href, carried)}"
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

/**
 * Brings the bar's links up to date with the address bar.
 *
 * The markup above is rendered once, and a reader who narrows the map after
 * that is changing the address bar without reloading -- `writeUrlState` uses
 * `replaceState` deliberately, so there is no navigation and no re-render to
 * hang this on. Without this the bar would carry whatever was in the URL at
 * first paint, which is worse than carrying nothing: a link that was right
 * when the page opened and is quietly wrong by the time it is clicked.
 *
 * Reads the ids the markup writes rather than a class, so a link this does
 * not know about is left alone instead of having a query appended to it.
 */
export function updatePageLinks(search: string): void {
  const carried = portableSearch(search);
  for (const page of PAGES) {
    for (const id of [`${page.id}-link`, `menu-${page.id}-link`]) {
      document.getElementById(id)?.setAttribute("href", linkHref(page.href, carried));
    }
  }
}
