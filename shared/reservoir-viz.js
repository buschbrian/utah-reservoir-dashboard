/*
 * Shared rendering logic for all three pages: ../index.html (the ArcGIS
 * Maps SDK map), ../maplibre/index.html (the MapLibre GL JS map) and
 * ../explore.html (the statewide overview, which draws no map at all).
 *
 * Why this file exists: the two map pages exist to compare *rendering
 * engines*, so everything that isn't engine-specific -- the color classes,
 * the status wording, the popup markup, the 12-month trend chart, the
 * legend, the watershed source and the map extent -- has to be identical
 * between them or the
 * comparison is measuring copy drift instead of the engines. It used to be
 * duplicated by hand in both files and had already diverged.
 * Engine-specific code (layers, paint properties, Arcade vs. MapLibre
 * expressions) stays in the pages.
 *
 * The overview joined later and inherited the same argument for a different
 * reason: a reservoir has to read identically whether you reached it by
 * clicking a dot or a table row. It also added the first logic here that is
 * about data rather than drawing -- the statewide rollup -- because the map
 * pages are the obvious next place to want it.
 *
 * Same zero-build-step constraint as the rest of the project: a plain
 * script that hangs one global off window, no modules, no bundler.
 *
 * IMPROVEMENT: with a build step this would be an ES module with real
 * imports and the chart and the rollup would be tested units. It is
 * deliberately not, to hold the project's "CDN tags only" constraint -- but
 * this note used to say "revisit when a third page shows up", and the third
 * page has shown up. The rollup in particular is arithmetic with no DOM in
 * it, and is currently only ever checked by a browser smoke test.
 */
