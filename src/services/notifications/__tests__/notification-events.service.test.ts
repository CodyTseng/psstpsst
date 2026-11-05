import type { Database } from '@/db/client';
import { conversations, messages, notificationEvents, type Rumor } from '@/db/schema';
import {
  notificationKindForTransition, recordNotificationEvent, takeNotificationEvents, type NotificationConversationState,
} from '../notification-events.service';

jest.mock('@/db/client', () => {
  const { createNotificationDatabase } = jest.requireActual('../test-support/database');
  return createNotificationDatabase();
});
jest.mock('@/lib/platform', () => ({ IS_IOS: false }));
const fixture = jest.requireMock('@/db/client') as ReturnType<typeof import('../test-support/database').createNotificationDatabase>;
const { db, sqlite } = fixture;
const ACCOUNT = 'a'.repeat(64);
const PEER = 'b'.repeat(64);
const empty = { deleted: false, hasReplied: false, lastMessageId: null, unreadCount: 0, muted: false };

beforeEach(() => {
  sqlite.exec('DELETE FROM notification_events; DELETE FROM messages; DELETE FROM conversations; DELETE FROM device_preferences; DELETE FROM accounts;');
  sqlite.prepare("INSERT INTO accounts (pubkey, signer_type, added_at) VALUES (?, 'generated', 1)").run(ACCOUNT);
});
afterAll(() => sqlite.close());

function preference(key: string, value: string) {
  sqlite.prepare('INSERT OR REPLACE INTO device_preferences (key,value,updated_at) VALUES (?,?,1)').run(key, value);
}
async function stored(options: { accepted?: boolean; before?: NotificationConversationState | null; present?: boolean; eligible?: boolean; id?: string; handle?: Database } = {}) {
  const rumor = { id: options.id ?? 'first', pubkey: PEER, kind: 14, content: 'hello', created_at: 100, tags: [['p', ACCOUNT]] } as Rumor;
  const after = { ...empty, hasReplied: options.accepted ?? false, lastMessageId: rumor.id, unreadCount: 1 };
  await (options.handle ?? db).transaction(async tx => {
    await tx.insert(conversations).values({ accountPubkey: ACCOUNT, conversationKey: PEER,
      createdAt: 100, createdOrderAt: 100000, updatedAt: 100, updatedOrderAt: 100000,
      lastMessageId: rumor.id, lastMessageAt: 100, lastMessageOrderAt: 100000,
      unreadCount: 1, hasReplied: after.hasReplied }).onConflictDoNothing();
    await tx.insert(messages).values({ accountPubkey: ACCOUNT, conversationKey: PEER, id: rumor.id!,
      senderPubkey: PEER, kind: 14, content: rumor.content, createdAt: 100, orderAt: 100000, tags: rumor.tags, rumor });
    await recordNotificationEvent(tx, { accountPubkey: ACCOUNT, conversationKey: PEER, rumor,
      before: options.before ?? null, after, eligible: options.eligible ?? true, incoming: true, userPresent: options.present ?? true });
  });
  return rumor;
}

it.each([
  { name: 'first request', before: null, accepted: false, eligible: true, kind: 'request' },
  { name: 'empty reaction row', before: empty, accepted: false, eligible: true, kind: 'request' },
  { name: 'request follow-up', before: { ...empty, lastMessageId: 'old' }, accepted: false, eligible: true, kind: null },
  { name: 'deleted request restoration', before: { ...empty, deleted: true }, accepted: false, eligible: true, kind: null },
  { name: 'accepted message', before: empty, accepted: true, eligible: true, kind: 'message' },
  { name: 'history', before: null, accepted: false, eligible: false, kind: null },
])('uses one transition rule for $name', ({ before, accepted, eligible, kind }) => {
  expect(notificationKindForTransition({ before, after: { ...empty, hasReplied: accepted, unreadCount: 1, lastMessageId: 'new' },
    eligible, incoming: true, messageKind: 14 })).toBe(kind);
});

it('hands an extension-owned foreground insert to a fresh consumer without shared message objects', async () => {
  const original = await stored({ handle: fixture.createHandle() as Database });
  expect((await takeNotificationEvents(ACCOUNT, 'system')).events).toEqual([]);
  const claimed = (await takeNotificationEvents(ACCOUNT, 'foreground')).events;
  expect(claimed).toHaveLength(1);
  expect(claimed[0].event.kind).toBe('request');
  expect(claimed[0].message.rumor).toEqual(original);
  expect(claimed[0].message.rumor).not.toBe(original);
  expect((await takeNotificationEvents(ACCOUNT, 'foreground')).events).toEqual([]);
});

it('atomically grants only one claimant ownership', async () => {
  await stored();
  const [first, second] = await Promise.all([takeNotificationEvents(ACCOUNT, 'foreground'), takeNotificationEvents(ACCOUNT, 'foreground')]);
  expect(first.events.length + second.events.length).toBe(1);
});

it.each([true, false])('keeps history silent for accepted=%s', async accepted => {
  await stored({ accepted, eligible: false });
  expect((await db.select().from(notificationEvents))).toHaveLength(0);
});

