import { DEFAULT_CUSTOM_DATE_FORMAT, normalizeCustomDateFormat } from '@/lib/date-format';
import { platform } from '@/platform';

import { getDevicePreference, trySetDevicePreference } from './device-preferences.service';
import { dateTimePreferences, type TimeFormat, type DateFormat } from './date-time-state';
export { dateTimePreferences, type TimeFormat, type DateFormat } from './date-time-state';

const KEY = 'dateTime.formats';

export async function refreshSystemDateTime(): Promise<void> {
  const system = await platform.localization.dateTimeSettings();
  const system24Hour = system.uses24HourClock;
  const systemLocale = system.locale ?? 'en-US';
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const previous = dateTimePreferences.getState();
  if (previous.system24Hour !== system24Hour || previous.systemLocale !== systemLocale || previous.timeZone !== timeZone) {
    dateTimePreferences.setState({ system24Hour, systemLocale, timeZone });
  }
}

/** Refresh on mobile foreground transitions and desktop focus returns without polling. */
export function watchSystemDateTime(): () => void {
  const refresh = () => {
    void refreshSystemDateTime().catch(error => console.warn('[date-time] Failed to refresh system preferences.', error));
  };
  const removeAppState = platform.appState.addChangeListener(state => { if (state === 'active') refresh(); });
  const removeLocalization = platform.localization.addChangeListener?.(refresh);
  return () => { removeAppState(); removeLocalization?.(); };
}

export async function loadDateTimePreferences(): Promise<void> {
  try {
    const [stored] = await Promise.all([
      getDevicePreference(KEY),
      refreshSystemDateTime().catch(error => {
        console.warn('[date-time] Failed to read system preferences.', error);
      }),
    ]);
    const value = stored ? JSON.parse(stored) : {};
    const customDateFormat = normalizeCustomDateFormat(value?.customDateFormat);
    dateTimePreferences.setState({
      customDateFormat: customDateFormat ?? DEFAULT_CUSTOM_DATE_FORMAT,
      timeFormat: ['system', '12h', '24h'].includes(value?.timeFormat) ? value.timeFormat : 'system',
      dateFormat: value?.dateFormat === 'custom'
        ? (customDateFormat ? 'custom' : 'system')
        : (['system', 'ymd', 'dmy', 'mdy'].includes(value?.dateFormat) ? value.dateFormat : 'system'),
    });
  } catch (error) {
    console.warn('[date-time] Failed to restore preferences.', error);
  } finally {
    dateTimePreferences.setState({ loaded: true });
  }
}

// Serialize writes so rapid selections cannot persist an older snapshot last.
let pendingWrite = Promise.resolve();
export function setDateTimePreferences(value: { timeFormat?: TimeFormat; dateFormat?: DateFormat; customDateFormat?: string }): Promise<void> {
  if (value.customDateFormat !== undefined) {
    const customDateFormat = normalizeCustomDateFormat(value.customDateFormat);
    if (customDateFormat == null) return Promise.resolve();
    value = { ...value, customDateFormat };
  }
  dateTimePreferences.setState(value);
  const { timeFormat, dateFormat, customDateFormat } = dateTimePreferences.getState();
  pendingWrite = pendingWrite.then(() => trySetDevicePreference(KEY, JSON.stringify({ timeFormat, dateFormat, customDateFormat })));
  return pendingWrite;
}
