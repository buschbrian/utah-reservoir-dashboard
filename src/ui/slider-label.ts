/*
 * Naming a Calcite slider's handle.
 *
 * The focusable control in a `calcite-slider` is not the host element -- it is
 * a `div` with `role="slider"` and `tabindex="0"` inside the component's
 * shadow root. In Calcite 5.1 that handle carries `aria-valuenow`,
 * `aria-valuemin` and `aria-valuemax` but no accessible name, and neither the
 * host's `aria-label` nor the component's own `label` property reaches it.
 * Both were tried and measured; axe-core reports `aria-input-field-name`
 * against the handle either way. A screen-reader user tabs onto a slider that
 * announces a number and no indication of what the number is.
 *
 * So the name is written onto the handle directly. Three things make that
 * defensible rather than a hack:
 *
 * - the shadow root is open, so this is reading the component's published
 *   surface rather than defeating encapsulation;
 * - Lit only manages the attributes its template binds, and the handle's
 *   template does not bind `aria-label` -- verified by driving the value and
 *   the `max` property and confirming the attribute survived both re-renders;
 * - if a later Calcite names the handle itself, its value wins, because this
 *   only writes when the handle has no name yet.
 *
 * The last point is why this checks before writing. The day Calcite fixes
 * this, the right outcome is that their name is used and this quietly stops
 * doing anything -- not that a stale copy of ours overwrites a better one.
 */

/** The shadow-root shape this needs, kept narrow so nothing else is reached. */
interface SliderHost extends HTMLElement {
  shadowRoot: ShadowRoot | null;
}

/** How long to keep looking for the handle. The component upgrades and
 * renders asynchronously, and a slider that has not rendered yet has no
 * handle to name -- but a slider that never renders must not leave a timer
 * running forever either. */
const RENDER_TIMEOUT_MS = 4000;
const RETRY_MS = 100;

function nameHandles(host: SliderHost, label: string): boolean {
  const handles = host.shadowRoot?.querySelectorAll('[role="slider"]');
  if (!handles || handles.length === 0) return false;
  for (const handle of handles) {
    /* Only when it has no name of its own. A future Calcite that labels its
     * own handles should win over this. */
    if (handle.getAttribute("aria-label")) continue;
    if (handle.getAttribute("aria-labelledby")) continue;
    handle.setAttribute("aria-label", label);
  }
  return true;
}

/**
 * Gives a slider's handle an accessible name, once the component has rendered
 * one. Safe to call before the element upgrades.
 */
export function nameSliderHandle(host: Element | null, label: string): void {
  if (!host) return;
  const slider = host as SliderHost;
  if (nameHandles(slider, label)) return;

  const deadline = Date.now() + RENDER_TIMEOUT_MS;
  const timer = setInterval(() => {
    if (nameHandles(slider, label) || Date.now() > deadline) clearInterval(timer);
  }, RETRY_MS);
}
