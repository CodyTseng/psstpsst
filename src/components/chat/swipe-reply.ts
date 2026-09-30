export const SWIPE_REPLY_MAX = 44;
export const SWIPE_REPLY_TRIGGER = 32;
export const SWIPE_REPLY_ACTIVATION = 12;
export const SWIPE_REPLY_ARMED_FROM = SWIPE_REPLY_TRIGGER - 4;

/** Keep only a logical trailing-to-leading drag and rubber-band past its limit. */
export function constrainSwipeReplyOffset(offset: number): number {
  'worklet';
  const distance = Math.max(0, -offset);
  if (distance === 0) return 0;
  if (distance <= SWIPE_REPLY_MAX) return offset;

  return -(SWIPE_REPLY_MAX + (distance - SWIPE_REPLY_MAX) * 0.15);
}

export function swipeReplyDistance(offset: number): number {
  'worklet';
  return Math.max(0, -offset);
}

/** Activate toward physical start: left in LTR, right in RTL. */
export function swipeReplyActivationOffset(isRTL: boolean): number {
  return isRTL ? SWIPE_REPLY_ACTIVATION : -SWIPE_REPLY_ACTIVATION;
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
