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

jest.mock('@/services/conversation/message-tail-cache', () => ({
  mergeStoredMessageIntoTail: jest.fn(),
}));
jest.mock('@/services/files/pending-attachment-file.service', () => ({
  deletePendingAttachmentFile: jest.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports -- load after database mock
const { groupReceiveService } = require('../group-receive.service') as typeof import('../group-receive.service');
// eslint-disable-next-line @typescript-eslint/no-require-imports -- load after database mock
const { groupService } = require('../group.service') as typeof import('../group.service');

const ACCOUNT = 'a'.repeat(64);
const BOB = 'b'.repeat(64);
const CAROL = 'c'.repeat(64);
const DAVE = 'd'.repeat(64);

function rumor(
  idChar: string,
  author: string,
  createdAt: number,
  tags: string[][],
  content = '',
): Rumor {
  return {
    id: idChar.repeat(64),
    pubkey: author,
    kind: 14,
    created_at: createdAt,
    tags,
    content,
  } as Rumor;
}

beforeAll(() => {
  mockDatabase!.sqlite.prepare(
    "INSERT INTO accounts (pubkey, signer_type, added_at, sort_order) VALUES (?, 'nsec', 1, 0)",
  ).run(ACCOUNT);
});

afterAll(() => mockDatabase?.sqlite.close());

it('uses creation time for a new group and preserves it during local metadata edits', async () => {
  const clock = jest.spyOn(Date, 'now').mockReturnValue(900123);
  try {
    const group = await groupService.createLocalGroup(ACCOUNT, [BOB, CAROL]);
    clock.mockReturnValue(901000);
    await groupService.renameLocalGroup(ACCOUNT, group.conversationKey, 'renamed');
    await groupService.updateLocalRoster(ACCOUNT, group.conversationKey, [ACCOUNT, BOB, CAROL, DAVE]);
    expect(mockDatabase!.sqlite.prepare(`
      SELECT created_at, created_order_at, updated_at, updated_order_at, last_message_id
      FROM conversations WHERE account_pubkey = ? AND conversation_key = ?
    `).get(ACCOUNT, group.conversationKey)).toEqual({
      created_at: 900, created_order_at: 900123,
      updated_at: 900, updated_order_at: 900123, last_message_id: null,
    });
  } finally {
    clock.mockRestore();
  }
});

it('keeps updated timestamps tied to the last-message id across receive paths', async () => {
  const h = 'updated-time-test';
  const receive = async (message: Rumor, intake: 'live' | 'recovery' | 'history' | 'archive') => {
    const result = await groupReceiveService.receive({
      accountPubkey: ACCOUNT, rumor: { ...message, id: message.id!.slice(0, 63) + '9' }, intake, active: false,
      senderBlocked: false, syncCursor: null,
    });
    expect(result.stored).toBe(true);
  };
  const assertTime = (id: string, at: number) => {
    const row = mockDatabase!.sqlite.prepare(`
      SELECT updated_at, updated_order_at, last_message_id, last_message_at, last_message_order_at
      FROM conversations WHERE account_pubkey = ? AND group_id = ?
    `).get(ACCOUNT, h);
    expect(row).toEqual({
      updated_at: at, updated_order_at: at * 1000, last_message_id: id.repeat(63) + '9',
      last_message_at: at, last_message_order_at: at * 1000,
    });
  };
  await receive(rumor('1', BOB, 100, [['p', ACCOUNT], ['h', h], ['action', 'create']], 'first'), 'live');
  assertTime('1', 100);
  await receive(rumor('2', BOB, 90, [['p', ACCOUNT], ['h', h]], 'late older'), 'recovery');
  assertTime('1', 100);
  await receive({ ...rumor('3', BOB, 200, [['p', ACCOUNT], ['h', h], ['e', '1'.repeat(63) + '9']], '+'), kind: 7 }, 'live');
  assertTime('1', 100);
  await receive(rumor('4', BOB, 300, [['p', ACCOUNT], ['h', h]], 'history newest'), 'history');
  assertTime('4', 300);
  await receive(rumor('5', BOB, 400, [['p', ACCOUNT], ['h', h]], 'archive newest'), 'archive');
  assertTime('5', 400);
});

it('keeps a stranger-created group in requests until local activity accepts it', async () => {
  const h = 'stranger-request-test';
  await expect(groupReceiveService.receive({
    accountPubkey: ACCOUNT,
    rumor: rumor('f', BOB, 5, [
      ['p', ACCOUNT],
      ['h', h],
      ['action', 'create'],
    ], 'hello'),
    intake: 'live',
    active: false,
    senderBlocked: false,
    syncCursor: null,
  })).resolves.toMatchObject({ stored: true });

  await groupReceiveService.receive({
    accountPubkey: ACCOUNT,
    rumor: rumor('e', BOB, 6, [['p', ACCOUNT], ['h', h]], 'follow-up'),
    intake: 'live',
    active: false,
    senderBlocked: false,
    syncCursor: null,
  });

  const row = mockDatabase!.sqlite.prepare(
    'SELECT has_replied FROM conversations WHERE group_id = ?',
  ).get(h) as { has_replied: number };
  expect(row.has_replied).toBe(0);
});

it('accepts a saved group and restores it to the main conversation list', async () => {
  const h = 'saved-group-request-test';
  mockDatabase!.sqlite.prepare(
    'INSERT INTO saved_groups (account_pubkey, group_id) VALUES (?, ?)',
  ).run(ACCOUNT, h);
  await groupReceiveService.receive({
    accountPubkey: ACCOUNT,
    rumor: rumor('a', BOB, 7, [
      ['p', ACCOUNT],
      ['h', h],
      ['action', 'create'],
    ], 'hello'),
    intake: 'live',
    active: false,
    senderBlocked: false,
    syncCursor: null,
  });
  mockDatabase!.sqlite.prepare(`
    UPDATE conversations
    SET deleted = 1, has_replied = 0, deleted_order_at = 7000
    WHERE account_pubkey = ? AND group_id = ?
  `).run(ACCOUNT, h);

  await groupReceiveService.receive({
    accountPubkey: ACCOUNT,
    rumor: rumor('b', BOB, 8, [['p', ACCOUNT], ['h', h]], 'new message'),
    intake: 'live',
    active: false,
    senderBlocked: false,
    syncCursor: null,
  });

  expect(mockDatabase!.sqlite.prepare(
    'SELECT deleted, has_replied FROM conversations WHERE group_id = ?',
  ).get(h)).toEqual({ deleted: 0, has_replied: 1 });
});

it('treats an own message synced from another device as accepted activity', async () => {
  const h = 'other-device-accept-test';
  await groupReceiveService.receive({
    accountPubkey: ACCOUNT,
    rumor: rumor('c', BOB, 9, [
      ['p', ACCOUNT],
      ['h', h],
      ['action', 'create'],
    ], 'hello'),
    intake: 'live',
    active: false,
    senderBlocked: false,
    syncCursor: null,
  });

  await groupReceiveService.receive({
    accountPubkey: ACCOUNT,
    rumor: rumor('d', ACCOUNT, 10, [['p', BOB], ['h', h]], 'sent elsewhere'),
    intake: 'live',
    active: false,
    senderBlocked: false,
    syncCursor: null,
  });

  expect(mockDatabase!.sqlite.prepare(
    'SELECT has_replied FROM conversations WHERE group_id = ?',
  ).get(h)).toEqual({ has_replied: 1 });
});

it('bootstraps, applies tail actions, and authorizes ordinary messages from the roster', async () => {
  const h = 'family-test';
  const create = rumor('1', BOB, 10, [
    ['p', ACCOUNT],
    ['h', h],
    ['action', 'create'],
  ], 'hello');
  await expect(groupReceiveService.receive({
    accountPubkey: ACCOUNT,
    rumor: create,
    intake: 'live',
    active: false,
    senderBlocked: false,
    syncCursor: null,
  })).resolves.toMatchObject({ stored: true });

  const invite = rumor('2', BOB, 11, [
    ['p', ACCOUNT],
    ['p', CAROL],
    ['h', h],
    ['action', 'invite', CAROL],
  ]);
  await expect(groupReceiveService.receive({
    accountPubkey: ACCOUNT,
    rumor: invite,
    intake: 'live',
    active: false,
    senderBlocked: false,
    syncCursor: null,
  })).resolves.toMatchObject({ stored: true });

  const carolMessage = rumor('3', CAROL, 12, [['p', ACCOUNT], ['h', h]], 'hi');
  await expect(groupReceiveService.receive({
    accountPubkey: ACCOUNT,
    rumor: carolMessage,
    intake: 'live',
    active: false,
    senderBlocked: false,
    syncCursor: null,
  })).resolves.toMatchObject({ stored: true });

  const row = mockDatabase!.sqlite.prepare(
    'SELECT member_pubkeys FROM conversations WHERE group_id = ?',
  ).get(h) as { member_pubkeys: string };
  expect(JSON.parse(row.member_pubkeys)).toEqual([ACCOUNT, BOB, CAROL]);
});

it('drops finalized actions and ignores finalized ordinary subjects without dropping content', async () => {
  const h = 'finality-test';
  const create = rumor('4', BOB, 200, [
    ['p', ACCOUNT],
    ['h', h],
    ['action', 'create'],
  ], 'hello');
  await groupReceiveService.receive({
    accountPubkey: ACCOUNT,
    rumor: create,
    intake: 'live',
    active: false,
    senderBlocked: false,
    syncCursor: null,
  });
  const lateInvite = rumor('5', BOB, 50, [
    ['p', ACCOUNT],
    ['p', DAVE],
    ['h', h],
    ['action', 'invite', DAVE],
  ]);
  await expect(groupReceiveService.receive({
    accountPubkey: ACCOUNT,
    rumor: lateInvite,
    intake: 'live',
    active: false,
    senderBlocked: false,
    syncCursor: { backwardUntil: 0, forwardSince: 100 },
  })).resolves.toMatchObject({ stored: false });

  const lateSubject = rumor('6', BOB, 50, [
    ['p', ACCOUNT],
    ['h', h],
    ['subject', 'Backdated'],
  ], 'old but visible');
  await expect(groupReceiveService.receive({
    accountPubkey: ACCOUNT,
    rumor: lateSubject,
    intake: 'live',
    active: false,
    senderBlocked: false,
    syncCursor: { backwardUntil: 0, forwardSince: 100 },
  })).resolves.toMatchObject({ stored: true });
  const state = mockDatabase!.sqlite.prepare(
    'SELECT name, member_pubkeys FROM conversations WHERE group_id = ?',
  ).get(h) as { name: string | null; member_pubkeys: string };
  expect(state.name).toBeNull();
  expect(JSON.parse(state.member_pubkeys)).not.toContain(DAVE);
});

it('promotes a quarantined action when an earlier prerequisite arrives', async () => {
  const h = 'replay-test';
  await groupReceiveService.receive({
    accountPubkey: ACCOUNT,
    rumor: rumor('7', BOB, 300, [
      ['p', ACCOUNT],
      ['h', h],
      ['action', 'create'],
    ], 'hello'),
    intake: 'live',
    active: false,
    senderBlocked: false,
    syncCursor: null,
  });
  const pending = rumor('8', CAROL, 320, [
    ['p', ACCOUNT],
    ['p', DAVE],
    ['h', h],
    ['action', 'invite', DAVE],
  ]);
  await expect(groupReceiveService.receive({
    accountPubkey: ACCOUNT,
    rumor: pending,
    intake: 'live',
    active: false,
    senderBlocked: false,
    syncCursor: null,
  })).resolves.toMatchObject({ stored: false });

  const prerequisite = rumor('9', BOB, 310, [
    ['p', ACCOUNT],
    ['p', CAROL],
    ['h', h],
    ['action', 'invite', CAROL],
  ]);
  await expect(groupReceiveService.receive({
    accountPubkey: ACCOUNT,
    rumor: prerequisite,
    intake: 'live',
    active: false,
    senderBlocked: false,
    syncCursor: null,
  })).resolves.toMatchObject({ stored: true, promoted: expect.arrayContaining([pending]) });

  const state = mockDatabase!.sqlite.prepare(
    'SELECT member_pubkeys FROM conversations WHERE group_id = ?',
  ).get(h) as { member_pubkeys: string };
  expect(JSON.parse(state.member_pubkeys)).toEqual([ACCOUNT, BOB, CAROL, DAVE]);
});
