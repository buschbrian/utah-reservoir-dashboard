/**
 * Collapses a long filter bar on a phone without changing its desktop form.
 *
 * CSS decides when the bar is narrow enough to collapse. This function owns
 * only the reader's explicit open state and the button's accessible name, so
 * rotating the page cannot leave the words and the visible controls out of
 * agreement.
 */
export function wireMobileFilterDisclosure(
  filterbar: HTMLElement,
  toggle: HTMLButtonElement
): void {
  const setOpen = (open: boolean): void => {
    filterbar.classList.toggle("mobile-filters-open", open);
    toggle.setAttribute("aria-expanded", String(open));
    toggle.textContent = open ? "Hide filters" : "Show filters";
  };

  setOpen(false);
  toggle.addEventListener("click", () => {
    setOpen(toggle.getAttribute("aria-expanded") !== "true");
  });
}
