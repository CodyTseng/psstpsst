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
jest.mock('../relay-list.service', () => ({ ownMetaRelays: async () => mockTargets }));
jest.mock('../relay-router', () => ({ configurationPublishRelays: async () => mockTargets }));
jest.mock('../relay-pool', () => ({ relayPool: { publishEvent: (...args: unknown[]) => mockPublish(...args), query: async () => [] } }));

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
      created_at INTEGER DEFAULT 0, created_order_at INTEGER DEFAULT 0,
      updated_at INTEGER DEFAULT 0, updated_order_at INTEGER DEFAULT 0,
      last_message_at INTEGER DEFAULT 0, last_message_order_at INTEGER DEFAULT 0,
      last_message_id TEXT, unread_count INTEGER DEFAULT 0, deleted INTEGER DEFAULT 0,
      deleted_at INTEGER, deleted_order_at INTEGER, muted INTEGER DEFAULT 0, pinned INTEGER DEFAULT 0,
      last_read_at INTEGER, last_read_order_at INTEGER, last_read_message_id TEXT,
      group_id TEXT, member_pubkeys TEXT, members_bootstrap_order_at INTEGER,
      members_bootstrap_event_id TEXT, members_action_order_at INTEGER,
      members_action_event_id TEXT, name_order_at INTEGER, name_event_id TEXT,
      PRIMARY KEY (account_pubkey, conversation_key)
    );
    CREATE TABLE blocked_users (
      account_pubkey TEXT, pubkey TEXT, blocked_at INTEGER, PRIMARY KEY (account_pubkey, pubkey)
    );
    CREATE TABLE saved_groups (
      account_pubkey TEXT, group_id TEXT, PRIMARY KEY (account_pubkey, group_id)
    );
    CREATE TABLE replaceable_events (
      pubkey TEXT, kind INTEGER, d_tag TEXT, event TEXT, created_at INTEGER, fetched_at INTEGER,
      PRIMARY KEY (pubkey, kind, d_tag)
    );
  `);
  sqlite.exec(readFileSync(`${process.cwd()}/src/db/migrations/0056_private-list-sync-state.sql`, 'utf8'));
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

it('queues complete private snapshots after local writes and protects them from stale remote lists', async () => {
  const { setConversationMuted, applyMutedEvent, MUTED_D } = jest.requireActual('../../conversation/conversation-prefs.service') as typeof import('../../conversation/conversation-prefs.service');
  const { blockUser, unblockUser, applyBlockedEvent, BLOCKED_D, getBlockedPubkeys } = jest.requireActual('../../dm/block.service') as typeof import('../../dm/block.service');
  const { setGroupSaved } = jest.requireActual('../../group/saved-groups.service') as typeof import('../../group/saved-groups.service');
  const peer = 'b'.repeat(64);
  const groupId = 'private-group-id';
  sqlite.prepare(`
    INSERT INTO conversations (
      account_pubkey, conversation_key, group_id, deleted, has_replied
    ) VALUES (?, ?, ?, 1, 0)
  `).run(SELF, 'group:private', groupId);
  const saves = [
    setConversationMuted(SELF, peer, true),
    blockUser(SELF, peer),
    setGroupSaved(SELF, groupId, true),
  ];
  await jest.runAllTimersAsync(); await Promise.all(saves);
  expect((await pending(30000, MUTED_D))?.event.content).toBe(`encrypted:${JSON.stringify([['p', peer]])}`);
  expect((await pending(30000, BLOCKED_D))?.event.content).toBe(`encrypted:${JSON.stringify([['p', peer]])}`);
  expect((await pending(30000, 'psstpsst-contacts'))?.event.content).toBe(
    `encrypted:${JSON.stringify([['h', groupId]])}`,
  );
  expect(await pending(30078, 'psstpsst-saved-groups')).toBeNull();
  const empty = { ...event(30000), content: 'encrypted:[]' };
  await applyMutedEvent(SELF, empty, mockSigner);
  await applyBlockedEvent(SELF, empty, mockSigner);
  const { applyContactsEvent } = jest.requireActual('../../contact/contact.service') as typeof import('../../contact/contact.service');
  await applyContactsEvent(SELF, { ...empty, tags: [['d', 'psstpsst-contacts']] }, mockSigner);
  expect(sqlite.prepare(
    'SELECT muted FROM conversations WHERE conversation_key = ?',
  ).get(peer)).toEqual({ muted: 1 });
  expect(await getBlockedPubkeys(SELF)).toEqual([peer]);
  expect(sqlite.prepare('SELECT group_id FROM saved_groups').all()).toEqual([
    { group_id: groupId },
  ]);
  expect(sqlite.prepare(
    'SELECT deleted, has_replied FROM conversations WHERE group_id = ?',
  ).get(groupId)).toEqual({ deleted: 0, has_replied: 1 });
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

it('migrates local saved groups and atomically removes only their old account coordinate', async () => {
  const { migrateLocalSavedGroups, CONTACTS_D } = jest.requireActual('../../contact/contact.service') as typeof import('../../contact/contact.service');
  sqlite.prepare('INSERT INTO saved_groups (account_pubkey, group_id) VALUES (?, ?)').run(SELF, 'local-room');
  // Legacy encrypted payload is no longer decoded; the saved table is authoritative.
  const old = { ...event(30078, 'psstpsst-saved-groups'), content: 'opaque-legacy-content' };
  await service.enqueueConfigurationEvent(old);
  await service.enqueueConfigurationEvent(event(30078, 'unrelated'));
  await service.enqueueConfigurationEvent(event(30078, 'psstpsst-saved-groups', 100, 'other'));
  const migrating = migrateLocalSavedGroups(SELF, mockSigner);
  await jest.runAllTimersAsync(); await migrating;
  expect((await pending(30000, CONTACTS_D))?.event.content).toBe('encrypted:[["h","local-room"]]');
  expect((await pending(30000, CONTACTS_D))?.event.tags.some((tag) => tag[0] === 'version')).toBe(false);
  expect(await pending(30078, 'psstpsst-saved-groups')).toBeNull();
  expect(sqlite.prepare('SELECT event FROM replaceable_events WHERE pubkey = ? AND kind = 30078 AND d_tag = ?')
    .get(SELF, 'psstpsst-saved-groups')).toBeUndefined();
  expect(await pending(30078, 'unrelated')).not.toBeNull();
  expect(sqlite.prepare('SELECT event_id FROM configuration_outbox WHERE account_pubkey = ?').get('other')).toBeDefined();
  mockSigner.signEvent.mockClear();
  await migrateLocalSavedGroups(SELF, mockSigner);
  expect(mockSigner.signEvent).not.toHaveBeenCalled();
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


it('publishes raw h ids for muted groups and reconciles them without re-publishing', async () => {
  const { setConversationMuted, applyMutedEvent, MUTED_D } = jest.requireActual('../../conversation/conversation-prefs.service') as typeof import('../../conversation/conversation-prefs.service');
  const { groupConversationKey } = jest.requireActual('@/lib/nostr/group-messaging') as typeof import('@/lib/nostr/group-messaging');
  const groupId = 'room/皇上';
  const key = groupConversationKey(groupId);
  sqlite.prepare('INSERT INTO conversations (account_pubkey, conversation_key, group_id) VALUES (?, ?, ?)')
    .run(SELF, key, groupId);
  const saving = setConversationMuted(SELF, key, true);
  await jest.runAllTimersAsync(); await saving;
  expect((await pending(30000, MUTED_D))?.event.content)
    .toBe(`encrypted:${JSON.stringify([['h', groupId]])}`);
  sqlite.exec('DELETE FROM configuration_outbox; DELETE FROM replaceable_events; UPDATE conversations SET muted = 0;');
  mockSigner.signEvent.mockClear();
  await applyMutedEvent(SELF, {
    ...event(30000, MUTED_D), content: `encrypted:${JSON.stringify([['h', groupId]])}`,
  }, mockSigner);
  expect(sqlite.prepare('SELECT muted FROM conversations').get()).toEqual({ muted: 1 });
  expect(await pending(30000, MUTED_D)).toBeNull();
  expect(mockSigner.signEvent).not.toHaveBeenCalled();
});

it('converts discovered g tags into h and durably queues a newer encrypted snapshot', async () => {
  const { applyMutedEvent, MUTED_D } = jest.requireActual('../../conversation/conversation-prefs.service') as typeof import('../../conversation/conversation-prefs.service');
  const { groupConversationKey } = jest.requireActual('@/lib/nostr/group-messaging') as typeof import('@/lib/nostr/group-messaging');
  const groupId = 'legacy-room';
  const key = groupConversationKey(groupId);
  const peer = 'b'.repeat(64);
  sqlite.prepare('INSERT INTO conversations (account_pubkey, conversation_key, group_id) VALUES (?, ?, ?)')
    .run(SELF, key, groupId);
  sqlite.prepare('INSERT INTO conversations (account_pubkey, conversation_key, muted) VALUES (?, ?, 1)')
    .run('other', 'untouched');
  const old = {
    ...event(30000, MUTED_D),
    content: `encrypted:${JSON.stringify([['p', peer], ['g', key], ['h', groupId], ['custom', 'keep']])}`,
  };
  await service.enqueueConfigurationEvent(old);
  sqlite.exec('DELETE FROM configuration_outbox;');
  const applying = applyMutedEvent(SELF, old, mockSigner);
  await jest.runAllTimersAsync(); await applying;
  const migrated = (await pending(30000, MUTED_D))!.event;
  expect(migrated.content).toBe(`encrypted:${JSON.stringify([
    ['p', peer], ['h', groupId], ['h', groupId], ['custom', 'keep'],
  ])}`);
  expect(migrated.tags).toEqual(old.tags);
  expect(migrated.created_at).toBeGreaterThan(old.created_at);
  expect(sqlite.prepare('SELECT muted FROM conversations WHERE account_pubkey = ? AND conversation_key = ?')
    .get(SELF, key)).toEqual({ muted: 1 });
  expect(sqlite.prepare('SELECT muted FROM conversations WHERE account_pubkey = ? AND conversation_key = ?')
    .get(SELF, peer)).toEqual({ muted: 1 });
  expect(sqlite.prepare('SELECT muted FROM conversations WHERE account_pubkey = ?').get('other'))
    .toEqual({ muted: 1 });
  const cache = sqlite.prepare('SELECT event FROM replaceable_events WHERE pubkey = ? AND d_tag = ?')
    .get(SELF, MUTED_D) as { event: string };
  expect(JSON.parse(cache.event).id).toBe(migrated.id);
  mockSigner.signEvent.mockClear();
  await applyMutedEvent(SELF, old, mockSigner);
  expect(mockSigner.signEvent).not.toHaveBeenCalled();
  expect((await pending(30000, MUTED_D))?.eventId).toBe(migrated.id);
});

it('leaves an unresolved legacy group snapshot intact until its raw id is available', async () => {
  const { applyMutedEvent, MUTED_D } = jest.requireActual('../../conversation/conversation-prefs.service') as typeof import('../../conversation/conversation-prefs.service');
  const { groupConversationKey } = jest.requireActual('@/lib/nostr/group-messaging') as typeof import('@/lib/nostr/group-messaging');
  const groupId = 'not-yet-known';
  const key = groupConversationKey(groupId);
  sqlite.prepare('INSERT INTO conversations (account_pubkey, conversation_key, muted) VALUES (?, ?, 1)')
    .run(SELF, 'local-peer');
  // A different account's group id must not resolve this account's legacy tag.
  sqlite.prepare('INSERT INTO conversations (account_pubkey, conversation_key, group_id) VALUES (?, ?, ?)')
    .run('other', key, groupId);
  const old = { ...event(30000, MUTED_D), content: `encrypted:${JSON.stringify([['g', key]])}` };
  await applyMutedEvent(SELF, old, mockSigner);
  expect(sqlite.prepare('SELECT muted FROM conversations WHERE account_pubkey = ?').get(SELF))
    .toEqual({ muted: 1 });
  expect(await pending(30000, MUTED_D)).toBeNull();
  expect(mockSigner.signEvent).not.toHaveBeenCalled();
  sqlite.prepare('INSERT INTO conversations (account_pubkey, conversation_key, group_id) VALUES (?, ?, ?)')
    .run(SELF, key, groupId);
  const retry = applyMutedEvent(SELF, old, mockSigner);
  await jest.runAllTimersAsync(); await retry;
  expect((await pending(30000, MUTED_D))?.event.content)
    .toBe(`encrypted:${JSON.stringify([['h', groupId]])}`);
});

it('keeps a failed legacy mute migration in the background when encryption races with a newer snapshot', async () => {
  const { applyMutedEvent, MUTED_D } = jest.requireActual('../../conversation/conversation-prefs.service') as typeof import('../../conversation/conversation-prefs.service');
  const { groupConversationKey } = jest.requireActual('@/lib/nostr/group-messaging') as typeof import('@/lib/nostr/group-messaging');
  const key = groupConversationKey('room');
  sqlite.prepare('INSERT INTO conversations (account_pubkey, conversation_key, group_id) VALUES (?, ?, ?)')
    .run(SELF, key, 'room');
  const old = { ...event(30000, MUTED_D), content: `encrypted:${JSON.stringify([['g', key]])}` };
  const newer = { ...event(30000, MUTED_D, 200), content: 'encrypted:[]' };
  mockSigner.nip44Encrypt.mockImplementationOnce(async (_pubkey, plaintext) => {
    await service.enqueueConfigurationEvent(newer);
    return `encrypted:${plaintext}`;
  });
  const applying = applyMutedEvent(SELF, old, mockSigner);
  await applying;
  await jest.runAllTimersAsync();
  expect((await pending(30000, MUTED_D))?.eventId).toBe(newer.id);
});


it('preserves contacts and group membership when either domain publishes an edit', async () => {
  const { addContact, removeContact, setPetname, CONTACTS_D } = jest.requireActual('../../contact/contact.service') as typeof import('../../contact/contact.service');
  const { setGroupSaved } = jest.requireActual('../../group/saved-groups.service') as typeof import('../../group/saved-groups.service');
  const peer = 'b'.repeat(64);
  await addContact(SELF, peer);
  await jest.runAllTimersAsync();
  const saving = setGroupSaved(SELF, 'room', true);
  await jest.runAllTimersAsync(); await saving;
  expect((await pending(30000, CONTACTS_D))?.event.content)
    .toBe(`encrypted:${JSON.stringify([['p', peer], ['h', 'room']])}`);
  expect(await pending(30078, 'psstpsst-saved-groups')).toBeNull();
  await setPetname(SELF, peer, 'Friend'); await jest.runAllTimersAsync();
  expect((await pending(30000, CONTACTS_D))?.event.content)
    .toBe(`encrypted:${JSON.stringify([['p', peer, '', 'Friend'], ['h', 'room']])}`);
  const removing = setGroupSaved(SELF, 'room', false);
  await jest.runAllTimersAsync(); await removing;
  expect((await pending(30000, CONTACTS_D))?.event.content)
    .toBe(`encrypted:${JSON.stringify([['p', peer, '', 'Friend']])}`);
  const restoring = setGroupSaved(SELF, 'room', true);
  await jest.runAllTimersAsync(); await restoring;
  await removeContact(SELF, peer); await jest.runAllTimersAsync();
  expect((await pending(30000, CONTACTS_D))?.event.content)
    .toBe(`encrypted:${JSON.stringify([['h', 'room']])}`);
});

it('reconciles p and h together and treats an empty group list as authoritative', async () => {
  const { applyContactsEvent, CONTACTS_D } = jest.requireActual('../../contact/contact.service') as typeof import('../../contact/contact.service');
  const peer = 'b'.repeat(64);
  sqlite.prepare('INSERT INTO conversations (account_pubkey, conversation_key, group_id, deleted) VALUES (?, ?, ?, 1)')
    .run(SELF, 'group:room', 'room');
  const combined = {
    ...event(30000, CONTACTS_D), tags: [['d', CONTACTS_D]],
    content: `encrypted:${JSON.stringify([['p', peer, '', 'Friend'], ['h', 'room']])}`,
  };
  await service.enqueueConfigurationEvent(combined); sqlite.exec('DELETE FROM configuration_outbox;');
  await applyContactsEvent(SELF, combined, mockSigner);
  expect(sqlite.prepare('SELECT pubkey, petname FROM contacts').all()).toEqual([{ pubkey: peer, petname: 'Friend' }]);
  expect(sqlite.prepare('SELECT group_id FROM saved_groups').all()).toEqual([{ group_id: 'room' }]);
  expect(sqlite.prepare('SELECT deleted, has_replied FROM conversations WHERE group_id = ?').get('room'))
    .toEqual({ deleted: 0, has_replied: 1 });
  const empty = { ...combined, id: 'combined-empty', created_at: 101, content: 'encrypted:[]' };
  await service.enqueueConfigurationEvent(empty); sqlite.exec('DELETE FROM configuration_outbox;');
  await applyContactsEvent(SELF, empty, mockSigner);
  expect(sqlite.prepare('SELECT * FROM contacts').all()).toEqual([]);
  expect(sqlite.prepare('SELECT * FROM saved_groups').all()).toEqual([]);
  expect(await pending(30000, CONTACTS_D)).toBeNull();
});

it('preserves contacts and nicknames when migrating local saved-group rows', async () => {
  const { migrateLocalSavedGroups, CONTACTS_D } = jest.requireActual('../../contact/contact.service') as typeof import('../../contact/contact.service');
  const peer = 'b'.repeat(64);
  const contacts = { ...event(30000, CONTACTS_D), content: `encrypted:${JSON.stringify([['p', peer, '', 'Friend']])}` };
  await service.enqueueConfigurationEvent(contacts); sqlite.exec('DELETE FROM configuration_outbox;');
  sqlite.prepare('INSERT INTO saved_groups (account_pubkey, group_id) VALUES (?, ?)').run(SELF, 'room');
  await service.enqueueConfigurationEvent(event(30078, 'psstpsst-saved-groups'));
  const migrating = migrateLocalSavedGroups(SELF, mockSigner);
  await jest.runAllTimersAsync(); await migrating;
  const result = (await pending(30000, CONTACTS_D))!.event;
  expect(result.content).toBe(`encrypted:${JSON.stringify([['p', peer, '', 'Friend'], ['h', 'room']])}`);
  expect(result.tags.some((tag) => tag[0] === 'version')).toBe(false);
  expect(result.created_at).toBeGreaterThan(contacts.created_at);
  expect(await pending(30078, 'psstpsst-saved-groups')).toBeNull();
});

it('coalesces concurrent contact and group edits into the latest complete snapshot', async () => {
  const { addContact, CONTACTS_D } = jest.requireActual('../../contact/contact.service') as typeof import('../../contact/contact.service');
  const { setGroupSaved } = jest.requireActual('../../group/saved-groups.service') as typeof import('../../group/saved-groups.service');
  const peer = 'b'.repeat(64);
  let resolve!: (value: string) => void;
  let started!: () => void;
  const encrypting = new Promise<void>((done) => { started = done; });
  mockSigner.nip44Encrypt.mockImplementationOnce(async () => {
    started();
    return new Promise<string>((done) => { resolve = done; });
  });
  await addContact(SELF, peer);
  await jest.advanceTimersByTimeAsync(0); await encrypting;
  const saving = setGroupSaved(SELF, 'room', true);
  await settle();
  resolve(`encrypted:${JSON.stringify([['p', peer]])}`);
  await jest.runAllTimersAsync(); await saving;
  expect((await pending(30000, CONTACTS_D))?.event.content)
    .toBe(`encrypted:${JSON.stringify([['p', peer], ['h', 'room']])}`);
  expect(sqlite.prepare('SELECT dirty FROM contact_sync_state').get()).toEqual({ dirty: 0 });
});

it('completes group saves locally before crypto and retains failed plaintext for the next edit', async () => {
  const { applyContactsEvent, CONTACTS_D } = jest.requireActual('../../contact/contact.service') as typeof import('../../contact/contact.service');
  const { setGroupSaved } = jest.requireActual('../../group/saved-groups.service') as typeof import('../../group/saved-groups.service');
  mockSigner.nip44Encrypt.mockRejectedValueOnce(new Error('signer unavailable'));
  await setGroupSaved(SELF, 'room', true);
  expect(sqlite.prepare('SELECT group_id FROM saved_groups').all()).toEqual([{ group_id: 'room' }]);
  expect(mockSigner.signEvent).not.toHaveBeenCalled();
  await jest.runAllTimersAsync();
  expect(sqlite.prepare('SELECT dirty FROM contact_sync_state').get()).toEqual({ dirty: 1 });
  await applyContactsEvent(SELF, { ...event(30000, CONTACTS_D), content: 'encrypted:[]' }, mockSigner);
  await jest.runAllTimersAsync();
  expect(await pending(30000, CONTACTS_D)).toBeNull();
  await setGroupSaved(SELF, 'another-room', true);
  await jest.runAllTimersAsync();
  expect((await pending(30000, CONTACTS_D))?.event.content)
    .toBe('encrypted:[["h","another-room"],["h","room"]]');
});

it('clears saved groups absent from the contact list and rejects malformed h entries', async () => {
  const { applyContactsEvent, CONTACTS_D } = jest.requireActual('../../contact/contact.service') as typeof import('../../contact/contact.service');
  const peer = 'b'.repeat(64);
  sqlite.prepare('INSERT INTO saved_groups (account_pubkey, group_id) VALUES (?, ?)').run(SELF, 'room');
  await applyContactsEvent(SELF, {
    ...event(30000, CONTACTS_D), content: `encrypted:${JSON.stringify([['p', peer]])}`,
  }, mockSigner);
  expect(sqlite.prepare('SELECT group_id FROM saved_groups').all()).toEqual([]);
  await applyContactsEvent(SELF, {
    ...event(30000, CONTACTS_D, 101), tags: [['d', CONTACTS_D]],
    content: 'encrypted:[["h",""]]',
  }, mockSigner);
  expect(sqlite.prepare('SELECT pubkey FROM contacts').all()).toEqual([{ pubkey: peer }]);
  expect(sqlite.prepare('SELECT group_id FROM saved_groups').all()).toEqual([]);
});

it('keeps old local cache and pending rows when migration signing fails, then retries safely', async () => {
  const { migrateLocalSavedGroups, CONTACTS_D } = jest.requireActual('../../contact/contact.service') as typeof import('../../contact/contact.service');
  sqlite.prepare('INSERT INTO saved_groups (account_pubkey, group_id) VALUES (?, ?)').run(SELF, 'room');
  const old = event(30078, 'psstpsst-saved-groups');
  await service.enqueueConfigurationEvent(old);
  mockSigner.nip44Encrypt.mockRejectedValueOnce(new Error('signer unavailable'));
  const migrating = migrateLocalSavedGroups(SELF, mockSigner);
  await migrating;
  await jest.runAllTimersAsync();
  expect((await pending(30078, 'psstpsst-saved-groups'))?.eventId).toBe(old.id);
  expect(sqlite.prepare('SELECT event FROM replaceable_events WHERE kind = 30078').get()).toBeDefined();
  expect(sqlite.prepare('SELECT group_id FROM saved_groups').all()).toEqual([{ group_id: 'room' }]);
  const retrying = migrateLocalSavedGroups(SELF, mockSigner);
  await jest.runAllTimersAsync(); await retrying;
  expect((await pending(30000, CONTACTS_D))?.event.content).toBe('encrypted:[["h","room"]]');
  expect(await pending(30078, 'psstpsst-saved-groups')).toBeNull();
  expect(sqlite.prepare('SELECT event FROM replaceable_events WHERE kind = 30078').get()).toBeUndefined();
});


it('rolls back legacy cleanup when storing the migrated list fails', async () => {
  const { migrateLocalSavedGroups, CONTACTS_D } = jest.requireActual('../../contact/contact.service') as typeof import('../../contact/contact.service');
  sqlite.prepare('INSERT INTO saved_groups (account_pubkey, group_id) VALUES (?, ?)').run(SELF, 'room');
  const old = event(30078, 'psstpsst-saved-groups');
  await service.enqueueConfigurationEvent(old);
  sqlite.exec("CREATE TRIGGER fail_migration BEFORE UPDATE ON contact_sync_state WHEN NEW.dirty = 0 BEGIN SELECT RAISE(ABORT, 'disk failure'); END;");
  const migrating = migrateLocalSavedGroups(SELF, mockSigner);
  await migrating;
  await jest.runAllTimersAsync();
  expect((await pending(30078, 'psstpsst-saved-groups'))?.eventId).toBe(old.id);
  expect(sqlite.prepare('SELECT event FROM replaceable_events WHERE kind = 30078').get()).toBeDefined();
  expect(await pending(30000, CONTACTS_D)).toBeNull();
  sqlite.exec('DROP TRIGGER fail_migration;');
  const retrying = migrateLocalSavedGroups(SELF, mockSigner);
  await jest.runAllTimersAsync(); await retrying;
  expect((await pending(30000, CONTACTS_D))?.event.content).toBe('encrypted:[["h","room"]]');
  expect(await pending(30078, 'psstpsst-saved-groups')).toBeNull();
});


it.each(['cache', 'outbox'])('migrates when only the local legacy %s row remains', async (remaining) => {
  const { migrateLocalSavedGroups, CONTACTS_D } = jest.requireActual('../../contact/contact.service') as typeof import('../../contact/contact.service');
  sqlite.prepare('INSERT INTO saved_groups (account_pubkey, group_id) VALUES (?, ?)').run(SELF, 'room');
  await service.enqueueConfigurationEvent(event(30078, 'psstpsst-saved-groups'));
  if (remaining === 'cache') sqlite.exec('DELETE FROM configuration_outbox;');
  else sqlite.exec('DELETE FROM replaceable_events;');
  const migrating = migrateLocalSavedGroups(SELF, mockSigner);
  await jest.runAllTimersAsync(); await migrating;
  expect((await pending(30000, CONTACTS_D))?.event.content).toBe('encrypted:[["h","room"]]');
  expect(await pending(30078, 'psstpsst-saved-groups')).toBeNull();
  expect(sqlite.prepare('SELECT * FROM replaceable_events WHERE kind = 30078').all()).toEqual([]);
});


it('keeps a cache conflict in the background and builds from fresh plaintext on the next edit', async () => {
  const { setGroupSaved } = jest.requireActual('../../group/saved-groups.service') as typeof import('../../group/saved-groups.service');
  const { CONTACTS_D } = jest.requireActual('../../contact/contact.service') as typeof import('../../contact/contact.service');
  const enqueue = service.enqueueConfigurationEvent;
  const arriving = { ...event(30000, CONTACTS_D), content: 'encrypted:[]' };
  const spy = jest.spyOn(service, 'enqueueConfigurationEvent').mockImplementationOnce(async (...args) => {
    // Arrive after the publisher's final cache read, before its enqueue transaction.
    await enqueue(arriving);
    return enqueue(...args);
  });
  await setGroupSaved(SELF, 'room', true);
  await jest.runAllTimersAsync();
  expect(sqlite.prepare('SELECT dirty FROM contact_sync_state').get()).toEqual({ dirty: 1 });
  expect(sqlite.prepare('SELECT group_id FROM saved_groups').all()).toEqual([{ group_id: 'room' }]);
  expect((await pending(30000, CONTACTS_D))?.eventId).toBe(arriving.id);
  spy.mockRestore();
  await setGroupSaved(SELF, 'new-room', true);
  await jest.runAllTimersAsync();
  expect((await pending(30000, CONTACTS_D))?.event.content)
    .toBe('encrypted:[["h","new-room"],["h","room"]]');
  expect(sqlite.prepare('SELECT dirty FROM contact_sync_state').get()).toEqual({ dirty: 0 });
});


it('continues a queued later edit after an earlier encryption fails', async () => {
  const { setGroupSaved } = jest.requireActual('../../group/saved-groups.service') as typeof import('../../group/saved-groups.service');
  const { CONTACTS_D } = jest.requireActual('../../contact/contact.service') as typeof import('../../contact/contact.service');
  let reject!: (reason: Error) => void;
  mockSigner.nip44Encrypt.mockImplementationOnce(async () => new Promise<string>((_resolve, fail) => { reject = fail; }));
  await setGroupSaved(SELF, 'first-room', true);
  await jest.advanceTimersByTimeAsync(0); await settle();
  await setGroupSaved(SELF, 'second-room', true);
  reject(new Error('signer unavailable'));
  await jest.runAllTimersAsync();
  expect((await pending(30000, CONTACTS_D))?.event.content)
    .toBe('encrypted:[["h","first-room"],["h","second-room"]]');
  expect(sqlite.prepare('SELECT dirty FROM contact_sync_state').get()).toEqual({ dirty: 0 });
});

it('does not discard a newer contact snapshot when an old delivery fails', async () => {
  const { setGroupSaved } = jest.requireActual('../../group/saved-groups.service') as typeof import('../../group/saved-groups.service');
  const { CONTACTS_D } = jest.requireActual('../../contact/contact.service') as typeof import('../../contact/contact.service');
  await setGroupSaved(SELF, 'first-room', true);
  await jest.runAllTimersAsync();
  let resolve!: (value: ReturnType<typeof results>) => void;
  mockPublish.mockReturnValueOnce(new Promise((done) => { resolve = done; }));
  await start();
  const delivering = worker.flush(); await settle();
  await setGroupSaved(SELF, 'second-room', true);
  await jest.runAllTimersAsync();
  const newer = (await pending(30000, CONTACTS_D))!;
  resolve(results(0)); await delivering;
  expect((await pending(30000, CONTACTS_D))?.eventId).toBe(newer.eventId);
  expect(sqlite.prepare('SELECT dirty FROM contact_sync_state').get()).toEqual({ dirty: 0 });
});


function privateList(kind: 'muted' | 'blocked') {
  if (kind === 'muted') {
    const prefs = jest.requireActual('../../conversation/conversation-prefs.service') as typeof import('../../conversation/conversation-prefs.service');
    return {
      dTag: prefs.MUTED_D,
      set: (pubkey: string, enabled: boolean) => prefs.setConversationMuted(SELF, pubkey, enabled),
      apply: (remote: Event) => prefs.applyMutedEvent(SELF, remote, mockSigner),
      members: async () => sqlite.prepare('SELECT conversation_key AS pubkey FROM conversations WHERE account_pubkey = ? AND muted = 1 ORDER BY conversation_key').all(SELF),
    };
  }
  const block = jest.requireActual('../../dm/block.service') as typeof import('../../dm/block.service');
  return {
    dTag: block.BLOCKED_D,
    set: (pubkey: string, enabled: boolean) => enabled ? block.blockUser(SELF, pubkey) : block.unblockUser(SELF, pubkey),
    apply: (remote: Event) => block.applyBlockedEvent(SELF, remote, mockSigner),
    members: async () => (await block.getBlockedPubkeys(SELF)).sort().map((pubkey) => ({ pubkey })),
  };
}

it.each(['muted', 'blocked'] as const)('keeps failed %s plaintext authoritative after restart until the next edit', async (kind) => {
  const list = privateList(kind);
  const peer = 'b'.repeat(64);
  mockSigner.nip44Encrypt.mockRejectedValueOnce(new Error('signer unavailable'));
  await list.set(peer, true);
  expect(await list.members()).toEqual([{ pubkey: peer }]);
  expect(mockSigner.signEvent).not.toHaveBeenCalled();
  if (kind === 'blocked') {
    const block = jest.requireActual('../../dm/block.service') as typeof import('../../dm/block.service');
    expect(block.isBlocked(SELF, peer)).toBe(true);
  }
  await jest.runAllTimersAsync();
  expect(await pending(30000, list.dTag)).toBeNull();
  expect(sqlite.prepare('SELECT dirty FROM private_list_sync_state WHERE d_tag = ?').get(list.dTag)).toEqual({ dirty: 1 });
  jest.resetModules();
  const restored = privateList(kind);
  await restored.apply({ ...event(30000, restored.dTag), content: 'encrypted:[]' });
  expect(await restored.members()).toEqual([{ pubkey: peer }]);
  await restored.set(peer, false);
  await jest.runAllTimersAsync();
  expect(await restored.members()).toEqual([]);
  expect((await pending(30000, restored.dTag))?.event.content).toBe('encrypted:[]');
});

it.each(['muted', 'blocked'] as const)('does not fail the local %s action when signing fails', async (kind) => {
  const list = privateList(kind);
  const peer = 'b'.repeat(64);
  mockSigner.signEvent.mockRejectedValueOnce(new Error('remote signer unavailable'));
  await list.set(peer, true);
  await jest.runAllTimersAsync();
  expect(await list.members()).toEqual([{ pubkey: peer }]);
  expect(await pending(30000, list.dTag)).toBeNull();
  await list.set(peer, false);
  await jest.runAllTimersAsync();
  expect((await pending(30000, list.dTag))?.event.content).toBe('encrypted:[]');
});

it.each(['muted', 'blocked'] as const)('retires failed %s delivery and generates a fresh event on the next edit', async (kind) => {
  const list = privateList(kind);
  const first = 'b'.repeat(64);
  const second = 'c'.repeat(64);
  await list.set(first, true);
  await jest.runAllTimersAsync();
  const old = (await pending(30000, list.dTag))!.event;
  await start(); await worker.flush(); worker.stop();
  expect(await pending(30000, list.dTag)).toBeNull();
  expect(sqlite.prepare('SELECT dirty FROM private_list_sync_state WHERE d_tag = ?').get(list.dTag)).toEqual({ dirty: 1 });
  await list.apply({ ...event(30000, list.dTag, old.created_at + 1), content: 'encrypted:[]' });
  expect(await list.members()).toEqual([{ pubkey: first }]);
  await list.set(second, true);
  await jest.runAllTimersAsync();
  const fresh = (await pending(30000, list.dTag))!.event;
  expect(fresh.id).not.toBe(old.id);
  expect(fresh.content).toBe(`encrypted:${JSON.stringify([['p', first], ['p', second]])}`);
});

it.each(['muted', 'blocked'] as const)('preserves a newer %s snapshot when an old delivery fails', async (kind) => {
  const list = privateList(kind);
  await list.set('b'.repeat(64), true);
  await jest.runAllTimersAsync();
  let resolve!: (value: ReturnType<typeof results>) => void;
  mockPublish.mockReturnValueOnce(new Promise((done) => { resolve = done; }));
  await start();
  const delivering = worker.flush(); await settle();
  await list.set('c'.repeat(64), true);
  await jest.runAllTimersAsync();
  const newer = (await pending(30000, list.dTag))!;
  resolve(results(0)); await delivering;
  expect((await pending(30000, list.dTag))?.eventId).toBe(newer.eventId);
  expect(sqlite.prepare('SELECT dirty FROM private_list_sync_state WHERE d_tag = ?').get(list.dTag)).toEqual({ dirty: 0 });
});


it('does not publish a converted legacy mute snapshot superseded before its background job starts', async () => {
  const { applyMutedEvent, MUTED_D } = jest.requireActual('../../conversation/conversation-prefs.service') as typeof import('../../conversation/conversation-prefs.service');
  const { groupConversationKey } = jest.requireActual('@/lib/nostr/group-messaging') as typeof import('@/lib/nostr/group-messaging');
  const key = groupConversationKey('room');
  sqlite.prepare('INSERT INTO conversations (account_pubkey, conversation_key, group_id) VALUES (?, ?, ?)').run(SELF, key, 'room');
  const old = { ...event(30000, MUTED_D), content: `encrypted:${JSON.stringify([['g', key]])}` };
  await service.enqueueConfigurationEvent(old); sqlite.exec('DELETE FROM configuration_outbox;');
  await applyMutedEvent(SELF, old, mockSigner);
  const newer = { ...event(30000, MUTED_D, 101), content: 'encrypted:[]' };
  await service.enqueueConfigurationEvent(newer); sqlite.exec('DELETE FROM configuration_outbox;');
  await jest.runAllTimersAsync();
  expect(mockSigner.signEvent).not.toHaveBeenCalled();
  expect(await pending(30000, MUTED_D)).toBeNull();
});
