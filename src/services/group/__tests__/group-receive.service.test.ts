import { buildRumor } from '@/services/crypto/nip17-gift-wrap';
import { groupConversationKey } from '@/lib/nostr/group-messaging';
import { isDisappearingMessage } from '@/lib/nostr/disappearing-message';
import { messageOrderAt } from '@/lib/nostr/message-order';
import { filterNotifiableMessages } from '@/services/notifications/notification-filter';
import type { DatabaseSync } from 'node:sqlite';

import type { Rumor } from '@/db/schema';
import { buildFileTags } from '@/lib/nostr/file-tags';

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

jest.mock('@/services/files/file-attachment.service', () => ({}));
jest.mock('@/services/account/account.service', () => ({ buildSigner: jest.fn() }));
jest.mock('@/services/conversation/message-tail-cache', () => ({
  mergeStoredMessageIntoTail: jest.fn(),
  emitMessageDeletion: jest.fn(),
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

it('ignores expiry tags when receiving group text, files, and reactions', async () => {
  const timestamp = Math.floor(Date.now() / 1000);
  const h = 'expiry-group';
  const text = recoveryRumor(h, 'Group message with an elapsed deadline');
  const file = recoveryRumor(h, 'https://example.com/group-file');
  file.kind = 15;
  file.tags.push(...buildFileTags({
    url: file.content, mime: 'application/octet-stream',
    decryptionKeyHex: '1'.repeat(64), decryptionNonceHex: '2'.repeat(24),
    cipherSha256Hex: '3'.repeat(64),
  }));
  const reaction = recoveryRumor(h, '+');
  reaction.kind = 7;
  reaction.tags.push(['e', text.id]);
  const receive = (event: Rumor) => groupReceiveService.receive({
    accountPubkey: ACCOUNT, rumor: event, intake: 'history', active: false, senderBlocked: false, syncCursor: null,
  });
  const sqlite = mockDatabase!.sqlite;
  for (const [index, event] of [text, file, reaction].entries()) {
    event.created_at = timestamp - 10 + index;
    event.tags.push(['expiration', String(index === 1 ? timestamp + 300 : timestamp - 1)]);
    await expect(receive(event)).resolves.toMatchObject({ handled: true, stored: true });
    expect(isDisappearingMessage(event)).toBe(false);
    const row = sqlite.prepare('SELECT expires_at, disappear_after_seconds, rumor FROM messages WHERE id = ?').get(event.id);
    expect(row).toMatchObject({ expires_at: null, disappear_after_seconds: null });
    expect(JSON.parse(String(row?.rumor))).toEqual(event);
  }
});

let recoveryId = 0;
function recoveryRumor(h: string, content = 'Recovered message'): Rumor {
  return {
    ...rumor('0', BOB, 500, [['p', ACCOUNT], ['p', CAROL], ['h', h]], content),
    id: (++recoveryId).toString(16).padStart(64, '0'),
  };
}

it('never tags new group text, files, or reactions with expiry', async () => {
  const { dmService } = jest.requireActual('@/services/dm/dm.service') as typeof import('@/services/dm/dm.service');
  const { relayMessageOutbox } = jest.requireActual('@/services/dm/relay-message-outbox') as typeof import('@/services/dm/relay-message-outbox');
  const wake = jest.spyOn(relayMessageOutbox, 'wake').mockImplementation(() => {});
  const sqlite = mockDatabase!.sqlite;
  const slot = 'psstpsst-message-expiry';
  sqlite.prepare('INSERT INTO private_list_sync_state (account_pubkey, kind, d_tag, draft) VALUES (?, 30078, ?, ?)')
    .run(ACCOUNT, slot, JSON.stringify([['v', '1'], ['default', '300']]));
  try {
    const { conversationKey } = await groupService.createLocalGroup(ACCOUNT, [BOB, CAROL]);
    const incomingTags = [['expiration', '100'], ['disappear-after', '30']];
    const text = await dmService.sendGroupMessage({
      accountPubkey: ACCOUNT, conversationKey, content: 'Group text', contentTags: incomingTags,
    });
    const file = await dmService.sendGroupMessage({
      accountPubkey: ACCOUNT, conversationKey, kind: 15, content: 'https://example.com/group-file',
      contentTags: [...incomingTags, ...buildFileTags({
        url: 'https://example.com/group-file', mime: 'application/octet-stream',
        decryptionKeyHex: '1'.repeat(64), decryptionNonceHex: '2'.repeat(24),
        cipherSha256Hex: '3'.repeat(64),
      })],
    });
    const reaction = await dmService.sendGroupReaction({
      accountPubkey: ACCOUNT, conversationKey, targetMessageId: text.rumorId, emoji: '👍',
    });
    for (const { rumorId } of [text, file, reaction]) {
      const row = sqlite.prepare('SELECT tags, expires_at FROM messages WHERE account_pubkey = ? AND id = ?')
        .get(ACCOUNT, rumorId);
      expect(row?.expires_at).toBeNull();
      const names = JSON.parse(String(row?.tags)).map(([key]: string[]) => key);
      expect(names).not.toContain('expiration');
      expect(names).not.toContain('disappear-after');
    }
  } finally {
    sqlite.prepare('DELETE FROM private_list_sync_state WHERE account_pubkey = ? AND kind = 30078 AND d_tag = ?').run(ACCOUNT, slot);
    wake.mockRestore();
  }
});

it('clears old group deadlines during upgrade while preserving direct message deadlines and content', async () => {
  const { dmService } = jest.requireActual('@/services/dm/dm.service') as typeof import('@/services/dm/dm.service');
  const { migrateDatabase } = jest.requireActual('@/db/use-live-query') as typeof import('@/db/use-live-query');
  const { default: migrations } = jest.requireActual('@/db/migrations/migrations') as typeof import('@/db/migrations/migrations');
  const now = Math.floor(Date.now() / 1000);
  const deadline = (now + 300) * 1000;
  const group = recoveryRumor('prior-build-expiry', 'Still readable');
  const direct = buildRumor({
    kind: 14, created_at: now, content: 'Still expires',
    tags: [['p', ACCOUNT], ['expiration', String(now + 300)]],
  }, '1234abcd'.repeat(8));
  await groupReceiveService.receive({
    accountPubkey: ACCOUNT, rumor: group, intake: 'history', active: false, senderBlocked: false, syncCursor: null,
  });
  await expect(dmService.importRumors(ACCOUNT, [direct])).resolves.toMatchObject({ inserted: 1 });
  const sqlite = mockDatabase!.sqlite;
  sqlite.prepare('UPDATE messages SET disappear_after_seconds = 300, expires_at = ? WHERE account_pubkey = ? AND id = ?')
    .run(deadline, ACCOUNT, group.id);
  sqlite.prepare('UPDATE conversations SET disappear_after_seconds = 300 WHERE account_pubkey = ? AND group_id = ?')
    .run(ACCOUNT, 'prior-build-expiry');

  await migrateDatabase(mockDatabase!.db as Parameters<typeof migrateDatabase>[0], {
    ...migrations, journal: { entries: migrations.journal.entries.filter(entry => entry.idx === 96) },
  });
  const message = sqlite.prepare('SELECT content, expires_at, disappear_after_seconds FROM messages WHERE account_pubkey = ? AND id = ?');
  expect(message.get(ACCOUNT, group.id))
    .toEqual({ content: group.content, expires_at: null, disappear_after_seconds: null });
  expect(message.get(ACCOUNT, direct.id))
    .toEqual({ content: direct.content, expires_at: deadline, disappear_after_seconds: 300 });
  expect(sqlite.prepare('SELECT disappear_after_seconds FROM conversations WHERE account_pubkey = ? AND group_id = ?')
    .get(ACCOUNT, 'prior-build-expiry')).toEqual({ disappear_after_seconds: null });
});

it.each(['live', 'recovery', 'history', 'archive'] as const)(
  'recovers an unknown group from ordinary content during %s without its first message',
  async (intake) => {
    const h = `ordinary-recovery-${intake}`;
    const message = recoveryRumor(h);
    message.tags.push(['subject', 'Recovered group']);
    await expect(groupReceiveService.receive({
      accountPubkey: ACCOUNT, rumor: message, intake, active: false,
      senderBlocked: false, syncCursor: { backwardUntil: 0, forwardSince: 600 },
    })).resolves.toMatchObject({ stored: true });
    expect(mockDatabase!.sqlite.prepare(`
      SELECT member_pubkeys, name, members_bootstrap_event_id, last_message_id, has_replied
      FROM conversations WHERE account_pubkey = ? AND group_id = ?
    `).get(ACCOUNT, h)).toEqual({
      member_pubkeys: JSON.stringify([ACCOUNT, BOB, CAROL]), name: 'Recovered group',
      members_bootstrap_event_id: message.id, last_message_id: message.id, has_replied: 0,
    });
    expect(hasEvent(message, ACCOUNT)).toBe(intake === 'live' || intake === 'recovery');
  },
);

it('establishes a local draft from its first ordinary message and queues delivery', async () => {
  const group = await groupService.createLocalGroup(ACCOUNT, [BOB, CAROL]);
  const message = recoveryRumor(group.groupId);
  message.pubkey = ACCOUNT;
  message.tags = [['p', BOB], ['p', CAROL], ['h', group.groupId]];
  await expect(groupReceiveService.receive({
    accountPubkey: ACCOUNT, rumor: message, intake: 'local', active: true,
    senderBlocked: false,
  })).resolves.toMatchObject({ stored: true });
  expect(mockDatabase!.sqlite.prepare(
    'SELECT members_bootstrap_event_id FROM conversations WHERE group_id = ?',
  ).get(group.groupId)).toEqual({ members_bootstrap_event_id: message.id });
  expect(mockDatabase!.sqlite.prepare(
    'SELECT message_id FROM relay_outbox_jobs WHERE account_pubkey = ? AND message_id = ?',
  ).get(ACCOUNT, message.id!)).toEqual({ message_id: message.id });
});

it('recovers a group from a valid file offer without an earlier text message', async () => {
  const h = 'file-recovery';
  const message = recoveryRumor(h, 'https://example.com/file');
  message.kind = 15;
  message.tags.push(...buildFileTags({
    url: message.content, mime: 'application/octet-stream',
    decryptionKeyHex: '1'.repeat(64), decryptionNonceHex: '2'.repeat(24),
    cipherSha256Hex: '3'.repeat(64),
  }));
  await expect(groupReceiveService.receive({
    accountPubkey: ACCOUNT, rumor: message, intake: 'live', active: false,
    senderBlocked: false, syncCursor: null,
  })).resolves.toMatchObject({ stored: true });
});

it('keeps legacy create content readable even when it arrives after ordinary content', async () => {
  const h = 'late-legacy-create';
  const receive = (message: Rumor) => groupReceiveService.receive({
    accountPubkey: ACCOUNT, rumor: message, intake: 'live', active: false,
    senderBlocked: false, syncCursor: { backwardUntil: 0, forwardSince: 600 },
  });
  await expect(receive(recoveryRumor(h))).resolves.toMatchObject({ stored: true });
  const legacy = recoveryRumor(h, 'Earlier first message');
  legacy.created_at = 400;
  legacy.tags.push(['action', 'create']);
  await expect(receive(legacy)).resolves.toMatchObject({ stored: true });
});

it('releases a pending reaction when ordinary content establishes the group', async () => {
  const h = 'pending-reaction-recovery';
  const message = recoveryRumor(h);
  const reaction = recoveryRumor(h, '+');
  reaction.kind = 7;
  reaction.created_at = 501;
  reaction.tags.push(['e', message.id!]);
  const receive = (rumor: Rumor) => groupReceiveService.receive({
    accountPubkey: ACCOUNT, rumor, intake: 'live', active: false,
    senderBlocked: false, syncCursor: null,
  });
  await expect(receive(reaction)).resolves.toMatchObject({ stored: false });
  const result = await receive(message);
  expect(result).toMatchObject({
    stored: true, promoted: expect.arrayContaining([reaction]),
  });
  expect(mockDatabase!.sqlite.prepare(
    'SELECT message_id FROM pending_group_rumors WHERE conversation_key = ?',
  ).all(result.conversationKey!)).toEqual([]);
});

it('does not let an ordinary audience snapshot re-add a removed member', async () => {
  const h = 'ordinary-roster-authorization';
  const receive = (rumor: Rumor) => groupReceiveService.receive({
    accountPubkey: ACCOUNT, rumor, intake: 'live', active: false,
    senderBlocked: false, syncCursor: null,
  });
  await receive(recoveryRumor(h));
  const remove = recoveryRumor(h, '');
  remove.created_at = 501;
  remove.tags.push(['action', 'remove', CAROL]);
  await expect(receive(remove)).resolves.toMatchObject({ stored: true });
  const ordinary = recoveryRumor(h);
  ordinary.created_at = 502;
  await expect(receive(ordinary)).resolves.toMatchObject({ stored: true });
  const removedSender = recoveryRumor(h);
  removedSender.pubkey = CAROL;
  removedSender.created_at = 503;
  await expect(receive(removedSender)).resolves.toMatchObject({ stored: false });
  expect(mockDatabase!.sqlite.prepare(
    'SELECT member_pubkeys FROM conversations WHERE group_id = ?',
  ).get(h)).toEqual({ member_pubkeys: JSON.stringify([ACCOUNT, BOB]) });
});

it.each(['reaction', 'empty', 'invalid-file', 'blocked', 'unaddressed', 'rename', 'remove'])(
  'does not bootstrap an unknown group from %s',
  async (variant) => {
    const h = `invalid-bootstrap-${variant}`;
    const message = recoveryRumor(h);
    if (variant === 'reaction') message.kind = 7;
    if (variant === 'empty' || variant === 'rename' || variant === 'remove') message.content = '';
    if (variant === 'invalid-file') message.kind = 15;
    if (variant === 'unaddressed') message.tags = [['p', CAROL], ['h', h]];
    if (variant === 'rename') message.tags.push(['action', 'rename'], ['subject', 'Name']);
    if (variant === 'remove') message.tags.push(['action', 'remove', ACCOUNT]);
    await expect(groupReceiveService.receive({
      accountPubkey: ACCOUNT, rumor: message, intake: 'live', active: false,
      senderBlocked: variant === 'blocked', syncCursor: null,
    })).resolves.toMatchObject({ stored: false });
    expect(mockDatabase!.sqlite.prepare(
      'SELECT group_id FROM conversations WHERE group_id = ?',
    ).get(h)).toBeUndefined();
  },
);

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

it('announces a new group request once while later group messages remain silent', async () => {
  const groupId = 'new-request-alert';
  const first = rumor('e1', BOB, 100, [['p', ACCOUNT], ['h', groupId]], 'hello');
  const later = rumor('e2', BOB, 101, [['p', ACCOUNT], ['h', groupId]], 'again');
  for (const message of [first, later]) {
    expect(await groupReceiveService.receive({
      accountPubkey: ACCOUNT, rumor: message, intake: 'live', active: false,
      senderBlocked: false,
    })).toMatchObject({ stored: true });
  }
  expect(hasEvent(first, ACCOUNT)).toBe(true);
  expect(hasEvent(later, ACCOUNT)).toBe(false);
});

it.each(['history', 'archive'] as const)('does not promote %s into an arrival when a live prerequisite unlocks it', async (intake) => {
  const h = `silent-promotion-${intake}`;
  const bootstrap = rumor(`silent-bootstrap-${intake}`, BOB, 100, [['p', ACCOUNT], ['h', h]], 'hello');
  await groupReceiveService.receive({ accountPubkey: ACCOUNT, rumor: bootstrap, intake: 'live', active: false, senderBlocked: false });
  const historical = rumor(`silent-pending-${intake}`, CAROL, 120,
    [['p', ACCOUNT], ['p', DAVE], ['h', h], ['action', 'invite', DAVE]]);
  await groupReceiveService.receive({ accountPubkey: ACCOUNT, rumor: historical, intake, active: false, senderBlocked: false });
  const prerequisite = rumor(`silent-prerequisite-${intake}`, BOB, 110,
    [['p', ACCOUNT], ['p', CAROL], ['h', h], ['action', 'invite', CAROL]]);
  const result = await groupReceiveService.receive({ accountPubkey: ACCOUNT, rumor: prerequisite, intake: 'live', active: false, senderBlocked: false });
  expect(result.promoted).toEqual(expect.arrayContaining([historical]));
  expect(hasEvent(result.promoted.find(item => item.id === historical.id)!, ACCOUNT)).toBe(false);
  expect(hasEvent(prerequisite, ACCOUNT)).toBe(false);
});

it.each(['live', 'recovery', 'history', 'archive'] as const)('preserves %s provenance on actual group replay deliveries', async (intake) => {
  const h = `delivered-provenance-${intake}`;
  const bootstrap = rumor(`delivered-bootstrap-${intake}`, BOB, 100, [['p', ACCOUNT], ['h', h]], 'hello');
  await groupReceiveService.receive({ accountPubkey: ACCOUNT, rumor: bootstrap, intake: 'live', active: false, senderBlocked: false });
  mockDatabase!.sqlite.prepare('UPDATE conversations SET has_replied = 1 WHERE account_pubkey = ? AND group_id = ?').run(ACCOUNT, h);
  const pending = rumor(`delivered-pending-${intake}`, CAROL, 120,
    [['p', ACCOUNT], ['p', DAVE], ['h', h], ['action', 'invite', DAVE]]);
  await groupReceiveService.receive({ accountPubkey: ACCOUNT, rumor: pending, intake, active: false, senderBlocked: false });
  const prerequisite = rumor(`delivered-prerequisite-${intake}`, BOB, 110,
    [['p', ACCOUNT], ['p', CAROL], ['h', h], ['action', 'invite', CAROL]]);
  const result = await groupReceiveService.receive({ accountPubkey: ACCOUNT, rumor: prerequisite, intake: 'live', active: false, senderBlocked: false });
  const delivered = [...new Map([prerequisite, ...result.promoted].map(item => [item.id, item])).values()];
  const actualPrerequisite = delivered.find(item => item.id === prerequisite.id)!;
  const actualPending = delivered.find(item => item.id === pending.id)!;
  expect(actualPrerequisite).not.toBe(prerequisite);
  expect(hasEvent(actualPrerequisite, ACCOUNT)).toBe(true);
  const livePending = intake === 'live' || intake === 'recovery';
  expect(hasEvent(actualPending, ACCOUNT)).toBe(livePending);
  const deliveredEvents = await filterNotifiableMessages(delivered, ACCOUNT);
  expect(deliveredEvents.map(item => item.rumor.id)).toEqual(livePending
    ? expect.arrayContaining([actualPrerequisite.id, actualPending.id]) : [actualPrerequisite.id]);
});

it('restores a deleted group request without another alert', async () => {
  const h = 'deleted-request-restoration';
  const first = rumor('deleted-first', BOB, 100, [['p', ACCOUNT], ['h', h]], 'hello');
  await groupReceiveService.receive({ accountPubkey: ACCOUNT, rumor: first, intake: 'live', active: false, senderBlocked: false });
  const key = groupConversationKey(h);
  mockDatabase!.sqlite.prepare('UPDATE conversations SET deleted = 1, has_replied = 0, unread_count = 0, last_read_order_at = 100000, deleted_order_at = 101000 WHERE conversation_key = ?').run(key);
  mockDatabase!.sqlite.prepare('DELETE FROM notification_events WHERE conversation_key = ?').run(key);
  const restored = rumor('deleted-restored', BOB, 102, [['p', ACCOUNT], ['h', h]], 'again');
  await groupReceiveService.receive({ accountPubkey: ACCOUNT, rumor: restored, intake: 'live', active: false, senderBlocked: false });
  expect(mockDatabase!.sqlite.prepare('SELECT deleted, has_replied, unread_count FROM conversations WHERE conversation_key = ?').get(key))
    .toEqual({ deleted: 0, has_replied: 0, unread_count: 1 });
  expect(hasEvent(restored)).toBe(false);
});

it('delays rate-limited gift wraps without blocking later jobs or retrying refusals', async () => {
  const { platform } = jest.requireActual('@/platform') as typeof import('@/platform');
  const { relayPool } = jest.requireActual('../../relay/relay-pool') as typeof import('../../relay/relay-pool');
  const { relayMessageOutbox } = jest.requireActual('../../dm/relay-message-outbox') as typeof import('../../dm/relay-message-outbox');
  const account = 'e'.repeat(64);
  const limited = 'wss://limited.example/';
  const refused = 'wss://refused.example/';
  const accepted = 'wss://accepted.example/';
  const sqlite = mockDatabase!.sqlite;
  sqlite.prepare("INSERT INTO accounts (pubkey, signer_type, added_at, sort_order) VALUES (?, 'nsec', 1, 0)").run(account);
  const group = await groupService.createLocalGroup(account, [BOB, CAROL]);

  async function queue(targets: string[]) {
    const message = recoveryRumor(group.groupId);
    message.pubkey = account;
    message.tags = [['p', BOB], ['p', CAROL], ['h', group.groupId]];
    await groupReceiveService.receive({
      accountPubkey: account, rumor: message, intake: 'local', active: true, senderBlocked: false,
    });
    const { id } = sqlite.prepare('SELECT id FROM relay_outbox_jobs WHERE message_id = ?').get(message.id!)!;
    sqlite.prepare("INSERT INTO message_delivery_copies (account_pubkey,message_id,recipient_pubkey,relays,updated_at) VALUES (?,?,?,'[]',0)")
      .run(account, message.id!, BOB);
    for (const url of targets) {
      sqlite.prepare('INSERT INTO relay_outbox_job_targets (job_id,recipient_pubkey,relay_url) VALUES (?,?,?)').run(id as number, BOB, url);
    }
    sqlite.prepare('INSERT INTO relay_outbox_payloads (job_id,recipient_pubkey,gift_wrap) VALUES (?,?,?)')
      .run(id as number, BOB, JSON.stringify({ id: message.id }));
    return message.id;
  }

  const first = await queue([limited, refused]);
  const second = await queue([accepted]);
  let limitedOnce = false;
  const publish = jest.spyOn(relayPool, 'publishEvent').mockImplementation(async ({ relays, onRelay }) =>
    relays.map((url) => {
      let outcome: import('../../relay/relay-pool').PublishOutcome = { ok: true };
      if (url === limited && !limitedOnce) {
        limitedOnce = true;
        outcome = { ok: false, failure: 'rate-limited', reason: 'rate-limited: slow down', retryAfterMs: 120_000 };
      } else if (url === refused) {
        outcome = { ok: false, failure: 'rejected', reason: 'blocked: relay policy' };
      }
      onRelay?.(url, outcome);
      return { url, outcome };
    }));
  const app = jest.spyOn(platform.appState, 'currentState').mockReturnValue('active');
  const online = jest.spyOn(platform.networkState, 'getState').mockResolvedValue({ isConnected: true });
  const observe = jest.spyOn(platform.networkState, 'addStateListener').mockImplementation(() => {});
  jest.useFakeTimers();
  try {
    relayMessageOutbox.activate({
      accountPubkey: account, dmRelays: [],
      encryptionKeypair: { pubkey: account, key: { account, role: 'messaging' }, createdAt: 0 },
      signSeal: jest.fn(),
    });
    await relayMessageOutbox.waitForIdle();
    expect(publish.mock.calls.map(([call]) => call.event.id)).toEqual([first, second]);
    await jest.advanceTimersByTimeAsync(119_999);
    expect(publish).toHaveBeenCalledTimes(2);
    await jest.advanceTimersByTimeAsync(1);
    await relayMessageOutbox.waitForIdle();
    expect(publish.mock.calls.map(([call]) => [call.event.id, call.relays])).toEqual([
      [first, [limited, refused]], [second, [accepted]], [first, [limited]],
    ]);
    expect(sqlite.prepare('SELECT id FROM relay_outbox_jobs WHERE account_pubkey = ?').all(account)).toEqual([]);
  } finally {
    relayMessageOutbox.deactivate();
    jest.useRealTimers();
    observe.mockRestore();
    online.mockRestore();
    app.mockRestore();
    publish.mockRestore();
  }
});

describe('private message deletions', () => {
  const { dmService } = jest.requireActual('@/services/dm/dm.service') as typeof import('@/services/dm/dm.service');
  const { relayMessageOutbox } = jest.requireActual('@/services/dm/relay-message-outbox') as typeof import('@/services/dm/relay-message-outbox');
  const receiveDm = dmService as unknown as {
    applyMessageDeletion(accountPubkey: string, rumor: Rumor, keepPending: boolean): Promise<boolean | null>;
    storeRumor(rumor: Rumor, accountPubkey: string): Promise<boolean | 'hidden' | null>;
  };

  it.each([
    ['direct', 'message author', BOB, BOB, true],
    ['direct', 'own device', DAVE, ACCOUNT, true],
    ['direct', 'unrelated author', 'f'.repeat(64), CAROL, false],
    ['group', 'message author', BOB, BOB, true],
    ['group', 'own device', BOB, ACCOUNT, true],
    ['group', 'unrelated author', BOB, CAROL, false],
  ] as const)('resolves a pending %s deletion from the %s', async (chat, _, author, requestAuthor, deleted) => {
    const h = `pending-deletion-${requestAuthor[0]}`;
    const target = buildRumor({
      kind: 14, created_at: 880, content: `Out-of-order ${chat} message`,
      tags: chat === 'group' ? [['p', ACCOUNT], ['p', CAROL], ['h', h]] : [['p', ACCOUNT]],
    }, author);
    const deletion = buildRumor({
      kind: 5, created_at: 881, tags: [['e', target.id], ['p', ACCOUNT]], content: '',
    }, requestAuthor);
    const sqlite = mockDatabase!.sqlite;
    const request = sqlite.prepare('SELECT pending_target_id FROM message_deletions WHERE account_pubkey = ? AND id = ?');
    for (let attempt = 0; attempt < 2; attempt++) {
      await receiveDm.applyMessageDeletion(ACCOUNT, deletion, true);
      expect(request.get(ACCOUNT, deletion.id)).toEqual({ pending_target_id: target.id });
    }
    if (chat === 'group') {
      const result = await groupReceiveService.receive({
        accountPubkey: ACCOUNT, rumor: target, intake: 'live', active: false,
        senderBlocked: false, syncCursor: null,
      });
      expect(result.stored).toBe(true);
      expect(result.hiddenIds?.has(target.id) ?? false).toBe(deleted);
    } else {
      await expect(receiveDm.storeRumor(target, ACCOUNT)).resolves.toBe(deleted ? 'hidden' : true);
    }
    expect(request.get(ACCOUNT, deletion.id)).toEqual(deleted ? { pending_target_id: null } : undefined);
    expect(sqlite.prepare('SELECT deleted, content FROM messages WHERE account_pubkey = ? AND id = ?')
      .get(ACCOUNT, target.id)).toEqual({ deleted: Number(deleted), content: target.content });
    expect(sqlite.prepare('SELECT count(*) AS n FROM message_fts WHERE id = ?')
      .get(target.id)?.n).toBe(deleted ? 0 : 1);
    expect(hasEvent(target)).toBe(!deleted);
    expect(sqlite.prepare('SELECT last_message_id, unread_count FROM conversations WHERE account_pubkey = ? AND conversation_key = ?')
      .get(ACCOUNT, chat === 'group' ? groupConversationKey(h) : author)).toEqual({
      last_message_id: deleted ? null : target.id,
      unread_count: deleted ? 0 : 1,
    });
  });

  it('places a local deletion after a target authored on a device whose clock is ahead', async () => {
    const wake = jest.spyOn(relayMessageOutbox, 'wake').mockImplementation(() => {});
    try {
      const target = buildRumor({
        kind: 14, created_at: Math.floor(Date.now() / 1000) + 120,
        tags: [['p', BOB], ['ms', '999']], content: 'Synced from a device with a fast clock',
      }, ACCOUNT);
      expect(await dmService.importRumors(ACCOUNT, [target])).toMatchObject({ inserted: 1 });
      await dmService.deleteMessage(ACCOUNT, target.id, false);
      const row = mockDatabase!.sqlite.prepare(`SELECT d.rumor, d.order_at FROM relay_outbox_jobs j
        JOIN message_deletions d ON d.account_pubkey = j.account_pubkey AND d.id = j.message_id
        WHERE j.account_pubkey = ? ORDER BY j.id DESC LIMIT 1`).get(ACCOUNT);
      const deletion = JSON.parse(String(row?.rumor)) as Rumor;
      expect(deletion.tags).toContainEqual(['e', target.id]);
      expect(messageOrderAt(deletion)).toBe(messageOrderAt(target) + 1);
      expect(row?.order_at).toBe(messageOrderAt(deletion));
    } finally {
      wake.mockRestore();
    }
  });

  it('replays only author-owned deletions against existing targets and removes search content', async () => {
    const author = 'e'.repeat(64);
    const target = buildRumor({
      kind: 14, created_at: 900, tags: [['p', ACCOUNT]], content: 'Deletable archive text',
    }, author);
    const deletion = (author: string, id: string): Rumor => ({
      ...rumor(id, author, 901, [['e', target.id], ['k', '14']]),
      kind: 5,
    });
    const valid = deletion(author, '8');
    expect(await dmService.importRumors(ACCOUNT, [valid])).toMatchObject({ invalid: 1 });
    expect(await dmService.importRumors(ACCOUNT, [target, deletion(CAROL, '7')]))
      .toEqual({ inserted: 1, existing: 0, invalid: 1 });
    const sqlite = mockDatabase!.sqlite;
    const search = sqlite.prepare('SELECT count(*) AS n FROM message_fts WHERE id = ?');
    expect(search.get(target.id)?.n).toBe(1);
    expect(await dmService.importRumors(ACCOUNT, [valid, valid]))
      .toEqual({ inserted: 1, existing: 1, invalid: 0 });
    expect(search.get(target.id)?.n).toBe(0);
    expect(sqlite.prepare('SELECT deleted, content FROM messages WHERE account_pubkey = ? AND id = ?')
      .get(ACCOUNT, target.id)).toEqual({ deleted: 1, content: target.content });
    expect(sqlite.prepare('SELECT last_message_id FROM conversations WHERE account_pubkey = ? AND conversation_key = ?')
      .get(ACCOUNT, author)?.last_message_id).toBeNull();
  });

  it.each([false, true])('queues the proper group audience with shared deletion = %s', async (forEveryone) => {
    const wake = jest.spyOn(relayMessageOutbox, 'wake').mockImplementation(() => {});
    try {
      const h = forEveryone ? 'delete-for-group' : 'delete-for-self';
      const target = buildRumor({
        kind: 14, created_at: 910, tags: [['p', BOB], ['p', CAROL], ['h', h]], content: 'Group history',
      }, ACCOUNT);
      expect(await dmService.importRumors(ACCOUNT, [target])).toMatchObject({ inserted: 1 });
      const sqlite = mockDatabase!.sqlite;
      sqlite.prepare('UPDATE conversations SET member_pubkeys = ? WHERE account_pubkey = ? AND conversation_key = ?')
        .run(JSON.stringify([ACCOUNT, BOB, DAVE]), ACCOUNT, groupConversationKey(h));
      await dmService.deleteMessage(ACCOUNT, target.id, forEveryone);
      const row = sqlite.prepare(`SELECT d.rumor FROM relay_outbox_jobs j
        JOIN message_deletions d ON d.account_pubkey = j.account_pubkey AND d.id = j.message_id
        WHERE j.account_pubkey = ? ORDER BY j.id DESC LIMIT 1`).get(ACCOUNT);
      const sent = JSON.parse(String(row?.rumor)) as Rumor;
      expect(sent).toMatchObject({ kind: 5, pubkey: ACCOUNT });
      expect(sent.tags).toContainEqual(['e', target.id]);
      expect(sent.tags.filter(([name]) => name === 'p')).toEqual(
        forEveryone ? [['p', BOB], ['p', CAROL]] : [['p', ACCOUNT]],
      );
      expect(wake).toHaveBeenCalledWith(ACCOUNT);
    } finally {
      wake.mockRestore();
    }
  });
  it('retracts only an owned group reaction and uses its original audience', async () => {
    const h = 'retract-group-reaction';
    const tags = [['p', BOB], ['p', CAROL], ['h', h]];
    const source = buildRumor({ kind: 14, content: 'Group original', tags, created_at: 910 }, ACCOUNT);
    const mine = buildRumor({
      kind: 7, content: '👍', tags: [...tags, ['e', source.id]], created_at: 911,
    }, ACCOUNT);
    const theirs = buildRumor({
      kind: 7, content: '👍', tags: [['p', ACCOUNT], ['p', CAROL], ['h', h], ['e', source.id]],
      created_at: 911,
    }, BOB);
    expect(await dmService.importRumors(ACCOUNT, [source, mine, theirs])).toMatchObject({ inserted: 3 });
    const sqlite = mockDatabase!.sqlite;
    const key = groupConversationKey(h);
    sqlite.prepare('UPDATE conversations SET member_pubkeys = ? WHERE account_pubkey = ? AND conversation_key = ?')
      .run(JSON.stringify([ACCOUNT, BOB, DAVE]), ACCOUNT, key);
    sqlite.prepare("INSERT INTO relay_outbox_jobs (account_pubkey,message_id,scope,created_at) VALUES (?,?,'all_recipient_relays',0)")
      .run(ACCOUNT, mine.id);
    const wake = jest.spyOn(relayMessageOutbox, 'wake').mockImplementation(() => {});
    try {
      await dmService.retractReaction(ACCOUNT, key, theirs.id);
      await dmService.retractReaction(ACCOUNT, key, source.id);
      await dmService.retractReaction(ACCOUNT, 'other-group', mine.id);
      expect(wake).not.toHaveBeenCalled();
      await dmService.retractReaction(ACCOUNT, key, mine.id);
      expect(wake).toHaveBeenCalledWith(ACCOUNT);
      const row = sqlite.prepare(`SELECT d.rumor FROM relay_outbox_jobs j
        JOIN message_deletions d ON d.account_pubkey = j.account_pubkey AND d.id = j.message_id
        WHERE j.account_pubkey = ? ORDER BY j.id DESC LIMIT 1`).get(ACCOUNT);
      const request = JSON.parse(String(row?.rumor)) as Rumor;
      expect(request.tags.filter(([name]) => name === 'p')).toEqual([['p', BOB], ['p', CAROL]]);
      expect(request.tags).toEqual(expect.arrayContaining([['e', mine.id], ['k', '7']]));
      expect(sqlite.prepare('SELECT scope, recipient_pubkey FROM relay_outbox_jobs WHERE account_pubkey = ? AND message_id = ? ORDER BY recipient_pubkey')
        .all(ACCOUNT, request.id)).toEqual([ACCOUNT, BOB, CAROL].map(recipient_pubkey => ({ scope: 'selected_copy', recipient_pubkey })));
      expect(sqlite.prepare('SELECT id FROM relay_outbox_jobs WHERE account_pubkey = ? AND message_id = ?')
        .get(ACCOUNT, mine.id)).toBeUndefined();
      const stored = sqlite.prepare('SELECT deleted FROM messages WHERE account_pubkey = ? AND id = ?');
      expect(stored.get(ACCOUNT, mine.id)?.deleted).toBe(1);
      expect(stored.get(ACCOUNT, theirs.id)?.deleted).toBe(0);
      expect(stored.get(ACCOUNT, source.id)?.deleted).toBe(0);
      expect(await dmService.importRumors(BOB, [source, mine, theirs, request])).toMatchObject({ inserted: 4 });
      expect(stored.get(BOB, mine.id)?.deleted).toBe(1);
      expect(stored.get(BOB, theirs.id)?.deleted).toBe(0);
      expect(stored.get(BOB, source.id)?.deleted).toBe(0);
    } finally {
      wake.mockRestore();
    }
  });

  it('scopes an entire mixed-author selection to the requesting account', async () => {
    const wake = jest.spyOn(relayMessageOutbox, 'wake').mockImplementation(() => {});
    try {
      const first = buildRumor({
        kind: 14, created_at: 920, tags: [['p', BOB], ['p', CAROL], ['h', 'batch-delete']], content: 'First selected',
      }, ACCOUNT);
      const second = buildRumor({
        kind: 14, created_at: 921, tags: [['p', CAROL], ['h', 'batch-delete']], content: 'Second selected',
      }, ACCOUNT);
      const peer = buildRumor({
        kind: 14, created_at: 922, tags: [['p', ACCOUNT]], content: 'Peer message',
      }, CAROL);
      expect(await dmService.importRumors(ACCOUNT, [first, second, peer])).toMatchObject({ inserted: 3 });

      const sqlite = mockDatabase!.sqlite;
      const lastJob = sqlite.prepare('SELECT max(id) AS id FROM relay_outbox_jobs').get()?.id;
      await dmService.deleteMessages(ACCOUNT, [first.id, second.id, peer.id, first.id], true);

      const jobs = sqlite.prepare(`SELECT d.rumor FROM relay_outbox_jobs j
        JOIN message_deletions d ON d.account_pubkey = j.account_pubkey AND d.id = j.message_id
        WHERE j.account_pubkey = ? AND j.id > ? ORDER BY j.id`).all(ACCOUNT, lastJob as number);
      expect(jobs.map((row) => {
        const deletion = JSON.parse(String(row.rumor)) as Rumor;
        return deletion.tags.filter(([name]) => name === 'e' || name === 'p');
      })).toEqual([
        [['e', first.id], ['p', ACCOUNT]],
        [['e', second.id], ['p', ACCOUNT]],
        [['e', peer.id], ['p', ACCOUNT]],
      ]);
      const status = sqlite.prepare('SELECT deleted FROM messages WHERE account_pubkey = ? AND id = ?');
      expect([first, second, peer].map((message) => status.get(ACCOUNT, message.id)?.deleted))
        .toEqual([1, 1, 1]);
      expect(wake).toHaveBeenCalledTimes(1);
    } finally {
      wake.mockRestore();
    }
  });
  it('replays a self-authored deletion of an incoming message on another device', async () => {
    const target = buildRumor({
      kind: 14, created_at: 930, tags: [['p', ACCOUNT]], content: 'Incoming message from history',
    }, DAVE);
    const selfDeletion = buildRumor({
      kind: 5, created_at: 931, tags: [['e', target.id], ['k', '14'], ['p', ACCOUNT]], content: '',
    }, ACCOUNT);

    expect(await dmService.importRumors(ACCOUNT, [target, selfDeletion]))
      .toEqual({ inserted: 2, existing: 0, invalid: 0 });
    expect(mockDatabase!.sqlite.prepare('SELECT deleted FROM messages WHERE account_pubkey = ? AND id = ?')
      .get(ACCOUNT, target.id)?.deleted).toBe(1);
  });

});


it('only notifies for reactions to the local member’s own message, with no change to unread', async () => {
  const h = 'own-reaction-notification';
  const own = rumor('9', ACCOUNT, 100, [['p', BOB], ['p', CAROL], ['h', h]], 'my message');
  own.id = 'ab'.repeat(32);
  const peer = { ...own, pubkey: BOB, id: 'bc'.repeat(32), created_at: 101,
    tags: [['p', ACCOUNT], ['p', CAROL], ['h', h]], content: 'peer message' };
  const react = (id: string, author: string, target: string) => ({
    ...peer, id: id.repeat(32), kind: 7, pubkey: author, created_at: 102,
    tags: [['p', ACCOUNT], ['p', BOB], ['p', CAROL], ['h', h], ['e', target]], content: '👍',
  });
  const receive = (message: Rumor, active = false) => groupReceiveService.receive({
    accountPubkey: ACCOUNT, rumor: message, intake: 'live', active,
    userPresent: true, senderBlocked: false, syncCursor: null,
  });
  await receive(own);
  await receive(peer);
  for (const ignored of [react('de', CAROL, peer.id), react('df', ACCOUNT, own.id)]) {
    await expect(receive(ignored)).resolves.toMatchObject({ stored: true });
    expect(hasEvent(ignored)).toBe(false);
  }
  const incoming = react('cd', CAROL, own.id);
  await expect(receive(incoming)).resolves.toMatchObject({ stored: true });
  expect(hasEvent(incoming)).toBe(true);
  const readState = () => mockDatabase!.sqlite.prepare(`
    SELECT unread_count, last_message_id, updated_order_at, reaction_preview_event_id, reaction_preview_pending
    FROM conversations WHERE account_pubkey = ? AND group_id = ?
  `).get(ACCOUNT, h);
  expect(readState()).toEqual({
    unread_count: 1, last_message_id: peer.id, updated_order_at: 101000,
    reaction_preview_event_id: incoming.id, reaction_preview_pending: 1,
  });

  const whileActive = { ...react('ce', BOB, own.id), created_at: 103 };
  await expect(receive(whileActive, true)).resolves.toMatchObject({ stored: true });
  expect(hasEvent(whileActive)).toBe(false);
  expect(readState()).toEqual({
    unread_count: 1, last_message_id: peer.id, updated_order_at: 101000,
    reaction_preview_event_id: whileActive.id, reaction_preview_pending: 0,
  });

  const caughtUp = { ...react('cf', BOB, own.id), created_at: 104 };
  await expect(groupReceiveService.receive({
    accountPubkey: ACCOUNT, rumor: caughtUp, intake: 'history', recoveryPreview: true,
    active: false, senderBlocked: false, syncCursor: null,
  })).resolves.toMatchObject({ stored: true });
  expect(hasEvent(caughtUp)).toBe(false);
  expect(readState()).toMatchObject({
    unread_count: 1, last_message_id: peer.id, updated_order_at: 101000,
    reaction_preview_event_id: caughtUp.id, reaction_preview_pending: 1,
  });
});


it('does not promote a quarantined reaction from a removed member', async () => {
  const group = 'pending-reaction-from-removed-member';
  const own = recoveryRumor(group, 'my message');
  own.pubkey = ACCOUNT;
  own.tags = [['p', BOB], ['p', CAROL], ['h', group]];
  const removal = recoveryRumor(group, '');
  removal.created_at = 501;
  removal.tags.push(['action', 'remove', CAROL]);
  const incoming = recoveryRumor(group, '👍');
  incoming.pubkey = CAROL;
  incoming.kind = 7;
  incoming.created_at = 502;
  incoming.tags.push(['e', own.id]);
  const receive = (message: Rumor) => groupReceiveService.receive({
    accountPubkey: ACCOUNT, rumor: message, intake: 'live', active: false,
    userPresent: true, senderBlocked: false, syncCursor: null,
  });
  await expect(receive(removal)).resolves.toMatchObject({ stored: false });
  await expect(receive(incoming)).resolves.toMatchObject({ stored: false });
  const result = await receive(own);
  expect(result.stored).toBe(true);
  expect(result.promoted.map(candidate => candidate.id)).toContain(removal.id);
  expect(result.promoted.map(candidate => candidate.id)).not.toContain(incoming.id);
  expect(hasEvent(incoming)).toBe(false);
});

it('uses current route presence instead of a stale group intake snapshot for reactions', async () => {
  const group = 'reaction-presence-change';
  const own = recoveryRumor(group, 'my message');
  own.pubkey = ACCOUNT;
  own.tags = [['p', BOB], ['p', CAROL], ['h', group]];
  const incoming = recoveryRumor(group, '👍');
  incoming.kind = 7;
  incoming.created_at = 501;
  incoming.tags.push(['e', own.id]);
  const opts = {
    accountPubkey: ACCOUNT, intake: 'live' as const, active: true,
    userPresent: true, senderBlocked: false, syncCursor: null,
    reactionPresence: () => ({ userPresent: true, activeConversation: null }),
  };
  await groupReceiveService.receive({ ...opts, rumor: own });
  await expect(groupReceiveService.receive({ ...opts, rumor: incoming })).resolves.toMatchObject({ stored: true });
  expect(hasEvent(incoming)).toBe(true);
});

it('keeps a live group reaction silent when it is promoted after its target arrives', async () => {
  const group = 'late-target-reaction';
  const own = recoveryRumor(group, 'my message');
  own.pubkey = ACCOUNT;
  own.tags = [['p', BOB], ['p', CAROL], ['h', group]];
  const incoming = recoveryRumor(group, '👍');
  incoming.kind = 7;
  incoming.created_at = 501;
  incoming.tags.push(['e', own.id]);
  const receive = (message: Rumor) => groupReceiveService.receive({
    accountPubkey: ACCOUNT, rumor: message, intake: 'live', active: false,
    userPresent: true, senderBlocked: false, syncCursor: null,
  });
  await expect(receive(incoming)).resolves.toMatchObject({ stored: false });
  const result = await receive(own);
  expect(result.promoted).toEqual([incoming]);
  expect(hasEvent(incoming)).toBe(false);
  expect(mockDatabase!.sqlite.prepare(
    'SELECT reaction_preview_pending FROM conversations WHERE account_pubkey = ? AND group_id = ?',
  ).get(ACCOUNT, group)).toEqual({ reaction_preview_pending: 0 });
});


it('skips a queued group write when its receive session is cancelled before acquiring the writer lock', async () => {
  const group = 'cancelled-historical-group';
  const incoming = recoveryRumor(group);
  let current = true;
  const received = groupReceiveService.receive({
    accountPubkey: ACCOUNT, rumor: incoming, intake: 'history', active: false,
    senderBlocked: false, syncCursor: null, isCurrent: () => current,
  });
  current = false;
  await expect(received).resolves.toMatchObject({ handled: true, stored: false });
  expect(mockDatabase!.sqlite.prepare('SELECT group_id FROM conversations WHERE account_pubkey = ? AND group_id = ?')
    .get(ACCOUNT, group)).toBeUndefined();
});