it('commits notification provenance with the message or rolls back both', async () => {
  await expect(db.transaction(async tx => {
    const rumor = { id: 'rollback', pubkey: PEER, kind: 14, content: 'hello', created_at: 100, tags: [] } as Rumor;
    await tx.insert(messages).values({ accountPubkey: ACCOUNT, conversationKey: PEER, id: rumor.id!, senderPubkey: PEER,
      kind: 14, content: 'hello', createdAt: 100, orderAt: 100000, tags: [], rumor });
    await recordNotificationEvent(tx, { accountPubkey: ACCOUNT, conversationKey: PEER, rumor,
      before: null, after: { ...empty, unreadCount: 1, lastMessageId: rumor.id }, eligible: true, incoming: true, userPresent: true });
    throw new Error('rollback');
  })).rejects.toThrow('rollback');
  expect(await db.select().from(messages)).toHaveLength(0);
  expect(await db.select().from(notificationEvents)).toHaveLength(0);
});

it.each(['notifications.unreadIndicators', 'notifications.quietMessageRequests'])('does not queue disabled foreground requests: %s', async key => {
  preference(key, key.endsWith('unreadIndicators') ? '0' : '1');
  await stored();
  expect(await db.select().from(notificationEvents)).toHaveLength(0);
});

it('discards an event when its setting changes before delivery and never catches up later', async () => {
  await stored();
  preference('notifications.quietMessageRequests', '1');
  expect((await takeNotificationEvents(ACCOUNT, 'foreground')).events).toHaveLength(0);
  preference('notifications.quietMessageRequests', '0');
  expect((await takeNotificationEvents(ACCOUNT, 'foreground')).events).toHaveLength(0);
});

it.each(['read', 'accepted', 'muted', 'deleted'])('discards a request that is now %s', async state => {
  await stored();
  const column = { read: 'unread_count = 0', accepted: 'has_replied = 1', muted: 'muted = 1', deleted: 'deleted = 1' }[state];
  sqlite.exec(`UPDATE conversations SET ${column}`);
  expect((await takeNotificationEvents(ACCOUNT, 'foreground')).events).toHaveLength(0);
});

it('keeps a request event independent of its newest message', async () => {
  await stored({ id: 'first' });
  await stored({ id: 'second', before: { ...empty, lastMessageId: 'first' } });
  sqlite.exec("UPDATE conversations SET last_message_id = 'second'");
  const claimed = (await takeNotificationEvents(ACCOUNT, 'foreground')).events;
  expect(claimed.map(row => row.message.id)).toEqual(['first']);
});

it('pages a bounded snapshot without consuming newer arrivals', async () => {
  await stored({ accepted: true, id: 'seed' });
  const insertMessage = sqlite.prepare(`INSERT INTO messages
    (account_pubkey,id,conversation_key,sender_pubkey,kind,content,created_at,order_at,tags,rumor)
    VALUES (?,?,?,?,14,'message',100,100000,'[]','{}')`);
  const insertEvent = sqlite.prepare(`INSERT INTO notification_events
    (account_pubkey,conversation_key,message_id,kind,target,created_at)
    VALUES (?,?,?,'message','foreground',?)`);
  const append = (id: string) => {
    insertMessage.run(ACCOUNT, id, PEER, PEER);
    insertEvent.run(ACCOUNT, PEER, id, Date.now());
  };
  for (let index = 0; index < 129; index++) append(`burst-${index}`);
  const first = await takeNotificationEvents(ACCOUNT, 'foreground');
  expect(first.events).toHaveLength(128);
  expect(first.more).toBe(true);
  append('after-snapshot');
  const second = await takeNotificationEvents(ACCOUNT, 'foreground', first.throughId);
  expect(second.events).toHaveLength(2);
  expect(second.more).toBe(false);
  expect((await takeNotificationEvents(ACCOUNT, 'foreground')).events.map(row => row.message.id)).toEqual(['after-snapshot']);
});

it('expires old arrivals without reading message history', async () => {
  await stored();
  sqlite.prepare('UPDATE notification_events SET created_at = ?').run(Date.now() - 61000);
  expect((await takeNotificationEvents(ACCOUNT, 'foreground')).events).toEqual([]);
  expect(await db.select().from(notificationEvents)).toHaveLength(0);
});

it.each(['foreground', 'system'] as const)('never delivers expired %s events beyond the cleanup batch', async target => {
  const clock = jest.spyOn(Date, 'now').mockReturnValue(1_800_000_000_000);
  try {
    const present = target === 'foreground';
    for (let index = 0; index < 129; index++) {
      await stored({ accepted: true, present, id: `expired-${index}` });
    }
    sqlite.prepare('UPDATE notification_events SET created_at = ?').run(Date.now() - 60_001);
    // Fresh events must remain deliverable even while expired rows await cleanup.
    await stored({ accepted: true, present, id: 'fresh' });
    const batch = await takeNotificationEvents(ACCOUNT, target);
    expect(batch.events.map(row => row.message.id)).toEqual(['fresh']);
    expect(batch.more).toBe(false);
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM notification_events').get()).toEqual({ n: 1 });
    expect((await takeNotificationEvents(ACCOUNT, target)).events).toEqual([]);
    expect(await db.select().from(notificationEvents)).toHaveLength(0);
  } finally {
    clock.mockRestore();
  }
});
