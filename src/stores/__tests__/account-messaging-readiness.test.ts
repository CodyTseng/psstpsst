import type { Event } from 'nostr-tools';

import { useActiveAccount } from '../active-account.store';
import { dmService } from '@/services/dm/dm.service';
import { resolveMessagingMetadata, type MessagingMetadata } from '@/services/dm/messaging-metadata';
import { initializeGeneratedAccount } from '@/services/account/generated-account-setup';
import { getAccount } from '@/services/account/account.service';
import { loadEncryptionKeys } from '@/services/dm/encryption-key.service';

jest.mock('@/services/account/generated-account-setup', () => ({ initializeGeneratedAccount: jest.fn() }));
jest.mock('@/services/relay/configuration-publish.service', () => ({ configurationPublisher: { start: jest.fn(), stop: jest.fn() } }));
jest.mock('@/services/account/account.service', () => ({
  getAccount: jest.fn(async () => ({ signerType: 'nsec', signerPayload: '', localSetupPending: false })),
  getActiveAccountPubkey: async () => 'account',
  migrateNip46BunkerSecrets: jest.fn(), setAccountEncryptionPubkey: jest.fn(),
  clearActiveAccountPubkey: jest.fn(), setActiveAccountPubkey: jest.fn(),
}));
jest.mock('@/services/dm/dm.service', () => ({ dmService: { init: jest.fn(), destroy: jest.fn() } }));
jest.mock('@/services/dm/encryption-key-rotation.service', () => ({ rotateEncryptionKeyIfDue: jest.fn() }));
jest.mock('@/services/relay/relay-pool', () => ({ relayPool: { destroy: jest.fn() } }));
jest.mock('@/services/relay/relay-list.service', () => ({
  loadAccountDmRelays: async () => ['wss://fresh.example'],
  ownKeyAnnouncementRelays: async () => [],
}));
jest.mock('@/services/signer/signer-factory', () => ({ createSigner: async () => ({ signEvent: jest.fn() }) }));
jest.mock('@/services/dm/messaging-metadata', () => ({
  resolveMessagingMetadata: jest.fn(), MessagingKeySyncRequiredError: class extends Error {},
  MessagingMetadataUnavailableError: class extends Error {},
}));
jest.mock('@/services/dm/encryption-key.service', () => ({
  loadEncryptionKeys: jest.fn(), publishEncryptionKeyAnnouncement: jest.fn(),
  getEncryptionPubkeyFromEvent: (event: Event) => event.tags[0][1],
}));

function metadata(key = 'old-key'): MessagingMetadata {
  return {
    accountPubkey: 'account', dmRelays: ['wss://fresh.example'], announcementRelays: [],
    announcement: { tags: [['n', key]] } as Event,
  };
}
const resolveMetadata = jest.mocked(resolveMessagingMetadata);
const loadKeys = jest.mocked(loadEncryptionKeys);
function hold<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
async function flush() { for (let i = 0; i < 50; i++) await Promise.resolve(); }

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(getAccount).mockResolvedValue({ signerType: 'nsec', signerPayload: '', localSetupPending: false } as never);
  jest.mocked(initializeGeneratedAccount).mockReset();
  jest.mocked(dmService.init).mockReset();
  useActiveAccount.setState({ activePubkey: null, status: 'idle', syncTargetPubkey: null, error: null });
  loadKeys.mockResolvedValue([{ pubkey: 'old-key', privkey: new Uint8Array(32), createdAt: 1 }]);
  resolveMetadata.mockResolvedValue(metadata());
});
afterEach(async () => { await useActiveAccount.getState().signOut(); });

it('shows local history while awaiting metadata but does not initialize receiving', async () => {
  const pending = hold<MessagingMetadata>();
  resolveMetadata.mockReturnValueOnce(pending.promise);
  await useActiveAccount.getState().loadFromStorage();
  await flush();
  expect(useActiveAccount.getState().status).toBe('ready');
  expect(dmService.init).not.toHaveBeenCalled();
  pending.resolve(metadata());
  await flush();
  expect(dmService.init).toHaveBeenCalledWith(expect.objectContaining({
    accountPubkey: 'account', dmRelays: ['wss://fresh.example'], metadata: metadata(),
  }));
});

it('waits for key transfer, rechecks metadata, and initializes only with the new key', async () => {
  resolveMetadata.mockResolvedValue(metadata('new-key'));
  await useActiveAccount.getState().loadFromStorage();
  await flush();
  expect(useActiveAccount.getState().status).toBe('need_sync');
  expect(dmService.init).not.toHaveBeenCalled();
  loadKeys.mockResolvedValue([{ pubkey: 'new-key', privkey: new Uint8Array(32), createdAt: 2 }]);
  await useActiveAccount.getState().completeSync();
  expect(resolveMetadata).toHaveBeenCalledTimes(2);
  expect(dmService.init).toHaveBeenCalledTimes(1);
  expect(useActiveAccount.getState().status).toBe('ready');
});

