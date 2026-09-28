import { formatListTime } from '../time';

describe('conversation list time', () => {
  it('uses the supplied clock instead of ambient render time', () => {
    const messageAt = 1_800_000_000;

    expect(formatListTime(messageAt, messageAt + 5 * 60)).toBe('5m');
    expect(formatListTime(messageAt, messageAt + 8 * 60)).toBe('8m');
  });
});
