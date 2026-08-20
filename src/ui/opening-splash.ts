/*
 * The first-visit question: where, and what.
 *
 * A reader arriving with no link and no remembered place lands on the whole
 * west -- 75 drainage areas, eleven states, and about two hundred reservoirs.
 * That is the honest default and it is a lot to be handed. This asks the two
 * questions that turn it into the page they wanted, and gets out of the way.
 *
 * ## When it appears, which is the constraint everything else bends to
 *
 * Only when nothing else has answered: no `?state=`, no `?area=`, no stored
 * place, and not dismissed before. **A shared link never lands on an
 * interstitial** -- someone opening a colleague's link is being shown a
 * thing, and a dialog in front of it is a worse version of the page they
 * were sent. `resolveOpeningPlace` already reports which of those answered,
 * so this reads its `source` rather than re-deriving the rule.
 *
 * ## Two decisions, taken here rather than left implicit
 *
 * **States and regions are one list, not two tabs.** Sixteen choices is a
 * lot at 360 pixels, which is the argument for tabs, and it is the wrong
 * argument: a tab hides half the answers behind an interaction a reader has
 * to guess is there. Two headed groups in one scrolling column shows every
 * choice at every width and costs a scroll instead of a discovery.
 *
 * **No counts on the tiles, for now.** The design that ordered this wanted
 * "eleven reservoirs, eighty-five snow sites" beside each place, and that is
 * genuinely better -- it is what makes offering a state with no reservoirs
 * obviously right rather than apparently broken. It needs all three payloads,
 * and a dialog that waits on three fetches is an interstitial that arrives
 * late, which is the one thing this shape must not be. So it opens on what
 * `reference.json` already answers -- which places exist and what they are
 * called -- and the counts wait for a way to have them without the wait.
 *
 * ## Not Calcite
 *
 * A native `<dialog>`: it traps focus, closes on Escape, and exposes a real
 * accessible name without a shadow root between the label and the control.
 * Calcite's own switch was refused by axe-core at all three widths earlier in
 * this feature's life for exactly that reason, and the filter bars this sits
 * beside already hold native controls.
 */
import { EVERYWHERE, type OpeningSelection } from "../data/opening-scope";
import type { DrainageArea } from "../data/boundaries";
import { searchWithPlace } from "../state/opening-preference";
import { stateName } from "../data/state-vocabulary";

const DISMISSED_STORAGE_KEY = "utah-reservoir-dashboard-splash-dismissed";

/** The three surfaces a place can be applied to. `href` is what the reader's
 * choice is appended to; `label` is what the button says. */
const SUBJECTS = [
  { key: "storage", href: "./index.html", label: "Reservoir storage" },
  { key: "snow", href: "./snow.html", label: "Snowpack" },
  { key: "drought", href: "./drought.html", label: "Drought" }
] as const;

type SubjectKey = (typeof SUBJECTS)[number]["key"];

export interface SplashPlaces {
  /** Two-letter codes, from `offeredStates`. Never written down here. */
  states: readonly string[];
  /** The five regions, from the published `west-huc2` scope. */
  regions: readonly DrainageArea[];
}

function wasDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISSED_STORAGE_KEY) !== null;
  } catch {
    /* Storage that refuses to answer is not a reader who has seen this. It
     * does mean the dialog cannot be dismissed for good, so it is shown once
     * per visit rather than never -- the alternative is never showing it to
     * anyone with cookies blocked. */
    return false;
  }
}

function markDismissed(): void {
  try {
    localStorage.setItem(DISMISSED_STORAGE_KEY, "1");
  } catch {
    // Nothing to do: the reader keeps the page they are on.
  }
}

/**
 * Whether to ask at all.
 *
 * Exported and pure so the rule is testable without a browser, and so the
 * one condition that matters -- a link is never interrupted -- is asserted
 * rather than trusted.
 */
export function shouldAskWhere(
  source: "link" | "stored" | "default", dismissed: boolean,
  search: string | null | undefined = ""
): boolean {
  if (dismissed || source !== "default") return false;
  /* Any parameter at all, not only a place.
   *
   * `resolveOpeningPlace` reports "default" for a link that names no state
   * and no area -- and `?reservoir=Flaming+Gorge` is such a link. It is also
   * unmistakably someone showing someone else a thing, and opening a modal
   * over it is the failure this whole rule exists to prevent. The same goes
   * for `?site=`, `?basin=`, `?month=`, `?level=`: none of them is a place,
   * every one of them is an intention someone arrived with.
   *
   * So the test is emptiness rather than a list of names. A list would have
   * to be kept in step with every parameter any surface ever adds, and the
   * failure mode of forgetting one is a reader's link buried under a dialog
   * -- which is exactly what happened here, caught by the one smoke case
   * that follows a link to a reservoir. */
  return String(search ?? "").replace(/^\?+/, "") === "";
}

