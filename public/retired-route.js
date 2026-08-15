/*
 * Compatibility redirects for the three retired dashboard implementations.
 *
 * Each page supplies a fixed relative target and one of the two current URL
 * contracts. Only named fields cross the boundary: an old basemap choice or
 * an unknown parameter cannot become state owned by the current application.
 */
(function () {
  "use strict";

  var script = document.currentScript;
  if (!script) return;
  var targetPath = script.getAttribute("data-target");
  var contract = script.getAttribute("data-contract");
  if (!targetPath || (contract !== "map" && contract !== "overview")) return;

  var source = new URLSearchParams(window.location.search);
  var target = new URLSearchParams();

  // A repeated key resolves to its last non-empty value, the same way the
  // current application reads its own URL. An empty value counts as absent so
  // a blank field cannot shadow a usable older alias behind it.
  function lastValue(key) {
    var values = source.getAll(key);
    for (var index = values.length - 1; index >= 0; index -= 1) {
      if (values[index] !== "") return values[index];
    }
    return null;
  }

  function first(keys) {
    for (var index = 0; index < keys.length; index += 1) {
      var value = lastValue(keys[index]);
      if (value !== null) return value;
    }
    return null;
  }

  function copy(output, inputs) {
    var value = first(inputs);
    if (value !== null) target.set(output, value);
  }

  if (contract === "map") {
    copy("reservoir", ["reservoir"]);
    copy("drainage", ["drainage", "area", "huc6"]);
    copy("class", ["class", "storage"]);
    copy("powell", ["powell"]);
    copy("reservoirs", ["reservoirs"]);
    copy("month", ["month"]);
    copy("table", ["table"]);
    copy("sort", ["sort"]);

    var late = lastValue("late");
    if (late !== null) target.set("late", late);
    else if (lastValue("reporting") === "late") target.set("late", "true");
    else if (lastValue("reporting") === "current") target.set("late", "false");
  } else {
    copy("q", ["q", "reservoir"]);
    copy("area", ["area", "drainage", "huc6"]);
    copy("reservoirs", ["reservoirs"]);
    copy("powell", ["powell"]);
    copy("storage", ["storage", "class"]);
    copy("sort", ["sort"]);
    copy("measure", ["measure"]);
    copy("top", ["top"]);
    copy("rank", ["rank"]);

    var reporting = lastValue("reporting");
    if (reporting !== null) target.set("reporting", reporting);
    else if (lastValue("late") === "true") target.set("reporting", "late");
  }

  var destination = new URL(targetPath, document.baseURI);
  destination.search = target.toString();
  destination.hash = window.location.hash;

  // The visible link must promise the same destination the automatic redirect
  // delivers, or a reader who clicks before replace() fires loses their state.
  var link = document.getElementById("continue-link");
  if (link) link.href = destination.href;

  window.location.replace(destination.href);
}());
