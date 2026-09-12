/**
 * Width of the left-edge strip that every horizontal swipe gesture must leave
 * free so the OS back-swipe (iOS `UIScreenEdgePan`) wins there. A rightward
 * drag starting inside this strip would otherwise fight the navigator's pop
 * gesture and the user could never swipe back over a swipeable row/bubble.
 *
 * Apply it as a negative-left `hitSlop` (`{ left: -BACK_SWIPE_GUARD }`) on any
 * pan / `Swipeable` whose leading (left→right) drag begins near the screen edge.
 */
export const BACK_SWIPE_GUARD = 30;

/**
 * Single-open coordinator for `Swipeable` rows (the conversation lists). A row
 * registers its close fn when it opens; opening one row closes whichever was
 * open before, and a tap elsewhere / a list scroll calls
 * {@link closeOpenSwipeable} to dismiss it — so at most one row's swipe menu is
 * ever open, and tapping outside it (another row, the blank area, a scroll)
 * snaps it shut, the way iOS list rows behave.
 *
 * Module-level (not React state) on purpose: it's shared across every list that
 * renders the row, needs no re-render to coordinate, and the open row is a
 * singleton by nature. Pass a **stable** close fn (a `useCallback`) so the
 * identity checks below hold across re-renders.
 */
let openSwipeableClose: (() => void) | null = null;

/** A row just opened: close the previously-open one and remember this one. */
export function registerOpenSwipeable(close: () => void): void {
  if (openSwipeableClose && openSwipeableClose !== close) openSwipeableClose();
  openSwipeableClose = close;
}

/** A row closed: forget it iff it's the one we were tracking (a stale close
 * from a different row must not clear a newer registration). */
export function clearOpenSwipeable(close: () => void): void {
  if (openSwipeableClose === close) openSwipeableClose = null;
}

/** Close the open row, if any. Returns whether one was open. Used by the
 * "tap/scroll outside" dismissers (list scroll, blank footer) and when a tap
 * lands on a **different** row — there we close the open menu but still let the
 * tapped row act (open its chat). */
export function closeOpenSwipeable(): boolean {
  if (!openSwipeableClose) return false;
  openSwipeableClose();
  openSwipeableClose = null;
  return true;
}

/** Close the open row **only if it is `close`'s own** row, returning whether it
 * was. Lets a row tell "I'm the open one — this tap should just dismiss me (and
 * be swallowed)" apart from "a different row is open — dismiss it, but still open
 * the chat I tapped". */
export function closeIfOpen(close: () => void): boolean {
  if (openSwipeableClose !== close) return false;
  openSwipeableClose();
  openSwipeableClose = null;
  return true;
}
