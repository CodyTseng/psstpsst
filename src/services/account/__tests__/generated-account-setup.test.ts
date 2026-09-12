import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import type { Event } from 'nostr-tools';

import { initializeGeneratedAccount } from '../generated-account-setup';
import { completeGeneratedAccountSetup } from '../account.service';
import { generateEncryptionKeypair, publishEncryptionKeyAnnouncement } from '../../dm/encryption-key.service';
import { saveAndPublishDmRelays } from '../../relay/relay-list.service';
import { configurationPublishRelays } from '../../relay/relay-router';

const mockEvents = new Map<number, Event>();
let mockAccount = { signerType: 'generated', signerPayload: null, localSetupPending: true };
let mockKeys: { pubkey: string; privkey: Uint8Array; createdAt: number }[] = [];
let mockEncryptionPubkey: string | null = null;
let mockSerial = 0;
function mockEvent(kind: number, tags: string[][] = []): Event {
  return { kind, pubkey: 'self', tags, content: '', created_at: 100, id: String(++mockSerial), sig: '' };
}

jest.mock('../account.service', () => ({
  getAccount: async () => mockAccount,
  setAccountEncryptionPubkey: async (_pubkey: string, key: string) => { mockEncryptionPubkey = key; },
  completeGeneratedAccountSetup: jest.fn(async () => { mockAccount.localSetupPending = false; }),
}));
jest.mock('../../signer/signer-factory', () => ({ createSigner: async () => ({}) }));
jest.mock('../../dm/encryption-key.service', () => ({
  loadEncryptionKeys: async () => mockKeys,
  generateEncryptionKeypair: jest.fn(async () => {
    const key = { pubkey: 'local-key', privkey: new Uint8Array(32), createdAt: 100 };
    mockKeys = [key];
    return key;
  }),
  getEncryptionPubkeyFromEvent: (event: Event) => event.tags.find((tag) => tag[0] === 'n')?.[1],
  publishEncryptionKeyAnnouncement: jest.fn(async ({ encryptionPubkey }: { encryptionPubkey: string }) => {
    mockEvents.set(10044, mockEvent(10044, [['n', encryptionPubkey]]));
  }),
}));
jest.mock('../../relay/relay-list.service', () => ({
  loadAccountDmRelays: async () => ['wss://local.example'],
  saveAndPublishDmRelays: jest.fn(async () => {
    mockEvents.set(10050, mockEvent(10050));
  }),
}));
jest.mock('../../relay/configuration-publish.service', () => ({
  prepareConfiguration: (_pubkey: string, _kind: number, _d: string, task: () => Promise<unknown>) => task(),
  publishConfiguration: jest.fn(async (_pubkey: string, _signer: unknown, template: { kind: number; tags: string[][] }) => {
    const event = mockEvent(template.kind, template.tags);
    mockEvents.set(template.kind, event);
    return event;
  }),
}));
jest.mock('../../relay/replaceable-events.service', () => ({
  getReplaceableEvents: async (keys: { kind: number }[]) => keys.map(({ kind }) => mockEvents.get(kind) ?? null),
}));
jest.mock('../../relay/relay-router', () => ({
  configurationPublishRelays: jest.fn(async () => ['wss://local.example']),
}));
// A remote lookup is never part of this service, even as a fallback.
jest.mock('../../dm/messaging-metadata', () => ({
  resolveMessagingMetadata: () => { throw new Error('Unexpected remote lookup'); },
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockEvents.clear();
  mockKeys = [];
  mockAccount = { signerType: 'generated', signerPayload: null, localSetupPending: true };
  mockEncryptionPubkey = null;
});

it('persists the first local key and both relay declarations before completing setup', async () => {
  const metadata = await initializeGeneratedAccount('self', new AbortController().signal);
  expect(mockEncryptionPubkey).toBe('local-key');
  expect([...mockEvents.keys()]).toEqual([10044, 10050, 10002]);
  expect(mockEvents.get(10002)?.tags.every((tag) => tag[2] === 'write')).toBe(true);
  expect(mockAccount.localSetupPending).toBe(false);
  expect(metadata).toMatchObject({
    accountPubkey: 'self', dmRelays: ['wss://local.example'], announcement: mockEvents.get(10044),
  });
  expect(jest.mocked(completeGeneratedAccountSetup).mock.invocationCallOrder[0])
    .toBeGreaterThan(jest.mocked(saveAndPublishDmRelays).mock.invocationCallOrder[0]);
});

it('reuses a persisted key and declaration after interrupted relay-list persistence', async () => {
  jest.mocked(saveAndPublishDmRelays).mockRejectedValueOnce(new Error('storage unavailable'));
  await expect(initializeGeneratedAccount('self', new AbortController().signal)).rejects.toThrow('storage unavailable');
  const key = mockKeys[0];
  expect(mockAccount.localSetupPending).toBe(true);
  expect(completeGeneratedAccountSetup).not.toHaveBeenCalled();
  await initializeGeneratedAccount('self', new AbortController().signal);
  expect(mockKeys[0]).toBe(key);
  expect(generateEncryptionKeypair).toHaveBeenCalledTimes(1);
  expect(publishEncryptionKeyAnnouncement).toHaveBeenCalledTimes(1);
  expect(mockAccount.localSetupPending).toBe(false);
});

it('preserves existing read/write relays when setup still needs a DM declaration', async () => {
  const metadata = mockEvent(10002, [['r', 'wss://custom.example', 'write']]);
  mockEvents.set(10002, metadata);
  await initializeGeneratedAccount('self', new AbortController().signal);
  expect(mockEvents.get(10002)).toBe(metadata);
  expect(mockEvents.has(10050)).toBe(true);
  expect(saveAndPublishDmRelays).toHaveBeenCalledTimes(1);
});

it('initializes missing read/write relays without republishing an existing DM declaration', async () => {
  const inbox = mockEvent(10050, [['relay', 'wss://inbox.example']]);
  mockEvents.set(10050, inbox);
  await initializeGeneratedAccount('self', new AbortController().signal);
  expect(mockEvents.get(10050)).toBe(inbox);
  expect(mockEvents.has(10002)).toBe(true);
  expect(saveAndPublishDmRelays).not.toHaveBeenCalled();
});

it('finishes an interrupted completion without re-signing persisted declarations', async () => {
  jest.mocked(completeGeneratedAccountSetup).mockRejectedValueOnce(new Error('storage unavailable'));
  await expect(initializeGeneratedAccount('self', new AbortController().signal)).rejects.toThrow('storage unavailable');
  const announcement = mockEvents.get(10044);
  await initializeGeneratedAccount('self', new AbortController().signal);
  expect(mockEvents.get(10044)).toBe(announcement);
  expect(generateEncryptionKeypair).toHaveBeenCalledTimes(1);
  expect(publishEncryptionKeyAnnouncement).toHaveBeenCalledTimes(1);
  expect(saveAndPublishDmRelays).toHaveBeenCalledTimes(1);
});

it.each(['nsec', 'nip46'])('rejects imported %s accounts even if marked pending', async (signerType) => {
  mockAccount.signerType = signerType;
  await expect(initializeGeneratedAccount('self', new AbortController().signal)).rejects.toThrow('not awaiting local creation');
  expect(generateEncryptionKeypair).not.toHaveBeenCalled();
});

it('rejects previously initialized generated accounts, including ones missing their local key', async () => {
  mockAccount.localSetupPending = false;
  await expect(initializeGeneratedAccount('self', new AbortController().signal)).rejects.toThrow('not awaiting local creation');
  expect(generateEncryptionKeypair).not.toHaveBeenCalled();
});

it('retains resumable setup when the session is cancelled after local persistence', async () => {
  const controller = new AbortController();
  jest.mocked(configurationPublishRelays).mockImplementationOnce(async () => {
    controller.abort();
    return ['wss://local.example'];
  });
  await expect(initializeGeneratedAccount('self', controller.signal)).rejects.toThrow('cancelled');
  expect(mockAccount.localSetupPending).toBe(true);
  expect(completeGeneratedAccountSetup).not.toHaveBeenCalled();
  await initializeGeneratedAccount('self', new AbortController().signal);
  expect(generateEncryptionKeypair).toHaveBeenCalledTimes(1);
});

it('does no work for an already cancelled session', async () => {
  const controller = new AbortController(); controller.abort();
  await expect(initializeGeneratedAccount('self', controller.signal)).rejects.toThrow('cancelled');
  expect(generateEncryptionKeypair).not.toHaveBeenCalled();
});

it('does not grant existing accounts the local-creation shortcut during migration', () => {
  const sqlite = new DatabaseSync(':memory:');
  try {
    sqlite.exec("CREATE TABLE accounts (pubkey TEXT PRIMARY KEY, signer_type TEXT); INSERT INTO accounts VALUES ('old', 'generated');");
    sqlite.exec(readFileSync(`${process.cwd()}/src/db/migrations/0046_local-account-setup.sql`, 'utf8'));
    expect(sqlite.prepare('SELECT local_setup_pending FROM accounts').get()).toEqual({ local_setup_pending: 0 });
  } finally {
    sqlite.close();
  }
});
