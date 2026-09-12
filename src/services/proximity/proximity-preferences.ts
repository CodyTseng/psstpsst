import {
  deleteDevicePreference,
  getDevicePreference,
  setDevicePreference,
} from '@/services/preferences/device-preferences.service';
import { proximitySessionStore } from '@/services/proximity/proximity-session';

export const proximityEnabledPreferenceKey = (accountPubkey: string) =>
  `proximity.enabled.${accountPubkey}`;

/** Explicit per-account, device-local feature switch. Missing values are off. */
export async function getProximityEnabled(accountPubkey: string): Promise<boolean> {
  const enabled =
    (await getDevicePreference(proximityEnabledPreferenceKey(accountPubkey))) === '1';
  proximitySessionStore.getState().setFeatureEnabled(accountPubkey, enabled);
  return enabled;
}

export async function setProximityEnabled(
  accountPubkey: string,
  enabled: boolean,
): Promise<void> {
  await setDevicePreference(proximityEnabledPreferenceKey(accountPubkey), enabled ? '1' : '0');
  proximitySessionStore.getState().setFeatureEnabled(accountPubkey, enabled);
}

export async function removeProximityEnabledPreference(
  accountPubkey: string,
): Promise<void> {
  await deleteDevicePreference(proximityEnabledPreferenceKey(accountPubkey));
  proximitySessionStore.getState().setFeatureEnabled(accountPubkey, false);
}
