import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import type { DatabaseSync } from 'node:sqlite';

import { db } from '@/db/client';
import { conversations, messages, savedGroups } from '@/db/schema';
import { useMainInboxConversations, useRequestConversations, type ConversationWithLast } from '../use-conversations';
import { useCommonGroups, useSavedGroups } from '../use-common-groups';

jest.mock('@/db/client', () => {
  const { DatabaseSync } = jest.requireActual('node:sqlite');
  const { drizzle } = jest.requireActual('drizzle-orm/sqlite-proxy');
  const { getTableConfig } = jest.requireActual('drizzle-orm/sqlite-core');
  const schema = jest.requireActual('@/db/schema');
  const sqlite = new DatabaseSync(':memory:');
  for (const table of [schema.conversations, schema.messages, schema.savedGroups]) {
    const config = getTableConfig(table);
    sqlite.exec(`CREATE TABLE "${config.name}" (${config.columns.map(
      (column: { name: string; getSQLType(): string }) =>
        `"${column.name}" ${column.getSQLType()}`,
    ).join(', ')})`);
  }
  return {
    sqlite,
    db: drizzle(async (query: string, params: unknown[], method: string) => {
      const statement = sqlite.prepare(query);
      statement.setReturnArrays(true);
      if (method === 'run') {
        statement.run(...params);
        return { rows: [] };
      }
      return { rows: method === 'get' ? statement.get(...params) : statement.all(...params) };
    }),
  };
});

jest.mock('@/platform', () => ({
  platform: { database: { addChangeListener: jest.fn(() => () => {}) } },
}));
jest.mock('@/stores/unread-count.store', () => ({
  useUnreadCount: jest.fn(() => 0),
  useUnreadIndicatorsEnabled: jest.fn(() => true),
}));

const sqlite = (jest.requireMock('@/db/client') as { sqlite: DatabaseSync }).sqlite;

