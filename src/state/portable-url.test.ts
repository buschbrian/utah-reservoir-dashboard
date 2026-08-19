/*
 * `?area=` and `?level=` are each documented as one parameter across the
 * whole site, and the navigation was dropping both on every click: the bar
 * was built from static hrefs, so a reader who chose subregions on the
 * drought map and clicked "Snowpack" landed on a map drawn in basins. What
 * the bar carries is the part that can be wrong without anything looking
 * wrong, so it is asserted here rather than only in the browser.
 */
import { describe, expect, it } from "vitest";
import { linkHref, portableSearch } from "./portable-url";

describe("the parameters that travel", () => {
  it("carries nothing from an untouched page", () => {
    expect(portableSearch("")).toBe("");
    expect(portableSearch(undefined)).toBe("");
    expect(portableSearch("?")).toBe("");
  });

  it("carries the shared where-and-how-finely parameters", () => {
    expect(portableSearch("?area=140100")).toBe("?area=140100");
    expect(portableSearch("?level=4")).toBe("?level=4");
    expect(portableSearch("?state=UT")).toBe("?state=UT");
  });

  it("leaves behind what belongs to one page's own subject", () => {
    /* A reservoir selection, a sort order, a chart measure and a storage
     * class are each about the page that owns them; carrying one would
     * assert the receiving page has the same subject. */
    expect(portableSearch(
      "?reservoir=Deer+Creek&sort=storage-desc&measure=percent&class=2&table=open"
    )).toBe("");
  });

  it("keeps the order fixed however the address bar spells it", () => {
    /* One view, one link. Two readers comparing shared links should not see
     * a difference that is only parameter order. */
    expect(portableSearch("?level=4&area=1401&state=UT"))
      .toBe(portableSearch("?state=UT&area=1401&level=4"));
    expect(portableSearch("?level=4&area=1401&state=UT")).toBe("?state=UT&area=1401&level=4");
  });

  it("translates the storage map's own spelling of the drainage area", () => {
    /* The map writes `drainage=` and reads `area=` as the older name; every
     * other page writes `area=`, and the snow and drought maps understand
     * nothing else. Carried verbatim, `drainage=` opens the snow map wide. */
    expect(portableSearch("?drainage=140600")).toBe("?area=140600");
  });

  it("lets the canonical name win when a link carries both spellings", () => {
    expect(portableSearch("?drainage=140600&area=160200")).toBe("?area=160200");
  });

  it("takes the last of a repeated parameter, as the selection reader does", () => {
    expect(portableSearch("?area=140100&area=160200")).toBe("?area=160200");
  });

  it("ignores an empty value rather than writing a bare parameter", () => {
    expect(portableSearch("?area=&level=")).toBe("");
  });

  it("escapes what it carries", () => {
    expect(portableSearch("?state=A%26B")).toBe("?state=A%26B");
  });

  it("is unmoved by a parameter it does not own sharing a prefix", () => {
    expect(portableSearch("?areas=140100&leveling=4&stated=UT")).toBe("");
  });
});

describe("a page's href", () => {
  it("stays clean when there is nothing to carry", () => {
    expect(linkHref("./snow.html", "")).toBe("./snow.html");
    expect(linkHref("./", "")).toBe("./");
  });

  it("carries the query on both the root and a named page", () => {
    expect(linkHref("./", "?area=1401")).toBe("./?area=1401");
    expect(linkHref("./snow.html", "?area=1401")).toBe("./snow.html?area=1401");
  });
});
