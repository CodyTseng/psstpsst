import { createStore } from 'zustand/vanilla';

import { DEFAULT_CUSTOM_DATE_FORMAT } from '@/lib/date-format';

export type TimeFormat = 'system' | '12h' | '24h';
export type DateFormat = 'system' | 'ymd' | 'dmy' | 'mdy' | 'custom';

export const dateTimePreferences = createStore(() => ({
  timeFormat: 'system' as TimeFormat,
  dateFormat: 'system' as DateFormat,
  customDateFormat: DEFAULT_CUSTOM_DATE_FORMAT,
  systemLocale: Intl.DateTimeFormat().resolvedOptions().locale,
  system24Hour: null as boolean | null,
  timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  loaded: false,
}));