it('does not reopen a signed-out account after its metadata query returns', async () => {
  const pending = hold<MessagingMetadata>();
  resolveMetadata.mockReturnValueOnce(pending.promise);
  await useActiveAccount.getState().loadFromStorage();
  await flush();
  await useActiveAccount.getState().signOut();
  pending.resolve(metadata());
  await flush();
  expect(dmService.init).not.toHaveBeenCalled();
  expect(useActiveAccount.getState().activePubkey).toBeNull();
});

it('shows a newly generated account after local persistence while messaging starts asynchronously', async () => {
  jest.mocked(getAccount).mockResolvedValue({ signerType: 'generated', localSetupPending: true } as never);
  const preparing = hold<MessagingMetadata>();
  const messaging = hold<void>();
  jest.mocked(initializeGeneratedAccount).mockReturnValueOnce(preparing.promise);
  jest.mocked(dmService.init).mockReturnValueOnce(messaging.promise);
  const signingIn = useActiveAccount.getState().setActive('account');
  await flush();
  expect(useActiveAccount.getState().status).toBe('loading');
  expect(resolveMetadata).not.toHaveBeenCalled();
  preparing.resolve(metadata());
  await signingIn;
  expect(useActiveAccount.getState()).toMatchObject({ status: 'ready', activePubkey: 'account' });
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(dmService.init).toHaveBeenCalledWith(expect.objectContaining({ metadata: metadata(), skipInitialHistory: true }));
  expect(resolveMetadata).not.toHaveBeenCalled();
  messaging.resolve();
});

it('resumes marked local setup before taking the existing-key fast path', async () => {
  jest.mocked(getAccount).mockResolvedValue({ signerType: 'generated', localSetupPending: true } as never);
  jest.mocked(initializeGeneratedAccount).mockResolvedValueOnce(metadata());
  await useActiveAccount.getState().loadFromStorage();
  expect(initializeGeneratedAccount).toHaveBeenCalledTimes(1);
  expect(resolveMetadata).not.toHaveBeenCalled();
  expect(useActiveAccount.getState().status).toBe('ready');
  await new Promise((resolve) => setTimeout(resolve, 0));
});

it('still reconciles an established generated account remotely', async () => {
  jest.mocked(getAccount).mockResolvedValue({ signerType: 'generated', localSetupPending: false } as never);
  await useActiveAccount.getState().loadFromStorage();
  await flush();
  expect(initializeGeneratedAccount).not.toHaveBeenCalled();
  expect(resolveMetadata).toHaveBeenCalled();
});

it('does not use local creation setup for an imported account even if a marker is present', async () => {
  jest.mocked(getAccount).mockResolvedValue({ signerType: 'nsec', localSetupPending: true } as never);
  await useActiveAccount.getState().loadFromStorage();
  await flush();
  expect(initializeGeneratedAccount).not.toHaveBeenCalled();
  expect(resolveMetadata).toHaveBeenCalled();
});

it('keeps an imported account without a local key waiting for remote key discovery', async () => {
  loadKeys.mockResolvedValue([]);
  const remote = hold<MessagingMetadata>();
  resolveMetadata.mockReturnValueOnce(remote.promise);
  const signingIn = useActiveAccount.getState().setActive('account');
  await flush();
  expect(useActiveAccount.getState().status).toBe('loading');
  expect(initializeGeneratedAccount).not.toHaveBeenCalled();
  remote.resolve(metadata('remote-key'));
  await signingIn;
  expect(useActiveAccount.getState().status).toBe('need_sync');
  expect(dmService.init).not.toHaveBeenCalled();
});

it('does not reopen or replace a signed-out session when local setup finishes or rejects', async () => {
  jest.mocked(getAccount).mockResolvedValue({ signerType: 'generated', localSetupPending: true } as never);
  const preparing = hold<MessagingMetadata>();
  jest.mocked(initializeGeneratedAccount).mockReturnValueOnce(preparing.promise);
  const signingIn = useActiveAccount.getState().setActive('account');
  await flush();
  await useActiveAccount.getState().signOut();
  preparing.resolve(metadata());
  await signingIn;
  expect(useActiveAccount.getState()).toMatchObject({ status: 'ready', activePubkey: null, error: null });
  expect(dmService.init).not.toHaveBeenCalled();
});
