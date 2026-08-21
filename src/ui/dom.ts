export function elementById<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing #${id}`);
  return element as T;
}

/**
 * Puts a control into its named slot, or at the end of the host when the
 * host has no such slot.
 *
 * The geographic drill-down and the area-size control are both built after
 * first paint -- one waits on the roster, the other on the reference export
 * -- so the order they reach a host in is the order two promises happened to
 * settle in. Appending made that order the reader's, which is how the snow
 * page came to offer "State" below "Reporting" and two controls called
 * "Drainage area" four rows apart. The template names the position; this
 * finds it.
 *
 * The fallback is not defensive padding: `createWhereControl` and
 * `createLevelControl` are shared by four hosts, and a host that has not
 * declared a slot should still get its control rather than lose it.
 */
export function placeInSlot(host: HTMLElement, slot: string, control: HTMLElement): void {
  const target = host.querySelector<HTMLElement>(`.control-slot[data-slot="${slot}"]`);
  (target ?? host).append(control);
}
