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
  /** Reflect a selection the page adopted from somewhere else, such as a
   * link, without treating it as a reader interaction -- `onChange` is not
   * called. */
  set(selection: OpeningSelection): void;
}

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

/** Replaces `select`'s options with `axis.options`, marking `axis.value`
 * selected, and sets the element's `value` to match -- the same two-step
 * `createLevelControl` uses (a `selected` attribute for first paint, an
 * assigned `.value` for a select being rebuilt after the component has
 * already upgraded). */
function fillAxisSelect(select: HTMLElement, axis: WhereAxis): void {
  select.replaceChildren();
  for (const option of axis.options) {
    const node = document.createElement("calcite-option");
    node.setAttribute("value", option.value);
    node.textContent = option.label;
    if (option.value === axis.value) node.setAttribute("selected", "");
    select.append(node);
  }
  (select as unknown as { value: string }).value = axis.value;
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
  if (gate.state.options.length <= 1 && gate.region.options.length <= 1) return null;

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

  return {
    element: wrapper,
    set(next: OpeningSelection): void {
      selection = next;
      render();
    }
  };
}
