import {
  deleteDevicePreference,
  getDevicePreference,
  setDevicePreference,
} from '@/services/preferences/device-preferences.service';

/** A whole-day interval, or `null` when automatic rotation is disabled. */
export type KeyRotationIntervalDays = number | null;
export type KeyRotationSettings = {
  enabled: boolean;
  intervalDays: number;
};

export const MIN_KEY_ROTATION_INTERVAL_DAYS = 1;
export const MAX_KEY_ROTATION_INTERVAL_DAYS = 90;
export const DEFAULT_KEY_ROTATION_INTERVAL_DAYS = 30;
const DISABLED_KEY_ROTATION_INTERVAL = 'off';
const DISABLED_KEY_ROTATION_INTERVAL_PREFIX = `${DISABLED_KEY_ROTATION_INTERVAL}:`;

const preferenceKey = (accountPubkey: string) =>
  `security.encryptionKeyRotationDays.${accountPubkey}`;

export function isValidKeyRotationIntervalDays(value: number): boolean {
  return (
    Number.isSafeInteger(value) &&
    value >= MIN_KEY_ROTATION_INTERVAL_DAYS &&
    value <= MAX_KEY_ROTATION_INTERVAL_DAYS
  );
}

/** Per-account, device-local cadence. The disabled storage form keeps the last
 * selected number (`off:30`) so enabling it again restores the user's choice. */
export async function getKeyRotationSettings(
  accountPubkey: string,
): Promise<KeyRotationSettings> {
  const raw = await getDevicePreference(preferenceKey(accountPubkey));
  if (raw == null) {
    return { enabled: false, intervalDays: DEFAULT_KEY_ROTATION_INTERVAL_DAYS };
  }
  if (raw === DISABLED_KEY_ROTATION_INTERVAL) {
    return { enabled: false, intervalDays: DEFAULT_KEY_ROTATION_INTERVAL_DAYS };
  }
  if (raw?.startsWith(DISABLED_KEY_ROTATION_INTERVAL_PREFIX)) {
    const storedDisabledInterval = Number(raw.slice(DISABLED_KEY_ROTATION_INTERVAL_PREFIX.length));
    return {
      enabled: false,
      intervalDays: isValidKeyRotationIntervalDays(storedDisabledInterval)
        ? storedDisabledInterval
        : DEFAULT_KEY_ROTATION_INTERVAL_DAYS,
    };
  }
  const stored = Number(raw);
  return {
    enabled: true,
    intervalDays: isValidKeyRotationIntervalDays(stored)
      ? stored
      : DEFAULT_KEY_ROTATION_INTERVAL_DAYS,
  };
}

export async function getKeyRotationIntervalDays(
  accountPubkey: string,
): Promise<KeyRotationIntervalDays> {
  const settings = await getKeyRotationSettings(accountPubkey);
  return settings.enabled ? settings.intervalDays : null;
}

export async function setKeyRotationSettings(
  accountPubkey: string,
  settings: KeyRotationSettings,
): Promise<void> {
  if (!isValidKeyRotationIntervalDays(settings.intervalDays)) {
    throw new RangeError('Encryption-key rotation interval is out of range');
  }
  await setDevicePreference(
    preferenceKey(accountPubkey),
    settings.enabled
      ? String(settings.intervalDays)
      : `${DISABLED_KEY_ROTATION_INTERVAL_PREFIX}${settings.intervalDays}`,
  );
}

export async function removeKeyRotationInterval(accountPubkey: string): Promise<void> {
  await deleteDevicePreference(preferenceKey(accountPubkey));
}
