import {
  getDevicePreference,
  setDevicePreference,
} from '@/services/preferences/device-preferences.service';

/** Device-level notification preference (not per-account). On until disabled. */
const ENABLED_KEY = 'notifications.enabled';
const BATTERY_OPTIMIZATION_PROMPTED_KEY = 'notifications.batteryOptimizationPrompted';
const CONTENT_PREFERENCES_KEY = 'notifications.contentPreferences';
const DND_WINDOW_KEY = 'notifications.dndWindow';

const MINUTES_PER_DAY = 24 * 60;

export type NotificationContentPreferences = {
  showSender: boolean;
  showMessageContent: boolean;
};

type StoredNotificationContentPreferences = Partial<NotificationContentPreferences> & {
  showAvatar?: boolean;
  showDisplayName?: boolean;
};

/** Daily quiet hours, expressed as minutes since local midnight (0–1439).
 * `startMinutes > endMinutes` describes an overnight window (e.g. 22:00–08:00). */
export type DndWindow = {
  enabled: boolean;
  startMinutes: number;
  endMinutes: number;
};

export const DEFAULT_DND_WINDOW: DndWindow = {
  enabled: false,
  startMinutes: 22 * 60,
  endMinutes: 8 * 60,
};

/** Notification previews start fully private on every device. */
export const DEFAULT_NOTIFICATION_CONTENT_PREFERENCES: NotificationContentPreferences = {
  showSender: false,
  showMessageContent: false,
};

/** Small persistence wrapper so the background task can read the preference without
 * pulling in the notification service / dm service at module load. */
export async function getNotificationsEnabled(): Promise<boolean> {
  return (await getDevicePreference(ENABLED_KEY, ENABLED_KEY)) !== '0';
}

export async function setNotificationsEnabled(enabled: boolean): Promise<void> {
  await setDevicePreference(ENABLED_KEY, enabled ? '1' : '0');
}

export async function getNotificationContentPreferences(): Promise<NotificationContentPreferences> {
  const stored = await getDevicePreference(CONTENT_PREFERENCES_KEY);
  if (!stored) return DEFAULT_NOTIFICATION_CONTENT_PREFERENCES;
  try {
    const value = JSON.parse(stored) as StoredNotificationContentPreferences;
    // Older versions stored avatar and display-name choices separately. Only
    // preserve an enabled sender preview when both fields had been allowed, so
    // migration never exposes more identity information than before.
    const showSender = typeof value.showSender === 'boolean'
      ? value.showSender
      : value.showAvatar === true && value.showDisplayName === true;
    return {
      showSender,
      showMessageContent: value.showMessageContent === true,
    };
  } catch {
    return DEFAULT_NOTIFICATION_CONTENT_PREFERENCES;
  }
}

export async function setNotificationContentPreferences(
  preferences: NotificationContentPreferences,
): Promise<void> {
  await setDevicePreference(CONTENT_PREFERENCES_KEY, JSON.stringify(preferences));
}

function isValidMinute(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 0 &&
    value < MINUTES_PER_DAY
  );
}

export async function getDndWindow(): Promise<DndWindow> {
  const stored = await getDevicePreference(DND_WINDOW_KEY);
  if (!stored) return DEFAULT_DND_WINDOW;
  try {
    const value = JSON.parse(stored) as Partial<DndWindow>;
    if (!isValidMinute(value.startMinutes) || !isValidMinute(value.endMinutes)) {
      return DEFAULT_DND_WINDOW;
    }
    return {
      enabled: value.enabled === true,
      startMinutes: value.startMinutes,
      endMinutes: value.endMinutes,
    };
  } catch {
    return DEFAULT_DND_WINDOW;
  }
}

export async function setDndWindow(window: DndWindow): Promise<void> {
  await setDevicePreference(DND_WINDOW_KEY, JSON.stringify(window));
}

/** Whether `minute` (minutes since local midnight) falls inside the window.
 * Equal start/end means the window covers nothing. The end is exclusive:
 * 22:00–08:00 silences 22:00 through 07:59. */
export function isMinuteInDndWindow(minute: number, window: DndWindow): boolean {
  const { startMinutes: start, endMinutes: end } = window;
  if (start === end) return false;
  if (start < end) return minute >= start && minute < end;
  return minute >= start || minute < end;
}

/** Whether quiet hours are in effect right now, per the local clock. Kept
 * import-light so the headless background task can call it directly. */
export async function isDndActiveNow(): Promise<boolean> {
  const window = await getDndWindow();
  if (!window.enabled) return false;

  const now = new Date();
  return isMinuteInDndWindow(now.getHours() * 60 + now.getMinutes(), window);
}

export async function getBatteryOptimizationPrompted(): Promise<boolean> {
  return (await getDevicePreference(BATTERY_OPTIMIZATION_PROMPTED_KEY)) === '1';
}

export async function setBatteryOptimizationPrompted(): Promise<void> {
  await setDevicePreference(BATTERY_OPTIMIZATION_PROMPTED_KEY, '1');
}