describe('conversation preview ordering', () => {
  let renderer: ReactTestRenderer | undefined;
  let keys: string[];

  beforeEach(() => {
    sqlite.exec('DELETE FROM messages; DELETE FROM conversations; DELETE FROM saved_groups');
    keys = [];
  });
  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = undefined;
  });
  afterAll(() => sqlite.close());

  it.each(['inbox', 'requests', 'saved', 'common'] as const)(
    'orders %s by updated time, including creation time before the first message',
    async (list) => {
      const accountPubkey = `account-${list}`;
      for (const [key, messageAt, pinned, createdAt] of [
        ['monday', 200, false, 1],
        ['old-delayed', 100, false, 2],
        ['old-draft', 150, false, 3],
        ['pinned', 50, true, 4],
        ['empty-older', null, false, 125],
        ['empty-newer', null, false, 300],
      ] as const) {
        await db.insert(conversations).values({
          accountPubkey,
          conversationKey: key,
          createdAt,
          createdOrderAt: createdAt * 1000,
          updatedAt: messageAt ?? createdAt,
          updatedOrderAt: (messageAt ?? createdAt) * 1000,
          lastMessageAt: messageAt,
          lastMessageOrderAt: messageAt === null ? null : messageAt * 1000,
          hasReplied: list !== 'requests',
          pinned,
          groupId: key,
          membersBootstrapEventId: `bootstrap-${key}`,
          memberPubkeys: [accountPubkey, 'peer'],
        });
        await db.insert(savedGroups).values({ accountPubkey, groupId: key });
      }

      function Harness() {
        const inbox = useMainInboxConversations(accountPubkey);
        const requests = useRequestConversations(accountPubkey);
        const saved = useSavedGroups(accountPubkey);
        const common = useCommonGroups(accountPubkey, 'peer');
        const rows = list === 'inbox' ? inbox.conversations
          : list === 'requests' ? requests.conversations
            : list === 'saved' ? saved.groups : common.groups;
        keys = rows.map(({ conversation }) => conversation.conversationKey);
        return null;
      }
      await act(async () => { renderer = create(<Harness />); });

      expect(keys).toEqual(list === 'common'
        ? ['empty-newer', 'monday', 'old-draft', 'empty-older', 'old-delayed', 'pinned']
        : ['pinned', 'empty-newer', 'monday', 'old-draft', 'empty-older', 'old-delayed']);
    },
  );

  it.each([true, false])('looks up the pending reaction in the owning account only (accepted=%s)', async accepted => {
    const firstAccount = 'reaction-first';
    const otherAccount = 'reaction-other';
    for (const accountPubkey of [firstAccount, otherAccount]) {
      for (const [conversationKey, orderAt] of [['older', 100000], ['newer', 200000]] as const) {
        await db.insert(conversations).values({
          accountPubkey, conversationKey, createdAt: 100, createdOrderAt: 100000,
          updatedAt: orderAt / 1000, updatedOrderAt: orderAt, hasReplied: accepted,
          lastMessageId: conversationKey === 'older' ? 'message' : null,
          reactionPreviewPending: accountPubkey === firstAccount && conversationKey === 'older',
          reactionPreviewEventId: conversationKey === 'older' ? 'reaction' : null,
          reactionPreviewOrderAt: conversationKey === 'older' ? 300000 : null,
        });
      }
      for (const [id, content, kind] of [
        ['message', 'Original message', 14],
        ['reaction', accountPubkey === firstAccount ? '👍' : '👎', 7],
      ] as const) {
        const rumor = { id, content, kind, pubkey: 'older', created_at: 100, tags: [] };
        await db.insert(messages).values({
          accountPubkey, conversationKey: 'older', id, content, kind, senderPubkey: 'older',
          createdAt: 100, orderAt: 100000, tags: [], rumor,
        });
      }
    }

    let rows: ConversationWithLast[] = [];
    function Harness({ account }: { account: string }) {
      const inbox = useMainInboxConversations(account);
      const requests = useRequestConversations(account);
      rows = accepted ? inbox.conversations : requests.conversations;
      return null;
    }
    await act(async () => { renderer = create(<Harness account={firstAccount} />); });
    expect(rows.map(({ conversation }) => conversation.conversationKey)).toEqual(['newer', 'older']);
    expect(rows[1].reactionPreviewEvent).toEqual({ content: '👍', tags: [] });
    expect(rows[1].lastMessageContent).toBe('Original message');
    await act(async () => { renderer?.update(<Harness account={otherAccount} />); });
    expect(rows.map(({ conversation }) => conversation.accountPubkey)).toEqual([otherAccount, otherAccount]);
    expect(rows[1].reactionPreviewEvent).toBeNull();
  });

  it('includes previews and files with a future deadline and excludes expired and legacy timed messages', async () => {
    const accountPubkey = 'expiry-previews';
    const now = Math.floor(Date.now() / 1000);
    for (const [key, kind, expiresAt, tags] of [
      ['active-text', 14, now + 3600, [['expiration', String(now + 3600)]]],
      ['active-file', 15, now + 3600, [['expiration', String(now + 3600)]]],
      ['expired', 14, now - 1, [['expiration', String(now - 1)]]],
      ['legacy', 14, now + 3600, [['disappear-after', '3600']]],
    ] as const) {
      const messageTags = tags.map(tag => [...tag]);
      await db.insert(conversations).values({
        accountPubkey, conversationKey: key, createdAt: now, createdOrderAt: now * 1000,
        updatedAt: now, updatedOrderAt: now * 1000, lastMessageId: key,
        hasReplied: key !== 'active-file', groupId: key, membersBootstrapEventId: `bootstrap-${key}`,
        memberPubkeys: [accountPubkey, 'peer'],
      });
      await db.insert(savedGroups).values({ accountPubkey, groupId: key });
      await db.insert(messages).values({
        accountPubkey, conversationKey: key, id: key, content: key, kind, senderPubkey: accountPubkey,
        createdAt: now, orderAt: now * 1000, tags: messageTags,
        disappearAfterSeconds: 3600, expiresAt: expiresAt * 1000,
        rumor: { id: key, content: key, kind, pubkey: accountPubkey, created_at: now, tags: messageTags },
      });
    }

    let lists: ConversationWithLast[][] = [];
    function Harness() {
      lists = [
        useMainInboxConversations(accountPubkey).conversations,
        useRequestConversations(accountPubkey).conversations,
        useSavedGroups(accountPubkey).groups,
        useCommonGroups(accountPubkey, 'peer').groups,
      ];
      return null;
    }
    await act(async () => { renderer = create(<Harness />); });
    expect(lists.map(list => Object.fromEntries(list.map(row => [
      row.conversation.conversationKey, [row.lastMessageKind, row.lastMessageContent],
    ])))).toEqual([
      { 'active-text': [14, 'active-text'], expired: [null, null], legacy: [null, null] },
      { 'active-file': [15, 'active-file'] },
      { 'active-text': [14, 'active-text'], 'active-file': [15, 'active-file'], expired: [null, null], legacy: [null, null] },
      { 'active-text': [14, 'active-text'], 'active-file': [15, 'active-file'], expired: [null, null], legacy: [null, null] },
    ]);
  });
});
