/*
 * The map's key, and the only thing on the page that explains what a circle
 * means.
 *
 * Generated from `STORAGE_CLASSES`, never written out by hand (ADR-008). A
 * legend is the one component whose whole job is to agree with the renderer,
 * so a hand-kept copy of the breaks is a caption that can lie about the map
 * it sits next to -- and it would lie silently, because nothing else on the
 * page reads it.
 *
 * The two comparison maps have carried a key since the first version; the
 * 5.1 application shipped without one, which left the colours, the circle
 * sizes and the dashed ring undocumented on the surface that is now the
 * root of the site.
 */
import { STALE_ACCENT, STALE_COLOR, STORAGE_CLASSES } from "../viz/classes";

/**
 * One entry per class, plus the three symbols that are not a storage class:
 * the circle's size, the dashed ring for a late reading, and the grey circle
 * for a reservoir with no usable percentage.
 */
export function renderLegend(host: HTMLElement): void {
  const classes = document.createElement("ul");
  classes.className = "legend-classes";
  for (const storageClass of STORAGE_CLASSES) {
    const item = document.createElement("li");
    const swatch = document.createElement("span");
    swatch.className = "legend-swatch";
    swatch.style.background = storageClass.color;
    const label = document.createElement("span");
    label.textContent = storageClass.label;
    item.append(swatch, label);
    classes.append(item);
  }

  const notes = document.createElement("ul");
  notes.className = "legend-notes";

  /* Drawn as real elements rather than described in a sentence: these three
   * are shapes on the map, and a reader matching a circle to a caption
   * should be matching it against the same circle. */
  const sizeNote = document.createElement("li");
  const sizeMarks = document.createElement("span");
  sizeMarks.className = "legend-sizes";
  sizeMarks.setAttribute("aria-hidden", "true");
  for (const diameter of [6, 10, 15]) {
    const circle = document.createElement("span");
    circle.className = "legend-size";
    circle.style.inlineSize = `${diameter}px`;
    circle.style.blockSize = `${diameter}px`;
    sizeMarks.append(circle);
  }
  const sizeText = document.createElement("span");
  sizeText.textContent = "Larger circle: holds more water when full";
  sizeNote.append(sizeMarks, sizeText);

  const lateNote = document.createElement("li");
  const lateMark = document.createElement("span");
  lateMark.className = "legend-swatch legend-swatch-late";
  lateMark.style.borderColor = STALE_ACCENT;
  lateMark.setAttribute("aria-hidden", "true");
  const lateText = document.createElement("span");
  lateText.textContent = "Dashed ring: the reading is late";
  lateNote.append(lateMark, lateText);

  const unknownNote = document.createElement("li");
  const unknownMark = document.createElement("span");
  unknownMark.className = "legend-swatch";
  unknownMark.style.background = STALE_COLOR;
  unknownMark.setAttribute("aria-hidden", "true");
  const unknownText = document.createElement("span");
  unknownText.textContent = "Grey circle: no recent storage reading";
  unknownNote.append(unknownMark, unknownText);

  notes.append(sizeNote, lateNote, unknownNote);
  host.replaceChildren(classes, notes);
}
