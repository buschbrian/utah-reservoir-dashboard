/**
 * Collapses long supporting content on a phone without changing its desktop form.
 *
 * CSS decides when the bar is narrow enough to collapse. This function owns
 * only the reader's explicit open state and the button's accessible name, so
 * rotating the page cannot leave the words and the visible controls out of
 * agreement.
 */
export interface MobileDisclosureOptions {
  openClass: string;
  openLabel: string;
  closedLabel: string;
}

/** Give any long phone-only disclosure the same explicit, announced state. */
export function wireMobileDisclosure(
  container: HTMLElement,
  toggle: HTMLButtonElement,
  options: MobileDisclosureOptions
): void {
  const setOpen = (open: boolean): void => {
    container.classList.toggle(options.openClass, open);
    toggle.setAttribute("aria-expanded", String(open));
    toggle.textContent = open ? options.openLabel : options.closedLabel;
  };

  setOpen(false);
  toggle.addEventListener("click", () => {
    setOpen(toggle.getAttribute("aria-expanded") !== "true");
  });
}

export function wireMobileFilterDisclosure(
  filterbar: HTMLElement,
  toggle: HTMLButtonElement
): void {
  wireMobileDisclosure(filterbar, toggle, {
    openClass: "mobile-filters-open",
    openLabel: "Hide filters",
    closedLabel: "Show filters"
  });
}
