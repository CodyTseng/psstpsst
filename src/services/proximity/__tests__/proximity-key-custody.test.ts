import { generateSecretKey, getPublicKey, verifyEvent } from 'nostr-tools';
import { bytesToHex } from 'nostr-tools/utils';
// eslint-disable-next-line no-restricted-imports -- Integration test substitutes the trusted worker for the native bridge.
import { LocalKeyVault } from '@/platform/vault/local-vault';
import { platform } from '@/platform';
import { ensureProximityIdentity, getProximityEventSigner, removeProximityIdentity } from '../proximity-identity.service';

const mockState: { vault: LocalKeyVault; row: Record<string, unknown> } = {} as never;
const mockInsert = jest.fn();
const mockDelete = jest.fn(async () => {});
jest.mock('@/db/client', () => ({ db: {
  select: () => ({ from: () => ({ where: () => ({ limit: async () => [mockState.row] }) }) }),
  insert: (...args: unknown[]) => mockInsert(...args),
  delete: () => ({ where: mockDelete }),
} }));
jest.mock('@/platform/vault-access', () => ({ vaultAccess: { execute: (command: never) => mockState.vault.execute(command) } }));
jest.mock('@/platform', () => ({ platform: {
  noise: { ensureIdentity: jest.fn(async () => new Uint8Array(32).fill(7)), removeIdentity: jest.fn(async () => {}) },
  secureStorage: { getItem: () => { throw new Error('Business code must not read private keys'); } },
} }));
jest.mock('../proximity-preferences', () => ({ removeProximityEnabledPreference: jest.fn(async () => {}) }));
jest.mock('@/i18n', () => ({ __esModule: true, default: { language: 'en' }, matchSupportedLanguage: () => 'en' }));

test('retains an existing nearby identity while exposing only public metadata and signer operations', async () => {
  const account = getPublicKey(generateSecretKey()), secret = generateSecretKey();
  const pubkey = getPublicKey(secret);
  const storage = new Map([[`proximity_identity_privkey_${account}`, bytesToHex(secret)]]);
  mockState.vault = new LocalKeyVault({ getItem: async name => storage.get(name) ?? null,
    setItem: async (name, value) => { storage.set(name, value); }, deleteItem: async name => { storage.delete(name); } });
  mockState.row = { accountPubkey: account, proximityPubkey: pubkey, displayName: 'Alice', createdAt: 1, updatedAt: 1 };
  const identity = await ensureProximityIdentity(account);
  expect(Object.keys(identity).sort()).toEqual(['accountPubkey', 'displayName', 'noiseBindingSignature', 'noisePubkey', 'proximityPubkey']);
  expect(identity.proximityPubkey).toBe(pubkey);
  expect(mockInsert).not.toHaveBeenCalled();
  const signer = await getProximityEventSigner(account);
  const event = await signer.signEvent({ kind: 1, created_at: 100, tags: [], content: 'nearby' });
  expect(verifyEvent(event)).toBe(true); expect(event.pubkey).toBe(pubkey);
  await removeProximityIdentity(account);
  expect(storage.has(`proximity_identity_privkey_${account}`)).toBe(false);
  expect(platform.noise.removeIdentity).toHaveBeenCalledWith(account);
  await mockState.vault.execute({ method: 'ensureProximity', account });
  await expect(signer.signEvent({ kind: 1, created_at: 100, tags: [], content: 'removed' })).rejects.toThrow();
});
