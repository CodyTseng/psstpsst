import {
  isNearMessageHistoryEdge,
  isNearMessageTail,
  messageTailScrollMode,
  MESSAGE_HISTORY_PREFETCH_VIEWPORTS,
  MESSAGE_TAIL_FOLLOW_THRESHOLD,
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

  it('retries older pagination when a settled fling reaches the history edge', () => {
    const viewportHeight = 800;
    const contentHeight = 4000;
    const threshold = viewportHeight * MESSAGE_HISTORY_PREFETCH_VIEWPORTS;

    expect(
      isNearMessageHistoryEdge({
        offsetY: contentHeight - viewportHeight - threshold,
        contentHeight,
        viewportHeight,
      }),
    ).toBe(true);
    expect(
      isNearMessageHistoryEdge({
        offsetY: contentHeight - viewportHeight - threshold - 1,
        contentHeight,
        viewportHeight,
      }),
    ).toBe(false);
  });

  it('treats fast-fling overshoot and short histories as being at the history edge', () => {
    expect(
      isNearMessageHistoryEdge({
        offsetY: 3400,
        contentHeight: 4000,
        viewportHeight: 800,
      }),
    ).toBe(true);
    expect(
      isNearMessageHistoryEdge({
        offsetY: 0,
        contentHeight: 600,
        viewportHeight: 800,
      }),
    ).toBe(true);
  });

  it('corrects an arrival instantly when already pinned at the bottom', () => {
    expect(
      messageTailScrollMode({ fromSelf: true, nearTail: true, atBottom: true }),
    ).toBe('instant');
  });

  it('animates released messages near the tail without moving a history reader', () => {
    expect(
      messageTailScrollMode({ fromSelf: true, nearTail: false, atBottom: false }),
    ).toBe('animated');
    expect(
      messageTailScrollMode({ fromSelf: false, nearTail: true, atBottom: false }),
    ).toBe('animated');
    expect(
      messageTailScrollMode({ fromSelf: false, nearTail: false, atBottom: false }),
    ).toBeNull();
  });
});
