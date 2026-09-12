import type { DatabaseSync } from 'node:sqlite';
import type { Event, EventTemplate } from 'nostr-tools';

const SELF = 'a'.repeat(64);
const ALICE = 'b'.repeat(64);
const BOB = 'c'.repeat(64);
const NOW = 1_800_000_000;
let serial = 0;
let mockDatabase: { sqlite: DatabaseSync; db: unknown } | undefined;
const mockSigner = {
  getPublicKey: async () => SELF,
  nip44Encrypt: jest.fn(async (_pubkey: string, plaintext: string) => plaintext),
  nip44Decrypt: jest.fn(async (_pubkey: string, content: string) => content),
  signEvent: jest.fn(async (template: EventTemplate): Promise<Event> => ({
    ...template, pubkey: SELF, id: `event-${++serial}`, sig: 'sig',
  })),
};
const mockPublish = jest.fn(async () => [{ url: 'wss://relay.example', outcome: { ok: true } }]);

jest.mock('@/platform', () => ({ platform: {
  appState: { currentState: () => 'active', addChangeListener: () => () => {} },
  networkState: { addStateListener: () => {} },
} }));
jest.mock('../../relay/relay-router', () => ({ configurationPublishRelays: async () => ['wss://relay.example'] }));

jest.mock('../../account/account.service', () => ({ buildSigner: async () => mockSigner }));
jest.mock('../../relay/relay-list.service', () => ({
  ownMetaRelays: async () => ['wss://relay.example'],
}));
jest.mock('../../relay/relay-pool', () => ({
  relayPool: { publishEvent: (...args: unknown[]) => (mockPublish as jest.Mock)(...args) },
}));

