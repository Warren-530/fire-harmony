// A press outside a menu or a popover closes it, and that press does nothing else: the click it makes is swallowed,
// so closing the Download menu over the map never also picks a hexagon (or a button under the pointer). Used by the
// Download menu, the Period month picker and the phone sheet (a drag is not a click either).

/** Swallow the next click of this press (it ends at the next pointer up; a press that turns into a drag makes no
 *  click, and the guard goes away with it). */
export function swallowNextClick(): void {
  const stop = (ev: Event) => { ev.stopPropagation(); ev.preventDefault(); };
  window.addEventListener('click', stop, { capture: true, once: true });
  const done = () => {
    window.removeEventListener('pointerup', done, true);
    window.removeEventListener('pointercancel', done, true);
    // the click comes right after the pointer up, in the same task
    window.setTimeout(() => window.removeEventListener('click', stop, true), 0);
  };
  window.addEventListener('pointerup', done, true);
  window.addEventListener('pointercancel', done, true);
}

/** Call `close` on a press outside the elements, and swallow that press's click. Returns the cleanup. */
export function onPressOutside(inside: () => (Node | null | undefined)[], close: () => void): () => void {
  const away = (e: PointerEvent) => {
    const n = e.target as Node;
    if (inside().some((el) => el?.contains(n))) return;
    swallowNextClick();
    close();
  };
  document.addEventListener('pointerdown', away, true);
  return () => document.removeEventListener('pointerdown', away, true);
}