function placeButton(
  label: string, selection: OpeningSelection, onChoose: (selection: OpeningSelection) => void
): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "splash-place";
  button.textContent = label;
  button.addEventListener("click", () => { onChoose(selection); });
  return button;
}

export interface OpeningSplash {
  element: HTMLDialogElement;
  open(): void;
}

/**
 * Builds the dialog. Returns `null` when there is nothing to offer, which is
 * the same answer `createWhereControl` gives for the same reason: a chooser
 * with one choice on it is furniture.
 */
export function createOpeningSplash(places: SplashPlaces): OpeningSplash | null {
  if (places.states.length < 2 && places.regions.length < 2) return null;

  const dialog = document.createElement("dialog");
  dialog.className = "opening-splash";
  dialog.setAttribute("aria-labelledby", "splash-heading");

  const heading = document.createElement("h2");
  heading.id = "splash-heading";
  heading.textContent = "Where do you want to start?";
  dialog.append(heading);

  const intro = document.createElement("p");
  intro.className = "splash-intro";
  intro.textContent = "This site covers the western United States. "
    + "Choose a place and a subject, or see all of it.";
  dialog.append(intro);

  /* The subject is chosen first and remembered only for as long as this
   * dialog is open. It is not a parameter and not stored: it decides which
   * page the chosen place is applied to, and the navigation bar carries the
   * place onto the other two if the reader goes looking. */
  let subject: SubjectKey = "storage";

  const subjectGroup = document.createElement("fieldset");
  subjectGroup.className = "splash-subjects";
  const subjectLegend = document.createElement("legend");
  subjectLegend.textContent = "Show me";
  subjectGroup.append(subjectLegend);
  for (const entry of SUBJECTS) {
    const label = document.createElement("label");
    const radio = document.createElement("input");
    radio.type = "radio";
    radio.name = "splash-subject";
    radio.value = entry.key;
    radio.checked = entry.key === subject;
    radio.addEventListener("change", () => {
      if (radio.checked) subject = entry.key;
    });
    label.append(radio, document.createTextNode(entry.label));
    subjectGroup.append(label);
  }
  dialog.append(subjectGroup);

  const choose = (selection: OpeningSelection): void => {
    markDismissed();
    const target = SUBJECTS.find((entry) => entry.key === subject) ?? SUBJECTS[0];
    /* `searchWithPlace` remembers the place and writes "everywhere" out loud.
     * Built from an empty search rather than this page's, because the reader
     * is being sent to a different surface and the parameters this one is
     * carrying are its own. */
    window.location.href = `${target.href}${searchWithPlace("", selection)}`;
  };

  const places_ = document.createElement("div");
  places_.className = "splash-places";

  const statesHeading = document.createElement("h3");
  statesHeading.textContent = "A state";
  places_.append(statesHeading);
  const stateList = document.createElement("div");
  stateList.className = "splash-place-list";
  for (const code of places.states) {
    stateList.append(placeButton(stateName(code), { state: code, area: null }, choose));
  }
  places_.append(stateList);

  if (places.regions.length > 0) {
    const regionHeading = document.createElement("h3");
    regionHeading.textContent = "A river basin";
    places_.append(regionHeading);
    const regionList = document.createElement("div");
    regionList.className = "splash-place-list";
    for (const region of places.regions) {
      /* Named at its own level, the rule the drainage-area control follows:
       * a bare name would collide with the basins that share it. */
      regionList.append(placeButton(
        region.name, { state: EVERYWHERE, area: region.huc6 }, choose));
    }
    places_.append(regionList);
  }
  dialog.append(places_);

  /* The skip is a real answer and gets one click, not a corner cross. A
   * reader who wants the whole west is not declining to answer. */
  const skip = document.createElement("button");
  skip.type = "button";
  skip.className = "splash-skip";
  skip.textContent = "Show the whole west";
  skip.addEventListener("click", () => {
    markDismissed();
    dialog.close();
  });
  dialog.append(skip);

  /* Escape closes a native dialog on its own, and it must mean the same as
   * the skip: the reader has answered "not now" and should not be asked
   * again on the next page. */
  dialog.addEventListener("close", markDismissed);

  return {
    element: dialog,
    open(): void {
      if (typeof dialog.showModal === "function") dialog.showModal();
      else dialog.setAttribute("open", "");
    }
  };
}

export { DISMISSED_STORAGE_KEY, wasDismissed };
