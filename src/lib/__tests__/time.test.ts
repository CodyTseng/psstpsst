import i18n from '@/i18n';

import { formatListTime } from '../time';

const unix = (year: number, month: number, day: number, hour = 12, minute = 0) =>
  Math.floor(new Date(year, month - 1, day, hour, minute).getTime() / 1000);

describe('conversation list time', () => {
  const originalLanguage = i18n.language;
  const now = unix(2026, 10, 4, 15);

  beforeEach(async () => {
    await i18n.changeLanguage('en');
  });

  afterAll(async () => {
    await i18n.changeLanguage(originalLanguage);
  });

  it('uses the supplied clock instead of ambient render time', () => {
    const messageAt = 1_800_000_000;

    expect(formatListTime(messageAt, messageAt + 5 * 60)).toBe('5m');
    expect(formatListTime(messageAt, messageAt + 8 * 60)).toBe('8m');
  });

  it('preserves recent-time and calendar-day boundaries', () => {
    expect(formatListTime(now, now)).toBe('now');
    expect(formatListTime(now - 59 * 60, now)).toBe('59m');
    expect(formatListTime(now - 60 * 60, now)).toBe('2:00 PM');
    expect(formatListTime(unix(2026, 10, 3), now)).toBe('Yesterday');
    expect(formatListTime(unix(2026, 10, 2), now)).toBe('Fri');
  });

  it('uses compact English month names and an unambiguous full year', () => {
    expect(formatListTime(unix(2026, 9, 20), now)).toBe('Sep 20');
    expect(formatListTime(unix(2025, 9, 20), now)).toBe('Sep 20, 2025');
  });

  it('updates cached formatters when the app language changes', async () => {
    const today = unix(2026, 10, 4, 13, 5);
    const older = unix(2026, 9, 20);
    expect(formatListTime(today, now)).toBe('1:05 PM');
    expect(formatListTime(older, now)).toBe('Sep 20');

    await i18n.changeLanguage('zh');
    expect(formatListTime(today, now)).toBe('13:05');
    expect(formatListTime(older, now)).toBe('9月20日');
    expect(formatListTime(unix(2025, 9, 20), now)).toBe('2025年9月20日');
    expect(formatListTime(now - 5 * 60, now)).toBe('5 分钟');
    expect(formatListTime(unix(2026, 10, 3), now)).toBe('昨天');
    expect(formatListTime(unix(2026, 10, 2), now)).toBe('周五');

    await i18n.changeLanguage('de');
    expect(formatListTime(today, now)).toBe('13:05');
    expect(formatListTime(older, now)).toBe('20. Sept.');

    await i18n.changeLanguage('en');
    expect(formatListTime(today, now)).toBe('1:05 PM');
    expect(formatListTime(older, now)).toBe('Sep 20');
  });
});
