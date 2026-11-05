import type { DatabaseSync } from 'node:sqlite';

import type { Rumor } from '@/db/schema';

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

jest.mock('@/platform', () => ({
  platform: { notifications: { shouldNotifyNow: () => true } },
}));
jest.mock('@/services/conversation/message-tail-cache', () => ({ mergeStoredMessageIntoTail: jest.fn() }));
jest.mock('@/services/crypto/nip17-gift-wrap', () => ({ KIND_CHAT: 14, KIND_FILE: 15, KIND_REACTION: 7 }));
jest.mock('@/services/account/account.service', () => ({}));
jest.mock('@/services/files/media-index.service', () => ({ recordEmbeddedMedia: jest.fn() }));
jest.mock('@/services/files/file-attachment.service', () => ({ deleteConversationAttachments: jest.fn(async () => {}) }));
jest.mock('@/services/relay/relay-list.service', () => ({}));
jest.mock('@/services/relay/relay-pool', () => ({}));
jest.mock('@/services/self-events/self-event-stream.service', () => ({}));
jest.mock('@/services/dm/encryption-key-watcher', () => ({}));
jest.mock('@/services/dm/encryption-key.service', () => ({}));
jest.mock('@/services/dm/notification-poll', () => ({}));
jest.mock('@/services/dm/messaging-metadata', () => ({}));
jest.mock('@/services/dm/relay-message-outbox', () => ({}));
jest.mock('@/services/dm/observed-peer-key.service', () => ({}));
jest.mock('@/services/dm/peer-encryption-key.service', () => ({}));
jest.mock('@/services/group/group-receive.service', () => ({}));
jest.mock('@/services/group/group.service', () => ({}));

// eslint-disable-next-line @typescript-eslint/no-require-imports -- load after database mock
const { dmService } = require('../dm.service') as typeof import('../dm.service');
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
