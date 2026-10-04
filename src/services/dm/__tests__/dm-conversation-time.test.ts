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
jest.mock('@/services/files/file-attachment.service', () => ({}));
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

beforeAll(() => {
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
