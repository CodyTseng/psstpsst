import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import type { DatabaseSync } from 'node:sqlite';

import { db } from '@/db/client';
import { conversations, savedGroups } from '@/db/schema';
import { useMainInboxConversations, useRequestConversations } from '../use-conversations';
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
    sqlite.exec('DELETE FROM conversations; DELETE FROM saved_groups');
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
});
