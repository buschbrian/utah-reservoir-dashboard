/*
 * The control that picks where a reader is looking: a state select, and a
 * drainage-area drill-down (region -> subregion -> basin).
 *
 * Modelled closely on `createLevelControl` (`ui/level-control.ts`) -- built
 * from what the reference export publishes, never a list written here;
 * returns `null` when there is nothing to choose; takes a Calcite `scale`
 * because the hosts differ; and answers with a `set()` method so a page can
 * reflect a choice it adopted from somewhere else, such as a link.
 *
 * The narrowing, the option lists and what a reader's raw pick means are all
 * `where-control-model.ts` -- pure functions built over
 * `data/opening-scope.ts#resolveOpeningScope`, kept apart from this file's
 * DOM building so they are testable in plain Node (see that module's own
 * doc). This file is the thin layer that turns `WhereControlView` into four
 * real `<calcite-select>`s and wires their changes back through
 * `nextSelectionFor*`.
 *
 * Changing the choice is a navigation on every host this control is wired
 * into (`main.ts`, `snow.ts`, `drought.ts`), the same choice
 * `createLevelControl` already made and for the same reason: `?state=` and
 * `?area=` are read once, at initialization, by every one of the four
 * surfaces (S3a-d), and reproducing that resolution live -- for three pages
 * with three different rules about what the area axis even means (D5) --
 * would be three separate re-render paths behind one shared control. A full
 * navigation is the one path already proven to keep the four surfaces
 * honest, and it is what a shared link already does. The `location.replace`
 * call itself is not here, the same way it is not in `createLevelControl`:
 * this module only calls `onChange` with the selection a reader picked, and
 * each host's own wiring function decides what "changed" means for that
 * page.
 */
import "@esri/calcite-components/components/calcite-label";
import "@esri/calcite-components/components/calcite-option";
import "@esri/calcite-components/components/calcite-select";
import type { OpeningRosters, OpeningSelection } from "../data/opening-scope";
import {
  nextSelectionForArea,
  nextSelectionForRegion,
  nextSelectionForState,
  nextSelectionForSubregion,
  whereControlView,
  type WhereAxis
} from "./where-control-model";

/** The unnarrowed selection: nothing chosen at any level. Used only to ask
 * "is there anything to choose at all", so a state already narrowed down to
 * a region-less corner of the roster cannot make an otherwise-real control
 * report itself as empty. */
const NOTHING_CHOSEN: OpeningSelection = { state: "all", area: null };

export interface WhereControl {
  element: HTMLElement;
}

/* No `set()`, deliberately, and unlike `createLevelControl` which has one.
 *
 * All three hosts build this control from a selection that is already final:
 * the storage and snow pages widen for a deep link *before* constructing it,
 * and the drought page has no widening at all. Nothing reassigns the scope
 * afterwards, so a method to push a later selection in would never be
 * called, and an unreachable method is not insurance -- it is untested code
 * that reads as a supported path. When S5 adds a stored choice that can
 * arrive after first paint, that is the caller that earns it back. */

export interface WhereControlOptions {
  /**
   * The Calcite scale to build every select at.
   *
   * The same reasoning as `createLevelControl`'s own option: the storage
   * shell's panel is Calcite throughout at the default scale, while the
   * snow and drought filter bars hold native selects a third taller. A
   * control eleven pixels shorter than its neighbours reads as a different
   * kind of control rather than as one more of them.
   */
  scale?: "s" | "m" | "l";
}

/** Builds one `calcite-label`-wrapped `calcite-select` and appends it to
 * `host`, returning the select. `calcite-label` wrapping the component with
 * the text as its child is the one pattern axe-core accepts here: neither a
 * plain `<label>` nor the component's own `label` attribute names the
 * control inside its shadow root (this feature has already failed that
 * check twice). The select's own `label` attribute is still set, for the
 * accessible name -- and it says what changes, not what the control is, the
 * same rule `createLevelControl` follows: the visible text already says
 * "State" or "Region", and a screen reader hearing that twice learns
 * nothing the second time. */
function buildAxisSelect(
  host: HTMLElement, visibleLabel: string, accessibleLabel: string, scale: "s" | "m" | "l"
): HTMLElement {
  const label = document.createElement("calcite-label");
  label.append(visibleLabel);
  const select = document.createElement("calcite-select");
  select.setAttribute("scale", scale);
  select.setAttribute("label", accessibleLabel);
  label.append(select);
  host.append(label);
  return select;
}

