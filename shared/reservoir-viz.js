/*
 * Shared rendering logic for both dashboards (../index.html, the ArcGIS
 * Maps SDK version, and ../maplibre/index.html, the MapLibre GL JS one).
 *
 * Why this file exists: the two pages exist to compare *rendering engines*,
 * so everything that isn't engine-specific -- the color classes, the status
 * wording, the popup markup, the 12-month trend chart, the legend -- has to
 * be identical between them or the comparison is measuring copy drift
 * instead of the engines. It used to be duplicated by hand in both files
 * and had already diverged. Engine-specific code (layers, paint properties,
 * Arcade vs. MapLibre expressions) stays in the pages.
 *
 * Same zero-build-step constraint as the rest of the project: a plain
 * script that hangs one global off window, no modules, no bundler.
 *
 * IMPROVEMENT: with a build step this would be an ES module with real
 * imports and the chart would be a tested unit. It is deliberately not,
 * to hold the project's "CDN tags only" constraint -- but the moment a
 * third page shows up, revisit that.
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

  function colorFor(pct) {
    if (pct === null || pct === undefined || isNaN(pct)) return STALE_COLOR;
    var chosen = CLASSES[0].color;
    for (var i = 0; i < CLASSES.length; i++) {
      if (pct >= CLASSES[i].min) chosen = CLASSES[i].color;
    }
    return chosen;
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

  function esc(s) {
    return String(s === null || s === undefined ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
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
    var pct = r.pct_of_record_max;
    var gap = r.record_max_af - r.current_storage_af;
    var status;
    if (pct === null || pct === undefined) status = "No current reading";
    else if (pct < 25) status = "Extremely low";
    else if (pct < 50) status = "Critically low";
    else if (pct < 75) status = "Below normal";
    else if (pct < 90) status = "Near normal";
    else status = "Near or above normal";
    return status + " — " + fmtPct(pct) + " of its period-of-record max, " +
      fmtAf(gap) + " af below that historical peak.";
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
   * IMPROVEMENT: no accessible fallback beyond the aria-label and the
   * table below it -- a real treemap of this data would need focusable
   * bars with per-month tooltips.
   */
  function trendChartSVG(r, opts) {
    opts = opts || {};
    var months = r.monthly || [];
    if (!months.length) {
      return "<p class='rv-empty'>Twelve-month history appears after the next " +
        "data refresh (this file predates the trend fields).</p>";
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
      parts.push("<rect x='" + (x(i) - barW / 2).toFixed(1) + "' y='" + top.toFixed(1) +
        "' width='" + barW.toFixed(1) + "' height='" + Math.max(0, padT + plotH - top).toFixed(1) +
        "' fill='" + colorFor(pct) + "' rx='1'>" +
        "<title>" + esc(fmtMonth(m.month) + ": " + fmtAf(m.mean_af) + " af" +
          (pct === null ? "" : " (" + fmtPct(pct) + " of record max)")) + "</title></rect>");
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

    var label = "Twelve-month storage history for " + r.name +
      ", monthly mean acre-feet, with the prior-years median for each month.";

    return "<svg class='rv-chart' viewBox='0 0 " + W + " " + H + "' width='100%' " +
      "role='img' aria-label='" + esc(label) + "'>" + parts.join("") + "</svg>" +
      "<p class='rv-chart-key'><span class='rv-swatch-bar'></span> monthly mean storage " +
      "<span class='rv-swatch-line'></span> normal for that month (prior years)</p>";
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

    return "<details class='rv-details'><summary>Last 12 months, by the numbers</summary>" +
      "<table class='rv-table'><thead><tr>" +
      "<th>Month</th><th class='rv-num'>Mean af</th>" +
      "<th class='rv-num'>% max</th><th class='rv-num'>vs. normal</th>" +
      "</tr></thead><tbody>" + rows + "</tbody></table>" +
      "<p class='rv-note'>“Normal” is the median of that same calendar " +
      "month in earlier years of the record, so the earliest years have nothing " +
      "to compare against.</p></details>";
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

    if (opts.includeTitle) {
      html += "<h2 class='rv-title'>" + esc(r.name) + "</h2>";
    }

    // The staleness banner is the whole point of the freshness work: a
    // reservoir whose feed stopped now says so in the popup instead of
    // presenting an eleven-day-old number as today's.
    if (r.is_stale) {
      html += "<p class='rv-stale'>⚠ Last reading is from " + esc(r.as_of) +
        " (" + esc(daysAgoPhrase(r.days_stale)) + ")" +
        (r.fetch_ok === false ? " — the refresh could not reach RISE for this reservoir."
                              : " — RISE has not published newer data for it.") +
        " Everything below describes that date, not today.</p>";
    }

    html += "<p class='rv-status'>" + esc(statusLine(r)) + "</p>";

    html += "<div class='rv-stats'>" +
      statRow("Current storage", fmtAf(r.current_storage_af) + " af") +
      statRow("Period-of-record max", fmtAf(r.record_max_af) + " af") +
      statRow("Normal for this week", r.seasonal_normal_af === undefined ? "—" :
        fmtAf(r.seasonal_normal_af) + " af" +
        (r.pct_of_seasonal_normal ? " <em>(" + fmtPct(r.pct_of_seasonal_normal) + " of it)</em>" : "")) +
      statRow("Seasonal percentile", fmtPct(r.seasonal_percentile)) +
      statRow("Change, 30 days", fmtSigned(r.change_30d_af) + " af" +
        (r.change_30d_pct === null || r.change_30d_pct === undefined ? "" :
          " <em>(" + (r.change_30d_pct > 0 ? "+" : "") + fmtPct(r.change_30d_pct) + ")</em>"),
        r.change_30d_af < 0 ? "rv-neg" : "") +
      statRow("Change, 1 year", fmtSigned(r.change_365d_af) + " af",
        r.change_365d_af < 0 ? "rv-neg" : "") +
      statRow("Peak this year", fmtAf(r.peak_this_year_af) + " af" +
        (r.peak_this_year_date ? " <em>(" + esc(r.peak_this_year_date) + ")</em>" : "")) +
      statRow("As of", esc(r.as_of || "—")) +
      "</div>";

    html += "<h3 class='rv-subhead'>Last 12 months</h3>";
    html += trendChartSVG(r, opts);
    html += monthlyTableHTML(r);

    html += "<p class='rv-note'>Seasonal percentile: where this reading ranks " +
      "against every other year's value within a 7-day window of the same date. " +
      "Data: <a href='https://data.usbr.gov/rise-api' target='_blank' " +
      "rel='noreferrer'>Bureau of Reclamation RISE</a> — provisional and " +
      "subject to revision.</p>";

    return html;
  }

  // --- Legend + header -----------------------------------------------

  function legendHTML() {
    var swatches = CLASSES.map(function (c) {
      return "<span class='rv-legend-row'><span class='rv-dot' style='background:" +
        c.color + "'></span>" + esc(c.label) + "</span>";
    }).join("");
    return "<b>% of period-of-record max</b>" +
      "<div class='rv-legend-scale'>" + swatches + "</div>" +
      "<span class='rv-legend-row'><span class='rv-dot rv-dot-stale'></span>" +
      "Dashed ring: feed has gone quiet</span>" +
      "<p class='rv-legend-note'>Filled circle = current storage. Gray outline ring = " +
      "that reservoir's own period-of-record max &mdash; the bigger the gap between " +
      "ring and fill, the more depleted it is. Click any reservoir for its " +
      "12-month trend.</p>";
  }

  /* One line under the title telling the reader how old the whole file is,
   * and how many reservoirs inside it are individually stale. */
  function freshnessHTML(data) {
    if (data.legacy) {
      return "<span class='rv-fresh-warn'>Serving an older reservoirs.json " +
        "(no refresh timestamp) — trend charts will be empty until the next " +
        "data refresh runs.</span>";
    }
    var stale = data.reservoirs.filter(function (r) { return r.is_stale; });
    var when = data.generatedAt ? new Date(data.generatedAt) : null;
    var age = when ? Math.round((Date.now() - when.getTime()) / 86400000) : null;
    var out = "Data refreshed " + (when ? when.toLocaleDateString("en-US",
      { year: "numeric", month: "short", day: "numeric" }) : "unknown");
    if (age !== null && age > 2) {
      out = "<span class='rv-fresh-warn'>" + out + " — " + age +
        " days ago; the refresh job may be failing.</span>";
    }
    if (stale.length) {
      out += " &middot; <span class='rv-fresh-warn'>" + stale.length +
        " reservoir" + (stale.length === 1 ? "" : "s") + " not updating: " +
        esc(stale.map(function (r) { return r.name; }).join(", ")) + "</span>";
    }
    return out;
  }

  // --- Shared stylesheet ---------------------------------------------
  //
  // Injected rather than duplicated in both pages' <style> blocks, for the
  // same reason the markup lives here: the two dashboards have to look
  // identical for the engine comparison to mean anything.
  var CSS = [
    ".rv-title{font-size:15px;margin:0 0 6px;}",
    ".rv-status{font-weight:600;font-size:13px;margin:0 0 8px;line-height:1.35;}",
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
    ".rv-axis{font-size:9px;fill:#888;font-family:sans-serif;}",
    ".rv-chart-key{font-size:10.5px;color:#777;margin:2px 0 6px;line-height:1.4;}",
    ".rv-swatch-bar{display:inline-block;width:9px;height:9px;background:#d73027;",
      "border-radius:1px;vertical-align:-1px;margin-right:2px;}",
    ".rv-swatch-line{display:inline-block;width:14px;border-top:1.6px dashed #31527a;",
      "vertical-align:4px;margin:0 2px 0 8px;}",
    ".rv-empty{font-size:11.5px;color:#888;margin:4px 0 8px;}",
    ".rv-details{margin:4px 0 8px;}",
    ".rv-details summary{font-size:11.5px;color:#0079c1;cursor:pointer;}",
    ".rv-table{border-collapse:collapse;font-size:11.5px;margin-top:6px;width:100%;}",
    ".rv-table th{text-align:left;color:#666;font-weight:600;border-bottom:1px solid #ddd;",
      "padding:2px 6px 2px 0;}",
    ".rv-table td{padding:1px 6px 1px 0;border-bottom:1px solid #f5f5f5;}",
    ".rv-num{text-align:right;}",
    ".rv-neg{color:#b3261e;}",
    ".rv-pos{color:#1a7f37;}",
    ".rv-note{font-size:10.5px;color:#888;margin-top:8px;line-height:1.45;}",
    ".rv-note a{color:#0079c1;}",
    ".rv-legend-scale{display:flex;flex-direction:column;gap:1px;margin:4px 0;}",
    ".rv-legend-row{display:flex;align-items:center;gap:6px;font-size:12px;}",
    ".rv-dot{width:11px;height:11px;border-radius:50%;display:inline-block;",
      "border:1px solid rgba(0,0,0,.25);}",
    ".rv-dot-stale{background:transparent;border:1.5px dashed " + STALE_ACCENT + ";}",
    ".rv-legend-note{font-size:11px;color:#666;margin:6px 0 0;line-height:1.4;}",
    ".rv-fresh-warn{color:" + STALE_ACCENT + ";font-weight:600;}"
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
    colorFor: colorFor,
    load: load,
    normalize: normalize,
    statusLine: statusLine,
    popupHTML: popupHTML,
    trendChartSVG: trendChartSVG,
    monthlyTableHTML: monthlyTableHTML,
    legendHTML: legendHTML,
    freshnessHTML: freshnessHTML,
    injectStyles: injectStyles,
    fmtAf: fmtAf,
    fmtCompact: fmtCompact
  };
})(window);
