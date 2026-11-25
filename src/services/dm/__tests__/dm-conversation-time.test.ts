import type { DatabaseSync } from 'node:sqlite';
import type { Event } from 'nostr-tools';

import type { Rumor } from '@/db/schema';
import { unwrapGiftWrapForAccount } from '@/services/crypto/nip17-gift-wrap';
import { watchReactionPreviewWhileViewing } from '@/services/conversation/reaction-preview.service';
import { takeNotificationEvents } from '@/services/notifications/notification-events.service';

let mockDatabase: { sqlite: DatabaseSync; db: unknown } | undefined;

jest.mock('@/db/client', () => {
  if (mockDatabase) return mockDatabase;
  const { DatabaseSync } = jest.requireActual('node:sqlite');
  const { readFileSync, readdirSync } = jest.requireActual('node:fs');
  const { createAsyncDatabase } = jest.requireActual('@/platform/create-async-database');
  const schema = jest.requireActual('@/db/schema');
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON');
  const files = readdirSync(`${process.cwd()}/src/db/migrations`)
    .filter((name: string) => /^\d{4}_.+\.sql$/.test(name))
    .sort();
  for (const name of files) {
    const source = readFileSync(`${process.cwd()}/src/db/migrations/${name}`, 'utf8');
    for (const statement of source.split('--> statement-breakpoint')) {
      if (statement.trim()) sqlite.exec(statement);
    }
  }
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
  const serialized = <T,>(task: () => Promise<T>): Promise<T> => {
    const result = tail.then(task);
    tail = result.then(() => {}, () => {});
    return result;
  };
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

let mockUserPresent = false;
const mockReturnListeners = new Set<() => void>();
type DatabaseListener = (event: { external: boolean; tableName?: string }) => void;
const mockDatabaseListeners = new Set<DatabaseListener>();
let mockNetworkConnected = false;
const mockAppStateListeners = new Set<(state: string) => void>();
let mockNetworkListener: ((state: { isConnected: boolean }) => void) | undefined;
const mockPublishRelay = jest.fn();
const mockWrapForRelay = jest.fn();
const mockArchiveMessages = new Map<string, string>();
jest.mock('../dm-backup-storage', () => ({
  BACKUP_CACHE_DIRECTORY_NAME: 'archives',
  persistLatestAccountArchive: jest.fn(),
}));
jest.mock('@/platform', () => ({
  platform: {
    database: {
      addChangeListener: (listener: DatabaseListener) => {
        mockDatabaseListeners.add(listener);
        return () => mockDatabaseListeners.delete(listener);
      },
      rawQuery: async (query: string, params: string[]) => mockDatabase!.sqlite.prepare(query).all(...params),
      rawQueryEach: (query: string, params: string[]) => mockDatabase!.sqlite.prepare(query).iterate(...params),
    },
    localization: { preferredLanguageTag: () => 'en' },
    deviceCrypto: { randomUUID: async () => 'test' },
    fileSystem: {
      cacheDirectoryUri: async () => 'file:///cache/',
      makeDirectory: jest.fn(),
      openWriteHandle: async (uri: string) => ({
        writeBytes: async (bytes: Uint8Array) => mockArchiveMessages.set(uri, new TextDecoder().decode(bytes)),
        close: jest.fn(),
      }),
      stat: async () => ({ exists: false }),
      writeText: jest.fn(),
    },
    zipArchive: {
      isAvailable: async () => true,
      addProgressListener: () => ({ remove: jest.fn() }),
      zip: jest.fn(),
    },
    appState: {
      currentState: () => mockUserPresent ? 'active' : 'background',
      addChangeListener: (listener: (state: string) => void) => {
        mockAppStateListeners.add(listener);
        return () => mockAppStateListeners.delete(listener);
      },
    },
    notifications: {
      shouldNotifyNow: () => !mockUserPresent,
      addUserReturnedListener: (listener: () => void) => {
        mockReturnListeners.add(listener);
        return () => mockReturnListeners.delete(listener);
      },
    },
    networkState: {
      getState: async () => ({ isConnected: mockNetworkConnected }),
      addStateListener: (listener: typeof mockNetworkListener) => { mockNetworkListener = listener; },
    },
  },
}));
jest.mock('@/services/conversation/message-tail-cache', () => ({ mergeStoredMessageIntoTail: jest.fn(), emitMessageDeletion: jest.fn(), emitMessageDeadlines: jest.fn() }));
jest.mock('@/services/crypto/nip17-gift-wrap', () => ({
  KIND_CHAT: 14, KIND_FILE: 15, KIND_REACTION: 7, KIND_MESSAGE_DELETION: 5,
  createGiftWrappedMessage: (...args: unknown[]) => mockWrapForRelay(...args),
  unwrapGiftWrapForAccount: jest.fn(),
  buildRumor: (template: Omit<Rumor, 'id' | 'pubkey'>, pubkey: string) => {
    const rumor = { ...template, pubkey };
    return { ...rumor, id: jest.requireActual('nostr-tools').getEventHash(rumor) };
  },
}));
jest.mock('@/services/account/account.service', () => ({}));
jest.mock('@/services/files/media-index.service', () => ({ recordEmbeddedMedia: jest.fn() }));
jest.mock('@/services/files/file-attachment.service', () => ({ deleteConversationAttachments: jest.fn(async () => {}) }));
jest.mock('@/services/relay/relay-list.service', () => ({}));
jest.mock('@/services/relay/relay-pool', () => ({ relayPool: { publishEvent: (...args: unknown[]) => mockPublishRelay(...args) } }));
jest.mock('@/services/self-events/self-event-stream.service', () => ({}));
jest.mock('@/services/dm/encryption-key-watcher', () => ({}));
jest.mock('@/services/dm/encryption-key.service', () => ({}));
jest.mock('@/services/dm/notification-poll', () => ({}));
jest.mock('@/services/dm/messaging-metadata', () => ({}));
jest.mock('@/services/dm/relay-message-outbox', () => ({ relayMessageOutbox: { wake: jest.fn() } }));
jest.mock('@/services/dm/observed-peer-key.service', () => ({ observedPeerKeyService: { rememberVerifiedSealKey: jest.fn() } }));
jest.mock('@/services/dm/peer-encryption-key.service', () => ({}));
jest.mock('@/services/group/group-receive.service', () => ({}));
jest.mock('@/services/group/group.service', () => ({}));
jest.mock('@/services/proximity/proximity.service', () => ({}));

// eslint-disable-next-line @typescript-eslint/no-require-imports -- load after database mock
const { dmService, DmService } = require('../dm.service') as typeof import('../dm.service');
// eslint-disable-next-line @typescript-eslint/no-require-imports -- load after database mock
const { exportAccountArchive } = require('../dm-backup.service') as typeof import('../dm-backup.service');
// eslint-disable-next-line @typescript-eslint/no-require-imports -- Jest runs these modules as CommonJS
const { parseBackupRumor } = require('../dm-backup-format') as typeof import('../dm-backup-format');
type Intake = 'live' | 'recovery' | 'history' | 'archive' | 'local';
const receiver = dmService as unknown as {
  storeRumor(
    rumor: Rumor, account: string, relays: undefined, profile: undefined,
    options: { intake: Intake },
  ): Promise<boolean>;
};
const ACCOUNT = 'a'.repeat(64);
const PEER = 'b'.repeat(64);

function hasEvent(message: Rumor, account = ACCOUNT): boolean {
  return !!mockDatabase!.sqlite.prepare('SELECT id FROM notification_events WHERE account_pubkey = ? AND message_id = ?').get(account, message.id!);
}

beforeAll(() => {
  mockDatabase!.sqlite.exec("INSERT INTO device_preferences (key,value,updated_at) VALUES ('notifications.enabled','1',1)");
  mockDatabase!.sqlite.prepare(
    "INSERT INTO accounts (pubkey, signer_type, added_at, sort_order) VALUES (?, 'nsec', 1, 0)",
  ).run(ACCOUNT);
});
afterAll(() => mockDatabase?.sqlite.close());

it('replaces creation time with the first message time even when the message is older', async () => {
  const peer = 'c'.repeat(64);
  mockDatabase!.sqlite.prepare(`
    INSERT INTO conversations (
      account_pubkey, conversation_key, created_at, created_order_at, updated_at, updated_order_at
    ) VALUES (?, ?, 900, 900789, 900, 900789)
  `).run(ACCOUNT, peer);
  expect(await receiver.storeRumor({
    id: '7'.repeat(64), pubkey: peer, kind: 14, created_at: 100, content: 'first',
    tags: [['p', ACCOUNT], ['ms', '123']],
  } as Rumor, ACCOUNT, undefined, undefined, { intake: 'recovery' })).toBe(true);
  expect(mockDatabase!.sqlite.prepare(`
    SELECT created_at, updated_at, updated_order_at, last_message_id
    FROM conversations WHERE account_pubkey = ? AND conversation_key = ?
  `).get(ACCOUNT, peer)).toEqual({
    created_at: 900, updated_at: 100, updated_order_at: 100123, last_message_id: '7'.repeat(64),
  });
});

it('updates time only with the newest non-reaction message across all intake paths', async () => {
  const receive = (id: string, at: number, intake: Intake, kind = 14) => receiver.storeRumor({
    id: id.repeat(64), pubkey: PEER, kind, created_at: at, content: kind === 7 ? '+' : 'hello',
    tags: [['p', ACCOUNT], ['ms', '123']],
  } as Rumor, ACCOUNT, undefined, undefined, { intake });
  const assertTime = (id: string, at: number) => {
    expect(mockDatabase!.sqlite.prepare(`
      SELECT updated_at, updated_order_at, last_message_id, last_message_at, last_message_order_at
      FROM conversations WHERE account_pubkey = ? AND conversation_key = ?
    `).get(ACCOUNT, PEER)).toEqual({
      updated_at: at, updated_order_at: at * 1000 + 123, last_message_id: id.repeat(64),
      last_message_at: at, last_message_order_at: at * 1000 + 123,
    });
  };
  expect(await receive('1', 100, 'live')).toBe(true);
  assertTime('1', 100);
  expect(await receive('2', 90, 'recovery')).toBe(true);
  assertTime('1', 100);
  expect(await receive('3', 200, 'live', 7)).toBe(true);
  assertTime('1', 100);
  expect(await receive('4', 300, 'history')).toBe(true);
  assertTime('4', 300);
  expect(await receive('5', 400, 'archive')).toBe(true);
  assertTime('5', 400);
  expect(await receive('6', 500, 'local')).toBe(true);
  assertTime('6', 500);
  expect(await receive('6', 500, 'live')).toBe(false);
  assertTime('6', 500);
});

it('marks only the creating receive transaction across batches and receiver restarts', async () => {
  const peer = 'e'.repeat(64);
  const make = (id: string, at: number) => ({
    id: id.repeat(64), pubkey: peer, kind: 14, created_at: at,
    content: 'request', tags: [['p', ACCOUNT]],
  } as Rumor);
  const first = make('a', 100);
  const later = make('b', 101);
  await receiver.storeRumor(first, ACCOUNT, undefined, undefined, { intake: 'recovery' });
  await receiver.storeRumor(later, ACCOUNT, undefined, undefined, { intake: 'recovery' });
  expect(hasEvent(first, ACCOUNT)).toBe(true);
  expect(hasEvent(later, ACCOUNT)).toBe(false);
  expect(hasEvent(first, 'other-account')).toBe(false);
  const replay = make('a', 100);
  expect(await receiver.storeRumor(replay, ACCOUNT, undefined, undefined, { intake: 'live' })).toBe(false);
  expect(hasEvent(replay, ACCOUNT)).toBe(true);
  // A new service instance still sees the existing request in SQLite.
  const restarted = new (dmService.constructor as new () => typeof receiver)();
  const afterRestart = make('c', 102);
  await restarted.storeRumor(afterRestart, ACCOUNT, undefined, undefined, { intake: 'live' });
  expect(hasEvent(afterRestart, ACCOUNT)).toBe(false);
});

it('does not announce history imports or subsequent live messages as new requests', async () => {
  const peer = 'f'.repeat(64);
  for (const [id, intake] of [['d', 'history'], ['e', 'live']] as const) {
    const message = { id: id.repeat(64), pubkey: peer, kind: 14, created_at: 200,
      content: 'history', tags: [['p', ACCOUNT]] } as Rumor;
    await receiver.storeRumor(message, ACCOUNT, undefined, undefined, { intake });
    expect(hasEvent(message, ACCOUNT)).toBe(false);
  }
});

it('does not notify again when a read request gets another unread message', async () => {
  const peer = 'e'.repeat(64);
  mockDatabase!.sqlite.prepare(`UPDATE conversations SET unread_count = 0,
    last_read_order_at = 102000 WHERE account_pubkey = ? AND conversation_key = ?`)
    .run(ACCOUNT, peer);
  const message = { id: 'f'.repeat(64), pubkey: peer, kind: 14, created_at: 103,
    content: 'again', tags: [['p', ACCOUNT]] } as Rumor;
  await receiver.storeRumor(message, ACCOUNT, undefined, undefined, { intake: 'live' });
  expect(hasEvent(message, ACCOUNT)).toBe(false);
});

it.each(['history', 'archive'] as const)('keeps %s inserts in new and existing conversations ineligible for all arrival notifications', async (intake) => {
  const peer = intake === 'history' ? '7'.repeat(64) : '8'.repeat(64);
  for (let index = 0; index < 2; index++) {
    const message = { id: `${intake}-${index}`, pubkey: peer, kind: 14, created_at: 300 + index,
      content: 'historical', tags: [['p', ACCOUNT]] } as Rumor;
    await receiver.storeRumor(message, ACCOUNT, undefined, undefined, { intake });
    expect(hasEvent(message, ACCOUNT)).toBe(false);
  }
});

it('discards an unobserved request on deletion and keeps its archive restoration silent', async () => {
  jest.useFakeTimers();
  try {
    const peer = '9'.repeat(64);
    const now = Math.floor(Date.now() / 1000);
    const first = { id: 'delete-unobserved', pubkey: peer, kind: 14, created_at: now - 1,
      content: 'live', tags: [['p', ACCOUNT]] } as Rumor;
    await receiver.storeRumor(first, ACCOUNT, undefined, undefined, { intake: 'live' });
    expect(hasEvent(first)).toBe(true);
    await dmService.deleteConversation(ACCOUNT, peer);
    expect(hasEvent(first)).toBe(false);
    const historical = { ...first, id: 'archive-after-delete', created_at: now + 1 } as Rumor;
    await receiver.storeRumor(historical, ACCOUNT, undefined, undefined, { intake: 'archive' });
    expect(mockDatabase!.sqlite.prepare('SELECT deleted FROM conversations WHERE account_pubkey = ? AND conversation_key = ?').get(ACCOUNT, peer)).toEqual({ deleted: 0 });
    expect(hasEvent(historical, ACCOUNT)).toBe(false);
    await jest.runOnlyPendingTimersAsync();
  } finally {
    jest.useRealTimers();
  }
});

it.each(['live', 'archive'] as const)('restores a deleted request on %s without another alert', async intake => {
  const peer = `deleted-${intake}`;
  const first = { id: `original-${intake}`, pubkey: peer, kind: 14, created_at: 100,
    content: 'first', tags: [['p', ACCOUNT]] } as Rumor;
  await receiver.storeRumor(first, ACCOUNT, undefined, undefined, { intake: 'live' });
  mockDatabase!.sqlite.prepare('UPDATE conversations SET deleted = 1, has_replied = 0, unread_count = 0, last_read_order_at = 100000, deleted_order_at = 101000 WHERE conversation_key = ?').run(peer);
  mockDatabase!.sqlite.prepare('DELETE FROM notification_events WHERE conversation_key = ?').run(peer);
  const restored = { ...first, id: `restored-${intake}`, created_at: 102 };
  await receiver.storeRumor(restored, ACCOUNT, undefined, undefined, { intake });
  expect(mockDatabase!.sqlite.prepare('SELECT deleted, has_replied, unread_count FROM conversations WHERE conversation_key = ?').get(peer))
    .toEqual({ deleted: 0, has_replied: 0, unread_count: 1 });
  expect(hasEvent(restored)).toBe(false);
});

const TIMED_PEER = '2'.repeat(64);

function timedMessage(id: string, account = ACCOUNT): Rumor {
  return {
    id: id.padStart(64, '0'), pubkey: TIMED_PEER, kind: 14, created_at: Math.floor(Date.now() / 1000),
    content: 'private expiring text', tags: [['p', account], ['disappear-after', '30']],
  };
}

function messageRow(id: string, account = ACCOUNT) {
  return mockDatabase!.sqlite.prepare(
    'SELECT deleted, content, tags, expires_at, rumor FROM messages WHERE account_pubkey = ? AND id = ?',
  ).get(account, id);
}

it('starts only on foreground visibility, keeps the deadline across service restarts and clears while offline', async () => {
  const message = timedMessage('3');
  const now = Date.now();
  const clock = jest.spyOn(Date, 'now').mockReturnValue(now);
  try {
    await receiver.storeRumor(message, ACCOUNT, undefined, undefined, { intake: 'live' });
    expect(hasEvent(message)).toBe(true);
    expect(messageRow(message.id)).toMatchObject({ expires_at: null, content: message.content });
    expect(mockDatabase!.sqlite.prepare('SELECT 1 FROM message_fts WHERE id = ?').get(message.id)).toBeUndefined();
    await dmService.markDisappearingMessagesSeen(ACCOUNT, TIMED_PEER, [message.id]);
    expect(messageRow(message.id)).toMatchObject({ expires_at: null });

    mockUserPresent = true;
    await dmService.markDisappearingMessagesSeen(ACCOUNT, TIMED_PEER, [message.id]);
    expect(messageRow(message.id)).toMatchObject({ expires_at: now + 30_000 });

    const reopened = new DmService();
    clock.mockReturnValue(now + 10_000);
    await reopened.markDisappearingMessagesSeen(ACCOUNT, TIMED_PEER, [message.id]);
    expect(await reopened.expireDisappearingMessages(ACCOUNT)).toBe(now + 30_000);

    mockUserPresent = false;
    clock.mockReturnValue(now + 30_001);
    await reopened.expireDisappearingMessages(ACCOUNT);
    expect(messageRow(message.id)).toMatchObject({ deleted: 1, content: '', tags: '[]', expires_at: null });
    expect(JSON.parse(messageRow(message.id)?.rumor as string)).toMatchObject({ content: '', tags: [] });
    expect(hasEvent(message)).toBe(false);
    expect(mockDatabase!.sqlite.prepare(`
      SELECT last_message_id, unread_count FROM conversations WHERE account_pubkey = ? AND conversation_key = ?
    `).get(ACCOUNT, TIMED_PEER)).toEqual({ last_message_id: null, unread_count: 0 });
    const queued = mockDatabase!.sqlite.prepare(`
      SELECT d.rumor FROM message_deletions d JOIN relay_outbox_jobs j
      ON j.message_id = d.id AND j.account_pubkey = d.account_pubkey
      WHERE d.account_pubkey = ? AND d.rumor LIKE ?
    `);
    const jobs = () => queued.all(ACCOUNT, `%${message.id}%`);
    expect(jobs()).toHaveLength(1);
    const deletion = JSON.parse(jobs()[0].rumor as string) as Rumor;
    expect(deletion).toMatchObject({ kind: 5, pubkey: ACCOUNT, content: '' });
    expect(deletion.tags).not.toContainEqual(['disappearing']);
    expect(deletion.tags.filter(([tag]) => tag === 'p')).toEqual([['p', ACCOUNT]]);
    await reopened.expireDisappearingMessages(ACCOUNT);
    expect(jobs()).toHaveLength(1);
    expect(await receiver.storeRumor(message, ACCOUNT, undefined, undefined, { intake: 'history' })).toBe(false);
    expect(messageRow(message.id)).toMatchObject({ deleted: 1, content: '' });
  } finally {
    mockUserPresent = false;
    clock.mockRestore();
  }
});

it('starts outgoing deadlines at creation and never persists body on late self-history intake', async () => {
  const message = { ...timedMessage('4'), pubkey: ACCOUNT, tags: [['p', TIMED_PEER], ['disappear-after', '30']] };
  const fromHistory = { ...message, id: '5'.padStart(64, '0'), created_at: message.created_at - 60 };
  await receiver.storeRumor(message, ACCOUNT, undefined, undefined, { intake: 'local' });
  expect(messageRow(message.id)).toMatchObject({ expires_at: message.created_at * 1000 + 30_000 });
  expect(await receiver.storeRumor(fromHistory, ACCOUNT, undefined, undefined, { intake: 'history' })).toBe('hidden');
  expect(messageRow(fromHistory.id)).toMatchObject({ deleted: 1, content: '' });
});

it.each([false, true])('restores a self deletion before its original (legacy tag: %s)', async (legacy) => {
  const message = timedMessage(legacy ? '16' : '6');
  const deletion: Rumor = {
    id: (legacy ? '17' : '7').padStart(64, '0'),
    pubkey: ACCOUNT, kind: 5, content: '', created_at: message.created_at,
    tags: [['p', ACCOUNT], ['e', message.id], ['k', '14']],
  };
  if (legacy) deletion.tags.push(['disappearing']);
  const sync = new DmService();
  expect(await sync.importRumors(ACCOUNT, [deletion, deletion])).toEqual({ inserted: 1, existing: 1, invalid: 0 });
  expect(messageRow(message.id)).toBeUndefined();
  expect(await receiver.storeRumor(message, ACCOUNT, undefined, undefined, { intake: 'history' })).toBe('hidden');
  expect(messageRow(message.id)).toMatchObject({ deleted: 1, content: '', tags: '[]' });
  expect(hasEvent(message)).toBe(false);
  expect(await sync.importRumors(ACCOUNT, [deletion])).toEqual({ inserted: 0, existing: 1, invalid: 0 });
});

it('exports a restorable self deletion when the original timed text was deleted by its author', async () => {
  const account = 'f'.repeat(64);
  const message = timedMessage('b', account);
  const sqlite = mockDatabase!.sqlite;
  sqlite.prepare("INSERT INTO accounts (pubkey, signer_type, added_at, sort_order) VALUES (?, 'nsec', 1, 0)").run(account);
  const remoteDelete: Rumor = {
    id: 'c'.padStart(64, '0'), pubkey: TIMED_PEER, kind: 5, content: '', created_at: message.created_at,
    tags: [['e', message.id], ['k', '14'], ['p', account]],
  };
  await receiver.storeRumor(message, account, undefined, undefined, { intake: 'live' });
  expect(await dmService.importRumors(account, [remoteDelete])).toEqual({ inserted: 1, existing: 0, invalid: 0 });
  expect(messageRow(message.id, account)).toMatchObject({ deleted: 1, content: '' });

  mockArchiveMessages.clear();
  expect(await exportAccountArchive(account, { includeAttachments: false })).toMatchObject({ messages: 1 });
  const [file] = mockArchiveMessages.values();
  const marker = parseBackupRumor(JSON.parse(file))!;
  expect(marker).toMatchObject({ kind: 5, pubkey: account, content: '' });
  expect(marker.tags.filter(([tag]) => tag !== 'ms')).toEqual([
    ['e', message.id], ['k', '14'], ['p', account],
  ]);

  sqlite.prepare('DELETE FROM messages WHERE account_pubkey = ? AND id = ?').run(account, message.id);
  sqlite.prepare('DELETE FROM message_deletions WHERE account_pubkey = ?').run(account);
  expect(await dmService.importRumors(account, [marker])).toEqual({ inserted: 1, existing: 0, invalid: 0 });

  mockArchiveMessages.clear();
  expect(await exportAccountArchive(account, { includeAttachments: false })).toMatchObject({ messages: 1 });
  expect(JSON.parse([...mockArchiveMessages.values()][0])).toEqual(marker);

  expect(await receiver.storeRumor(message, account, undefined, undefined, { intake: 'history' })).toBe('hidden');
  expect(messageRow(message.id, account)).toMatchObject({ deleted: 1, content: '' });
});

it.each([true, false])('uses the same account-only deletion format for timed and ordinary messages (timed: %s)', async (timed) => {
  const message = timedMessage(timed ? '18' : '19');
  if (!timed) message.tags = [['p', ACCOUNT]];
  await receiver.storeRumor(message, ACCOUNT, undefined, undefined, { intake: 'live' });
  await dmService.deleteMessage(ACCOUNT, message.id, false);

  const sqlite = mockDatabase!.sqlite;
  const deletions = sqlite.prepare(`
    SELECT d.rumor FROM message_deletions d JOIN relay_outbox_jobs j
      ON j.message_id = d.id AND j.account_pubkey = d.account_pubkey
    WHERE d.account_pubkey = ? AND d.rumor LIKE ?
  `).all(ACCOUNT, `%${message.id}%`);
  expect(deletions).toHaveLength(1);
  const deletion = JSON.parse(deletions[0].rumor as string) as Rumor;
  expect(deletion.tags.filter(([tag]) => tag !== 'ms')).toEqual([
    ['e', message.id], ['k', '14'], ['p', ACCOUNT],
  ]);
  expect(messageRow(message.id)).toMatchObject({ deleted: 1, content: timed ? '' : message.content });
});

it('snapshots the current chat timer only into newly authored text', async () => {
  const peer = 'd'.repeat(64);
  const sqlite = mockDatabase!.sqlite;
  const send = (content: string) => dmService.sendMessage({ accountPubkey: ACCOUNT, recipientPubkeys: [peer], content });
  const ordinary = await send('ordinary');
  sqlite.prepare('UPDATE conversations SET disappear_after_seconds = 300 WHERE account_pubkey = ? AND conversation_key = ?')
    .run(ACCOUNT, peer);
  const expiring = await send('timed');
  sqlite.prepare('UPDATE conversations SET disappear_after_seconds = NULL WHERE account_pubkey = ? AND conversation_key = ?')
    .run(ACCOUNT, peer);
  const afterDisabled = await send('ordinary again');

  expect(messageRow(ordinary.rumorId)).toMatchObject({ expires_at: null });
  expect(JSON.parse(messageRow(expiring.rumorId)?.tags as string)).toContainEqual(['disappear-after', '300']);
  expect(messageRow(expiring.rumorId)?.expires_at).toBeGreaterThan(Date.now());
  expect(messageRow(afterDisabled.rumorId)).toMatchObject({ expires_at: null });
});

it('sweeps on foreground entry when suspended past the persisted deadline', async () => {
  const account = 'e'.repeat(64);
  const sqlite = mockDatabase!.sqlite;
  sqlite.prepare("INSERT INTO accounts (pubkey, signer_type, added_at, sort_order) VALUES (?, 'nsec', 1, 0)").run(account);
  const message = timedMessage('a', account);
  await receiver.storeRumor(message, account, undefined, undefined, { intake: 'live' });
  const now = Date.now();
  sqlite.prepare('UPDATE messages SET expires_at = ? WHERE account_pubkey = ? AND id = ?').run(now + 1000, account, message.id);
  const runtime = new DmService();
  jest.useFakeTimers({ now });
  const stop = runtime.watchDisappearingMessages(account);
  try {
    await jest.advanceTimersByTimeAsync(0);
    expect(messageRow(message.id, account)).toMatchObject({ deleted: 0, content: message.content });
    jest.setSystemTime(now + 5000);
    mockUserPresent = true;
    for (const listener of mockAppStateListeners) listener('active');
    await jest.advanceTimersByTimeAsync(0);
    expect(messageRow(message.id, account)).toMatchObject({ deleted: 1, content: '' });
  } finally {
    stop();
    mockUserPresent = false;
    jest.useRealTimers();
  }
});

it('keeps the original and deletion atomic if a cleanup write fails', async () => {
  const message = timedMessage('8');
  const sqlite = mockDatabase!.sqlite;
  await receiver.storeRumor(message, ACCOUNT, undefined, undefined, { intake: 'live' });
  sqlite.prepare('UPDATE messages SET expires_at = 1 WHERE account_pubkey = ? AND id = ?').run(ACCOUNT, message.id);
  sqlite.exec(`CREATE TEMP TRIGGER fail_disappearing_cleanup AFTER UPDATE OF deleted ON messages
    BEGIN SELECT raise(ABORT, 'simulated cleanup failure'); END`);
  try {
    await expect(dmService.expireDisappearingMessages(ACCOUNT)).rejects.toThrow();
    expect(messageRow(message.id)).toMatchObject({ deleted: 0, content: message.content });
    expect(sqlite.prepare('SELECT id FROM message_deletions WHERE rumor LIKE ?').get(`%${message.id}%`)).toBeUndefined();
  } finally {
    sqlite.exec('DROP TRIGGER fail_disappearing_cleanup');
  }
  await dmService.expireDisappearingMessages(ACCOUNT);
  expect(messageRow(message.id)).toMatchObject({ deleted: 1, content: '' });
});

it('publishes queued expiry after network recovery and retries an unacknowledged relay', async () => {
  const { relayMessageOutbox } = jest.requireActual('../relay-message-outbox') as typeof import('../relay-message-outbox');
  const account = 'c'.repeat(64);
  const sqlite = mockDatabase!.sqlite;
  sqlite.prepare("INSERT INTO accounts (pubkey, signer_type, added_at, sort_order) VALUES (?, 'nsec', 1, 0)").run(account);
  const message = timedMessage('9', account);
  await receiver.storeRumor(message, account, undefined, undefined, { intake: 'live' });
  sqlite.prepare('UPDATE messages SET expires_at = 1 WHERE account_pubkey = ? AND id = ?').run(account, message.id);
  const jobs = () => sqlite.prepare('SELECT id FROM relay_outbox_jobs WHERE account_pubkey = ?').all(account);
  const now = Date.now();
  jest.useFakeTimers({ now });
  try {
    await dmService.expireDisappearingMessages(account);
    const deletionJob = jobs();
    expect(deletionJob).toHaveLength(1);
    mockWrapForRelay.mockResolvedValue({ giftWrap: { id: 'wrapped' } });
    mockPublishRelay
      .mockImplementationOnce(async ({ onRelay, relays }) => onRelay(relays[0], { ok: false, reason: 'connection interrupted' }))
      .mockImplementationOnce(async ({ onRelay, relays }) => onRelay(relays[0], { ok: true }));

    relayMessageOutbox.activate({
      accountPubkey: account,
      dmRelays: ['wss://self.example/'],
      encryptionKeypair: { pubkey: account, key: { account, role: 'messaging' }, createdAt: 1 },
      signSeal: jest.fn(),
    });
    await relayMessageOutbox.waitForIdle();
    expect(mockPublishRelay).not.toHaveBeenCalled();
    expect(jobs()).toEqual(deletionJob);

    mockUserPresent = true;
    mockNetworkConnected = true;
    mockNetworkListener?.({ isConnected: true });
    await jest.advanceTimersByTimeAsync(1);
    await relayMessageOutbox.waitForIdle();
    expect(mockPublishRelay).toHaveBeenCalledTimes(1);
    expect(jobs()).toEqual(deletionJob);
    expect(mockWrapForRelay).toHaveBeenCalledWith(expect.objectContaining({
      recipientIdentityPubkey: account,
      rumorTemplate: expect.objectContaining({
        kind: 5,
        content: '',
        tags: expect.not.arrayContaining([['disappearing']]),
      }),
    }));

    await jest.advanceTimersByTimeAsync(60_000);
    await relayMessageOutbox.waitForIdle();
    expect(mockPublishRelay).toHaveBeenCalledTimes(2);
    expect(jobs()).toEqual([]);
  } finally {
    relayMessageOutbox.deactivate();
    mockUserPresent = false;
    mockNetworkConnected = false;
    jest.useRealTimers();
  }
});


it('keeps targets hidden when their history deletions are processed first', async () => {
  const historyPeer = 'cd'.repeat(32);
  const history = new DmService() as unknown as {
    accountPubkey: string;
    encryptionKeypair: object;
    persistHistoryPage(page: Event[], epoch: number): Promise<void>;
  };
  history.accountPubkey = ACCOUNT;
  history.encryptionKeypair = {};
  const message = (id: string): Rumor => ({
    id: id.repeat(32), kind: 14, pubkey: ACCOUNT, created_at: 100, content: 'Original',
    tags: [['p', historyPeer]],
  });
  const deletion = (id: string, target: string): Rumor => ({
    id: id.repeat(32), kind: 5, pubkey: ACCOUNT, created_at: 101, content: '',
    tags: [['p', ACCOUNT], ['e', target], ['k', '14']],
  });
  const first = message('c1');
  const later = message('c2');
  const visible = message('c3');
  const reaction: Rumor = {
    id: 'c4'.repeat(32), kind: 7, pubkey: historyPeer, created_at: 102, content: '👍',
    tags: [['p', ACCOUNT], ['e', visible.id]],
  };
  const rumors = [first, later, visible, reaction, deletion('c5', first.id), deletion('c6', later.id)];
  const lookup = new Map(rumors.map(rumor => [`history-${rumor.id}`, rumor]));
  let releaseDecode!: () => void;
  const blockedDecode = new Promise<void>(resolve => { releaseDecode = resolve; });
  let startDecode!: () => void;
  const decodeStarted = new Promise<void>(resolve => { startDecode = resolve; });
  const unwrap = jest.mocked(unwrapGiftWrapForAccount).mockImplementation(async wrap => {
    if (wrap.id === 'unverified-tail') {
      startDecode();
      await blockedDecode;
      return { status: 'unsupported', reason: 'missing-encryption-key-tag' };
    }
    return {
      status: 'decrypted',
      value: { giftWrap: wrap, seal: wrap, rumor: lookup.get(wrap.id)!, senderEncryptionPubkey: historyPeer },
    };
  });
  const page = (...items: Rumor[]): Event[] => items.map((rumor, index) => ({
    id: `history-${rumor.id}`, kind: 1059, pubkey: historyPeer, created_at: 200 - index,
    content: '', sig: '', tags: [['p', ACCOUNT]],
  }));
  const sqlite = mockDatabase!.sqlite;
  // Detect a transient visible insert, even if a later write eventually hides it.
  sqlite.exec(`
    CREATE TEMP TRIGGER require_history_target_hidden BEFORE INSERT ON messages
    WHEN new.id IN ('${first.id}', '${later.id}') AND new.deleted = 0
      AND NOT EXISTS (SELECT 1 FROM messages WHERE account_pubkey = new.account_pubkey AND id = new.id)
    BEGIN SELECT raise(ABORT, 'history target became visible'); END
  `);
  const firstPage = page(rumors[4], rumors[5], reaction, visible);
  const relayA = history.persistHistoryPage([
    ...firstPage, { ...firstPage[0], id: 'unverified-tail' },
  ], 0);
  try {
    await decodeStarted;
    // Relay B finishes its page while Relay A is still verifying its tail.
    await history.persistHistoryPage(page(first), 0);
    expect(messageRow(first.id)?.deleted).toBe(1);
    releaseDecode();
    await relayA;
    expect(messageRow(later.id)).toBeUndefined();
    expect(sqlite.prepare('SELECT reply_to_id FROM messages WHERE account_pubkey = ? AND id = ?')
      .get(ACCOUNT, reaction.id)).toEqual({ reply_to_id: visible.id });
    expect(hasEvent(reaction)).toBe(false);
    expect(sqlite.prepare(`
      SELECT last_message_id, reaction_preview_pending FROM conversations
      WHERE account_pubkey = ? AND conversation_key = ?
    `).get(ACCOUNT, historyPeer)).toEqual({
      last_message_id: visible.id, reaction_preview_pending: 0,
    });
    await history.persistHistoryPage(page(later), 0);
    expect(messageRow(later.id)?.deleted).toBe(1);
  } finally {
    releaseDecode();
    await relayA.catch(() => {});
    sqlite.exec('DROP TRIGGER require_history_target_hidden');
    unwrap.mockReset();
  }
});

it('rechecks cancellation when a queued Relay deletion or message receives the writer lock', async () => {
  const history = new DmService() as unknown as {
    applyMessageDeletion(account: string, rumor: Rumor, keepPending: boolean, isCurrent: () => boolean): Promise<boolean | null>;
    storeRumor(
      rumor: Rumor, account: string, sourceRelays: undefined, profile: undefined,
      options: { intake: 'history'; isCurrent: () => boolean },
    ): Promise<boolean>;
  };
  const target: Rumor = { id: 'd7'.repeat(32), kind: 14, pubkey: ACCOUNT, created_at: 1,
    tags: [['p', PEER]], content: 'Stale history' };
  const deletion: Rumor = { id: 'd8'.repeat(32), kind: 5, pubkey: ACCOUNT, created_at: 2,
    tags: [['p', ACCOUNT], ['e', target.id], ['k', '14']], content: '' };
  let current = true;
  const isCurrent = () => current;
  const deleted = history.applyMessageDeletion(ACCOUNT, deletion, true, isCurrent);
  const stored = history.storeRumor(target, ACCOUNT, undefined, undefined, { intake: 'history', isCurrent });
  current = false;
  await expect(deleted).resolves.toBeNull();
  await expect(stored).resolves.toBe(false);
  expect(messageRow(target.id)).toBeUndefined();
  expect(mockDatabase!.sqlite.prepare('SELECT id FROM message_deletions WHERE account_pubkey = ? AND id = ?')
    .get(ACCOUNT, deletion.id)).toBeUndefined();
});

const REACTION_PEER = '2'.repeat(64);
const REACTION_TARGET = 'f1'.repeat(32);

function directReaction(id: string, at: number, overrides: Partial<Rumor> = {}): Rumor {
  return {
    id: id.repeat(32), pubkey: REACTION_PEER, kind: 7, created_at: at,
    content: '👍', tags: [['p', ACCOUNT], ['e', REACTION_TARGET], ['ms', '123']],
    ...overrides,
  };
}

function readReactionPreview(account = ACCOUNT) {
  return mockDatabase!.sqlite.prepare(`
    SELECT reaction_preview_event_id, reaction_preview_order_at, reaction_preview_pending
    FROM conversations WHERE account_pubkey = ? AND conversation_key = ?
  `).get(account, REACTION_PEER);
}

function receiveReaction(rumor: Rumor, intake: Intake = 'live') {
  return receiver.storeRumor(rumor, ACCOUNT, undefined, undefined, { intake });
}

describe('direct reaction previews', () => {
  beforeEach(async () => {
    const sqlite = mockDatabase!.sqlite;
    sqlite.prepare('DELETE FROM notification_events WHERE account_pubkey = ? AND conversation_key = ?').run(ACCOUNT, REACTION_PEER);
    sqlite.prepare('DELETE FROM messages WHERE account_pubkey = ? AND conversation_key = ?').run(ACCOUNT, REACTION_PEER);
    sqlite.prepare('DELETE FROM conversations WHERE account_pubkey = ? AND conversation_key = ?').run(ACCOUNT, REACTION_PEER);
    await receiveReaction({
      id: REACTION_TARGET, pubkey: ACCOUNT, kind: 14, created_at: 400,
      content: 'Private target text', tags: [['p', REACTION_PEER]],
    }, 'local');
  });

  it('updates an independent preview cursor for valid reactions to an own message, including recovery', async () => {
    await dmService.markConversationAsUnread(ACCOUNT, REACTION_PEER);
    const ordinaryState = () => mockDatabase!.sqlite.prepare(`
      SELECT unread_count, last_read_order_at, last_message_id, last_message_at, updated_order_at
      FROM conversations WHERE account_pubkey = ? AND conversation_key = ?
    `).get(ACCOUNT, REACTION_PEER);
    const before = ordinaryState();
    for (const [reaction, intake] of [
      [directReaction('f2', 599), 'history'],
      [directReaction('f3', 598), 'archive'],
      [directReaction('f4', 597, { pubkey: ACCOUNT, tags: [['p', REACTION_PEER], ['e', REACTION_TARGET]] }), 'live'],
      [directReaction('f5', 596, { content: 'arbitrary text 👍' }), 'live'],
      [directReaction('f6', 595, { pubkey: PEER }), 'live'],
    ] as const) {
      await receiveReaction(reaction, intake);
      expect(hasEvent(reaction)).toBe(false);
    }
    expect(readReactionPreview()?.reaction_preview_pending).toBe(0);
    const first = directReaction('ed', 500);
    const sameTime = directReaction('dc', 500, { content: '👎' });
    await receiveReaction(first, 'recovery');
    await receiveReaction(sameTime);
    expect(readReactionPreview()).toEqual({
      reaction_preview_event_id: sameTime.id, reaction_preview_order_at: 500123,
      reaction_preview_pending: 1,
    });
    expect(ordinaryState()).toEqual(before);
    const system = await takeNotificationEvents(ACCOUNT, 'system');
    expect(system.events.filter(row => row.event.kind === 'reaction').map(row => row.message.id))
      .toEqual([first.id, sameTime.id]);
  });

  it('clears on window activation, keeps the cursor across reopen, and suppresses active receipts', async () => {
    await receiveReaction(directReaction('ea', 500));
    const prior = readReactionPreview();
    const stop = watchReactionPreviewWhileViewing(ACCOUNT, REACTION_PEER);
    try {
      // An unfocused detail is still routed but the user has not seen it.
      expect(readReactionPreview()).toEqual(prior);
      mockUserPresent = true;
      for (const returned of mockReturnListeners) returned();
      // Queue a real write through the same executor to wait for the clear.
      await dmService.markConversationAsUnread(ACCOUNT, REACTION_PEER);
      expect(readReactionPreview()).toEqual({ ...prior, reaction_preview_pending: 0 });
      const active = directReaction('c9', 600);
      await receiveReaction(active);
      expect(hasEvent(active)).toBe(false);
      expect(readReactionPreview()).toEqual({
        reaction_preview_event_id: active.id, reaction_preview_order_at: 600123,
        reaction_preview_pending: 0,
      });
    } finally {
      stop();
      mockUserPresent = false;
    }
    const restarted = new DmService() as unknown as typeof receiver;
    expect(await restarted.storeRumor(directReaction('ca', 600), ACCOUNT, undefined, undefined, { intake: 'recovery' })).toBe(true);
    expect(await restarted.storeRumor(directReaction('c9', 600), ACCOUNT, undefined, undefined, { intake: 'recovery' })).toBe(false);
    expect(readReactionPreview()?.reaction_preview_pending).toBe(0);
  });

  it('suppresses a preview during concurrent open and removes it if the target is deleted', async () => {
    mockUserPresent = true;
    let stop: (() => void) | undefined;
    try {
      const receive = receiveReaction(directReaction('ab', 701));
      stop = watchReactionPreviewWhileViewing(ACCOUNT, REACTION_PEER);
      await receive;
      expect(readReactionPreview()?.reaction_preview_pending).toBe(0);
      // Simulate a stale presence snapshot in an independent intake runtime.
      mockDatabase!.sqlite.prepare(`
        UPDATE conversations SET reaction_preview_pending = 1
        WHERE account_pubkey = ? AND conversation_key = ?
      `).run(ACCOUNT, REACTION_PEER);
      for (const change of mockDatabaseListeners) change({ external: true, tableName: 'conversations' });
      await dmService.markConversationAsUnread(ACCOUNT, REACTION_PEER);
      expect(readReactionPreview()?.reaction_preview_pending).toBe(0);
      stop();
      stop = undefined;

      const pending = directReaction('ac', 702);
      await receiveReaction(pending);
      expect(readReactionPreview()?.reaction_preview_pending).toBe(1);
      expect(hasEvent(pending)).toBe(true);
      await dmService.deleteMessage(ACCOUNT, REACTION_TARGET, false);
      expect(readReactionPreview()).toEqual({
        reaction_preview_event_id: pending.id, reaction_preview_order_at: 702123,
        reaction_preview_pending: 0,
      });
      await receiveReaction(directReaction('ad', 703));
      expect(readReactionPreview()?.reaction_preview_event_id).toBe(pending.id);
      const claimed = await takeNotificationEvents(ACCOUNT, 'foreground');
      expect(claimed.events.map(row => row.message.id)).not.toContain(pending.id);
    } finally {
      stop?.();
      mockUserPresent = false;
    }
  });

  it('keeps an arrival when the routed chat is closed before a queued clear can run', async () => {
    mockUserPresent = true;
    try {
      const reaction = directReaction('ad', 702);
      const receive = receiveReaction(reaction);
      const stop = watchReactionPreviewWhileViewing(ACCOUNT, REACTION_PEER);
      stop();
      await receive;
      await dmService.markConversationAsUnread(ACCOUNT, REACTION_PEER);
      expect(readReactionPreview()?.reaction_preview_pending).toBe(1);
      expect(hasEvent(reaction)).toBe(true);
    } finally {
      mockUserPresent = false;
    }
  });

  it('does not show or notify on an already expired target', async () => {
    mockDatabase!.sqlite.prepare(`
      UPDATE messages SET disappear_after_seconds = 30, expires_at = ?
      WHERE account_pubkey = ? AND id = ?
    `).run(Date.now() - 1, ACCOUNT, REACTION_TARGET);
    const expired = directReaction('ae', 500);
    await receiveReaction(expired);
    expect(readReactionPreview()?.reaction_preview_event_id).toBeNull();
    expect(hasEvent(expired)).toBe(false);
  });

  it('keeps the preview for a muted conversation without queuing a notification', async () => {
    mockDatabase!.sqlite.prepare('UPDATE conversations SET muted = 1 WHERE account_pubkey = ? AND conversation_key = ?')
      .run(ACCOUNT, REACTION_PEER);
    const muted = directReaction('af', 500);
    await receiveReaction(muted);
    expect(readReactionPreview()?.reaction_preview_event_id).toBe(muted.id);
    expect(hasEvent(muted)).toBe(false);
  });
});
