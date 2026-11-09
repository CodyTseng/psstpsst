import dayjs from 'dayjs';

import i18n from '@/i18n';
import { formatCustomDate } from '@/lib/date-format';
import { formattingLocale } from '@/lib/locale';
import { dateTimePreferences } from '@/services/preferences/date-time-state';

export type DateTimeFormatPreferences = ReturnType<typeof dateTimePreferences.getState> & { language?: string };

const dateTimeFormatters = new Map<string, Intl.DateTimeFormat>();

function dateFormatter(locale: string, options: Intl.DateTimeFormatOptions, timeZone: string): Intl.DateTimeFormat {
  const key = `${locale}:${timeZone}:${JSON.stringify(options)}`;
  let formatter = dateTimeFormatters.get(key);
  if (!formatter) {
    // Android's best-fit matcher can resolve en-CN to Chinese. Lookup retains
    // the requested language by dropping unsupported regional subtags instead.
    formatter = new Intl.DateTimeFormat(locale, { ...options, timeZone, localeMatcher: 'lookup' });
    if (dateTimeFormatters.size >= 64) dateTimeFormatters.clear();
    dateTimeFormatters.set(key, formatter);
  }
  return formatter;
}

function localizedDate(ts: number, options: Intl.DateTimeFormatOptions, preferences: DateTimeFormatPreferences): string {
  const locale = formattingLocale(preferences.language ?? i18n.resolvedLanguage ?? i18n.language, preferences.systemLocale);
  return dateFormatter(locale, options, preferences.timeZone).format(new Date(ts * 1000));
}

const TIME_TEXT_PATTERN = /^([01]?\d|2[0-3]):([0-5]\d)(?:\s*(AM|PM))?$/i;

export function parseTimeOfDay(text: string, is24Hour: boolean): number | null {
  const match = TIME_TEXT_PATTERN.exec(text.trim());
  if (!match) return null;
  let hour = Number(match[1]);
  if (is24Hour ? !!match[3] : (!match[3] || hour < 1 || hour > 12)) return null;
  if (!is24Hour) hour = hour % 12 + (match[3].toUpperCase() === 'PM' ? 12 : 0);
  return hour * 60 + Number(match[2]);
}

let clockLocale: string | undefined;
let localeUses24Hour = false;

/** Resolve the device preference independently of the UI language. */
export function uses24HourClock(preferences: DateTimeFormatPreferences = dateTimePreferences.getState()): boolean {
  const { timeFormat, system24Hour, systemLocale } = preferences;
  if (timeFormat !== 'system') return timeFormat === '24h';
  if (system24Hour != null) return system24Hour;
  if (clockLocale !== systemLocale) {
    clockLocale = systemLocale;
    localeUses24Hour = !new Intl.DateTimeFormat(systemLocale, { hour: 'numeric' }).resolvedOptions().hour12;
  }
  return localeUses24Hour;
}

export function formatTime(ts: number, seconds = false, preferences: DateTimeFormatPreferences = dateTimePreferences.getState()): string {
  const is24Hour = uses24HourClock(preferences);
  return localizedDate(ts, {
    hour: is24Hour ? '2-digit' : 'numeric', minute: '2-digit',
    ...(seconds ? { second: '2-digit' as const } : {}),
    hourCycle: is24Hour ? 'h23' : 'h12',
  }, preferences);
}

