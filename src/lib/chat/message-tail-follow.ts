/**
 * The scroll-to-latest control appears only beyond this inverted-list offset.
 * Inside the same band, incoming messages follow the live tail immediately.
 */
export const MESSAGE_TAIL_FOLLOW_THRESHOLD = 300;

/** Match MessageList's onEndReached prefetch distance. FlatList can miss its
 * edge callback when a fast fling outruns the rendered window, so the settled
 * scroll events use the same distance as a low-cost fallback. */
export const MESSAGE_HISTORY_PREFETCH_VIEWPORTS = 2;

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
