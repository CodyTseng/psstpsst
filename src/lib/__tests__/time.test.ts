import i18n from '@/i18n';

import { formatListTime, formatTime, formatDate, formatDetailTimestamp, formatDateSeparator, timeSpacer, parseTimeOfDay } from '../time';
import { dateTimePreferences } from '@/services/preferences/date-time-state';

const unix = (year: number, month: number, day: number, hour = 12, minute = 0) =>
  Math.floor(new Date(year, month - 1, day, hour, minute).getTime() / 1000);

describe('conversation list time', () => {
  const originalLanguage = i18n.language;
  const now = unix(2026, 10, 4, 15);

  beforeEach(async () => {
    dateTimePreferences.setState({ timeFormat: 'system', dateFormat: 'system', system24Hour: false, systemLocale: 'en-US' });
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

  it('combines app-language date structure with the independent system clock', async () => {
    const today = unix(2026, 10, 4, 13, 5);
    const older = unix(2026, 9, 20);
    expect(formatListTime(today, now)).toBe('1:05 PM');
    expect(formatListTime(older, now)).toBe('Sep 20');

    await i18n.changeLanguage('zh');
    expect(formatListTime(today, now)).toBe('下午1:05');
    expect(formatListTime(older, now)).toBe('9月20日');
    expect(formatListTime(unix(2025, 9, 20), now)).toBe('2025年9月20日');
    expect(formatListTime(now - 5 * 60, now)).toBe('5 分钟');
    expect(formatListTime(unix(2026, 10, 3), now)).toBe('昨天');
    expect(formatListTime(unix(2026, 10, 2), now)).toBe('周五');

    await i18n.changeLanguage('de');
    expect(formatListTime(today, now)).toBe('1:05 PM');
    expect(formatListTime(older, now)).toBe(new Intl.DateTimeFormat('de-US', { month: 'short', day: 'numeric' }).format(new Date(older * 1000)));

    dateTimePreferences.setState({ timeFormat: 'system', dateFormat: 'system', system24Hour: false, systemLocale: 'en-US' });
    await i18n.changeLanguage('en');
    expect(formatListTime(today, now)).toBe('1:05 PM');
    expect(formatListTime(older, now)).toBe('Sep 20');
  });
});


describe('date and time preferences', () => {
  const timestamp = unix(2026, 10, 20, 13, 5);
  beforeEach(async () => {
    dateTimePreferences.setState({ timeFormat: '24h', dateFormat: 'ymd', system24Hour: false, systemLocale: 'en-US' });
    await i18n.changeLanguage('en');
  });

  it('applies clock overrides consistently and refreshes cached formatters', () => {
    expect(formatTime(timestamp)).toBe('13:05');
    expect(formatDetailTimestamp(timestamp)).toBe('2026-10-20 13:05:00');
    dateTimePreferences.setState({ timeFormat: '12h' });
    expect(formatTime(timestamp)).toBe('1:05 PM');
    expect(formatDetailTimestamp(timestamp)).toBe('2026-10-20 1:05:00 PM');
    dateTimePreferences.setState({ timeFormat: '24h' });
    expect(formatTime(timestamp)).toBe('13:05');
  });

  it.each([['ymd', '2026-10-20'], ['dmy', '20-10-2026'], ['mdy', '10-20-2026']] as const)('uses full %s dates everywhere', (dateFormat, expected) => {
    dateTimePreferences.setState({ dateFormat });
    expect(formatDate(timestamp)).toBe(expected);
    expect(formatListTime(timestamp, unix(2026, 10, 31))).toBe(expected);
    expect(formatDateSeparator(unix(2025, 10, 20))).toBe(expected.replace('2026', '2025'));
  });

  it('applies a custom pattern consistently and updates it without stale cached output', () => {
    dateTimePreferences.setState({ dateFormat: 'custom', customDateFormat: 'D.M.YYYY' });
    expect(formatDate(timestamp)).toBe('20.10.2026');
    expect(formatListTime(timestamp, unix(2026, 10, 31))).toBe('20.10.2026');
    expect(formatDetailTimestamp(timestamp)).toBe('20.10.2026 13:05:00');
    dateTimePreferences.setState({ customDateFormat: 'MM/DD/YY' });
    expect(formatDate(timestamp)).toBe('10/20/26');
  });

  it('honors the system clock even with an English UI', () => {
    dateTimePreferences.setState({ timeFormat: 'system', system24Hour: true });
    expect(formatTime(timestamp)).toBe('13:05');
    dateTimePreferences.setState({ system24Hour: false });
    expect(formatTime(timestamp)).toBe('1:05 PM');
  });

  it('falls back to the full regional locale when the native preference is unavailable', () => {
    dateTimePreferences.setState({ timeFormat: 'system', system24Hour: null, systemLocale: 'en-GB' });
    expect(formatTime(timestamp)).toBe('13:05');
    dateTimePreferences.setState({ systemLocale: 'en-US' });
    expect(formatTime(timestamp)).toBe('1:05 PM');
  });

  it('uses midnight as 00:00 and handles noon and midnight in 12-hour mode', () => {
    expect(formatTime(unix(2026, 10, 20, 0))).toBe('00:00');
    dateTimePreferences.setState({ timeFormat: '12h' });
    expect(formatTime(unix(2026, 10, 20, 0))).toBe('12:00 AM');
    expect(formatTime(unix(2026, 10, 20, 12))).toBe('12:00 PM');
  });

  it('reserves whitespace for the entire clock including localized day periods', () => {
    const reservation = (time: string) => timeSpacer(time).replace(/\u2060/g, '');
    expect(reservation('13:05')).toBe('\u2007\u2007\u2008\u2007\u2007');
    expect(reservation('1:05 PM').length).toBeGreaterThan(reservation('13:05').length);
    expect(reservation('下午1:05')).toBe('\u2003\u2003\u2007\u2008\u2007\u2007');
    expect(reservation('١:٠٥ ص')).toBe('\u2007\u2008\u2007\u2007\u00a0\u2003');
    expect(reservation('12:20 AM')).toBe('\u2007\u2007\u2008\u2007\u2007\u00a0\u2007\u2003');
    expect(reservation('1:05 PM')).toMatch(/^[\u00a0\u2003\u2007\u2008\u202f]+$/);
    expect(timeSpacer('12:20 AM')).toContain('\u2060');
  });
});


describe('quiet-hours time input', () => {
  it.each([
    ['00:00', true, 0], ['23:59', true, 1439], ['12:00 AM', false, 0],
    ['12:00 PM', false, 720], ['1:05 pm', false, 785], [' 10:00 PM ', false, 1320],
    ['24:00', true, null], ['12:60', true, null], ['13:00 PM', false, null],
    ['00:30 AM', false, null], ['10:00', false, null], ['10:00 PM', true, null],
  ] as const)('parses %s in 24h=%s as %s minutes', (text, is24Hour, expected) => {
    expect(parseTimeOfDay(text, is24Hour)).toBe(expected);
  });
});

describe('regional month literals', () => {
  const timestamp = unix(2026, 10, 20, 13, 5);

  it.each(['zh-CN', 'zh-TW', 'ja-JP', 'ko-KR'])('preserves the regional pattern without duplicating localized month literals: %s', systemLocale => {
    const preferences = {
      ...dateTimePreferences.getState(), dateFormat: 'system' as const, timeFormat: '24h' as const,
      systemLocale, language: systemLocale,
    };
    for (const month of ['short', 'long'] as const) {
      const options = { year: 'numeric', month, day: 'numeric' } as const;
      const expected = new Intl.DateTimeFormat(systemLocale, { ...options, timeZone: preferences.timeZone }).format(new Date(timestamp * 1000));
      expect(formatDate(timestamp, options, preferences)).toBe(expected);
    }
    expect(formatDetailTimestamp(timestamp, preferences)).not.toMatch(/月月/);
    expect(formatListTime(timestamp, unix(2026, 10, 31), preferences)).not.toMatch(/月月/);
    expect(formatDateSeparator(timestamp, preferences)).not.toMatch(/月月/);
  });

  it('uses a complete Chinese date with a US system region', () => {
    const preferences = { ...dateTimePreferences.getState(), dateFormat: 'system' as const, systemLocale: 'en-US', language: 'zh' };
    expect(formatDate(timestamp, undefined, preferences)).toBe('2026年10月20日');
  });

  it('uses a complete English date with a Chinese system region', () => {
    const preferences = { ...dateTimePreferences.getState(), dateFormat: 'system' as const, systemLocale: 'zh-CN', language: 'en' };
    expect(formatDate(timestamp, undefined, preferences)).toBe('Oct 20, 2026');
  });
});


describe('automatic dates combining language and region', () => {
  const timestamp = unix(2025, 10, 22, 13, 5);
  it.each([
    ['en-US', 'zh', 'zh-US'], ['en-GB', 'ja', 'ja-GB'], ['zh-CN', 'en', 'en-CN'], ['ja-JP', 'pt-BR', 'pt-BR'],
    ['en-GB', 'en', 'en-GB'], ['zh-CN', 'en-US', 'en-US'],
  ])('combines system %s with UI %s as %s', (systemLocale, language, expectedLocale) => {
    const preferences = { ...dateTimePreferences.getState(), dateFormat: 'system' as const, systemLocale, language };
    const expected = (month: 'short' | 'long') => new Intl.DateTimeFormat(expectedLocale, {
      year: 'numeric', month, day: 'numeric', timeZone: preferences.timeZone,
    }).format(new Date(timestamp * 1000));
    expect(formatDate(timestamp, undefined, preferences)).toBe(expected('short'));
    expect(formatListTime(timestamp, unix(2026, 10, 31), preferences)).toBe(expected('short'));
    expect(formatDateSeparator(timestamp, preferences)).toBe(expected('long'));
    expect(formatDetailTimestamp(timestamp, preferences)).toContain(expected('short'));
  });
});
