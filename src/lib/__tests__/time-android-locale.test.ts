import { dateTimePreferences } from '@/services/preferences/date-time-state';

import { formatDate, formatListTime, formatMonthLabel, formatTime } from '../time';

it('keeps English timestamps when Android best-fit resolves en-CN to Chinese', () => {
  const NativeDateTimeFormat = Intl.DateTimeFormat;
  // Reproduce the Android Hermes result observed on a Chinese-language device.
  const formatter = jest.spyOn(Intl, 'DateTimeFormat').mockImplementation((locales, options) =>
    new NativeDateTimeFormat(locales === 'en-CN' && options?.localeMatcher !== 'lookup' ? 'zh-CN' : locales, options));
  const preferences = {
    ...dateTimePreferences.getState(),
    language: 'en', systemLocale: 'zh-Hans-CN', timeZone: 'UTC',
    dateFormat: 'system' as const, timeFormat: '12h' as const,
  };
  const timestamp = Date.UTC(2026, 9, 22, 13, 5) / 1000;
  try {
    expect(formatListTime(timestamp, timestamp + 2 * 86400, preferences)).toBe('Thu');
    expect(formatListTime(timestamp, timestamp + 10 * 86400, preferences)).toBe('Oct 22');
    expect(formatDate(timestamp, undefined, preferences)).toBe('Oct 22, 2026');
    expect(formatMonthLabel(timestamp, preferences)).toMatch(/^October(?: 2026)?$/);
    expect(formatTime(timestamp, false, preferences)).toBe('1:05 PM');
  } finally {
    formatter.mockRestore();
  }
});
