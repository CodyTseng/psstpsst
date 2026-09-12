import {
  isNearMessageTail,
  MESSAGE_TAIL_FOLLOW_THRESHOLD,
  shouldRequestMessageTailScroll,
} from '../message-tail-follow';

describe('message tail following', () => {
  it('follows arrivals throughout the band where no scroll control is shown', () => {
    expect(isNearMessageTail(0)).toBe(true);
    expect(isNearMessageTail(24)).toBe(true);
    expect(isNearMessageTail(MESSAGE_TAIL_FOLLOW_THRESHOLD)).toBe(true);
  });

  it('stages arrivals once the reader is far enough up to see the control', () => {
    expect(isNearMessageTail(MESSAGE_TAIL_FOLLOW_THRESHOLD + 1)).toBe(false);
  });

  it('lets MVCP settle an arrival that is already pinned at the bottom', () => {
    expect(
      shouldRequestMessageTailScroll({ fromSelf: true, nearTail: true, atBottom: true }),
    ).toBe(false);
  });

  it('requests one corrective scroll only when the released message is off the bottom', () => {
    expect(
      shouldRequestMessageTailScroll({ fromSelf: true, nearTail: false, atBottom: false }),
    ).toBe(true);
    expect(
      shouldRequestMessageTailScroll({ fromSelf: false, nearTail: true, atBottom: false }),
    ).toBe(true);
    expect(
      shouldRequestMessageTailScroll({ fromSelf: false, nearTail: false, atBottom: false }),
    ).toBe(false);
  });
});