/**
 * Replaces `select`'s options with `axis.options` and marks `axis.value`
 * selected.
 *
 * The `selected` attribute alone, not the attribute and an assigned `.value`.
 * This is not what `createLevelControl` does and the two are not the same
 * shape: that control builds its options once and never rebuilds them, using
 * `.value` only in a separate method, while this one rebuilds every axis on
 * every render because the lists below a change are different lists.
 *
 * Setting both was redundant rather than racy -- `document.createElement`
 * upgrades a registered Calcite element synchronously, and `calcite-select`
 * re-reads its options on a microtask, so the attribute is always seen. The
 * second write is dropped rather than explained, because two lines doing one
 * thing need a reason and there was none.
 */
function fillAxisSelect(select: HTMLElement, axis: WhereAxis): void {
  select.replaceChildren();
  for (const option of axis.options) {
    const node = document.createElement("calcite-option");
    node.setAttribute("value", option.value);
    node.textContent = option.label;
    if (option.value === axis.value) node.setAttribute("selected", "");
    select.append(node);
  }
}

/**
 * Builds the where control: a state select and a region/subregion/drainage-
 * area drill-down, all four repopulated together from one narrowed
 * `whereControlView` every time any of them changes.
 *
 * Returns `null` when there is nothing to choose -- both axes empty, which
 * is what an unpublished or unreachable reference export degrades to
 * (`EMPTY_OPENING_ROSTERS` in `data/opening-scope.ts`). A roster that
 * publishes states but no region tier, or the reverse, still builds a
 * control: there is a real choice on at least one axis, so nothing here
 * decides those two are yoked together the way `createLevelControl`'s
 * single select does.
 */
export function createWhereControl(
  rosters: OpeningRosters,
  current: OpeningSelection,
  onChange: (selection: OpeningSelection) => void,
  options: WhereControlOptions = {}
): WhereControl | null {
  const gate = whereControlView(rosters, NOTHING_CHOSEN);
  /* Nothing to choose on *any* axis, not just the two coarsest. Checking
   * state and region alone would build no control for a payload that offers
   * subregions or drainage areas without them -- which is what a scope
   * narrowed to one state looks like. */
  const nothingOffered = (axis: WhereAxis): boolean => axis.options.length <= 1;
  if (nothingOffered(gate.state) && nothingOffered(gate.region)
    && nothingOffered(gate.subregion) && nothingOffered(gate.area)) return null;

  const view = whereControlView(rosters, current);

  const scale = options.scale ?? "m";
  let selection = current;

  const wrapper = document.createElement("div");
  wrapper.className = "where-control";

  const stateSelect = buildAxisSelect(wrapper, "State", "Which state to show", scale);
  const regionSelect = buildAxisSelect(wrapper, "Region", "Which region to show", scale);
  const subregionSelect = buildAxisSelect(wrapper, "Subregion", "Which subregion to show", scale);
  const areaSelect = buildAxisSelect(wrapper, "Drainage area", "Which drainage area to show", scale);

  function render(): void {
    const next = whereControlView(rosters, selection);
    fillAxisSelect(stateSelect, next.state);
    fillAxisSelect(regionSelect, next.region);
    fillAxisSelect(subregionSelect, next.subregion);
    fillAxisSelect(areaSelect, next.area);
  }

  function commit(next: OpeningSelection): void {
    selection = next;
    render();
    onChange(selection);
  }

  stateSelect.addEventListener("calciteSelectChange", () => {
    commit(nextSelectionForState(selection, rosters, (stateSelect as unknown as { value: string }).value));
  });
  regionSelect.addEventListener("calciteSelectChange", () => {
    commit(nextSelectionForRegion(selection, (regionSelect as unknown as { value: string }).value));
  });
  subregionSelect.addEventListener("calciteSelectChange", () => {
    commit(nextSelectionForSubregion(selection, (subregionSelect as unknown as { value: string }).value));
  });
  areaSelect.addEventListener("calciteSelectChange", () => {
    commit(nextSelectionForArea(selection, (areaSelect as unknown as { value: string }).value));
  });

  fillAxisSelect(stateSelect, view.state);
  fillAxisSelect(regionSelect, view.region);
  fillAxisSelect(subregionSelect, view.subregion);
  fillAxisSelect(areaSelect, view.area);

  return { element: wrapper };
}