// Exercise real SQL and transaction isolation through the same async Drizzle
// binding as mobile. Only the native executor and network/signer are replaced.
jest.mock('@/db/client', () => {
  if (mockDatabase) return mockDatabase;
  const { DatabaseSync } = jest.requireActual('node:sqlite');
  const { readFileSync } = jest.requireActual('node:fs');
  const { createAsyncDatabase } = jest.requireActual('@/platform/create-async-database');
  const schema = jest.requireActual('@/db/schema');
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE accounts (pubkey TEXT PRIMARY KEY);
    INSERT INTO accounts VALUES ('${'a'.repeat(64)}'), ('other');
    CREATE TABLE contacts (
      account_pubkey TEXT, pubkey TEXT, added_at INTEGER, source TEXT, petname TEXT,
      PRIMARY KEY (account_pubkey, pubkey)
    );
    CREATE TABLE conversations (
      account_pubkey TEXT, conversation_key TEXT, has_replied INTEGER
    );
    CREATE TABLE replaceable_events (
      pubkey TEXT, kind INTEGER, d_tag TEXT, event TEXT, created_at INTEGER, fetched_at INTEGER,
      PRIMARY KEY (pubkey, kind, d_tag)
    );
  `);
  sqlite.exec(readFileSync(`${process.cwd()}/src/db/migrations/0044_contact-sync-state.sql`, 'utf8'));
  sqlite.exec(readFileSync(`${process.cwd()}/src/db/migrations/0045_configuration-outbox.sql`, 'utf8'));
  const execute = async (query: string, params: unknown[], method: string) => {
    const statement = sqlite.prepare(query);
    statement.setReturnArrays(true);
    if (method === 'run') {
      statement.run(...params);
      return { rows: [] };
    }
    return { rows: method === 'get' ? statement.get(...params) : statement.all(...params) };
  };
  let tail = Promise.resolve();
  function serialized<T>(task: () => Promise<T>): Promise<T> {
    const result = tail.then(task);
    tail = result.then(() => {}, () => {});
    return result;
  }
  const executor = {
    execute: (query: string, params: unknown[], method: string) =>
      serialized(() => execute(query, params, method)),
    transaction: (task: (tx: unknown) => Promise<unknown>) => serialized(async () => {
      sqlite.exec('BEGIN');
      try {
        const result = await task({ execute });
        sqlite.exec('COMMIT');
        return result;
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    }),
  };
  mockDatabase = { sqlite, db: createAsyncDatabase(executor, schema) };
  return mockDatabase;
});

type Service = typeof import('../contact.service');
type Cache = typeof import('../../relay/replaceable-events.service');
let service: Service;
let cache: Cache;
let sqlite: DatabaseSync;
let publisher: typeof import('../../relay/configuration-publish.service')['configurationPublisher'];

function remote(pubkeys: string[], createdAt = NOW - 60): Event {
  return {
    pubkey: SELF, kind: 30000, tags: [['d', 'psstpsst-contacts']],
    content: JSON.stringify(pubkeys.map((pubkey) => ['p', pubkey])),
    created_at: createdAt, id: `remote-${++serial}`, sig: 'sig',
  };
}
function saved(): { pubkey: string; petname: string | null }[] {
  return sqlite.prepare('SELECT pubkey, petname FROM contacts WHERE account_pubkey = ? ORDER BY pubkey')
    .all(SELF) as { pubkey: string; petname: string | null }[];
}
function dirty(): boolean {
  return !!(sqlite.prepare('SELECT dirty FROM contact_sync_state WHERE account_pubkey = ?')
    .get(SELF) as { dirty: number } | undefined)?.dirty;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
async function flushMicrotasks() {
  for (let i = 0; i < 200; i++) await Promise.resolve();
}
async function flushPublish() {
  await jest.runAllTimersAsync();
  await flushMicrotasks();
}

beforeEach(() => {
  mockDatabase = undefined;
  jest.resetModules();
  jest.useFakeTimers();
  jest.setSystemTime(NOW * 1000);
  mockSigner.nip44Encrypt.mockReset().mockImplementation(async (_pubkey, text) => text);
  mockSigner.nip44Decrypt.mockReset().mockImplementation(async (_pubkey, text) => text);
  mockSigner.signEvent.mockClear();
  mockPublish.mockReset().mockResolvedValue([{ url: 'wss://relay.example', outcome: { ok: true } }]);
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  service = require('../contact.service');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  cache = require('../../relay/replaceable-events.service');
  sqlite = (jest.requireMock('@/db/client') as { sqlite: DatabaseSync }).sqlite;
  publisher = jest.requireActual('../../relay/configuration-publish.service').configurationPublisher;
  publisher.start(SELF);
});
afterEach(async () => {
  await flushPublish();
  publisher.stop();
  sqlite.close();
  jest.useRealTimers();
});

it('keeps imported contacts when the contacts screen applies the old cached list before publication', async () => {
  const old = remote([]);
  await cache.storeReplaceableEvent(old);
  await service.importNostrFollowContacts(SELF, [ALICE]);
  await service.applyContactsEvent(SELF, old, mockSigner);
  expect(saved()).toEqual([{ pubkey: ALICE, petname: null }]);
  expect(dirty()).toBe(true);
  await flushPublish();
  expect(dirty()).toBe(false);
  await service.applyContactsEvent(SELF, old, mockSigner);
  expect(saved()).toHaveLength(1);
});

it('discards a delayed decryption after a local edit has already been published', async () => {
  const old = remote([]);
  await cache.storeReplaceableEvent(old);
  const decrypt = deferred<string>();
  mockSigner.nip44Decrypt.mockReturnValueOnce(decrypt.promise);
  const applying = service.applyContactsEvent(SELF, old, mockSigner);
  await flushMicrotasks();
  expect(mockSigner.nip44Decrypt).toHaveBeenCalled();
  await service.addContact(SELF, ALICE);
  await flushPublish();
  decrypt.resolve('[]');
  await applying;
  expect(saved()).toEqual([{ pubkey: ALICE, petname: null }]);
});

it('preserves pending imports after signer failure and retries from persisted state', async () => {
  mockSigner.nip44Encrypt.mockRejectedValueOnce(new Error('signer unavailable'));
  await service.importNostrFollowContacts(SELF, [ALICE]);
  await flushPublish();
  expect(dirty()).toBe(true);
  // Recreate the service without its in-memory publish jobs, as on restart.
  publisher.stop();
  jest.resetModules();
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  service = require('../contact.service');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  cache = require('../../relay/replaceable-events.service');
  publisher = jest.requireActual('../../relay/configuration-publish.service').configurationPublisher;
  publisher.start(SELF);
  await service.applyContactsEvent(SELF, remote([]), mockSigner);
  expect(saved()).toHaveLength(1);
  await flushPublish();
  expect(dirty()).toBe(false);
});

it('hands a failed publish to the durable queue without re-signing on a remote miss', async () => {
  mockPublish.mockResolvedValueOnce([{ url: 'wss://relay.example', outcome: { ok: false } }]);
  await service.addContact(SELF, ALICE);
  await jest.advanceTimersByTimeAsync(1);
  await flushMicrotasks();
  expect(dirty()).toBe(false);
  expect(sqlite.prepare('SELECT attempts FROM configuration_outbox').get()).toEqual({ attempts: 1 });
  await service.applyContactsEvent(SELF, null, mockSigner);
  await flushPublish();
  expect(mockSigner.signEvent).toHaveBeenCalledTimes(1);
  expect(mockPublish).toHaveBeenCalledTimes(2);
});

it('publishes strictly newer snapshots for consecutive edits within one second', async () => {
  await service.addContact(SELF, ALICE);
  await flushPublish();
  await service.addContact(SELF, BOB);
  await flushPublish();
  const templates = mockSigner.signEvent.mock.calls.map(([template]) => template);
  expect(templates[1].created_at).toBe(templates[0].created_at + 1);
  const latest = await cache.getReplaceableEvent({ pubkey: SELF, kind: 30000, dTag: service.CONTACTS_D });
  expect(JSON.parse(latest!.content)).toEqual([['p', ALICE], ['p', BOB]]);
});

it('replaces a snapshot superseded while encryption is pending', async () => {
  const encrypt = deferred<string>();
  mockSigner.nip44Encrypt.mockReturnValueOnce(encrypt.promise);
  await service.addContact(SELF, ALICE);
  await jest.advanceTimersByTimeAsync(0);
  await flushMicrotasks();
  expect(mockSigner.nip44Encrypt).toHaveBeenCalledTimes(1);
  await service.addContact(SELF, BOB);
  encrypt.resolve(JSON.stringify([['p', ALICE]]));
  await flushPublish();
  expect(mockPublish).toHaveBeenCalledTimes(1);
  expect(JSON.parse(mockSigner.signEvent.mock.calls.at(-1)![0].content))
    .toEqual([['p', ALICE], ['p', BOB]]);
  expect(dirty()).toBe(false);
});

it('does not clear a newer revision when an earlier publication is acknowledged', async () => {
  const publish = deferred<{ url: string; outcome: { ok: boolean } }[]>();
  mockPublish.mockReturnValueOnce(publish.promise);
  await service.addContact(SELF, ALICE);
  await jest.advanceTimersByTimeAsync(1);
  await flushMicrotasks();
  expect(mockPublish).toHaveBeenCalledTimes(1);
  await service.setPetname(SELF, ALICE, 'Alice');
  publish.resolve([{ url: 'wss://relay.example', outcome: { ok: true } }]);
  await flushMicrotasks();
  expect(dirty()).toBe(true);
  await flushPublish();
  expect(dirty()).toBe(false);
  expect(saved()).toEqual([{ pubkey: ALICE, petname: 'Alice' }]);
});

it('protects removals and nicknames while accepting a newer remote list after sync', async () => {
  await service.addContact(SELF, ALICE);
  await flushPublish();
  const old = remote([ALICE]);
  await service.removeContact(SELF, ALICE);
  await service.applyContactsEvent(SELF, old, mockSigner);
  expect(saved()).toEqual([]);
  await service.setPetname(SELF, BOB, 'Bob');
  await service.applyContactsEvent(SELF, old, mockSigner);
  expect(saved()).toEqual([{ pubkey: BOB, petname: 'Bob' }]);
  await flushPublish();
  const newer = remote([ALICE], NOW + 100);
  await cache.storeReplaceableEvent(newer);
  await service.applyContactsEvent(SELF, newer, mockSigner);
  expect(saved()).toEqual([{ pubkey: ALICE, petname: null }]);
});

it('isolates account state and removes sync metadata when the account is deleted', async () => {
  await service.addContact(SELF, ALICE);
  const otherEvent = { ...remote([BOB]), pubkey: 'other' };
  await service.applyContactsEvent('other', otherEvent, mockSigner);
  expect(sqlite.prepare('SELECT count(*) AS count FROM contacts WHERE account_pubkey = ?')
    .get('other')).toEqual({ count: 1 });
  await flushPublish();
  sqlite.prepare('DELETE FROM accounts WHERE pubkey = ?').run(SELF);
  expect(sqlite.prepare('SELECT * FROM contact_sync_state WHERE account_pubkey = ?').get(SELF))
    .toBeUndefined();
});