/** Explicit formats are Gregorian numeric dates; automatic dates combine UI language and device region. */
export function formatDate(ts: number, options: Intl.DateTimeFormatOptions = { year: 'numeric', month: 'short', day: 'numeric' }, preferences: DateTimeFormatPreferences = dateTimePreferences.getState()): string {
  const { dateFormat, customDateFormat } = preferences;
  if (dateFormat === 'system') {
    return localizedDate(ts, options, preferences);
  }
  const date = new Date(ts * 1000);
  if (dateFormat === 'custom') return formatCustomDate(date, customDateFormat);
  const year = String(date.getFullYear()).padStart(4, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return (dateFormat === 'ymd' ? [year, month, day] : dateFormat === 'dmy' ? [day, month, year] : [month, day, year]).join('-');
}

export function formatDateTime(ts: number, seconds = false, preferences: DateTimeFormatPreferences = dateTimePreferences.getState()): string {
  return `${formatDate(ts, undefined, preferences)} ${formatTime(ts, seconds, preferences)}`;
}

/** Full localized timestamp used by message details. */
export function formatDetailTimestamp(ts: number, preferences: DateTimeFormatPreferences = dateTimePreferences.getState()): string {
  return formatDateTime(ts, true, preferences);
}

/** Match clock glyph classes with invisible typographic spaces, without duplicating visible text. */
export function timeSpacer(time: string): string {
  let spacer = '';
  for (const character of time) {
    if (/[\p{Mark}\p{Format}]/u.test(character)) continue;
    if (/\p{Decimal_Number}/u.test(character)) spacer += '\u2007';
    else if (/[:.]/.test(character)) spacer += '\u2008';
    else if (/[ \u00a0]/.test(character)) spacer += '\u00a0';
    else if (character === '\u202f') spacer += '\u202f';
    else if (/[A-Za-z]/.test(character)) spacer += /[MWmw]/.test(character) ? '\u2003' : '\u2007';
    else spacer += '\u2003';
  }
  // Typographic spaces are normally breakable; reserve the complete metadata run together.
  return Array.from(spacer).join('\u2060');
}

/**
 * Compact timestamp for the conversation list (Telegram/Signal-style):
 *   now → `{n}m` → local time (today) → Yesterday → weekday (this week) → date.
 * Clock and date formats follow device preferences; relative labels follow the app language.
 * The conversation list advances a foreground-only minute clock so memoized
 * visible rows re-render when this relative label can change.
 */
export function formatListTime(
  ts: number,
  nowTs = Math.floor(Date.now() / 1000),
  preferences: DateTimeFormatPreferences = dateTimePreferences.getState(),
): string {
  const m = dayjs.unix(ts);
  const now = dayjs.unix(nowTs);
  const diffMin = now.diff(m, 'minute');
  if (diffMin < 1) return i18n.t('time.now');
  if (diffMin < 60) return i18n.t('time.minutes_short', { n: diffMin });
  if (m.isSame(now, 'day')) {
    return formatTime(ts, false, preferences);
  }
  if (m.isSame(now.subtract(1, 'day'), 'day')) return i18n.t('time.yesterday');
  if (now.diff(m, 'day') < 7) return localizedDate(ts, { weekday: 'short' }, preferences);
  if (m.isSame(now, 'year')) return formatDate(ts, { month: 'short', day: 'numeric' }, preferences);
  return formatDate(ts, undefined, preferences);
}

/**
 * Day-boundary separator label shown between message bubbles in a chat. Precise
 * date, omitting the current year only in automatic format:
 *   Today / Yesterday / "March 5" / "March 5, 2023".
 */
export function formatDateSeparator(ts: number, preferences: DateTimeFormatPreferences = dateTimePreferences.getState()): string {
  const m = dayjs.unix(ts);
  const now = dayjs();
  if (m.isSame(now, 'day')) return i18n.t('time.today');
  if (m.isSame(now.subtract(1, 'day'), 'day')) return i18n.t('time.yesterday');
  if (m.isSame(now, 'year')) return formatDate(ts, { month: 'long', day: 'numeric' }, preferences);
  return formatDate(ts, { year: 'numeric', month: 'long', day: 'numeric' }, preferences);
}

/** Whether two unix-second timestamps fall on different calendar days. */
export function isDifferentDay(a: number, b: number): boolean {
  return !dayjs.unix(a).isSame(dayjs.unix(b), 'day');
}

/** Month-group header for the media gallery: "June" / "June 2025" (year omitted
 * in the current year), localized like the day separator above. */
export function formatMonthLabel(ts: number, preferences: DateTimeFormatPreferences = dateTimePreferences.getState()): string {
  const m = dayjs.unix(ts);
  const now = dayjs();
  if (m.isSame(now, 'year')) return localizedDate(ts, { month: 'long' }, preferences);
  return localizedDate(ts, { year: 'numeric', month: 'long' }, preferences);
}

/** Stable key (year-month) for grouping timestamps into month buckets. */
export function monthKey(ts: number): string {
  return dayjs.unix(ts).format('YYYY-MM');
}
