/*
 * What travels with a reader who moves between pages.
 *
 * Separate from `ui/page-header.ts`, which renders the bar, because this is
 * URL logic and not markup: the awkward cases are a link that spells the
 * drainage area the storage map's way and a link carrying both spellings,
 * and neither is testable through a module that pulls the component
 * library's stylesheet in on import.
 */

/**
 * The parameters that travel with a reader who moves between pages.
 *
 * `?area=` and `?level=` are each one parameter across the whole site by
 * design -- the three maps exist to be compared by flipping between them
 * (ADR-007), and a reader who has narrowed one map and lands on another
 * drawn wide has been given two answers to one question. The navigation is
 * where that promise was being broken: this table built static hrefs, so
 * every parameter was dropped on every click, and `?level=` in particular
 * was documented as shared while the bar silently discarded it.
 *
 * Only the parameters that mean the same thing everywhere are here. A
 * reservoir selection, a sort order, a chart measure and a storage class are
 * each about one page's own subject, and carrying them would be asserting
 * that the receiving page has the same subject.
 *
 * Written in this order rather than the order they appear in the address
 * bar, so the same view always produces the same link.
 */
const PORTABLE_PARAMS: readonly string[] = ["state", "area", "level"];

/**
 * The storage map spells the shared drainage area `drainage=`, and reads
 * `area=` as the older name (`state/url.ts`). Every other page spells it
 * `area=` and the snow and drought maps understand nothing else, so `area`
 * is the name that travels and the map's own spelling is translated on the
 * way out. Carrying `drainage=` verbatim would produce a link the snow map
 * opens wide.
 */
const PORTABLE_ALIASES: Readonly<Record<string, string>> = { drainage: "area" };

/**
 * The part of a search string that means the same thing on the next page.
 *
 * Returns "" rather than "?" when nothing is carried, so an untouched
 * dashboard still links to a clean address -- the same rule `url.ts`
 * follows, where a default is written as absence.
 */
export function portableSearch(search: string | null | undefined): string {
  const params = new URLSearchParams(String(search ?? "").replace(/^\?/, ""));
  const carried = new Map<string, string>();
  /* Canonical names first, then the aliases into whatever gap is left: a
   * link holding both `drainage=` and `area=` means what the page whose
   * canonical name it is means by it, which is how `stateFromSearch` reads
   * the same pair. */
  for (const name of PORTABLE_PARAMS) {
    const values = params.getAll(name).filter((value) => value !== "");
    /* Last wins among duplicates, matching `url.ts`'s `lastValue`. */
    const value = values[values.length - 1];
    if (value !== undefined) carried.set(name, value);
  }
  for (const [alias, name] of Object.entries(PORTABLE_ALIASES)) {
    if (carried.has(name)) continue;
    const values = params.getAll(alias).filter((value) => value !== "");
    const value = values[values.length - 1];
    if (value !== undefined) carried.set(name, value);
  }
  const parts = PORTABLE_PARAMS
    .filter((name) => carried.has(name))
    .map((name) => `${name}=${encodeURIComponent(carried.get(name) as string)}`);
  return parts.length ? `?${parts.join("&")}` : "";
}

/** A page's href with the carried parameters on it. */
export function linkHref(href: string, search: string): string {
  return search ? `${href}${search}` : href;
}

