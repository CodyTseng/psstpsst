import {
  constrainSwipeReplyOffset,
  SWIPE_REPLY_MAX,
  SWIPE_REPLY_TRIGGER,
  swipeReplyDistance,
  swipeReplyEdgeInset,
} from '../swipe-reply';

describe('swipe reply', () => {
  it.each([-1, 1])(
    'preserves direction %i before and after resistance',
    (direction) => {
      expect(constrainSwipeReplyOffset(direction * SWIPE_REPLY_TRIGGER)).toBe(
        direction * SWIPE_REPLY_TRIGGER,
      );
      expect(
        constrainSwipeReplyOffset(direction * (SWIPE_REPLY_MAX + 20)),
      ).toBe(direction * (SWIPE_REPLY_MAX + 3));
    },
  );

  it('uses the same reply threshold in both directions', () => {
    expect(swipeReplyDistance(SWIPE_REPLY_TRIGGER - 1)).toBeLessThan(
      SWIPE_REPLY_TRIGGER,
    );
    expect(swipeReplyDistance(-(SWIPE_REPLY_TRIGGER - 1))).toBeLessThan(
      SWIPE_REPLY_TRIGGER,
    );
    expect(swipeReplyDistance(SWIPE_REPLY_TRIGGER)).toBe(SWIPE_REPLY_TRIGGER);
    expect(swipeReplyDistance(-SWIPE_REPLY_TRIGGER)).toBe(SWIPE_REPLY_TRIGGER);
  });

  it('keeps reply affordances out of the attachment action slot', () => {
    const inwardSlotSize = 44;
    expect(swipeReplyEdgeInset(true, true, 'start', inwardSlotSize)).toBe(
      inwardSlotSize,
    );
    expect(swipeReplyEdgeInset(true, true, 'end', inwardSlotSize)).toBe(0);
    expect(swipeReplyEdgeInset(true, false, 'start', inwardSlotSize)).toBe(0);
    expect(swipeReplyEdgeInset(true, false, 'end', inwardSlotSize)).toBe(
      inwardSlotSize,
    );
    expect(swipeReplyEdgeInset(false, true, 'start', inwardSlotSize)).toBe(0);
  });
});
