import {
  constrainSwipeReplyOffset,
  SWIPE_REPLY_ACTIVATION,
  SWIPE_REPLY_MAX,
  SWIPE_REPLY_TRIGGER,
  swipeReplyActivationOffset,
  swipeReplyDistance,
  swipeReplyEdgeInset,
} from '../swipe-reply';

describe('swipe reply', () => {
  it('keeps only logical trailing-to-leading movement', () => {
    expect(constrainSwipeReplyOffset(SWIPE_REPLY_TRIGGER)).toBe(0);
    expect(constrainSwipeReplyOffset(-SWIPE_REPLY_TRIGGER)).toBe(
      -SWIPE_REPLY_TRIGGER,
    );
    expect(constrainSwipeReplyOffset(-(SWIPE_REPLY_MAX + 20))).toBe(
      -(SWIPE_REPLY_MAX + 3),
    );
  });

  it('arms only a logical trailing-to-leading swipe', () => {
    expect(swipeReplyDistance(SWIPE_REPLY_TRIGGER)).toBe(0);
    expect(swipeReplyDistance(-(SWIPE_REPLY_TRIGGER - 1))).toBeLessThan(
      SWIPE_REPLY_TRIGGER,
    );
    expect(swipeReplyDistance(-SWIPE_REPLY_TRIGGER)).toBe(SWIPE_REPLY_TRIGGER);
  });

  it('reverses the physical activation direction for RTL', () => {
    expect(swipeReplyActivationOffset(false)).toBe(-SWIPE_REPLY_ACTIVATION);
    expect(swipeReplyActivationOffset(true)).toBe(SWIPE_REPLY_ACTIVATION);
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
