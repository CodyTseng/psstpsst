import dayjs from 'dayjs';

import i18n from '@/i18n';

const dateTimeFormatters = new Map<string, Intl.DateTimeFormat>();

function localizedDate(ts: number, options: Intl.DateTimeFormatOptions): string {
  const locale = i18n.resolvedLanguage ?? i18n.language;
  const key = `${locale}:${JSON.stringify(options)}`;
  let formatter = dateTimeFormatters.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale, options);
    dateTimeFormatters.set(key, formatter);
  }
  return formatter.format(new Date(ts * 1000));
}

/** Full localized timestamp used by message details. */
export function formatDetailTimestamp(ts: number): string {
  return localizedDate(ts, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
}

/**
 * Compact timestamp for the conversation list (Telegram/Signal-style):
 *   now → `{n}m` → HH:mm (today) → Yesterday → weekday (this week) → date.
 * The conversation list advances a foreground-only minute clock so memoized
 * visible rows re-render when this relative label can change.
 */
export function formatListTime(
  ts: number,
  nowTs = Math.floor(Date.now() / 1000),
): string {
  const m = dayjs.unix(ts);
  const now = dayjs.unix(nowTs);
  const diffMin = now.diff(m, 'minute');
  if (diffMin < 1) return i18n.t('time.now');
  if (diffMin < 60) return i18n.t('time.minutes_short', { n: diffMin });
  if (m.isSame(now, 'day')) {
    return localizedDate(ts, { hour: '2-digit', minute: '2-digit', hour12: false });
  }
  if (m.isSame(now.subtract(1, 'day'), 'day')) return i18n.t('time.yesterday');
  if (now.diff(m, 'day') < 7) return localizedDate(ts, { weekday: 'short' });
  if (m.isSame(now, 'year')) return localizedDate(ts, { month: 'numeric', day: 'numeric' });
  return localizedDate(ts, { year: '2-digit', month: 'numeric', day: 'numeric' });
}

/**
 * Day-boundary separator label shown between message bubbles in a chat. Precise
 * date, with the year omitted when it's the current year:
 *   Today / Yesterday / "March 5" / "March 5, 2023".
 */
export function formatDateSeparator(ts: number): string {
  const m = dayjs.unix(ts);
  const now = dayjs();
  if (m.isSame(now, 'day')) return i18n.t('time.today');
  if (m.isSame(now.subtract(1, 'day'), 'day')) return i18n.t('time.yesterday');
  if (m.isSame(now, 'year')) return localizedDate(ts, { month: 'long', day: 'numeric' });
  return localizedDate(ts, { year: 'numeric', month: 'long', day: 'numeric' });
}

/** Whether two unix-second timestamps fall on different calendar days. */
export function isDifferentDay(a: number, b: number): boolean {
  return !dayjs.unix(a).isSame(dayjs.unix(b), 'day');
}

/** Month-group header for the media gallery: "June" / "June 2025" (year omitted
 * in the current year), localized like the day separator above. */
export function formatMonthLabel(ts: number): string {
  const m = dayjs.unix(ts);
  const now = dayjs();
  if (m.isSame(now, 'year')) return localizedDate(ts, { month: 'long' });
  return localizedDate(ts, { year: 'numeric', month: 'long' });
}

/** Stable key (year-month) for grouping timestamps into month buckets. */
export function monthKey(ts: number): string {
  return dayjs.unix(ts).format('YYYY-MM');
}
