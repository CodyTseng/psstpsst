// eslint-disable-next-line no-restricted-imports -- This test executes the trusted worker's private PIN operations.
import { LocalKeyVault } from '@/platform/vault/local-vault';
import { scryptAsync } from '@noble/hashes/scrypt.js';
import { bytesToHex } from 'nostr-tools/utils';
const account = 'a'.repeat(64);
let values: Map<string, string>, vault: LocalKeyVault;
beforeEach(() => {
  values = new Map(); vault = new LocalKeyVault({ getItem: async key => values.get(key) ?? null,
    setItem: async (key, value) => { values.set(key, value); }, deleteItem: async key => { values.delete(key); } });
});
afterEach(() => jest.restoreAllMocks());
it('keeps PIN setup and verification behind private worker operations', async () => {
  await expect(vault.walletInternal('hasPin', account)).resolves.toBe(false);
  await vault.walletInternal('setPin', account, '123456');
  await expect(vault.walletInternal('verifyPin', account, '123456')).resolves.toBe(true);
  await expect(vault.execute({ method: 'walletSetPin', account, pin: '654321' } as never)).rejects.toThrow();
  await expect(vault.walletInternal('setPin', account, '654321')).rejects.toThrow();
});
it('retains existing PIN hashes and throttles failed verification attempts', async () => {
  const salt = 'legacy-wallet-salt'; const digest = bytesToHex(await scryptAsync('123456', salt, { N: 1 << 15, r: 8, p: 1, dkLen: 32 }));
  values.set(`psstpsst.wallet.pin.${account}`, JSON.stringify({ version: 1, salt, digest }));
  let now = Date.now(); jest.spyOn(Date, 'now').mockImplementation(() => now);
  await expect(vault.walletInternal('verifyPin', account, '123456')).resolves.toBe(true);
  await expect(vault.walletInternal('verifyPin', account, '000000')).resolves.toBe(false);
  await expect(vault.walletInternal('verifyPin', account, '123456')).resolves.toBe(false);
  now += 1001;
  await expect(vault.walletInternal('verifyPin', account, '123456')).resolves.toBe(true);
});
it('rejects malformed PINs and removes the PIN through account teardown', async () => {
  await expect(vault.walletInternal('setPin', account, '12345')).rejects.toThrow();
  await vault.walletInternal('setPin', account, '123456');
  await vault.execute({ method: 'walletRemovePin', account });
  await expect(vault.walletInternal('hasPin', account)).resolves.toBe(false);
});
