/**
 * The scroll-to-latest control appears only beyond this inverted-list offset.
 * Inside the same band, incoming messages follow the live tail immediately.
 */
export const MESSAGE_TAIL_FOLLOW_THRESHOLD = 300;

/** Start fetching history before FlatList reaches its rendered edge. FlatList
 * can miss its edge callback when a fast fling outruns the rendered window, so
 * scroll and settled events use this wider distance as a low-cost fallback. */
export const MESSAGE_HISTORY_PREFETCH_VIEWPORTS = 2;

export function messageHistoryPageRequest({
  ready,
  hasMore,
  loading,
  continuous,
  initialAvailable,
}: {
  ready: boolean;
  hasMore: boolean;
  loading: boolean;
  continuous: boolean;
  initialAvailable: boolean;
}): { request: boolean; consumeInitial: boolean } {
  if (!ready || !hasMore || loading) {
    return { request: false, consumeInitial: false };
  }
  if (continuous) return { request: true, consumeInitial: false };
  return initialAvailable
    ? { request: true, consumeInitial: true }
    : { request: false, consumeInitial: false };
}

export function isNearMessageTail(offsetY: number): boolean {
  return offsetY <= MESSAGE_TAIL_FOLLOW_THRESHOLD;
}

export function isNearMessageHistoryEdge({
  offsetY,
  contentHeight,
  viewportHeight,
}: {
  offsetY: number;
  contentHeight: number;
  viewportHeight: number;
}): boolean {
  if (viewportHeight <= 0 || contentHeight <= viewportHeight) return true;
  const distanceFromEdge = contentHeight - viewportHeight - offsetY;
  return distanceFromEdge <= viewportHeight * MESSAGE_HISTORY_PREFETCH_VIEWPORTS;
}

/** Native position anchoring is only needed when an anchored window prepends
 * newer rows. In tail mode, arrivals are staged while the reader is away from
 * the bottom, and older pages append beyond the visible history edge. */
export function shouldMaintainVisibleMessagePosition({
  anchored,
  initialPositionReady,
}: {
  anchored: boolean;
  initialPositionReady: boolean;
}): boolean {
  return anchored && initialPositionReady;
}

export type MessageTailScrollMode = 'instant' | 'animated' | null;

export function messageTailScrollMode({
  fromSelf,
  nearTail,
  atBottom,
}: {
  fromSelf: boolean;
  nearTail: boolean;
  atBottom: boolean;
}): MessageTailScrollMode {
  if (!fromSelf && !nearTail) return null;
  return atBottom ? 'instant' : 'animated';
}
