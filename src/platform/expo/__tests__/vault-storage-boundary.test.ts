import * as SecureStore from 'expo-secure-store';
import { securityAdapter } from '../security';
import { isVaultStorageKey } from '../../ports/key-vault';

jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(async () => null), deleteItemAsync: jest.fn(async () => {}) }));
beforeEach(() => jest.clearAllMocks());

test.each(['identity_privkey_', 'encryption_keys_', 'nip46_client_privkey_', 'nip46_bunker_secret_', 'nip46_bunker_binding_',
  'proximity_identity_privkey_', 'proximity_identity_noise_privkey_', 'wallet_credential_', 'psstpsst.nwc.', 'psstpsst.wallet.pin.'])(
  'rejects credential namespace %s through legacy preference migration', async prefix => {
    const key = `${prefix}${'a'.repeat(64)}`;
    expect(isVaultStorageKey(key)).toBe(true);
    await expect(securityAdapter.readLegacyPreference(key)).rejects.toThrow('Not a legacy preference');
    await expect(securityAdapter.deleteLegacyPreference(key)).rejects.toThrow('Not a legacy preference');
    expect(SecureStore.getItemAsync).not.toHaveBeenCalled(); expect(SecureStore.deleteItemAsync).not.toHaveBeenCalled();
  },
);
test.each(['language.preference', 'theme.preference', 'theme.accent', 'chat.enterToSend', 'chat.quickReactions', 'active_account_pubkey', 'notifications.enabled', 'wallet.balanceVisible.0123456789abcdef'])(
  'allows only reviewed non-secret preference %s', async key => {
    await securityAdapter.readLegacyPreference(key); expect(SecureStore.getItemAsync).toHaveBeenCalledWith(key);
  },
);
test('has no raw secret reader, writer or password input API', () => {
  for (const method of ['getItem', 'setItem', 'deleteItem', 'configurePassword', 'unlockWithPassword']) expect(Reflect.get(securityAdapter, method)).toBeUndefined();
});
