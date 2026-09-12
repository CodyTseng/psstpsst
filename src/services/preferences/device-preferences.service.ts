import { eq } from 'drizzle-orm';

import { db } from '@/db/client';
import { devicePreferences } from '@/db/schema';
import { platform } from '@/platform';

const WALLET_BALANCE_VISIBLE_PREFIX = 'wallet.balanceVisible';

export function walletBalanceVisiblePreferenceKey(accountPubkey: string): string {
  return `${WALLET_BALANCE_VISIBLE_PREFIX}.${accountPubkey}`;
}

export function legacyWalletBalanceVisiblePreferenceKey(accountPubkey: string): string {
  return `${WALLET_BALANCE_VISIBLE_PREFIX}.${accountPubkey.slice(0, 16)}`;
}

/** Read a non-secret device preference from SQLite.
 *
 * During the storage transition, callers pass the old SecureStore key. A value
 * found there is copied to SQLite and removed from the keychain before it is
 * returned. This lazy migration also covers preferences that are only read when
 * their screen or account is opened.
 */
export async function getDevicePreference(
  key: string,
  legacySecureStoreKey?: string,
): Promise<string | null> {
  const rows = await db
    .select({ value: devicePreferences.value })
    .from(devicePreferences)
    .where(eq(devicePreferences.key, key))
    .limit(1);
  if (rows[0]) return rows[0].value;
  if (!legacySecureStoreKey) return null;

  const legacyValue = await platform.secureStorage.getItem(legacySecureStoreKey);
  if (legacyValue == null) return null;

  await setDevicePreference(key, legacyValue);
  await platform.secureStorage.deleteItem(legacySecureStoreKey);
  return legacyValue;
}

/** Upsert a non-secret device preference in SQLite. */
export async function setDevicePreference(key: string, value: string): Promise<void> {
  const updatedAt = Math.floor(Date.now() / 1000);
  await db
    .insert(devicePreferences)
    .values({ key, value, updatedAt })
    .onConflictDoUpdate({
      target: devicePreferences.key,
      set: { value, updatedAt },
    });
}

/** Persist an optimistic UI preference without exposing an unhandled rejection. */
export async function trySetDevicePreference(key: string, value: string): Promise<void> {
  try {
    await setDevicePreference(key, value);
  } catch (error) {
    console.warn(`[preferences] Failed to persist ${key}.`, error);
  }
}

/** Delete a device preference and any not-yet-migrated keychain copy. */
export async function deleteDevicePreference(
  key: string,
  legacySecureStoreKey?: string,
): Promise<void> {
  await db.delete(devicePreferences).where(eq(devicePreferences.key, key));
  if (legacySecureStoreKey) await platform.secureStorage.deleteItem(legacySecureStoreKey);
}
