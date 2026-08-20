/* Which answer wins when a link and a remembered choice both arrive at one
 * page, and what happens to a remembered choice the site has outgrown. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  forgetPlaceIfEmpty,
  readStoredPlace,
  resolveOpeningPlace,
  writeStoredPlace
} from "./opening-preference";

const KEY = "utah-reservoir-dashboard-place";

function useMemoryStorage(): Map<string, string> {
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key)
  });
  return store;
}

beforeEach(() => { useMemoryStorage(); });
afterEach(() => { vi.unstubAllGlobals(); });

describe("which answer wins", () => {
  it("takes the link over a stored choice", () => {
    // A link is one person showing another a thing. It has to show them it.
    const place = resolveOpeningPlace("?state=CO", { state: "UT", area: null });
    expect(place.selection).toEqual({ state: "CO", area: null });
    expect(place.source).toBe("link");
  });

  it("lets a link say everywhere out loud, over a stored choice", () => {
    /* The reason `all` is writable at all: with a place stored, an absent
     * `state=` cannot mean "the whole west" any more, so there has to be a
     * way to say it. */
    const place = resolveOpeningPlace("?state=all", { state: "UT", area: null });
    expect(place.selection).toEqual({ state: "all", area: null });
    expect(place.source).toBe("link");
  });

  it("takes the stored choice when the address bar says nothing", () => {
    const place = resolveOpeningPlace("", { state: "ID", area: "1601" });
    expect(place.selection).toEqual({ state: "ID", area: "1601" });
    expect(place.source).toBe("stored");
  });

  it("opens on everywhere when neither has an answer", () => {
    const place = resolveOpeningPlace("", null);
    expect(place.selection).toEqual({ state: "all", area: null });
    expect(place.source).toBe("default");
  });

  it("treats an unreadable link as no answer, so a stored choice still stands", () => {
    /* `?state=ZZ` is not a state and `?area=12345` is an odd width. Neither
     * is a narrower request; both are no request, and the reader's own
     * choice should not be thrown away by someone else's typo. */
    for (const search of ["?state=ZZ", "?area=12345", "?state=", "?area="]) {
      const place = resolveOpeningPlace(search, { state: "UT", area: null });
      expect(place.source, search).toBe("stored");
      expect(place.selection, search).toEqual({ state: "UT", area: null });
    }
  });

  it("reads an area-only link as an answer", () => {
    const place = resolveOpeningPlace("?area=14", { state: "UT", area: null });
    expect(place.source).toBe("link");
    expect(place.selection).toEqual({ state: "all", area: "14" });
  });
});

describe("what is remembered", () => {
  it("round-trips a place", () => {
    writeStoredPlace({ state: "CO", area: "1401" });
    expect(readStoredPlace()).toEqual({ state: "CO", area: "1401" });
  });

  it("stores no preference as no key, not as a value", () => {
    const store = useMemoryStorage();
    writeStoredPlace({ state: "CO", area: null });
    expect(store.has(KEY)).toBe(true);
    writeStoredPlace({ state: "all", area: null });
    expect(store.has(KEY)).toBe(false);
    expect(readStoredPlace()).toBeNull();
  });

  it("refuses a stored value it would not accept from a link", () => {
    /* Storage is not a trusted source: an older version of this site wrote
     * it, or the reader edited it, and it goes straight into a filter. */
    const store = useMemoryStorage();
    for (const raw of [
      "not json", "null", "[]", '"CO"',
      '{"state":"ZZ","area":null}',
      '{"state":"all","area":"12345"}',
      '{"state":"all","area":null}'
    ]) {
      store.set(KEY, raw);
      expect(readStoredPlace(), raw).toBeNull();
    }
  });

  it("keeps the half of a stored value that is readable", () => {
    const store = useMemoryStorage();
    store.set(KEY, '{"state":"UT","area":"nonsense"}');
    expect(readStoredPlace()).toEqual({ state: "UT", area: null });
  });

  it("survives storage that throws rather than answers", () => {
    // Cookies blocked, a private window at quota: still has to draw a page.
    vi.stubGlobal("localStorage", {
      getItem: () => { throw new Error("denied"); },
      setItem: () => { throw new Error("denied"); },
      removeItem: () => { throw new Error("denied"); }
    });
    expect(readStoredPlace()).toBeNull();
    expect(() => { writeStoredPlace({ state: "UT", area: null }); }).not.toThrow();
  });
});

describe("a stored place the site has outgrown", () => {
  it("is forgotten when the surface it opened found nothing", () => {
    const store = useMemoryStorage();
    writeStoredPlace({ state: "UT", area: null });
    const forgotten = forgetPlaceIfEmpty(
      { selection: { state: "UT", area: null }, source: "stored" }, false);
    expect(forgotten).toBe(true);
    expect(store.has(KEY)).toBe(false);
  });

  it("is kept when the surface found something", () => {
    const store = useMemoryStorage();
    writeStoredPlace({ state: "UT", area: null });
    expect(forgetPlaceIfEmpty(
      { selection: { state: "UT", area: null }, source: "stored" }, true)).toBe(false);
    expect(store.has(KEY)).toBe(true);
  });

  it("never forgets a place that came from a link", () => {
    /* An empty link is the sender's mistake to see, not the recipient's
     * preference to lose -- and the recipient may have no preference at all. */
    useMemoryStorage();
    writeStoredPlace({ state: "CO", area: null });
    expect(forgetPlaceIfEmpty(
      { selection: { state: "UT", area: null }, source: "link" }, false)).toBe(false);
    expect(readStoredPlace()).toEqual({ state: "CO", area: null });
  });
});
