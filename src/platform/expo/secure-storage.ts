import * as SecureStore from 'expo-secure-store';

import type { SecureStoragePort } from '../ports/secure-storage';

/** Secure storage backed by the iOS Keychain / Android Keystore. */
export const secureStorageAdapter: SecureStoragePort = {
  accessStatus: () => Promise.resolve('available'),
  configurePassword: () => Promise.resolve(),
  unlockWithPassword: () => Promise.resolve(true),
  getItem: (key) => SecureStore.getItemAsync(key),
  setItem: (key, value) => SecureStore.setItemAsync(key, value),
  deleteItem: (key) => SecureStore.deleteItemAsync(key),
};
