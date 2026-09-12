import { formatBadgeCount } from '../badge-count';

describe('badge count formatting', () => {
  it('uses the same 99+ cap for every unread surface', () => {
    expect(formatBadgeCount(1)).toBe('1');
    expect(formatBadgeCount(99)).toBe('99');
    expect(formatBadgeCount(100)).toBe('99+');
  });
});