(function (global) {
  "use strict";

  // --- Color classes -------------------------------------------------
  //
  // Five classes instead of the original three. The old ramp put every
  // reservoir under 50% into one bucket, which in a drought year is most
  // of the state -- Lake Powell at 34% and Meeks Cabin at 13% rendered
  // the same red, so the map couldn't distinguish "low" from "nearly
  // empty" exactly where the story is. Sequential red -> green, ordered
  // worst-first, colorblind-safe (RdYlGn, ColorBrewer).
  var CLASSES = [
    { min: 0,  color: "#a50026", label: "Under 25%" },
    { min: 25, color: "#d73027", label: "25–50%" },
    { min: 50, color: "#fdae61", label: "50–75%" },
    { min: 75, color: "#a6d96a", label: "75–90%" },
    { min: 90, color: "#1a9850", label: "Over 90%" }
  ];

  var STALE_COLOR = "#9e9e9e";
  var STALE_ACCENT = "#b45309"; // amber-700, for the "data is old" ring

  /*
   * The number the map is actually about. Percent of real capacity where we
   * have it (from the National Inventory of Dams, via capacities.json), and
   * percent of the highest storage ever observed where we don't. The two are
   * close for most reservoirs but they are not the same claim, so the popup
   * always shows which one it used.
   */
  function headlinePct(r) {
    return (r.pct_of_capacity === null || r.pct_of_capacity === undefined)
      ? r.pct_of_record_max : r.pct_of_capacity;
  }

  function headlineBasis(r) {
    return (r.pct_of_capacity === null || r.pct_of_capacity === undefined)
      ? "highest recorded storage" : "capacity";
  }

  function colorFor(pct) {
    if (pct === null || pct === undefined || isNaN(pct)) return STALE_COLOR;
    var chosen = CLASSES[0].color;
    for (var i = 0; i < CLASSES.length; i++) {
      if (pct >= CLASSES[i].min) chosen = CLASSES[i].color;
    }
    return chosen;
  }

  /*
   * The gray a color becomes under CSS `grayscale(100%)`, computed here so
   * the two engines can dim a reservoir the same way. The ArcGIS SDK takes
   * that filter string directly on a featureEffect; MapLibre has no filter
   * primitive at all, so its dimmed paint has to be handed the already-gray
   * color. Rec. 601 luma, which is what the CSS filter specification uses --
   * a plain channel average would wash the red classes out further than the
   * green ones and the two maps would stop matching.
   */
  function grayscaleHex(hex) {
    var n = parseInt(String(hex).slice(1), 16);
    var r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    var y = Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b);
    return "#" + ((1 << 24) + (y << 16) + (y << 8) + y).toString(16).slice(1);
  }

  // --- Shared geographic context ---------------------------------------
  //
  // The six-corner ring immediately below is only a lightweight fallback.
  // Production loads `utah-boundary.geojson`, a maintained UGRC boundary;
  // the fallback keeps reservoir points usable if that context file fails.
  // Both maps are about Utah but neither basemap knows that: Nevada,
  // Wyoming and the Colorado Plateau render at exactly the same weight as
  // the state the dashboard is for, and the eye has to do the cropping.
  // A translucent mask over everything outside the state line fixes that
  // without hiding anything -- deliberately *slight* (see MASK_FILL), for
  // two reasons. Neighboring geography is real context: the Uinta Basin
  // does not stop at the Colorado line. And two of the 28 reservoirs are
  // not in Utah at all -- Lake Powell sits behind Glen Canyon Dam in
  // Arizona, and Meeks Cabin is in the Wyoming notch -- so a hard clip
  // would drop them into a gray void.
  //
  // This approximation captures Utah's nominal surveyed lines and northeast
  // notch, but not the small, visible survey variations along those lines.
  var UTAH_W = -114.052, UTAH_E = -109.041;
  var UTAH_S = 37.0, UTAH_N = 42.0;
  var NOTCH_W = -111.047, NOTCH_S = 41.0;

  // Counterclockwise, starting at the northwest corner. Used as-is for an
  // ArcGIS *hole* ring (which wants the opposite winding from the outer
  // ring) and reversed for GeoJSON.
  var UTAH_RING = [
    [UTAH_W, UTAH_N], [UTAH_W, UTAH_S], [UTAH_E, UTAH_S],
    [UTAH_E, NOTCH_S], [NOTCH_W, NOTCH_S], [NOTCH_W, UTAH_N],
    [UTAH_W, UTAH_N]
  ];

  // Clockwise, and far larger than either map can pan to at these zooms,
  // so the mask never runs out before the viewport does.
  //
  // Deliberately not the whole world. A ring spanning the full -180..180
  // rendered *inverted* in the ArcGIS SDK -- Utah dimmed and everything
  // around it left bright -- because a polygon touching both edges of the
  // antimeridian is ambiguous about which side it encloses, so the outer
  // ring was dropped and the Utah hole was promoted to the only ring.
  // MapLibre drew it correctly, which is exactly the kind of difference
  // this project's two-engine setup exists to catch. A continent-sized box
  // has no such ambiguity; the cost is that zooming out past North America
  // reveals the mask's own edge, which no reader of a Utah dashboard is
  // going to do.
  var SURROUND_RING = [
    [-160, 72], [-45, 72], [-45, 8], [-160, 8], [-160, 72]
  ];

  // A pale cool gray rather than plain white, and only ~60% opaque. White
  // works on the ArcGIS topo basemap, which is colorful enough to wash out
  // visibly, but does nothing at all on CARTO Positron -- which is already
  // near-white, so a white scrim over it is a scrim over nothing. A gray
  // dims both. The alpha is the "slightly" part: out-of-state labels and
  // terrain stay readable, they just stop competing.
  var MASK_FILL = "rgba(226,232,239,0.62)";
  var MASK_LINE = "#8fa3b8";

  /* Both engines use the authoritative WBD service. Layer 3 is the six-digit
   * basin level. The state filter finds touching basins; the region filter
   * removes Upper Snake, which clips Utah but drains to the Columbia rather
   * than the Colorado River or Great Basin systems (ADR-010). */
  var HUC6_SERVICE_URL =
    "https://hydro.nationalmap.gov/arcgis/rest/services/wbd/MapServer/3";
  var HUC6_WHERE = "states LIKE '%UT%' AND huc6 NOT LIKE '17%'";
  var HUC6_GEOJSON_URL = HUC6_SERVICE_URL + "/query?where=" +
    encodeURIComponent(HUC6_WHERE) +
    "&outFields=huc6%2Cname%2Cstates&returnGeometry=true&outSR=4326" +
    "&geometryPrecision=5&f=geojson";

  // One explicit starting extent for both renderers, one zoom level wider
  // than a tight fit around Utah: the tight version cropped hard against the
  // state line and gave a reader no idea where these basins sit.
  //
  // PROVISIONAL. This is a hand-set box around one state, and it stops
  // making sense the moment the connected sites land. The drainage areas
  // that touch Utah reach into Colorado, Wyoming and New Mexico -- Blue
  // Mesa, Morrow Point, Navajo, Fontenelle -- so once those are published
  // the starting extent should be computed from the sites and boundaries
  // actually on the map, not written down here. See Phase 1.5 in
  // MODERNIZATION_PLAN.md.
  /* The drainage areas are the primary source, so the map's geography is
   * derived from them rather than written down beside them.
   *
   * HUC6_BOUNDS is the bounding box of the polygons in the committed
   * `huc6.geojson`. It is a constant because both engines need their
   * navigation constraint at construction, before any boundary file has
   * been fetched -- and a constraint that arrives late is a map that could
   * be panned away in the meantime. `extent.test.ts` recomputes it from the
   * committed file, so the moment the drainage areas change and this is not
   * regenerated, the build says so.
   */
  var HUC6_BOUNDS = [[-115.706, 35.109], [-105.627, 43.451]];

  /** A bounding box scaled about its own centre. Two is one zoom level. */
  function expandBounds(bounds, factor) {
    var west = bounds[0][0], south = bounds[0][1];
    var east = bounds[1][0], north = bounds[1][1];
    var midX = (west + east) / 2, midY = (south + north) / 2;
    var halfX = ((east - west) / 2) * factor, halfY = ((north - south) / 2) * factor;
    return [[midX - halfX, midY - halfY], [midX + halfX, midY + halfY]];
  }

  /* Where the map opens, and the furthest out it goes -- the same box, one
   * zoom level out from the drainage areas. Opening at the polygons exactly
   * puts them against the edges of the canvas; one level out gives them the
   * middle of it, with the surrounding geography for context, and there is
   * nothing useful further out than that for a dashboard about these
   * drainage areas. */
  var MAP_BOUNDS = expandBounds(HUC6_BOUNDS, 2);

  /** The closest any of the maps will zoom. Deep enough to read a dam. */
  var MAP_MAX_ZOOM = 23;

  // Keeps a Utah dashboard from becoming a world map while leaving the
  // connected Colorado River and Great Basin context visible.
  var MAP_MIN_ZOOM = 4;
  var MAP_CENTER = [-111.55, 39.50];

  var HUC_FILL = "rgba(226,232,239,0.22)";
  var HUC_LINE = "#6f8498";

  function reversed(ring) { return ring.slice().reverse(); }

  function parseUtahBoundary(value) {
    if (!value || !Array.isArray(value.features) || value.features.length !== 1) return null;
    var geometry = value.features[0] && value.features[0].geometry;
    if (!geometry || !Array.isArray(geometry.coordinates)) return null;
    var polygons = geometry.type === "MultiPolygon"
      ? geometry.coordinates
      : geometry.type === "Polygon" ? [geometry.coordinates] : null;
    if (!polygons || !polygons.length) return null;
    for (var i = 0; i < polygons.length; i++) {
      if (!Array.isArray(polygons[i]) || !Array.isArray(polygons[i][0]) ||
          polygons[i][0].length < 4) return null;
    }
    return polygons;
  }

  function loadUtahBoundary(url) {
    return fetch(url, { cache: "no-cache" }).then(function (response) {
      if (!response.ok) throw new Error("HTTP " + response.status + " loading " + url);
      return response.json();
    }).then(function (value) {
      var boundary = parseUtahBoundary(value);
      if (!boundary) throw new Error("Malformed Utah boundary in " + url);
      return boundary;
    });
  }

  function stateOuterRings(boundary) {
    var polygons = boundary || [[UTAH_RING]];
    return polygons.map(function (polygon) { return polygon[0]; });
  }

  /* ArcGIS Polygon rings: outer clockwise, holes counterclockwise. */
  function utahMaskRings(boundary) {
    return [SURROUND_RING.slice()].concat(stateOuterRings(boundary).map(function (ring) {
      return ring.slice();
    }));
  }

  /* GeoJSON winds the other way (RFC 7946: outer counterclockwise, holes
   * clockwise), so the same two rings get flipped. */
  function utahMaskGeoJSON(boundary) {
    return {
      type: "Feature",
      properties: {},
      geometry: {
        type: "Polygon",
        coordinates: [reversed(SURROUND_RING)].concat(
          stateOuterRings(boundary).map(reversed))
      }
    };
  }

  function utahOutlineGeoJSON(boundary) {
    return {
      type: "Feature",
      properties: {},
      geometry: {
        type: "MultiLineString",
        coordinates: stateOuterRings(boundary).map(function (ring) { return ring.slice(); })
      }
    };
  }

  // --- Shared selection state ------------------------------------------
  //
  // The three pages already agree about what a reservoir looks like. They
  // now have to agree about what is *selected*, because the selection is
  // the only part of a view a reader can hand to somebody else: a link.
  // ../explore.html got there first with `?reservoir=Deer+Creek`, so the
  // two map pages copy its parameter name and its encoding exactly -- a
  // link that opens Deer Creek on one page has to open Deer Creek on all
  // three, or the "share this" promise is a lie on two pages out of three.
  //
  // Written as a tiny store rather than a variable per page for the reason
  // the popup markup lives here: the pages are supposed to differ only by
  // rendering engine. It is also the seed of the shared state the project
  // is heading toward (Phase 1.5 in MODERNIZATION_PLAN.md), where one
  // object drives the map, the table and the charts together. That is why
  // the store is built from a *list* of fields and the URL mapping is a
  // table: a filter or a selected drainage area joins by adding one line to
  // SELECTION_PARAMS, not by rewriting the plumbing.
  //
  // Deliberately without any browser API in the parsing half. The URL
  // reading and writing are the parts most likely to be wrong about a name
  // with a space or an apostrophe in it ("Ken's Lake", "Smith and
  // Morehouse"), and they are only testable at all if they take a string
  // and return a value. The DOM half is one function, connectSelectionToUrl.

  // Field name in the store -> query parameter name in the URL. One entry
  // today; the mapping exists so the second one is a line rather than a
  // refactor.
  var SELECTION_PARAMS = { reservoir: "reservoir" };
  var SELECTION_FIELDS = Object.keys(SELECTION_PARAMS);

  /* Empty, blank and missing all mean "nothing selected". Without this a
   * hand-edited `?reservoir=` would count as a selection of the reservoir
   * whose name is the empty string, and every page would then hunt for it. */
  function normalizeSelectionValue(value) {
    if (value === null || value === undefined) return null;
    var text = String(value).trim();
    return text === "" ? null : text;
  }

  /* Hand-rolled instead of URLSearchParams for two reasons: this file is
   * also evaluated in a bare sandbox by the unit tests (see
   * src/data/legacy-harness.ts), which has the JavaScript built-ins and
   * nothing else; and URLSearchParams writes spaces as "+" while
   * ../explore.html writes them as "%20" through encodeURIComponent, so
   * round-tripping through it would quietly change the shape of every link
   * the overview page produces. Reading accepts both spellings -- "+" is
   * still a legal space in a query string, and a link typed by hand is
   * likely to use it. */
  function decodeQueryPart(text) {
    try {
      return decodeURIComponent(String(text).replace(/\+/g, "%20"));
    } catch (e) {
      // A truncated percent escape ("%E0%A4") throws rather than returning
      // something wrong. A broken link should read as "no selection", not
      // take the page down.
      return null;
    }
  }

  function parseQuery(search) {
    var pairs = [];
    String(search === null || search === undefined ? "" : search)
      .replace(/^[?]/, "")
      .split("&")
      .forEach(function (chunk) {
        if (!chunk) return;
        var eq = chunk.indexOf("=");
        var key = decodeQueryPart(eq < 0 ? chunk : chunk.slice(0, eq));
        var value = eq < 0 ? "" : decodeQueryPart(chunk.slice(eq + 1));
        if (key === null || value === null) return;
        pairs.push([key, value]);
      });
    return pairs;
  }

  /* A query string -> the selection it describes. Unknown parameters are
   * ignored rather than dropped: ../maplibre/index.html carries its own
   * `basemap` parameter, and a selection must not throw it away. */
  function selectionFromSearch(search) {
    var out = {};
    SELECTION_FIELDS.forEach(function (field) { out[field] = null; });
    parseQuery(search).forEach(function (pair) {
      SELECTION_FIELDS.forEach(function (field) {
        if (pair[0] === SELECTION_PARAMS[field]) {
          out[field] = normalizeSelectionValue(pair[1]);
        }
      });
    });
    return out;
  }

  /* The selection -> a query string, keeping every other parameter that was
   * already there and putting the selection first so the interesting part
   * of a shared link is the readable part. encodeURIComponent, character
   * for character the same call ../explore.html makes, which is what makes
   * the links interchangeable between the three pages. */
  function searchWithSelection(state, currentSearch) {
    var parts = [];
    SELECTION_FIELDS.forEach(function (field) {
      var value = normalizeSelectionValue(state ? state[field] : null);
      if (value !== null) {
        parts.push(SELECTION_PARAMS[field] + "=" + encodeURIComponent(value));
      }
    });
    parseQuery(currentSearch).forEach(function (pair) {
      var owned = SELECTION_FIELDS.some(function (field) {
        return pair[0] === SELECTION_PARAMS[field];
      });
      if (owned) return;
      parts.push(encodeURIComponent(pair[0]) + "=" + encodeURIComponent(pair[1]));
    });
    return parts.length ? "?" + parts.join("&") : "";
  }

  /* The one place that decides whether a name in a link names a reservoir.
   * Case-insensitive and trimmed, the same rule ../explore.html uses, so
   * "?reservoir=deer creek" from somebody's address bar still works. */
  function findReservoir(reservoirs, name) {
    var wanted = normalizeSelectionValue(name);
    if (wanted === null || !reservoirs) return null;
    wanted = wanted.toLowerCase();
    for (var i = 0; i < reservoirs.length; i++) {
      var candidate = normalizeSelectionValue(reservoirs[i] && reservoirs[i].name);
      if (candidate !== null && candidate.toLowerCase() === wanted) return reservoirs[i];
    }
    return null;
  }

  /* The store itself. Subscribers are called only when a value actually
   * changed, which is what lets the pages be careless about re-selecting
   * the reservoir that is already open: clicking the same dot twice, or
   * the URL writer echoing back the value the map just set, both end here
   * as a no-op instead of an infinite round trip. */
  function createSelectionStore(fields) {
    var keys = (fields && fields.length ? fields : SELECTION_FIELDS).slice();
    var state = {};
    keys.forEach(function (key) { state[key] = null; });
    var listeners = [];

    function get() {
      var copy = {};
      keys.forEach(function (key) { copy[key] = state[key]; });
      return copy;
    }

    function subscribe(listener) {
      listeners.push(listener);
      return function () {
        var at = listeners.indexOf(listener);
        if (at >= 0) listeners.splice(at, 1);
      };
    }

    function set(patch, meta) {
      var changed = [];
      keys.forEach(function (key) {
        if (!patch || !Object.prototype.hasOwnProperty.call(patch, key)) return;
        var value = normalizeSelectionValue(patch[key]);
        if (state[key] !== value) {
          state[key] = value;
          changed.push(key);
        }
      });
      if (!changed.length) return false;
      var snapshot = get();
      // `source` says who moved the state: "map" for a click on a dot,
      // "url" for the first read of the address bar, "popstate" for the
      // back and forward buttons. The pages use it to decide whether to
      // move the map, which should follow a link but must not yank the
      // view out from under the finger that just tapped a dot.
      var info = { changed: changed, source: (meta && meta.source) || "code" };
      // A copy of the list, so a listener that unsubscribes itself while
      // being called cannot make the loop skip the next one.
      listeners.slice().forEach(function (listener) {
        try {
          listener(snapshot, info);
        } catch (err) {
          // One page component failing must not stop the others: the map
          // and the URL writer are both subscribers here, and losing the
          // shareable URL because a layer was not ready is a worse bug
          // than the one that caused it.
          if (global.console) global.console.error("Selection listener failed:", err);
        }
      });
      return true;
    }

    function clear(meta) {
      var patch = {};
      keys.forEach(function (key) { patch[key] = null; });
      return set(patch, meta);
    }

    return { fields: keys, get: get, set: set, clear: clear, subscribe: subscribe };
  }

  // One store per page. The pages drive this; nothing else should make its
  // own, except the tests.
  var selection = createSelectionStore(SELECTION_FIELDS);

  /* The only part of the selection that touches the browser: read the URL
   * into the store now, write the store back to the URL on every change,
   * and follow the back and forward buttons.
   *
   * history.replaceState, never pushState. A reader comparing five
   * reservoirs clicks five dots; with pushState the back button then walks
   * back through all five instead of leaving the map, which is the
   * behaviour everybody complains about and nobody wants. The cost is that
   * only the entry the reader arrived on is in the history -- which is
   * exactly what makes the back button work for a shared link, the case
   * requirement 4 is about.
   *
   * Subscribe your own listeners *before* calling this: the first read of
   * the URL happens inside it, and that read is what opens the popup for a
   * link somebody sent you. */
  function connectSelectionToUrl(store, options) {
    options = options || {};
    var win = options.window || global;
    var loc = win.location;
    var hist = win.history;
    if (!loc) return function () {};

    // Set while the store is being filled *from* the URL, so the writer
    // below does not write the address bar back onto itself. Harmless if
    // it did (replaceState with the same string is a no-op), but a
    // popstate that got rewritten would be a real bug the day a second
    // field joins the store.
    var applying = false;

    function readUrl(source) {
      applying = true;
      try {
        store.set(selectionFromSearch(loc.search), { source: source });
      } finally {
        applying = false;
      }
    }

    var unsubscribe = store.subscribe(function (state) {
      if (applying) return;
      if (!hist || typeof hist.replaceState !== "function") return;
      hist.replaceState(null, "",
        (loc.pathname || "") + searchWithSelection(state, loc.search) + (loc.hash || ""));
    });

    function onPopState() { readUrl("popstate"); }
    if (win.addEventListener) win.addEventListener("popstate", onPopState);

    readUrl("url");

    return function () {
      unsubscribe();
      if (win.removeEventListener) win.removeEventListener("popstate", onPopState);
    };
  }

  /* The wording for a link that names something this dashboard does not
   * have. Quiet on purpose: the map is fine, the link is not, and the
   * reader who followed it can do nothing about it except read the map. */
  function unknownReservoirMessage(name) {
    return "This dashboard does not have a reservoir with the name \"" +
      normalizeSelectionValue(name) + "\". The map shows all reservoirs.";
  }

  // --- Statewide rollup ------------------------------------------------
  //
  // The maps answer "how is this reservoir doing"; these answer "how is the
  // state doing", which no amount of clicking 28 popups adds up to. Kept
  // here rather than in the page that currently uses it because it is data
  // logic, not layout, and the map pages are the obvious next place to
  // want it.

  function sizeBasis(r) {
    return (r.capacity_af === null || r.capacity_af === undefined)
      ? r.record_max_af : r.capacity_af;
  }

  function utahReservoirs(reservoirs, excludeLakePowell) {
    return (reservoirs || []).filter(function (reservoir) {
      if (reservoir.intersects_utah !== true) return false;
      return !excludeLakePowell ||
        String(reservoir.name || "").trim().toLowerCase() !== "lake powell";
    });
  }

  function statewideSummary(reservoirs) {
    var sum = function (pick) {
      return reservoirs.reduce(function (acc, r) {
        var v = pick(r);
        return (v === null || v === undefined || isNaN(v)) ? acc : acc + v;
      }, 0);
    };
    var storage = sum(function (r) { return r.current_storage_af; });
    var capacity = sum(sizeBasis);
    // Counted per class rather than averaged: a statewide mean percentage
    // is dominated by Lake Powell, which holds more than every other
    // reservoir here combined, so "17 of 28 are under half full" is the
    // honest companion to the volume-weighted number.
    var classCounts = CLASSES.map(function (cls, i) {
      var upper = i === CLASSES.length - 1 ? Infinity : CLASSES[i + 1].min;
      return {
        label: cls.label,
        color: cls.color,
        count: reservoirs.filter(function (r) {
          var pct = headlinePct(r);
          return pct !== null && pct !== undefined && pct >= cls.min && pct < upper;
        }).length
      };
    });
    // "Normal for this week" only across the reservoirs that have one, and
    // with the numerator narrowed to those same reservoirs -- dividing all
    // 28 reservoirs' storage by 25 reservoirs' normal would read as a
    // surplus that is really just the missing three.
    var withNormal = reservoirs.filter(function (r) {
      return r.seasonal_normal_af !== null && r.seasonal_normal_af !== undefined;
    });
    var normalTotal = withNormal.reduce(function (a, r) {
      return a + r.seasonal_normal_af;
    }, 0);
    var storageWithNormal = withNormal.reduce(function (a, r) {
      return a + (r.current_storage_af || 0);
    }, 0);
    var withoutPowell = reservoirs.filter(function (r) {
      return String(r.name || "").trim().toLowerCase() !== "lake powell";
    });
    var storageWithoutPowell = withoutPowell.reduce(function (a, r) {
      return a + ((r.current_storage_af === null || r.current_storage_af === undefined)
        ? 0 : r.current_storage_af);
    }, 0);
    var capacityWithoutPowell = withoutPowell.reduce(function (a, r) {
      var v = sizeBasis(r);
      return a + ((v === null || v === undefined || isNaN(v)) ? 0 : v);
    }, 0);

    return {
      count: reservoirs.length,
      storage_af: storage,
      capacity_af: capacity,
      pct_full: capacity ? (storage / capacity) * 100 : null,
      change_30d_af: sum(function (r) { return r.change_30d_af; }),
      change_365d_af: sum(function (r) { return r.change_365d_af; }),
      normal_af: normalTotal,
      pct_of_normal: normalTotal ? (storageWithNormal / normalTotal) * 100 : null,
      normal_covers: withNormal.length,
      stale: reservoirs.filter(function (r) { return r.is_stale; }).length,
      below_half: reservoirs.filter(function (r) {
        var pct = headlinePct(r);
        return pct !== null && pct !== undefined && pct < 50;
      }).length,
      without_lake_powell: {
        count: withoutPowell.length,
        storage_af: storageWithoutPowell,
        capacity_af: capacityWithoutPowell,
        pct_full: capacityWithoutPowell
          ? (storageWithoutPowell / capacityWithoutPowell) * 100 : null
      },
      classes: classCounts
    };
  }

  /* Statewide storage by month, shaped like a single reservoir's `monthly`
   * array so the existing trend chart can draw it unchanged.
   *
   * Months that not every reservoir reported are dropped rather than shown
   * short, which matters more than it sounds: a stale reservoir's 12-month
   * window ends where its feed stopped, so the three frozen reservoirs
   * contribute an extra month at the old end and nothing at the new one.
   * Summed naively that renders as a near-empty bar last August and a
   * sudden statewide drop this August -- both of them pure artifacts of who
   * was reporting, drawn in the same ink as a real drawdown. Full coverage
   * is measured against the best month rather than the reservoir count, so
   * one reservoir with no monthly history at all doesn't erase the chart. */
  function statewideMonthly(reservoirs) {
    var byMonth = {};
    reservoirs.forEach(function (r) {
      (r.monthly || []).forEach(function (m) {
        if (m.mean_af === null || m.mean_af === undefined) return;
        var slot = byMonth[m.month] || (byMonth[m.month] = {
          month: m.month, mean_af: 0, normal_af: 0, reservoirs: 0, normal_from: 0
        });
        slot.mean_af += m.mean_af;
        slot.reservoirs += 1;
        if (m.normal_af !== null && m.normal_af !== undefined) {
          slot.normal_af += m.normal_af;
          slot.normal_from += 1;
        }
      });
    });
    var months = Object.keys(byMonth).sort().map(function (k) {
      var slot = byMonth[k];
      if (!slot.normal_from) slot.normal_af = null;
      return slot;
    });
    var full = months.reduce(function (max, m) {
      return Math.max(max, m.reservoirs);
    }, 0);
    return months.filter(function (m) { return m.reservoirs === full; }).slice(-12);
  }

  // --- Month history ---------------------------------------------------
  //
  // The maps answer "how is this reservoir doing today". These answer "how
  // did it get here", which is the question a drought dashboard is really
  // for: one dry dot tells you nothing about whether the state is draining
  // or refilling, and twelve of them in sequence tell you everything.
  //
  // Kept here rather than in the pages for the usual reason -- the two map
  // pages exist to compare rendering engines, so the *data* behind the two
  // sliders has to come from one place or the comparison starts measuring
  // arithmetic drift instead.

  /* The months the slider offers, oldest first.
   *
   * The union of every reservoir's own window rather than the intersection,
   * which is a deliberate reversal of what statewideMonthly() does two
   * hundred lines up. That function sums reservoirs together, so a month
   * that only half of them reported would render as a statewide collapse
   * that is really a reporting gap -- it has to drop those months. The
   * slider draws each reservoir separately and has a grey for "no reading",
   * so it can afford to show the newest month honestly instead of hiding
   * it. That matters here: the reservoirs on a monthly schedule publish a
   * month only after it ends, so the intersection would always be eleven
   * months and would always be one month behind.
   */
  function monthKeys(reservoirs) {
    var seen = {};
    (reservoirs || []).forEach(function (r) {
      (r.monthly || []).forEach(function (m) {
        if (m && m.month) seen[m.month] = true;
      });
    });
    return Object.keys(seen).sort().slice(-12);
  }

  function monthEntry(r, month) {
    var months = r.monthly || [];
    for (var i = 0; i < months.length; i++) {
      if (months[i] && months[i].month === month) return months[i];
    }
    return null;
  }

  /* Percent full for one month, against the same denominator the map's
   * colors already use -- capacity where the National Inventory of Dams has
   * it, highest recorded storage where it does not. Recomputed rather than
   * read off a field because the file only carries today's percentages, and
   * using a different denominator for the past would make the slider's
   * colors mean something subtly different from the colors it starts on. */
  function monthPct(r, month) {
    var entry = monthEntry(r, month);
    if (!entry || entry.mean_af === null || entry.mean_af === undefined) return null;
    var basis = sizeBasis(r);
    if (!basis) return null;
    return (entry.mean_af / basis) * 100;
  }

  function monthMissingCount(reservoirs, month) {
    return (reservoirs || []).filter(function (r) {
      var pct = monthPct(r, month);
      return pct === null || isNaN(pct);
    }).length;
  }

  // --- Month slider control --------------------------------------------
  //
  // One factory for both maps: identical markup, identical wording,
  // identical keyboard behavior, and only the redraw differs (an ArcGIS
  // renderer swap on one page, a GeoJSON source update on the other). The
  // page hands in the months and a callback and gets a DOM node back.
  //
  // The rightmost position is "Today", not the newest month, and it is
  // where the control starts. Those are two different claims -- a month is
  // an average over up to 31 days, today is one reading -- and the page has
  // always opened on today, so today keeps a position of its own instead of
  // being approximated by the last month. It also gives the keyboard an
  // exact way home: End on the slider, as well as the Today button.

  var PLAY_INTERVAL_MS = 1000;

  function createMonthSlider(opts) {
    opts = opts || {};
    var months = opts.months || [];
    var last = months.length - 1;
    var todayIndex = months.length;
    var onChange = opts.onChange || function () {};
    var missingCount = opts.missingCount || function () { return 0; };

    var root = document.createElement("div");
    root.className = "rv-timeline";
    root.id = "monthSlider";
    root.setAttribute("role", "group");
    root.setAttribute("aria-label", "Month control");

    var head = document.createElement("div");
    head.className = "rv-timeline-head";

    // A real <button>, not a clickable div: it has to be reachable by Tab
    // and operable by Space and Enter without any code from us.
    var play = document.createElement("button");
    play.type = "button";
    play.id = "monthPlay";
    play.setAttribute("aria-pressed", "false");
    play.textContent = "Play";

    // <output> is announced politely on change by default, so the month
    // name reaches a screen reader as the slider moves.
    var label = document.createElement("output");
    label.className = "rv-month-label";
    label.id = "monthLabel";
    label.setAttribute("for", "monthRange");

    var today = document.createElement("button");
    today.type = "button";
    today.id = "monthToday";
    today.textContent = "Today";

    head.appendChild(play);
    head.appendChild(label);
    head.appendChild(today);

    // A native range input, which brings arrow keys, Home and End with it.
    var range = document.createElement("input");
    range.type = "range";
    range.className = "rv-month-range";
    range.id = "monthRange";
    range.min = "0";
    range.max = String(todayIndex);
    range.step = "1";
    range.value = String(todayIndex);
    range.setAttribute("aria-label", "Month to show. The last position is today.");

    var note = document.createElement("p");
    note.className = "rv-month-note";

    root.appendChild(head);
    root.appendChild(range);
    root.appendChild(note);

    var index = todayIndex;
    var timer = null;
    // matchMedia is guarded because this file is also evaluated outside a
    // browser by the unit-test harness.
    var motion = global.matchMedia
      ? global.matchMedia("(prefers-reduced-motion: reduce)") : null;

    function reducedMotion() { return !!(motion && motion.matches); }

    function selected() { return index === todayIndex ? null : months[index]; }

    function describe() {
      var month = selected();
      label.textContent = month === null ? "Today" : fmtMonth(month);
      var lines = [];
      if (month === null) {
        lines.push("The map shows the newest reading for each reservoir.");
      } else {
        lines.push("The map shows the average storage for " + fmtMonth(month) + ".");
        // Named, not silently absent: a reservoir with no reading for the
        // month is drawn grey, and a grey circle that nothing explains
        // reads as an error rather than as missing data.
        var missing = missingCount(month);
        if (missing) {
          lines.push(missing + (missing === 1 ? " reservoir has" : " reservoirs have") +
            " no data for this month. " +
            (missing === 1 ? "It shows as a small gray circle."
                           : "They show as small gray circles."));
        }
      }
      if (reducedMotion()) {
        lines.push("Automatic play is off. Your device asks for less movement.");
      }
      note.textContent = lines.join(" ");
    }

    function apply(next) {
      index = Math.max(0, Math.min(todayIndex, next));
      if (String(index) !== range.value) range.value = String(index);
      describe();
      onChange(selected(), index);
    }

    function stop() {
      if (timer) { clearInterval(timer); timer = null; }
      play.setAttribute("aria-pressed", "false");
      play.textContent = "Play";
    }

    // Loops through the twelve months only. Today is not a frame of the
    // animation: it is the place the reader comes back to, and dropping it
    // into the loop would make the map jump between an average and a single
    // reading once a cycle for no reason a reader could name.
    function step() { apply(index >= last ? 0 : index + 1); }

    function start() {
      if (reducedMotion() || timer) return;
      step();
      timer = setInterval(step, PLAY_INTERVAL_MS);
      play.setAttribute("aria-pressed", "true");
      play.textContent = "Pause";
    }

    play.addEventListener("click", function () { timer ? stop() : start(); });
    today.addEventListener("click", function () { stop(); apply(todayIndex); });
    // Any hand movement of the slider takes over from the animation --
    // otherwise the next tick yanks the map off the month just chosen.
    range.addEventListener("input", function () {
      stop();
      apply(parseInt(range.value, 10));
    });

    /* The play button stays in the DOM when motion is reduced, disabled
     * rather than removed: a control that vanishes depending on a system
     * setting is harder to explain than one that is visibly off, and the
     * note says why. The listener matters because the setting can change
     * while the page is open. */
    function syncMotion() {
      if (reducedMotion()) stop();
      play.disabled = reducedMotion();
      describe();
    }
    if (motion) {
      if (motion.addEventListener) motion.addEventListener("change", syncMotion);
      else if (motion.addListener) motion.addListener(syncMotion);
    }
    syncMotion();

    return {
      element: root,
      months: months,
      month: selected,
      setMonth: apply,
      stop: stop
    };
  }

  // --- Formatting ----------------------------------------------------

  function fmtAf(v) {
    if (v === null || v === undefined || isNaN(v)) return "—";
    return Math.round(v).toLocaleString("en-US");
  }

  function fmtCompact(v) {
    if (v === null || v === undefined || isNaN(v)) return "—";
    var abs = Math.abs(v);
    if (abs >= 1e6) return (v / 1e6).toFixed(abs >= 1e7 ? 0 : 1) + "M";
    if (abs >= 1e3) return Math.round(v / 1e3) + "k";
    return Math.round(v).toString();
  }

  function fmtPct(v, places) {
    if (v === null || v === undefined || isNaN(v)) return "—";
    return v.toFixed(places === undefined ? 0 : places) + "%";
  }

  function fmtSigned(v) {
    if (v === null || v === undefined || isNaN(v)) return "—";
    return (v > 0 ? "+" : v < 0 ? "−" : "") + fmtAf(Math.abs(v));
  }

  function fmtMonth(ym) {
    // "2026-08" -> "Aug 2026". Parsed by hand rather than via Date() so a
    // browser in a negative UTC offset doesn't shift it to the prior month.
    var parts = String(ym).split("-");
    var names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
                 "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    var idx = parseInt(parts[1], 10) - 1;
    return (names[idx] || parts[1]) + " " + parts[0];
  }

  /* The apostrophe is escaped too, which it did not used to be. Every page
   * here builds attributes with single quotes -- data-name='...',
   * aria-label='...' -- and there is a reservoir called Ken's Lake, so the
   * old version closed the attribute in the middle of the name and left
   * `s Lake'` for the parser to invent attributes out of. It broke that one
   * reservoir's row silently: the button still rendered, still counted, and
   * did nothing when you pressed it. Accessible names have the same
   * exposure and no visible symptom at all. */
  function esc(s) {
    return String(s === null || s === undefined ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function daysAgoPhrase(days) {
    if (days === null || days === undefined) return "unknown age";
    if (days <= 0) return "today";
    if (days === 1) return "yesterday";
    return days + " days ago";
  }

  // --- Data loading --------------------------------------------------

  /*
   * Normalizes both shapes of reservoirs.json: the current
   * { generated_at, reservoirs: [...] } envelope, and the older bare array
   * (still what a cached copy or an un-refreshed fork will serve). The
   * envelope carries generated_at and stale_count, which is what lets the
   * page tell "the data is old" apart from "the refresh job itself died" --
   * the failure mode that hid three frozen reservoirs for eleven days.
   */
  function normalize(payload) {
    var isArray = Array.isArray(payload);
    var reservoirs = isArray ? payload : (payload.reservoirs || []);
    var meta = isArray ? {} : payload;
    return {
      generatedAt: meta.generated_at || null,
      staleAfterDays: meta.stale_after_days || 2,
      source: meta.source || null,
      sources: meta.sources || [],
      sourceCounts: meta.source_counts || null,
      legacy: isArray,
      reservoirs: reservoirs.map(function (r) {
        // Older files predate every freshness and trend field; fill in
        // enough that the pages don't have to null-check everywhere.
        var copy = Object.assign({}, r);
        if (copy.days_stale === undefined) copy.days_stale = daysBetween(copy.as_of);
        if (copy.is_stale === undefined) {
          copy.is_stale = copy.days_stale !== null && copy.days_stale > 2;
        }
        if (copy.fetch_ok === undefined) copy.fetch_ok = true;
        if (!copy.source_key) copy.source_key = "rise";
        if (!copy.source_label) copy.source_label = "Bureau of Reclamation RISE";
        if (!copy.source_url) copy.source_url = "https://data.usbr.gov/rise-api";
        if (!copy.data_frequency) copy.data_frequency = "daily";
        if (copy.stale_after_days === undefined) copy.stale_after_days = 2;
        if (!Array.isArray(copy.monthly)) copy.monthly = [];
        return copy;
      })
    };
  }

  function daysBetween(isoDate) {
    if (!isoDate) return null;
    var then = Date.parse(isoDate + "T00:00:00Z");
    if (isNaN(then)) return null;
    var today = Date.parse(new Date().toISOString().slice(0, 10) + "T00:00:00Z");
    return Math.round((today - then) / 86400000);
  }

  function load(url) {
    return fetch(url, { cache: "no-cache" })
      .then(function (resp) {
        // fetch() only rejects on network failure, so a 404 that serves an
        // HTML error page used to arrive here and die inside resp.json()
        // with an opaque parse error.
        if (!resp.ok) throw new Error("HTTP " + resp.status + " loading " + url);
        return resp.json();
      })
      .then(normalize);
  }

  // --- Status wording ------------------------------------------------

  function statusLine(r) {
    var pct = headlinePct(r);
    var reference = (r.capacity_af === null || r.capacity_af === undefined)
      ? r.record_max_af : r.capacity_af;
    var gap = reference - r.current_storage_af;
    var status;
    if (pct === null || pct === undefined) status = "No current reading";
    else if (pct < 25) status = "Extremely low";
    else if (pct < 50) status = "Very low";
    else if (pct < 75) status = "Lower than normal";
    else if (pct < 90) status = "Close to normal";
    else status = "Close to or above normal";
    var gapText = gap >= 0
      ? "It needs " + fmtAf(gap) + " acre-feet to be full."
      : "It is " + fmtAf(Math.abs(gap)) + " acre-feet above the full level.";
    return status + ". It is " + fmtPct(pct) + " of its " + headlineBasis(r) + ". " + gapText;
  }

  // --- 12-month trend chart -----------------------------------------

  /*
   * Inline SVG rather than a charting library: keeps the no-build-step
   * constraint, adds zero bytes of dependency, and renders identically
   * inside an ArcGIS popup and a MapLibre popup.
   *
   * Bars are each month's mean storage, colored by that month's own % of
   * record max on the same ramp as the map -- so the chart's colors and
   * the dot on the map mean the same thing, and you can watch a reservoir
   * walk down through the classes over the year. The dashed line is the
   * median for that calendar month in prior years ("normal"), which is
   * what turns a downward slope into an answer about whether the decline
   * is just summer drawdown or an actually bad year.
   *
   * Each bar is its own tab stop. That closes the gap this comment used to
   * describe: the chart carried one aria-label for the whole picture and a
   * table underneath, so a keyboard reader could get the numbers but never
   * the shape. Two details make it work. The <svg> is role="group", not
   * role="img" -- an img subtree is presentational, so every child inside
   * it is hidden from a screen reader no matter what it declares. And each
   * bar carries its own aria-label rather than relying on the <title>
   * child, because a <title> is a tooltip first and is read inconsistently.
   * The table below stays: it is still the fastest way to compare two
   * months that are not next to each other.
   */
  function trendChartSVG(r, opts) {
    opts = opts || {};
    var months = r.monthly || [];
    if (!months.length) {
      return "<p class='rv-empty'>The 12-month history will appear after the next data update.</p>";
    }

    var W = opts.width || 316, H = opts.height || 132;
    var padL = 40, padR = 10, padT = 12, padB = 26;
    var plotW = W - padL - padR, plotH = H - padT - padB;

    var values = [];
    months.forEach(function (m) {
      if (m.mean_af !== null && m.mean_af !== undefined) values.push(m.mean_af);
      if (m.normal_af !== null && m.normal_af !== undefined) values.push(m.normal_af);
    });
    if (!values.length) return "<p class='rv-empty'>No monthly values available.</p>";

    // Baseline at zero on purpose: these are storage volumes, and a
    // truncated axis would exaggerate ordinary seasonal drawdown into a
    // cliff. The reservoir's record max is drawn as a reference line so
    // the bars stay readable against the number that defines the map's
    // color classes.
    var yMax = Math.max.apply(null, values);
    if (r.record_max_af) yMax = Math.max(yMax, r.record_max_af * 0.35);
    yMax = yMax * 1.12 || 1;

    function x(i) { return padL + (i + 0.5) * (plotW / months.length); }
    function y(v) { return padT + plotH - (v / yMax) * plotH; }

    var barW = Math.max(4, (plotW / months.length) - 4);
    var parts = [];

    // horizontal gridlines + y labels
    [0, 0.5, 1].forEach(function (frac) {
      var v = yMax * frac, yy = y(v);
      parts.push("<line x1='" + padL + "' y1='" + yy.toFixed(1) + "' x2='" + (W - padR) +
        "' y2='" + yy.toFixed(1) + "' stroke='#e6e6e6' stroke-width='1'/>");
      parts.push("<text x='" + (padL - 5) + "' y='" + (yy + 3.5).toFixed(1) +
        "' text-anchor='end' class='rv-axis'>" + esc(fmtCompact(v)) + "</text>");
    });

    // bars
    months.forEach(function (m, i) {
      if (m.mean_af === null || m.mean_af === undefined) return;
      var pct = r.record_max_af ? (m.mean_af / r.record_max_af) * 100 : null;
      var top = y(m.mean_af);
      var reading = fmtMonth(m.month) + ": " + fmtAf(m.mean_af) + " acre-feet" +
        (pct === null ? "" : ". " + fmtPct(pct) + " of the highest recorded storage") +
        (m.normal_af === null || m.normal_af === undefined ? ""
          : ". Normal for this month: " + fmtAf(m.normal_af) + " acre-feet") + ".";
      parts.push("<rect class='rv-bar' tabindex='0' role='img' aria-label='" + esc(reading) +
        "' x='" + (x(i) - barW / 2).toFixed(1) + "' y='" + top.toFixed(1) +
        "' width='" + barW.toFixed(1) + "' height='" + Math.max(0, padT + plotH - top).toFixed(1) +
        "' fill='" + colorFor(pct) + "' rx='1'>" +
        "<title>" + esc(reading) + "</title></rect>");
    });

    // "normal" line (median of prior years for the same calendar month)
    var normalPts = [];
    months.forEach(function (m, i) {
      if (m.normal_af === null || m.normal_af === undefined) return;
      normalPts.push(x(i).toFixed(1) + "," + y(m.normal_af).toFixed(1));
    });
    if (normalPts.length > 1) {
      parts.push("<polyline points='" + normalPts.join(" ") + "' fill='none' " +
        "stroke='#31527a' stroke-width='1.6' stroke-dasharray='4 3'/>");
    }

    // x labels: every third month, so 12 bars don't collide at popup width
    months.forEach(function (m, i) {
      if (i % 3 !== 0 && i !== months.length - 1) return;
      parts.push("<text x='" + x(i).toFixed(1) + "' y='" + (H - 8) +
        "' text-anchor='middle' class='rv-axis'>" +
        esc(fmtMonth(m.month).replace(" 20", " '")) + "</text>");
    });

    var label = "Storage history for " + r.name + " during the last 12 months. " +
      "The bars show the average storage for each month. The line shows the normal value. " +
      "Move to each month with the Tab key.";

    return "<svg class='rv-chart' viewBox='0 0 " + W + " " + H + "' width='100%' " +
      "role='group' aria-label='" + esc(label) + "'>" + parts.join("") + "</svg>" +
      "<p class='rv-chart-key'><span class='rv-swatch-bar'></span> average storage for each month " +
      "<span class='rv-swatch-line'></span> normal value for that month</p>";
  }

  // --- 12-month table ------------------------------------------------

  /*
   * The chart answers "what's the shape"; this answers "what's the
   * number". Collapsed by default so the popup stays a popup.
   */
  function monthlyTableHTML(r) {
    var months = r.monthly || [];
    if (!months.length) return "";
    var rows = months.slice().reverse().map(function (m) {
      var vsNormal = (m.normal_af && m.mean_af !== null && m.mean_af !== undefined)
        ? ((m.mean_af - m.normal_af) / m.normal_af) * 100 : null;
      var cls = vsNormal === null ? "" : (vsNormal < 0 ? " rv-neg" : " rv-pos");
      var pct = r.record_max_af && m.mean_af !== null && m.mean_af !== undefined
        ? (m.mean_af / r.record_max_af) * 100 : null;
      return "<tr><td>" + esc(fmtMonth(m.month)) + "</td>" +
        "<td class='rv-num'>" + esc(fmtAf(m.mean_af)) + "</td>" +
        "<td class='rv-num'>" + esc(fmtPct(pct)) + "</td>" +
        "<td class='rv-num" + cls + "'>" +
          (vsNormal === null ? "—" : (vsNormal > 0 ? "+" : "") + vsNormal.toFixed(0) + "%") +
        "</td></tr>";
    }).join("");

    return "<details class='rv-details'><summary>Values for the last 12 months</summary>" +
      "<table class='rv-table'><thead><tr>" +
      "<th>Month</th><th class='rv-num'>Average acre-feet</th>" +
      "<th class='rv-num'>% of highest</th><th class='rv-num'>Change from normal</th>" +
      "</tr></thead><tbody>" + rows + "</tbody></table>" +
      "<p class='rv-note'>Normal is the middle value for the same month in earlier years. " +
      "The first years do not have earlier values for this comparison.</p></details>";
  }

  // --- Popup ---------------------------------------------------------

  function statRow(label, value, extraClass) {
    return "<div class='rv-stat" + (extraClass ? " " + extraClass : "") + "'>" +
      "<span class='rv-stat-label'>" + esc(label) + "</span>" +
      "<span class='rv-stat-value'>" + value + "</span></div>";
  }

  function popupHTML(r, opts) {
    opts = opts || {};
    var html = "";
    var sourceLabel = r.source_key === "awdb"
      ? "USDA Natural Resources Conservation Service"
      : "U.S. Bureau of Reclamation";
    var sourceUrl = r.source_url || "https://data.usbr.gov/rise-api";
    var cadence = r.data_frequency || "daily";

    if (opts.includeTitle) {
      html += "<h2 class='rv-title'>" + esc(r.name) + "</h2>";
    }

    // The staleness banner is the whole point of the freshness work: a
    // reservoir whose feed stopped now says so in the popup instead of
    // presenting an eleven-day-old number as today's.
    if (r.is_stale) {
      html += "<p class='rv-stale'>⚠ Last reading is from " + esc(r.as_of) +
        " (" + esc(daysAgoPhrase(r.days_stale)) + ")" +
        (r.fetch_ok === false ? ". The data update could not reach " + esc(sourceLabel) + "."
                              : ". " + esc(sourceLabel) + " has not published newer data.") +
        " The values below are for that date. They are not values for today.</p>";
    }

    /* When the map is showing a past month, the popup below it is still
     * about today -- the record only carries one set of current numbers.
     * Rather than rewrite every row for the selected month, the popup says
     * plainly which number the dot on the map is, and leaves the rest
     * labelled as the newest reading. The 12-month table further down
     * already holds every other month's value. */
    if (opts.month) {
      var monthValue = monthEntry(r, opts.month);
      var monthShare = monthPct(r, opts.month);
      var monthText = (monthValue && monthValue.mean_af !== null &&
                       monthValue.mean_af !== undefined)
        ? fmtAf(monthValue.mean_af) + " acre-feet" +
          (monthShare === null ? "" : " (" + fmtPct(monthShare) + " of the full level)")
        : "no data";
      html += "<p class='rv-month-callout'>" + esc(fmtMonth(opts.month)) + ": " +
        esc(monthText) + ". The values below are the newest reading.</p>";
    }

    html += "<p class='rv-status'>" + esc(statusLine(r)) + "</p>";

    html += "<div class='rv-stats'>" +
      statRow("Current storage", fmtAf(r.current_storage_af) + " acre-feet") +
      statRow("Capacity", r.capacity_af ? fmtAf(r.capacity_af) + " acre-feet" +
        (r.pct_of_capacity ? " <em>(" + fmtPct(r.pct_of_capacity) + " full)</em>" : "")
        : "—") +
      statRow("Highest recorded storage", fmtAf(r.record_max_af) + " acre-feet" +
        (r.pct_of_record_max ? " <em>(" + fmtPct(r.pct_of_record_max) + " of it)</em>" : "")) +
      statRow("Normal for this week", r.seasonal_normal_af === undefined ? "—" :
        fmtAf(r.seasonal_normal_af) + " acre-feet" +
        (r.pct_of_seasonal_normal ? " <em>(" + fmtPct(r.pct_of_seasonal_normal) + " of it)</em>" : "")) +
      statRow("History rank", fmtPct(r.seasonal_percentile)) +
      statRow("Change in 30 days", fmtSigned(r.change_30d_af) + " acre-feet" +
        (r.change_30d_pct === null || r.change_30d_pct === undefined ? "" :
          " <em>(" + (r.change_30d_pct > 0 ? "+" : "") + fmtPct(r.change_30d_pct) + ")</em>"),
        r.change_30d_af < 0 ? "rv-neg" : "") +
      statRow("Change in 1 year", fmtSigned(r.change_365d_af) + " acre-feet",
        r.change_365d_af < 0 ? "rv-neg" : "") +
      statRow("Highest value this year", fmtAf(r.peak_this_year_af) + " acre-feet" +
        (r.peak_this_year_date ? " <em>(" + esc(r.peak_this_year_date) + ")</em>" : "")) +
      statRow("Data date", esc(r.as_of || "—")) +
      statRow("Update schedule", esc(cadence.charAt(0).toUpperCase() + cadence.slice(1))) +
      "</div>";

    html += "<h3 class='rv-subhead'>Last 12 months</h3>";
    html += trendChartSVG(r, opts);
    html += monthlyTableHTML(r);

    html += "<p class='rv-note'>History rank compares this value with values near the same date in earlier years. " +
      "For example, 90% means that this value is higher than 90% of those earlier values. " +
      "Storage data: <a href='" + esc(sourceUrl) + "' target='_blank' " +
      "rel='noreferrer'>" + esc(sourceLabel) + "</a>. The source can change these values later. Capacity data: " +
      (r.capacity_basis === "awdb_reservoir_metadata"
        ? "USDA Natural Resources Conservation Service" : "U.S. Army Corps of Engineers National Inventory of Dams") +
      ".</p>";

    return html;
  }

  // --- Keyboard list of reservoirs -------------------------------------

  /*
   * The map pages draw their reservoirs onto a WebGL canvas, and a canvas
   * has no children: there is nothing to Tab to, nothing for a screen
   * reader to read, and no way at all to reach a reservoir without a
   * mouse. Both engines have the same hole for the same reason, so the
   * repair lives here rather than twice in the pages.
   *
   * Real <button> elements, not a hidden list. A visible list is useful to
   * everybody -- finding Rockport Reservoir among 53 dots is slow with a
   * mouse too -- and a list only screen readers can reach is a list nobody
   * maintains, because a bug in it is invisible to the person who broke it.
   *
   * Order is largest first, the same order the overview's ranking uses, so
   * the three pages agree about what "first" means.
   *
   * A <details> rather than a plain list: on a phone the map is the page,
   * and 53 rows would bury it. Closed, this costs one line. The pages
   * decide the starting state from the viewport width.
   */
  function reservoirListHTML(reservoirs, opts) {
    opts = opts || {};
    var sorted = reservoirs.slice().sort(function (a, b) {
      return (sizeBasis(b) || 0) - (sizeBasis(a) || 0);
    });
    var items = sorted.map(function (r) {
      var pct = headlinePct(r);
      var known = !(pct === null || pct === undefined || isNaN(pct));
      // The accessible name repeats the visible name and percent in the
      // same order they appear on screen, then adds what the row shows
      // only as a color and a warning sign.
      var label = r.name + ". " +
        (known ? fmtPct(pct) + " full. " : "No current reading. ") +
        "Full level: " + fmtAf(sizeBasis(r)) + " acre-feet." +
        (r.is_stale ? " Data is late." : "");
      return "<li><button type='button' class='rv-list-btn' data-name='" + esc(r.name) +
        "' aria-label='" + esc(label) + "'>" +
        "<span class='rv-list-dot' style='background:" + colorFor(pct) + "'></span>" +
        "<span class='rv-list-name'>" + esc(r.name) +
          (r.is_stale ? "<span class='rv-list-late' aria-hidden='true'>&#9888;</span>" : "") +
        "</span>" +
        "<span class='rv-list-pct'>" + esc(fmtPct(pct)) + "</span></button></li>";
    }).join("");

    return "<details class='rv-list' id='rv-list'" + (opts.open ? " open" : "") + ">" +
      "<summary class='rv-list-summary'>Reservoir list (" + sorted.length + ")</summary>" +
      "<p class='rv-list-hint'>Select a reservoir to move the map to it and open its " +
      "details. The largest reservoirs are first.</p>" +
      "<ul class='rv-list-items'>" + items + "</ul></details>";
  }

  /* Keeps the title card from running underneath the legend.

     Both pages used to cap the card at `calc(100vh - 240px)`, a number that
     was a fair guess when the legend was five color swatches. It is now
     wrong: the legend has grown a no-data row and two sentences about the
     month slider, and the card has grown a filter row, a slider and a list
     of 53 reservoirs. Two guessed constants, both moving.

     So measure instead. The card may reach down to the legend's top edge
     and no further, recomputed on resize. Below the phone breakpoint the
     legend is small and out of the way and the card gets the viewport.
  */
  function fitCardAboveLegend(card, legend) {
    if (!card) return function () {};
    function apply() {
      if (!legend || global.innerWidth <= 640) {
        card.style.maxHeight = "";
        return;
      }
      var top = card.getBoundingClientRect().top;
      var floor = legend.getBoundingClientRect().top;
      // A legend that has not been laid out yet reports 0; leave the
      // stylesheet's value alone rather than collapsing the card to nothing.
      if (!floor || floor <= top) { card.style.maxHeight = ""; return; }
      // border-box, or the cap would exclude the card's own padding and
      // border and the card would still finish below the legend by exactly
      // that much -- which is what the first version of this did.
      card.style.boxSizing = "border-box";
      card.style.maxHeight = Math.max(120, Math.round(floor - top - 12)) + "px";
      card.style.overflowY = "auto";
    }
    apply();
    global.addEventListener("resize", apply);
    // The legend is not its final size when this first runs. The ArcGIS SDK
    // lays out anything added to view.ui on its own schedule, and the legend
    // reflows once its text wraps, so a single measurement was 24px stale
    // and the card still finished below it. Watching both boxes is the
    // version that stays true.
    if (global.ResizeObserver) {
      var observer = new ResizeObserver(function () { apply(); });
      observer.observe(legend);
      observer.observe(card);
    }
    return apply;
  }

  // --- Announcements ---------------------------------------------------

  /*
   * One polite live region per page. "Polite" and only on selection: the
   * maps fire a hover event for every pixel the pointer crosses, and an
   * assertive region wired to that would talk over the reader continuously
   * and never finish a sentence.
   *
   * The text is cleared and re-set on a later task on purpose. Assigning
   * the same string twice is not a change, so a reader that announced
   * "Lake Powell" stays silent when you select Lake Powell again -- which
   * reads as a broken button rather than as a repeat.
   */
  function announce(message) {
    var node = document.getElementById("rv-live");
    if (!node) {
      node = document.createElement("div");
      node.id = "rv-live";
      node.className = "rv-sr-only";
      node.setAttribute("role", "status");
      node.setAttribute("aria-live", "polite");
      node.setAttribute("aria-atomic", "true");
      document.body.appendChild(node);
    }
    node.textContent = "";
    var later = global.setTimeout;
    if (typeof later === "function") {
      later(function () { node.textContent = message; }, 40);
    } else {
      node.textContent = message;
    }
  }

  /* What a reader hears when a reservoir is selected: which one, then the
   * two numbers the popup leads with. Deliberately short -- the popup
   * itself carries the other ten rows, and a live region that reads the
   * whole popup is a live region people turn off. */
  function selectionMessage(r) {
    return "Selected " + r.name + ". Current storage: " +
      fmtAf(r.current_storage_af) + " acre-feet. " + statusLine(r);
  }

  // --- Hover card ----------------------------------------------------
  //
  // The popup answers "tell me everything about this reservoir" and costs a
  // click plus a panel that covers a quarter of the map. Most of the time
  // the reader is scanning: which dot is this, and is it in trouble. That
  // question deserves an answer with no click at all, so both maps show a
  // three-line card that follows the pointer.
  //
  // Built here rather than in the pages for the usual reason -- the two
  // engines exist to be compared, and a card whose wording or ordering
  // differs between them makes the comparison about copy again. The engines
  // still differ in how they *find* the reservoir under the pointer (a
  // throttled hitTest against a FeatureLayer, versus a layer-scoped
  // mousemove), which is exactly the difference worth seeing.

  /* A hover card on a touch screen is worse than nothing: there is no
   * pointer to follow, the first tap both shows and dismisses it, and it
   * lands on top of the popup the tap was meant to open. Everything below
   * checks this first and does nothing when the pointer is coarse. The CSS
   * hides the card under 640px as well, so a narrow desktop window that
   * still reports a fine pointer cannot push the layout sideways. */
  function pointerCanHover() {
    if (!global.matchMedia) return true;
    return global.matchMedia("(hover: hover) and (pointer: fine)").matches;
  }

  function hoverCardHTML(r) {
    var pct = headlinePct(r);
    return "<span class='rv-hover-name'>" + esc(r.name) + "</span>" +
      "<span class='rv-hover-pct'><span class='rv-dot' style='background:" +
        colorFor(pct) + "'></span>" + esc(fmtPct(pct)) + " of " +
        esc(headlineBasis(r)) + "</span>" +
      "<span class='rv-hover-date'>Data date: " + esc(r.as_of || "unknown") +
        (r.is_stale ? " &middot; late data" : "") + "</span>";
  }

  /*
   * One card element per page, reused. `show` takes viewport coordinates
   * (clientX/clientY), because that is the one coordinate space both SDKs
   * hand back from the underlying pointer event -- the ArcGIS view reports
   * its own container-relative x/y as well, and using those would put the
   * card in the wrong place on the MapLibre page.
   */
  function createHoverCard() {
    var el = null;
    var gap = 14;   // clear of the cursor itself
    var margin = 8; // never closer than this to a viewport edge

    function ensure() {
      if (el) return el;
      el = document.createElement("div");
      el.className = "rv-hover-card";
      // Not aria-live: the card repeats what the map already conveys, and a
      // pointer user is looking at it. Announcing every dot the mouse
      // crosses would make the page unusable with a screen reader running.
      el.setAttribute("aria-hidden", "true");
      el.hidden = true;
      document.body.appendChild(el);
      return el;
    }

    return {
      show: function (record, clientX, clientY) {
        if (!record || !pointerCanHover()) return;
        var node = ensure();
        node.innerHTML = hoverCardHTML(record);
        node.hidden = false;
        // Measured after the content is in, so a long reservoir name flips
        // the card to the other side of the cursor instead of running off
        // the right edge and widening the document.
        var w = node.offsetWidth, h = node.offsetHeight;
        var left = clientX + gap;
        var top = clientY + gap;
        if (left + w > global.innerWidth - margin) left = clientX - gap - w;
        if (left < margin) left = margin;
        if (top + h > global.innerHeight - margin) top = clientY - gap - h;
        if (top < margin) top = margin;
        node.style.left = Math.round(left) + "px";
        node.style.top = Math.round(top) + "px";
      },
      hide: function () {
        if (el) el.hidden = true;
      }
    };
  }

  // --- Filter state --------------------------------------------------
  //
  // Filtering a map of 53 reservoirs by hiding 40 of them answers the
  // question and destroys the context: "which reservoirs are under a
  // quarter full" is only meaningful next to the ones that are not. So
  // nothing is removed. Matching reservoirs stay as they were and the rest
  // go gray and faint -- the ArcGIS SDK does this with featureEffect, and
  // MapLibre with paint expressions on a feature state. The predicate and
  // the counts live here so the two maps can never disagree about which
  // reservoirs matched.

  function defaultFilterState() {
    return { classIndex: null, lateOnly: false };
  }

  function filterIsActive(state) {
    return !!state && (state.lateOnly === true ||
      (state.classIndex !== null && state.classIndex !== undefined));
  }

  /* The upper bound of a class is the next class's lower bound, so the
   * boundaries can only ever come from CLASSES itself. Same rule the map
   * colors, the legend and the statewide counts use. */
  function classRange(index) {
    var cls = CLASSES[index];
    if (!cls) return null;
    return {
      min: cls.min,
      max: index === CLASSES.length - 1 ? Infinity : CLASSES[index + 1].min
    };
  }

  function matchesFilter(r, state) {
    if (!filterIsActive(state)) return true;
    if (state.lateOnly && !r.is_stale) return false;
    if (state.classIndex === null || state.classIndex === undefined) return true;
    var range = classRange(state.classIndex);
    if (!range) return true;
    var pct = headlinePct(r);
    // A reservoir with no reading at all belongs to no class, so a class
    // filter dims it rather than quietly counting it as a match.
    if (pct === null || pct === undefined || isNaN(pct)) return false;
    return pct >= range.min && pct < range.max;
  }

  function filterCountText(matching, total, active) {
    if (!active) return "The map shows all " + total + " reservoirs.";
    return matching + " of " + total + " reservoirs match. " +
      "The map shows the other reservoirs in gray.";
  }

  function filterControlsHTML() {
    var options = ["<option value='all'>All reservoirs</option>"].concat(
      CLASSES.map(function (c, i) {
        return "<option value='" + i + "'>" + esc(c.label) + "</option>";
      })
    ).join("");
    return "<label for='classFilter'>Percent full" +
      "<select id='classFilter'>" + options + "</select></label>" +
      "<button type='button' class='rv-toggle' id='lateFilter' aria-pressed='false'>" +
      "Show only late data</button>" +
      "<button type='button' class='rv-clear' id='clearFilter' hidden>Clear the filter</button>" +
      // role=status, unlike the hover card: this changes only when the
      // reader operates a control, and the count is the only feedback that
      // the map dimmed anything at all.
      "<span class='rv-filter-count' id='filterCount' role='status'></span>";
  }

  /*
   * Builds the controls into `container` and calls `onChange(state, names)`
   * whenever the reader changes them -- and once immediately, so a page
   * never has to duplicate the "apply the empty filter" path. `names` is a
   * Set of the matching reservoir names, which is the form both maps need:
   * ArcGIS turns it into a count and a where-clause, MapLibre into feature
   * states.
   */
  function attachFilterControls(container, reservoirs, onChange) {
    container.innerHTML = filterControlsHTML();
    var select = container.querySelector("#classFilter");
    var lateButton = container.querySelector("#lateFilter");
    var clearButton = container.querySelector("#clearFilter");
    var count = container.querySelector("#filterCount");
    var state = defaultFilterState();

    function apply() {
      var matching = reservoirs.filter(function (r) { return matchesFilter(r, state); });
      var active = filterIsActive(state);
      select.value = state.classIndex === null ? "all" : String(state.classIndex);
      lateButton.setAttribute("aria-pressed", state.lateOnly ? "true" : "false");
      clearButton.hidden = !active;
      count.textContent = filterCountText(matching.length, reservoirs.length, active);
      onChange(state, new Set(matching.map(function (r) { return r.name; })));
    }

    select.addEventListener("change", function () {
      state.classIndex = select.value === "all" ? null : Number(select.value);
      apply();
    });
    lateButton.addEventListener("click", function () {
      state.lateOnly = !state.lateOnly;
      apply();
    });
    clearButton.addEventListener("click", function () {
      state = defaultFilterState();
      apply();
    });

    apply();
    return { apply: apply, state: function () { return state; } };
  }

  // --- Legend + header -----------------------------------------------

  /* The heading is a real <h2> with an id rather than the <b> it used to
   * be, so the legend panel can point `aria-labelledby` at it and become a
   * named region a screen reader can jump to. A bold span named nothing;
   * the panel was reachable only by reading the whole page in order. */
  function legendHTML() {
    var swatches = CLASSES.map(function (c) {
      return "<span class='rv-legend-row'><span class='rv-dot' style='background:" +
        c.color + "'></span>" + esc(c.label) + "</span>";
    }).join("");
    return "<h2 class='rv-legend-head' id='rv-legend-head'>Percent of full level</h2>" +
      "<div class='rv-legend-scale'>" + swatches + "</div>" +
      "<span class='rv-legend-row'><span class='rv-dot rv-dot-stale'></span>" +
      "Dashed circle: data is late</span>" +
      "<span class='rv-legend-row'><span class='rv-dot' style='background:" + STALE_COLOR +
      "'></span>Small gray circle: no data</span>" +
      "<p class='rv-legend-note'>The filled circle shows current storage. The gray circle shows " +
      "the full level. A large gap means that more water is missing. Where capacity data is not " +
      "available, the gray circle shows the highest recorded storage. Select a reservoir to see " +
      "its storage during the last 12 months. Move the pointer to a reservoir to see a short " +
      "summary. Move the month slider to see the storage for each of the last 12 months. " +
      "The gray circle does not change with the month.</p>" +
      "<p class='rv-legend-note'>The shaded lines show large drainage areas from the U.S. Geological Survey.</p>";
  }

  /* One line under the title telling the reader how old the whole file is,
   * and how many reservoirs inside it are individually stale. */
  function freshnessHTML(data) {
    if (data.legacy) {
      return "<span class='rv-fresh-warn'>This data file has no update date. " +
        "The charts will be empty until the next data update.</span>";
    }
    var stale = data.reservoirs.filter(function (r) { return r.is_stale; });
    var when = data.generatedAt ? new Date(data.generatedAt) : null;
    var age = when ? Math.round((Date.now() - when.getTime()) / 86400000) : null;
    var out = "Data update: " + (when ? when.toLocaleDateString("en-US",
      { year: "numeric", month: "short", day: "numeric" }) : "unknown");
    if (data.sourceCounts) {
      out += ". Bureau of Reclamation: " + (data.sourceCounts.rise || 0) +
        ". Natural Resources Conservation Service: " + (data.sourceCounts.awdb || 0) + ".";
      var monthly = data.reservoirs.filter(function (r) {
        return r.data_frequency === "monthly";
      }).length;
      if (monthly) out += " Monthly data: " + monthly + ".";
    }
    if (age !== null && age > 2) {
      out = "<span class='rv-fresh-warn'>" + out + ". The data is " + age +
        " days old. The automatic update possibly failed.</span>";
    }
    if (stale.length) {
      out += " &middot; <span class='rv-fresh-warn'>" + stale.length +
        " reservoir" + (stale.length === 1 ? " has" : "s have") + " late data: " +
        esc(stale.map(function (r) { return r.name; }).join(", ")) + "</span>";
    }
    return out;
  }

  // --- Shared stylesheet ---------------------------------------------
  //
  // Injected rather than duplicated in both pages' <style> blocks, for the
  // same reason the markup lives here: the two dashboards have to look
  // identical for the engine comparison to mean anything.
  //
  // Contrast pass, 2026-08. Every gray and every link in this file was
  // measured against the surface it actually sits on -- white inside a
  // popup, #fbfcfb inside the map pages' panels -- and four of them failed
  // WCAG AA for text:
  //   #888 (chart axis labels, the empty-state line, the source note)  3.5:1
  //   #777 (the chart key)                                            4.7:1, at 10.5px
  //   #0079c1 (the source links and the details summary)              3.9:1
  // The two grays became #5f6368 (6.0:1) and the blue became #0b6198
  // (6.6:1), which is still the same blue family the SDK uses for its own
  // links. The five class colors are untouched: they are a data ramp with
  // a unit test pinning them, and the two that fail as *text* -- #fdae61
  // and #a6d96a -- are only ever drawn as fills behind no text at all.
  var INK_MUTED = "#5f6368";
  var LINK = "#0b6198";
  // One focus color for all three pages. Dark enough to read as a ring on
  // every surface here, including the amber warning panel and the color
  // classes' own fills, so a focused chart bar is visible on green as well
  // as on dark red.
  var FOCUS = "#14527a";

  var CSS = [
    ".rv-title{font-size:15px;margin:0 0 6px;}",
    ".rv-status{font-weight:600;font-size:13px;margin:0 0 8px;line-height:1.35;}",
    ".rv-month-callout{background:#eef4fb;border-left:3px solid #31527a;color:#1f3350;",
      "font-size:11.5px;line-height:1.4;margin:0 0 8px;padding:6px 8px;}",
    /* The slider sits inside the title card on both pages, which is the one
       place on either map that cannot collide with the zoom control in the
       top right or the legend in the bottom left. Everything below is
       width-safe: the range fills its container and the head row wraps, so
       a 360px phone gets no horizontal scroll. */
    ".rv-timeline{margin-top:8px;padding-top:8px;border-top:1px solid #e3e8e6;}",
    ".rv-timeline-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap;}",
    ".rv-timeline button{font:inherit;font-size:11px;line-height:1.2;padding:3px 9px;",
      "border:1px solid #c6d1ce;border-radius:4px;background:#fbfcfb;color:#263746;",
      "cursor:pointer;}",
    ".rv-timeline button:disabled{opacity:.55;cursor:default;}",
    ".rv-month-label{font-size:12px;font-weight:600;color:#263746;flex:1 1 auto;}",
    ".rv-month-range{display:block;width:100%;box-sizing:border-box;margin:7px 0 0;}",
    ".rv-month-note{font-size:10.5px;color:#777;margin:4px 0 0;line-height:1.35;}",
    ".rv-stale{background:#fff7ed;border-left:3px solid " + STALE_ACCENT + ";",
      "color:#7c2d12;font-size:11.5px;line-height:1.4;margin:0 0 8px;padding:6px 8px;}",
    ".rv-stats{display:grid;grid-template-columns:1fr;gap:2px;margin-bottom:10px;}",
    ".rv-stat{display:flex;justify-content:space-between;gap:10px;font-size:12.5px;",
      "border-bottom:1px solid #f0f0f0;padding:2px 0;}",
    ".rv-stat-label{color:#666;}",
    ".rv-stat-value{font-weight:600;text-align:right;white-space:nowrap;}",
    ".rv-stat-value em{font-weight:400;color:#777;font-style:normal;}",
    ".rv-stat.rv-neg .rv-stat-value{color:#b3261e;}",
    ".rv-subhead{font-size:12px;text-transform:uppercase;letter-spacing:.04em;",
      "color:#666;margin:10px 0 4px;}",
    ".rv-chart{display:block;overflow:visible;}",
    ".rv-axis{font-size:9px;fill:" + INK_MUTED + ";font-family:sans-serif;}",
    // Both an outline and a stroke, because SVG focus rings are the least
    // consistent part of this: `outline` on a <rect> is honored by current
    // Chrome and Firefox and ignored by older WebKit, while a stroke is
    // drawn everywhere but sits inside the shape and can be lost against a
    // dark class color. Together one of them is always visible.
    ".rv-bar{cursor:default;}",
    ".rv-bar:focus{outline:3px solid " + FOCUS + ";outline-offset:1px;",
      "stroke:" + FOCUS + ";stroke-width:2;}",
    ".rv-bar:focus:not(:focus-visible){outline:none;stroke:none;}",
    ".rv-bar:focus-visible{outline:3px solid " + FOCUS + ";outline-offset:1px;",
      "stroke:" + FOCUS + ";stroke-width:2;}",
    ".rv-chart-key{font-size:10.5px;color:" + INK_MUTED + ";margin:2px 0 6px;line-height:1.4;}",
    ".rv-swatch-bar{display:inline-block;width:9px;height:9px;background:#d73027;",
      "border-radius:1px;vertical-align:-1px;margin-right:2px;}",
    ".rv-swatch-line{display:inline-block;width:14px;border-top:1.6px dashed #31527a;",
      "vertical-align:4px;margin:0 2px 0 8px;}",
    ".rv-empty{font-size:11.5px;color:" + INK_MUTED + ";margin:4px 0 8px;}",
    ".rv-details{margin:4px 0 8px;}",
    ".rv-details summary{font-size:11.5px;color:" + LINK + ";cursor:pointer;}",
    ".rv-table{border-collapse:collapse;font-size:11.5px;margin-top:6px;width:100%;}",
    ".rv-table th{text-align:left;color:#666;font-weight:600;border-bottom:1px solid #ddd;",
      "padding:2px 6px 2px 0;}",
    ".rv-table td{padding:1px 6px 1px 0;border-bottom:1px solid #f5f5f5;}",
    ".rv-num{text-align:right;}",
    ".rv-neg{color:#b3261e;}",
    ".rv-pos{color:#1a7f37;}",
    ".rv-note{font-size:10.5px;color:" + INK_MUTED + ";margin-top:8px;line-height:1.45;}",
    ".rv-note a{color:" + LINK + ";}",
    ".rv-legend-head{font-size:13px;font-weight:700;margin:0 0 2px;}",
    ".rv-legend-scale{display:flex;flex-direction:column;gap:1px;margin:4px 0;}",
    ".rv-legend-row{display:flex;align-items:center;gap:6px;font-size:12px;}",
    ".rv-dot{width:11px;height:11px;border-radius:50%;display:inline-block;",
      "border:1px solid rgba(0,0,0,.25);}",
    ".rv-dot-stale{background:transparent;border:1.5px dashed " + STALE_ACCENT + ";}",
    ".rv-legend-note{font-size:11px;color:#666;margin:6px 0 0;line-height:1.4;}",
    ".rv-fresh-warn{color:" + STALE_ACCENT + ";font-weight:600;}",

    // Off screen but still rendered: `display:none` and `visibility:hidden`
    // both remove the node from the accessibility tree, which is exactly
    // the thing a live region must not be.
    ".rv-sr-only{position:absolute;width:1px;height:1px;margin:-1px;padding:0;",
      "overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0;}",

    // --- Keyboard list of reservoirs (map pages) ---
    ".rv-list{margin-top:8px;border-top:1px solid #dde4e2;padding-top:7px;}",
    ".rv-list-summary{font-size:12px;font-weight:600;color:#31465a;cursor:pointer;}",
    ".rv-list-hint{font-size:10.5px;color:" + INK_MUTED + ";margin:5px 0 5px;line-height:1.4;}",
    // The scroll cap keeps the panel a panel: 53 rows unrolled would run
    // past the bottom of the window and cover the legend.
    ".rv-list-items{list-style:none;margin:0;padding:0;max-height:34vh;overflow-y:auto;}",
    // minmax(0,1fr) on the name column, so a long reservoir name truncates
    // instead of widening the panel and scrolling the whole page sideways.
    ".rv-list-btn{display:grid;grid-template-columns:11px minmax(0,1fr) auto;",
      "align-items:center;gap:7px;width:100%;padding:4px 6px;border:0;border-radius:5px;",
      "background:none;font:inherit;font-size:12px;color:inherit;text-align:left;cursor:pointer;}",
    ".rv-list-btn:hover{background:#e4ebe8;}",
    ".rv-list-btn:focus-visible{outline:3px solid " + FOCUS + ";outline-offset:-1px;",
      "background:#e4ebe8;}",
    ".rv-list-dot{width:11px;height:11px;border-radius:50%;",
      "border:1px solid rgba(0,0,0,.25);}",
    ".rv-list-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}",
    ".rv-list-pct{font-variant-numeric:tabular-nums;font-weight:600;}",
    ".rv-list-late{color:" + STALE_ACCENT + ";margin-left:4px;}",

    // A visible focus ring on everything the three pages can focus,
    // written with :where() so it has zero specificity -- the overview's
    // own focus styles, which are tuned to their surfaces, still win, and
    // this only fills the gaps.
    ":where(a,button,select,summary,input,textarea,[tabindex]):focus-visible{",
      "outline:3px solid " + FOCUS + ";outline-offset:2px;}",
    // The SDK controls need real specificity: both map libraries ship
    // their own button rules, and a zero-specificity ring loses to them.
    ".esri-widget button:focus-visible,.esri-popup button:focus-visible,",
      ".maplibregl-ctrl button:focus-visible,.maplibregl-popup-close-button:focus-visible{",
      "outline:3px solid " + FOCUS + ";outline-offset:-3px;}",
    "@media (max-width:640px){.rv-list-items{max-height:40vh;}}",
    // Filter controls. `flex-wrap` and `min-width:0` are the whole mobile
    // story: the title card is 296px wide on a 360px phone (8px margin,
    // 56px zoom-control gutter, 20px padding), so these three controls have
    // to be allowed to stack instead of forcing the card wider than the
    // viewport -- the horizontal-overflow failure CI checks at 360px.
    ".rv-filters{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin-top:8px;}",
    ".rv-filters label{display:flex;align-items:center;gap:4px;font-size:11px;color:#555;",
      "min-width:0;}",
    ".rv-filters select{max-width:140px;min-width:0;padding:3px 6px;border:1px solid #c6d1ce;",
      "border-radius:4px;background:#fbfcfb;font:inherit;font-size:11px;}",
    ".rv-toggle,.rv-clear{font:inherit;font-size:11px;padding:3px 8px;border:1px solid #c6d1ce;",
      "border-radius:4px;background:#fbfcfb;color:#344e54;cursor:pointer;}",
    // Same pressed treatment as the overview page's buttons, so a reader who
    // moves between the three pages sees one control, not three.
    ".rv-toggle[aria-pressed='true']{background:#344e54;border-color:#344e54;color:#fff;}",
    ".rv-clear[hidden]{display:none;}",
    // Its own line: the count changes length as the reader filters, and
    // letting it share a row makes the buttons above it jump around.
    ".rv-filter-count{flex-basis:100%;font-size:11px;color:#555;line-height:1.35;}",
    // The hover card is fixed to the viewport and never accepts pointer
    // events -- it sits under the cursor by design, so any hit of its own
    // would make the map stutter as the card chased the pointer it stole.
    ".rv-hover-card{position:fixed;z-index:40;pointer-events:none;max-width:230px;",
      "display:flex;flex-direction:column;gap:2px;padding:7px 9px;border-radius:6px;",
      "background:rgba(251,252,251,.98);box-shadow:0 2px 10px rgba(36,49,47,.28);",
      "font-family:sans-serif;}",
    ".rv-hover-card[hidden]{display:none;}",
    ".rv-hover-name{font-size:12.5px;font-weight:600;line-height:1.25;}",
    ".rv-hover-pct{display:flex;align-items:center;gap:5px;font-size:12px;}",
    ".rv-hover-date{font-size:10.5px;color:#777;}",
    // Motion is opt-in, not opt-out: the default rule set has no transition
    // at all, and only a reader who has not asked for reduced motion gets
    // one. Written this way round so a new transition cannot be added to a
    // base rule and quietly escape the preference.
    "@media (prefers-reduced-motion: no-preference){",
      ".rv-toggle,.rv-clear{transition:background-color .12s ease,color .12s ease;}",
      ".rv-hover-card{transition:opacity .1s ease;}",
    "}",
    // Below the phone breakpoint the pointer is almost certainly a finger,
    // and a 230px card next to a 360px viewport is a layout risk for no
    // benefit. pointerCanHover() already covers real touch screens; this
    // covers a narrow window that still reports a mouse.
    "@media (max-width:640px){.rv-hover-card{display:none;}}"
  ].join("");

  function injectStyles() {
    if (document.getElementById("rv-styles")) return;
    var el = document.createElement("style");
    el.id = "rv-styles";
    el.textContent = CSS;
    document.head.appendChild(el);
  }

  global.ReservoirViz = {
    CLASSES: CLASSES,
    STALE_COLOR: STALE_COLOR,
    STALE_ACCENT: STALE_ACCENT,
    MASK_FILL: MASK_FILL,
    MASK_LINE: MASK_LINE,
    HUC6_SERVICE_URL: HUC6_SERVICE_URL,
    HUC6_WHERE: HUC6_WHERE,
    HUC6_GEOJSON_URL: HUC6_GEOJSON_URL,
    HUC_FILL: HUC_FILL,
    HUC_LINE: HUC_LINE,
    MAP_BOUNDS: MAP_BOUNDS,
    MAP_MIN_ZOOM: MAP_MIN_ZOOM,
    MAP_CENTER: MAP_CENTER,
    MAP_MAX_ZOOM: MAP_MAX_ZOOM,
    HUC6_BOUNDS: HUC6_BOUNDS,
    expandBounds: expandBounds,
    UTAH_RING: UTAH_RING,
    parseUtahBoundary: parseUtahBoundary,
    loadUtahBoundary: loadUtahBoundary,
    utahMaskRings: utahMaskRings,
    utahMaskGeoJSON: utahMaskGeoJSON,
    utahOutlineGeoJSON: utahOutlineGeoJSON,
    SELECTION_PARAMS: SELECTION_PARAMS,
    SELECTION_FIELDS: SELECTION_FIELDS,
    selection: selection,
    createSelectionStore: createSelectionStore,
    selectionFromSearch: selectionFromSearch,
    searchWithSelection: searchWithSelection,
    findReservoir: findReservoir,
    connectSelectionToUrl: connectSelectionToUrl,
    unknownReservoirMessage: unknownReservoirMessage,
    statewideSummary: statewideSummary,
    utahReservoirs: utahReservoirs,
    statewideMonthly: statewideMonthly,
    monthKeys: monthKeys,
    monthEntry: monthEntry,
    monthPct: monthPct,
    monthMissingCount: monthMissingCount,
    createMonthSlider: createMonthSlider,
    sizeBasis: sizeBasis,
    colorFor: colorFor,
    grayscaleHex: grayscaleHex,
    headlinePct: headlinePct,
    headlineBasis: headlineBasis,
    load: load,
    normalize: normalize,
    statusLine: statusLine,
    popupHTML: popupHTML,
    trendChartSVG: trendChartSVG,
    monthlyTableHTML: monthlyTableHTML,
    legendHTML: legendHTML,
    reservoirListHTML: reservoirListHTML,
    fitCardAboveLegend: fitCardAboveLegend,
    announce: announce,
    selectionMessage: selectionMessage,
    freshnessHTML: freshnessHTML,
    FOCUS_COLOR: FOCUS,
    LINK_COLOR: LINK,
    hoverCardHTML: hoverCardHTML,
    createHoverCard: createHoverCard,
    pointerCanHover: pointerCanHover,
    attachFilterControls: attachFilterControls,
    filterControlsHTML: filterControlsHTML,
    filterCountText: filterCountText,
    defaultFilterState: defaultFilterState,
    filterIsActive: filterIsActive,
    matchesFilter: matchesFilter,
    classRange: classRange,
    injectStyles: injectStyles,
    fmtAf: fmtAf,
    fmtCompact: fmtCompact,
    fmtPct: fmtPct,
    fmtSigned: fmtSigned,
    fmtMonth: fmtMonth,
    daysAgoPhrase: daysAgoPhrase,
    esc: esc
  };
})(window);
