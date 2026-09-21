import {
  startsLoadedTimelineDay,
  startsLoadedSenderGroup,
  startsTimelineDay,
} from '../message-timeline-boundary';

const seconds = (day: number, hour: number) =>
  Math.floor(new Date(2026, 8, day, hour).getTime() / 1000);

describe('message timeline day boundaries', () => {
  it('keeps sender spacing unchanged when a same-sender older page arrives', () => {
    expect(startsLoadedSenderGroup(true, true)).toBe(false);
    expect(startsLoadedSenderGroup(false, false)).toBe(false);
    expect(startsLoadedSenderGroup(true, false)).toBe(true);
    expect(startsLoadedSenderGroup(false, null)).toBe(true);
    expect(startsLoadedSenderGroup(false, undefined)).toBe(false);
  });
  it('does not split same-day text from an older pending attachment', () => {
    const pendingAt = seconds(1, 12);
    expect(
      startsTimelineDay(
        { kind: 'message', message: { createdAt: seconds(1, 13) } },
        { kind: 'pending', pending: { messageOrderAt: pendingAt * 1000 } },
      ),
    ).toBe(false);
  });

  it('does not split a pending attachment from an older same-day message', () => {
    expect(
      startsTimelineDay(
        { kind: 'pending', pending: { startedAt: seconds(1, 13) } },
        { kind: 'message', message: { createdAt: seconds(1, 12) } },
      ),
    ).toBe(false);
  });

  it('starts a new day across item kinds', () => {
    expect(
      startsTimelineDay(
        { kind: 'message', message: { createdAt: seconds(2, 8) } },
        { kind: 'pending', pending: { startedAt: seconds(1, 23) } },
      ),
    ).toBe(true);
  });

  it('does not render a provisional capsule at an unknown loaded edge', () => {
    expect(
      startsLoadedTimelineDay(
        { kind: 'message', message: { createdAt: seconds(2, 8) } },
        undefined,
        undefined,
      ),
    ).toBe(false);
  });

  it('keeps the loaded-edge capsule stable when the older page arrives', () => {
    const current = { kind: 'message', message: { createdAt: seconds(2, 8) } } as const;
    const olderAt = seconds(1, 23);

    expect(startsLoadedTimelineDay(current, undefined, olderAt)).toBe(true);
    expect(
      startsLoadedTimelineDay(
        current,
        { kind: 'message', message: { createdAt: olderAt } },
        undefined,
      ),
    ).toBe(true);
  });

  it('keeps a same-day page seam capsule-free', () => {
    const current = { kind: 'message', message: { createdAt: seconds(2, 8) } } as const;
    const olderAt = seconds(2, 7);

    expect(startsLoadedTimelineDay(current, undefined, olderAt)).toBe(false);
    expect(
      startsLoadedTimelineDay(
        current,
        { kind: 'message', message: { createdAt: olderAt } },
        undefined,
      ),
    ).toBe(false);
  });

  it('shows the oldest capsule only at the true start of history', () => {
    expect(
      startsLoadedTimelineDay(
        { kind: 'message', message: { createdAt: seconds(2, 8) } },
        undefined,
        null,
      ),
    ).toBe(true);
  });
});
