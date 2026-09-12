/**
 * Returns the active route key when its synthetic wide-pane transition has not
 * completed yet. The caller retains the most recently emitted key: a stable
 * active route is emitted once, while returning to it after another route has
 * become active emits its next entering transition.
 */
export function getPendingWideTransitionEndRouteKey(
  lastEmittedRouteKey: string | null,
  activeRouteKey: string | undefined,
): string | null {
  if (!activeRouteKey || activeRouteKey === lastEmittedRouteKey) {
    return null;
  }

  return activeRouteKey;
}
