import { startsTimelineDay } from '../message-timeline-boundary';

const seconds = (day: number, hour: number) =>
  Math.floor(new Date(2026, 8, day, hour).getTime() / 1000);

describe('message timeline day boundaries', () => {
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
});
