/*
 * The control that picks how finely the ground is divided.
 *
 * A `calcite-select` with one option per offered level, built from what the
 * reference export publishes rather than from a list written here: a level
 * with no roster behind it is a control that empties the map (ADR-064). When
 * the export offers only one, there is nothing to choose and no control is
 * built at all.
 */
import "@esri/calcite-components/components/calcite-label";
import "@esri/calcite-components/components/calcite-option";
import "@esri/calcite-components/components/calcite-select";
import { levelLabel } from "../state/level";

export interface LevelControl {
  element: HTMLElement;
  /** Reflect a level the page adopted from somewhere else, such as a link. */
  set(level: number): void;
}

export interface LevelControlOptions {
  /**
   * The Calcite scale to build the select at.
   *
   * It has to match the controls beside it, and the two hosts differ: the
   * storage shell's panel is Calcite throughout at the default scale, while
   * the snow and drought filter bars hold native selects a third taller. A
   * control eleven pixels shorter than its neighbours reads as a different
   * kind of control rather than as one more of them.
   */
  scale?: "s" | "m" | "l";
}

export function createLevelControl(
  offered: readonly number[], current: number, onChange: (level: number) => void,
  options: LevelControlOptions = {}
): LevelControl | null {
  if (offered.length < 2) return null;
  const label = document.createElement("calcite-label");
  label.className = "level-control";
  label.append("Area size");
  const select = document.createElement("calcite-select");
  select.setAttribute("scale", options.scale ?? "m");
  /* The accessible name says what changes, not what the control is: the
   * visible label already says "Area size", and a screen reader hearing it
   * twice learns nothing the second time. */
  select.setAttribute("label", "How finely the drainage areas are divided");
  for (const level of offered) {
    const option = document.createElement("calcite-option");
    option.setAttribute("value", String(level));
    option.textContent = levelLabel(level);
    if (level === current) option.setAttribute("selected", "");
    select.append(option);
  }
  select.addEventListener("calciteSelectChange", () => {
    const chosen = Number((select as unknown as { value: string }).value);
    if (Number.isInteger(chosen)) onChange(chosen);
  });
  label.append(select);
  return {
    element: label,
    set(level: number): void {
      (select as unknown as { value: string }).value = String(level);
    }
  };
}
