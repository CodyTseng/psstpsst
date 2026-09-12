import type { SQL } from 'drizzle-orm';
import { SQLiteSyncDialect } from 'drizzle-orm/sqlite-core';

import { conversations } from '@/db/schema';

import { markAllRequestConversationsAsRead } from '../conversation-read.service';

const mockWhere = jest.fn(async (_where: SQL | undefined) => {});
const mockSet = jest.fn((_values: unknown) => ({ where: mockWhere }));
const mockUpdate = jest.fn((_table: unknown) => ({ set: mockSet }));

jest.mock('@/db/client', () => ({
  db: {
    update: (table: unknown) => mockUpdate(table),
  },
}));

describe('conversation read service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('marks only this account\'s unread pending requests in one update', async () => {
    await markAllRequestConversationsAsRead('account');

    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockUpdate).toHaveBeenCalledWith(conversations);
    expect(mockSet).toHaveBeenCalledTimes(1);
    expect(mockSet).toHaveBeenCalledWith(
      expect.objectContaining({
        unreadCount: 0,
        lastReadAt: expect.anything(),
        lastReadOrderAt: expect.anything(),
        lastReadMessageId: expect.anything(),
      }),
    );

    const where = mockWhere.mock.calls[0]?.[0];
    expect(where).toBeDefined();
    const query = new SQLiteSyncDialect().sqlToQuery(where!);
    expect(query.sql).toBe(
      '("conversations"."account_pubkey" = ? and "conversations"."deleted" = ? and "conversations"."has_replied" = ? and "conversations"."unread_count" > ?)',
    );
    expect(query.params).toEqual(['account', 0, 0, 0]);
  });
});
