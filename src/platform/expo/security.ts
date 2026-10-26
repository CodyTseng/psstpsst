import * as SecureStore from 'expo-secure-store';
import { requireNativeModule } from 'expo-modules-core';
import { isLegacyPreferenceKey, type SecurityPort } from '../ports/security';

type NativeSecurity = { securityStatus(): Promise<'available'>; ensureWalletProtection(account: string, selection: string): Promise<boolean> };
const native = () => requireNativeModule<NativeSecurity>('ExpoCryptoAccelerator');

function legacy(key: string): string {
  if (!isLegacyPreferenceKey(key)) throw new Error('Not a legacy preference');
  return key;
}
export const securityAdapter: SecurityPort = {
  accessStatus: async () => native().securityStatus(),
  requestUnlock: async () => true,
  ensureWalletProtection: (account, selection) => native().ensureWalletProtection(account, JSON.stringify(selection)),
  readLegacyPreference: async key => SecureStore.getItemAsync(legacy(key)),
  deleteLegacyPreference: async key => SecureStore.deleteItemAsync(legacy(key)),
};
