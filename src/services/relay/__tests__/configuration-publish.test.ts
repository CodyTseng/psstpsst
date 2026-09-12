import type { DatabaseSync } from 'node:sqlite';
import type { Event, EventTemplate } from 'nostr-tools';
import type { NetworkStateSnapshot } from '@/platform/ports/network-state';
import type { AppStateStatus } from '@/platform/ports/app-state';

const SELF = 'a'.repeat(64);
let mockDatabase: { sqlite: DatabaseSync; db: unknown } | undefined;
let mockNetwork: (state: NetworkStateSnapshot) => void;
let mockApp: (state: AppStateStatus) => void;
let mockAppState: AppStateStatus = 'active';
let mockTargets = ['wss://one.example/', 'wss://two.example/', 'wss://three.example/'];
const mockPublish = jest.fn();
let serial = 0;
const mockSigner = {
  getPublicKey: async () => SELF,
  nip44Encrypt: jest.fn(async (_pubkey: string, text: string) => `encrypted:${text}`),
  nip44Decrypt: jest.fn(async (_pubkey: string, text: string) => text.replace('encrypted:', '')),
  signEvent: jest.fn(async (template: EventTemplate): Promise<Event> => ({
    ...template, pubkey: SELF, id: `event-${++serial}`, sig: 'sig',
  })),
};
jest.mock('@/platform', () => ({ platform: {
  appState: { currentState: () => mockAppState, addChangeListener: (fn: typeof mockApp) => { mockApp = fn; return () => {}; } },
  networkState: { addStateListener: (fn: typeof mockNetwork) => { mockNetwork = fn; } },
} }));
jest.mock('../../account/account.service', () => ({ buildSigner: async () => mockSigner }));
jest.mock('../relay-router', () => ({ configurationPublishRelays: async () => mockTargets }));
jest.mock('../relay-pool', () => ({ relayPool: { publishEvent: (...args: unknown[]) => mockPublish(...args) } }));

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
    CREATE TABLE profiles (
      pubkey TEXT PRIMARY KEY, name TEXT, display_name TEXT, picture TEXT, nip05 TEXT,
      lud06 TEXT, lud16 TEXT, about TEXT, raw_event TEXT, fetched_at INTEGER
    );
    CREATE TABLE relay_lists (
      account_pubkey TEXT, relay_url TEXT, read INTEGER DEFAULT 1, write INTEGER DEFAULT 1,
      updated_at INTEGER, PRIMARY KEY (account_pubkey, relay_url)
    );
    CREATE TABLE media_server_lists (
      account_pubkey TEXT, server_url TEXT, updated_at INTEGER, PRIMARY KEY (account_pubkey, server_url)
    );
    CREATE TABLE contacts (
      account_pubkey TEXT, pubkey TEXT, added_at INTEGER, source TEXT, petname TEXT,
      PRIMARY KEY (account_pubkey, pubkey)
    );
    CREATE TABLE conversations (
      account_pubkey TEXT, conversation_key TEXT, has_replied INTEGER DEFAULT 0,
      delivery_kind TEXT DEFAULT 'relay', proximity_account_pubkey TEXT, name TEXT,
      last_message_at INTEGER DEFAULT 0, last_message_order_at INTEGER DEFAULT 0,
      last_message_id TEXT, unread_count INTEGER DEFAULT 0, deleted INTEGER DEFAULT 0,
      deleted_at INTEGER, deleted_order_at INTEGER, muted INTEGER DEFAULT 0, pinned INTEGER DEFAULT 0,
      last_read_at INTEGER, last_read_order_at INTEGER, last_read_message_id TEXT,
      PRIMARY KEY (account_pubkey, conversation_key)
    );
    CREATE TABLE blocked_users (
      account_pubkey TEXT, pubkey TEXT, blocked_at INTEGER, PRIMARY KEY (account_pubkey, pubkey)
    );
    CREATE TABLE replaceable_events (
      pubkey TEXT, kind INTEGER, d_tag TEXT, event TEXT, created_at INTEGER, fetched_at INTEGER,
      PRIMARY KEY (pubkey, kind, d_tag)
    );
  `);
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

type Service = typeof import('../configuration-publish.service');
let service: Service;
let worker: Service['configurationPublisher'];
let sqlite: DatabaseSync;
function event(kind = 0, d = '', createdAt = 100, pubkey = SELF): Event {
  return { kind, tags: [['d', d]], created_at: createdAt, pubkey, id: `event-${++serial}`, sig: 'sig', content: '{}' };
}
function results(successes: number) {
  return mockTargets.map((url, i) => ({ url, outcome: i < successes ? { ok: true } : { ok: false, reason: 'offline' } }));
}
async function settle() { for (let i = 0; i < 200; i++) await Promise.resolve(); }
async function start() { worker.start(SELF); await settle(); }
async function pending(kind = 0, d = '') { return service.getPendingConfiguration(SELF, kind, d); }
beforeEach(() => {
  mockDatabase = undefined;
  jest.resetModules();
  jest.useFakeTimers();
  jest.setSystemTime(1_800_000_000_000);
  mockAppState = 'active';
  mockTargets = ['wss://one.example/', 'wss://two.example/', 'wss://three.example/'];
  mockPublish.mockReset().mockImplementation(async () => results(0));
  mockSigner.signEvent.mockClear();
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  service = require('../configuration-publish.service');
  worker = service.configurationPublisher;
  sqlite = (jest.requireMock('@/db/client') as { sqlite: DatabaseSync }).sqlite;
});
afterEach(() => { worker.stop(); jest.clearAllTimers(); sqlite.close(); jest.useRealTimers(); });

it.each([[0, 1], [1, 1], [2, 2], [3, 2], [4, 3], [5, 3]])('requires a strict majority for %i relays', (total, quorum) => {
  expect(service.configurationPublishQuorum(total)).toBe(quorum);
});

it('rejects a partial edit when another client changed its base event', async () => {
  const base = event(10002);
  await service.enqueueConfigurationEvent(base);
  const remote = event(10002, '', 101);
  remote.tags = [['r', 'wss://remote-read.example', 'read']];
  await service.enqueueConfigurationEvent(remote);
  await expect(service.enqueueConfigurationEvent(event(10002, '', 102), undefined, base.id))
    .rejects.toThrow('Configuration changed');
  expect((await pending(10002))?.eventId).toBe(remote.id);
  const cached = sqlite.prepare('SELECT event FROM replaceable_events WHERE kind = 10002').get() as { event: string };
  expect(JSON.parse(cached.event).tags).toEqual(remote.tags);
});

it('commits the snapshot and pending work together and replaces only the same coordinate', async () => {
  const old = event(30000, 'muted');
  const latest = event(30000, 'muted', 101);
  await service.enqueueConfigurationEvent(old);
  await service.enqueueConfigurationEvent(event(30000, 'contacts'));
  await service.enqueueConfigurationEvent(event(30000, 'muted', 100, 'other'));
  await service.enqueueConfigurationEvent(latest);
  expect((await pending(30000, 'muted'))?.eventId).toBe(latest.id);
  expect(await service.enqueueConfigurationEvent(old)).toBe(false);
  expect(sqlite.prepare('SELECT count(*) AS n FROM configuration_outbox').get()).toEqual({ n: 3 });
  const cached = sqlite.prepare('SELECT event FROM replaceable_events WHERE pubkey = ? AND kind = 30000 AND d_tag = ?').get(SELF, 'muted') as { event: string };
  expect(JSON.parse(cached.event).id).toBe(latest.id);
  sqlite.exec("CREATE TRIGGER fail_cache BEFORE INSERT ON replaceable_events BEGIN SELECT RAISE(ABORT, 'disk failure'); END;");
  await expect(service.enqueueConfigurationEvent(event(10030))).rejects.toThrow();
  expect(await pending(10030)).toBeNull();
});

it('ignores d tags for ordinary replaceable events and rejects messages', async () => {
  await service.enqueueConfigurationEvent(event(0, 'one'));
  await service.enqueueConfigurationEvent(event(0, 'two', 101));
  expect((await pending())?.event.created_at).toBe(101);
  await expect(service.enqueueConfigurationEvent(event(1059))).rejects.toThrow('Only replaceable');
});

it('keeps failed events with a persisted deadline, reuses the signature, and clears at quorum', async () => {
  const snapshot = event();
  await service.enqueueConfigurationEvent(snapshot);
  await start();
  mockPublish.mockResolvedValueOnce(results(1));
  await worker.flush();
  const row = await pending();
  expect(row).toMatchObject({ attempts: 1, nextAttemptAt: Date.now() + 1000, acknowledgedRelays: [mockTargets[0]] });
  await worker.flush();
  expect(mockPublish).toHaveBeenCalledTimes(1);
  mockPublish.mockImplementationOnce(async ({ relays }) => relays.map((url: string) => ({ url, outcome: { ok: true } })));
  await jest.advanceTimersByTimeAsync(1000);
  expect(mockPublish.mock.calls[1][0]).toMatchObject({ event: snapshot, relays: mockTargets.slice(1) });
  expect(mockSigner.signEvent).not.toHaveBeenCalled();
  expect(await pending()).toBeNull();
});

it('recovers persisted payloads and acknowledgements in a new worker and reroutes from current settings', async () => {
  await service.enqueueConfigurationEvent(event());
  await start();
  mockPublish.mockResolvedValueOnce(results(1));
  await worker.flush();
  worker.stop();
  mockTargets = [mockTargets[1], 'wss://new.example/'];
  mockPublish.mockResolvedValueOnce(results(1));
  worker = new service.ConfigurationPublisher();
  await start();
  await worker.flush();
  expect(mockPublish.mock.calls[1][0].relays).toEqual(mockTargets);
  expect(await pending()).not.toBeNull(); // the old relay's receipt cannot count in the new quorum
  mockPublish.mockImplementationOnce(async ({ relays }) => relays.map((url: string) => ({ url, outcome: { ok: true } })));
  await jest.advanceTimersByTimeAsync(2000);
  expect(mockPublish.mock.calls[2][0].relays).toEqual([mockTargets[1]]);
  expect(await pending()).toBeNull();
});

it.each([true, false])('an old in-flight result cannot delete or delay its replacement (success=%s)', async (ok) => {
  let resolve!: (value: unknown) => void;
  mockPublish.mockReturnValueOnce(new Promise((done) => { resolve = done; }));
  await service.enqueueConfigurationEvent(event());
  await start();
  const delivery = worker.flush();
  await settle();
  expect(mockPublish).toHaveBeenCalledTimes(1);
  const latest = event(0, '', 101);
  await service.enqueueConfigurationEvent(latest);
  resolve(results(ok ? 3 : 0));
  await delivery;
  expect(await pending()).toMatchObject({ eventId: latest.id, attempts: 0, acknowledgedRelays: [] });
});

it('suspends retries offline and in background and wakes on recovery', async () => {
  await service.enqueueConfigurationEvent(event());
  await start();
  mockNetwork({ isConnected: false });
  await jest.advanceTimersByTimeAsync(60_000);
  expect(mockPublish).not.toHaveBeenCalled();
  mockNetwork({ isConnected: true });
  await settle();
  await worker.flush();
  expect(mockPublish).toHaveBeenCalledTimes(1);
  mockAppState = 'background'; mockApp(mockAppState);
  await jest.advanceTimersByTimeAsync(60_000);
  expect(mockPublish).toHaveBeenCalledTimes(1);
  mockAppState = 'active'; mockApp(mockAppState);
  await settle();
  mockPublish.mockResolvedValueOnce(results(2));
  await worker.flush();
  expect(await pending()).toBeNull();
});

it('cancels old-account work and does not retry deleted accounts', async () => {
  let resolve!: (value: unknown) => void;
  mockPublish.mockReturnValueOnce(new Promise((done) => { resolve = done; }));
  await service.enqueueConfigurationEvent(event());
  await start();
  const delivery = worker.flush(); await settle();
  const signal = mockPublish.mock.calls[0][0].abort as AbortSignal;
  worker.start('other'); await settle();
  expect(signal.aborted).toBe(true);
  resolve(results(3)); await delivery;
  expect(await pending()).not.toBeNull();
  sqlite.prepare('DELETE FROM accounts WHERE pubkey = ?').run(SELF);
  expect(await pending()).toBeNull();
  await worker.flush();
  expect(mockPublish).toHaveBeenCalledTimes(1);
});

it('signs successive same-second changes with increasing timestamps without waiting for relays', async () => {
  const template = { kind: 0, content: '{}', tags: [], created_at: 100 };
  const first = service.publishConfiguration(SELF, mockSigner, template);
  const second = service.publishConfiguration(SELF, mockSigner, { ...template, content: '{"name":"new"}' });
  await jest.runAllTimersAsync();
  const [a, b] = await Promise.all([first, second]);
  expect(b.created_at).toBe(a.created_at + 1);
  expect((await pending())?.eventId).toBe(b.id);
  expect(mockPublish).not.toHaveBeenCalled();
});

it('saves a profile locally while every relay is unavailable and merges subsequent edits', async () => {
  const { saveProfile, getProfile } = jest.requireActual('../../profile/profile.service') as typeof import('../../profile/profile.service');
  const options = { signer: mockSigner, accountPubkey: SELF, relays: [] };
  const first = saveProfile({ ...options, metadata: { name: 'Alice' } });
  const second = saveProfile({ ...options, metadata: { about: 'About Alice' } });
  await jest.runAllTimersAsync();
  await Promise.all([first, second]);
  expect(await getProfile(SELF)).toMatchObject({ name: 'Alice', about: 'About Alice' });
  expect(JSON.parse((await pending())!.event.content)).toMatchObject({ name: 'Alice', about: 'About Alice' });
  expect(mockPublish).not.toHaveBeenCalled();
  await start(); await worker.flush();
  expect((await pending())?.attempts).toBe(1);
});

it('persists initial relay lists, key announcements, and media servers without relay I/O', async () => {
  const { saveAndPublishDmRelays } = jest.requireActual('../relay-list.service') as typeof import('../relay-list.service');
  const { publishEncryptionKeyAnnouncement } = jest.requireActual('../../dm/encryption-key.service') as typeof import('../../dm/encryption-key.service');
  const { saveAndPublishMediaServers } = jest.requireActual('../../files/media-server.service') as typeof import('../../files/media-server.service');
  const saves = [
    saveAndPublishDmRelays({ accountPubkey: SELF, signer: mockSigner, relays: ['wss://dm.example'] }),
    publishEncryptionKeyAnnouncement({ signer: mockSigner, encryptionPubkey: 'b'.repeat(64), relays: [] }),
    saveAndPublishMediaServers({ accountPubkey: SELF, signer: mockSigner, servers: ['https://media.example'] }),
  ];
  await jest.runAllTimersAsync(); await Promise.all(saves);
  expect(sqlite.prepare('SELECT kind FROM configuration_outbox ORDER BY kind').all())
    .toEqual([10044, 10050, 10063].map((kind) => ({ kind })));
  expect(mockPublish).not.toHaveBeenCalled();
});

it('saves emoji packs and their collection offline, replacing only the edited pack', async () => {
  const { saveEmojiPack } = jest.requireActual('../../emoji/custom-emoji.service') as typeof import('../../emoji/custom-emoji.service');
  const saving = saveEmojiPack({ accountPubkey: SELF, title: 'Pack', emojis: [{ shortcode: 'wave', url: 'https://example.com/wave.png' }] });
  await jest.runAllTimersAsync(); const pack = await saving;
  expect(await pending(30030, pack.identifier)).not.toBeNull();
  expect(await pending(10030)).not.toBeNull();
  const editing = saveEmojiPack({ accountPubkey: SELF, title: 'New name', existing: pack, emojis: [{ shortcode: 'wave', url: 'https://example.com/wave.png' }] });
  await jest.runAllTimersAsync(); const edited = await editing;
  expect(edited.event.created_at).toBeGreaterThan(pack.event.created_at);
  expect((await pending(30030, pack.identifier))?.eventId).toBe(edited.event.id);
  expect(mockPublish).not.toHaveBeenCalled();
});

it('persists private mute/block snapshots before returning and protects them from stale remote lists', async () => {
  const { setConversationMuted, applyMutedEvent, MUTED_D } = jest.requireActual('../../conversation/conversation-prefs.service') as typeof import('../../conversation/conversation-prefs.service');
  const { blockUser, unblockUser, applyBlockedEvent, BLOCKED_D, getBlockedPubkeys } = jest.requireActual('../../dm/block.service') as typeof import('../../dm/block.service');
  const peer = 'b'.repeat(64);
  const saves = [setConversationMuted(SELF, peer, true), blockUser(SELF, peer)];
  await jest.runAllTimersAsync(); await Promise.all(saves);
  expect((await pending(30000, MUTED_D))?.event.content).toBe(`encrypted:${JSON.stringify([['p', peer]])}`);
  expect((await pending(30000, BLOCKED_D))?.event.content).toBe(`encrypted:${JSON.stringify([['p', peer]])}`);
  const empty = { ...event(30000), content: 'encrypted:[]' };
  await applyMutedEvent(SELF, empty, mockSigner);
  await applyBlockedEvent(SELF, empty, mockSigner);
  expect(sqlite.prepare('SELECT muted FROM conversations').get()).toEqual({ muted: 1 });
  expect(await getBlockedPubkeys(SELF)).toEqual([peer]);
  const removing = unblockUser(SELF, peer); await jest.runAllTimersAsync(); await removing;
  expect((await pending(30000, BLOCKED_D))?.event.content).toBe('encrypted:[]');
  expect(mockPublish).not.toHaveBeenCalled();
});

it('checks changed routing before clearing an in-flight event', async () => {
  let resolve!: (value: unknown) => void;
  mockPublish.mockReturnValueOnce(new Promise((done) => { resolve = done; }));
  await service.enqueueConfigurationEvent(event()); await start();
  const delivery = worker.flush(); await settle();
  const acknowledgements = results(3);
  mockTargets = ['wss://new-one.example', 'wss://new-two.example'];
  resolve(acknowledgements); await delivery;
  expect(await pending()).not.toBeNull();
});

it('never treats an empty relay set as successful publication', async () => {
  mockTargets = [];
  await service.enqueueConfigurationEvent(event()); await start(); await worker.flush();
  expect(await pending()).toMatchObject({ attempts: 1 });
  expect(mockPublish).not.toHaveBeenCalled();
});

it('rolls back profile state and pending publication when the profile write fails', async () => {
  const { saveProfile, getProfile } = jest.requireActual('../../profile/profile.service') as typeof import('../../profile/profile.service');
  sqlite.exec("CREATE TRIGGER fail_profile BEFORE INSERT ON profiles BEGIN SELECT RAISE(ABORT, 'disk failure'); END;");
  const saving = saveProfile({ accountPubkey: SELF, signer: mockSigner, relays: [], metadata: { name: 'Alice' } });
  const rejected = expect(saving).rejects.toThrow();
  await jest.runAllTimersAsync(); await rejected;
  expect(await getProfile(SELF)).toBeNull();
  expect(await pending()).toBeNull();
  expect(mockPublish).not.toHaveBeenCalled();
});

it('ignores a delayed private-list echo after a newer local snapshot is already acknowledged', async () => {
  const { setConversationMuted, applyMutedEvent, MUTED_D } = jest.requireActual('../../conversation/conversation-prefs.service') as typeof import('../../conversation/conversation-prefs.service');
  const peer = 'b'.repeat(64);
  const saving = setConversationMuted(SELF, peer, true); await jest.runAllTimersAsync(); await saving;
  mockPublish.mockResolvedValueOnce(results(2));
  await start(); await worker.flush();
  expect(await pending(30000, MUTED_D)).toBeNull();
  await applyMutedEvent(SELF, { ...event(30000, MUTED_D), content: 'encrypted:[]' }, mockSigner);
  expect(sqlite.prepare('SELECT muted FROM conversations').get()).toEqual({ muted: 1 });
});

it('does not reconcile a private-list echo while a newer local snapshot is still being prepared', async () => {
  const { MUTED_D } = jest.requireActual('../../conversation/conversation-prefs.service') as typeof import('../../conversation/conversation-prefs.service');
  let finish!: () => void;
  const preparing = service.prepareConfiguration(SELF, 30000, MUTED_D, () => new Promise<void>((resolve) => { finish = resolve; }));
  await jest.advanceTimersByTimeAsync(1);
  expect(await service.canApplyConfigurationEvent(SELF, 30000, MUTED_D, event(30000, MUTED_D))).toBe(false);
  finish(); await preparing;
  expect(await service.canApplyConfigurationEvent(SELF, 30000, MUTED_D, event(30000, MUTED_D))).toBe(true);
});
