export const SWIPE_REPLY_MAX = 44;
export const SWIPE_REPLY_TRIGGER = 32;
export const SWIPE_REPLY_ACTIVATION = 12;
export const SWIPE_REPLY_ARMED_FROM = SWIPE_REPLY_TRIGGER - 4;

/** Preserve the drag direction while rubber-banding equally past either edge. */
export function constrainSwipeReplyOffset(offset: number): number {
  'worklet';
  const distance = Math.abs(offset);
  if (distance <= SWIPE_REPLY_MAX) return offset;

  const direction = offset < 0 ? -1 : 1;
  return direction * (SWIPE_REPLY_MAX + (distance - SWIPE_REPLY_MAX) * 0.15);
}

export function swipeReplyDistance(offset: number): number {
  'worklet';
  return Math.abs(offset);
}

/** Keep the affordance on the attachment body, outside its inward action slot. */
export function swipeReplyEdgeInset(
  hasAttachment: boolean,
  isSelf: boolean,
  edge: 'start' | 'end',
  inwardSlotSize: number,
): number {
  if (!hasAttachment) return 0;
  const inwardEdge = isSelf ? 'start' : 'end';
  return edge === inwardEdge ? inwardSlotSize : 0;
}
