/**
 * The scroll-to-latest control appears only beyond this inverted-list offset.
 * Inside the same band, incoming messages follow the live tail immediately.
 */
export const MESSAGE_TAIL_FOLLOW_THRESHOLD = 300;

export function isNearMessageTail(offsetY: number): boolean {
  return offsetY <= MESSAGE_TAIL_FOLLOW_THRESHOLD;
}

export function shouldRequestMessageTailScroll({
  fromSelf,
  nearTail,
  atBottom,
}: {
  fromSelf: boolean;
  nearTail: boolean;
  atBottom: boolean;
}): boolean {
  return !atBottom && (fromSelf || nearTail);
}
