import { db } from '@/db/client';

import {
  getMainInboxUnreadCount,
  refreshUnreadIndicator,
  unreadCountService,
  unreadCountStore,
} from '../unread-count.service';

const mockSetCount = jest.fn(async (_count: number) => {});
let mockTotal: number | string | null = 0;
let mockWhere: jest.Mock;
let mockShouldNotifyNow = false;
let mockDatabaseListener: ((event: { tableName?: string }) => void) | null = null;

jest.mock('@/db/client', () => ({
  db: {
    select: jest.fn(() => ({
      from: jest.fn(() => ({
        where: (...args: unknown[]) => mockWhere(...args),
      })),
    })),
  },
}));

const mockSelect = jest.mocked(db.select);

jest.mock('@/platform', () => ({
  platform: {
    database: {
      addChangeListener: jest.fn((listener: (event: { tableName?: string }) => void) => {
        mockDatabaseListener = listener;
        return () => {
          mockDatabaseListener = null;
        };
      }),
    },
    notifications: {
      shouldNotifyNow: () => mockShouldNotifyNow,
    },
  },
}));

jest.mock('@/services/unread-indicator.service', () => ({
  syncUnreadIndicator: (count: number) => mockSetCount(count),
}));

/** Whether the last aggregate query's where tree binds `value` as a SQL param
 * (drizzle wraps bound values in `Param` chunks, which carry an `encoder`). */
function lastWhereBindsParam(value: unknown): boolean {
  const stack: unknown[] = [mockWhere.mock.calls.at(-1)?.[0]];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node || typeof node !== 'object') continue;

    const record = node as { encoder?: unknown; value?: unknown; queryChunks?: unknown };
    if (record.encoder !== undefined && record.value === value) return true;
    if (Array.isArray(record.queryChunks)) stack.push(...record.queryChunks);
  }
  return false;
}

describe('unread count service', () => {
  beforeEach(() => {
    mockTotal = 0;
    mockShouldNotifyNow = false;
    mockWhere = jest.fn(async () => [{ total: mockTotal }]);
    mockSelect.mockClear();
    mockSetCount.mockClear();
  });

  afterEach(async () => {
    // Backstop cleanup: even a failing test must not leak its active
    // conversation (or pending refresh timer) into the next one.
    jest.useFakeTimers();
    unreadCountService.setActiveConversation(null);
    await jest.runAllTimersAsync();
    jest.useRealTimers();
  });

  it('normalizes the SQLite sum result to a number', async () => {
    mockTotal = '12';

    await expect(getMainInboxUnreadCount('account')).resolves.toBe(12);
  });

  it('excludes a conversation from the total when asked', async () => {
    await getMainInboxUnreadCount('account');
    expect(lastWhereBindsParam('peer-a')).toBe(false);

    await getMainInboxUnreadCount('account', 'peer-a');
    expect(lastWhereBindsParam('peer-a')).toBe(true);
  });

  it('refreshes platform chrome from the stored unread total', async () => {
    mockTotal = 7;

    await refreshUnreadIndicator('account');

    expect(mockSetCount).toHaveBeenCalledWith(7);
  });

  it('publishes one shared count and coalesces conversation transaction bursts', async () => {
    jest.useFakeTimers();
    mockTotal = 3;

    unreadCountService.setActiveAccount('active-account');
    await jest.runAllTimersAsync();

    expect(unreadCountStore.getState()).toEqual({
      accountPubkey: 'active-account',
      count: 3,
    });
    expect(mockSetCount).toHaveBeenLastCalledWith(3);

    mockSelect.mockClear();
    mockSetCount.mockClear();
    mockTotal = 8;
    mockDatabaseListener!({ tableName: 'conversations' });
    mockDatabaseListener!({ tableName: 'conversations' });
    mockDatabaseListener!({ tableName: 'conversations' });
    await jest.runAllTimersAsync();

    expect(mockSelect).toHaveBeenCalledTimes(1);
    expect(unreadCountStore.getState().count).toBe(8);
    expect(mockSetCount).toHaveBeenCalledWith(8);
  });

  it('leaves the open conversation out of the published count while present', async () => {
    jest.useFakeTimers();
    unreadCountService.setActiveAccount('active-account');
    await jest.runAllTimersAsync();
    mockWhere.mockClear();

    unreadCountService.setActiveConversation({
      accountPubkey: 'active-account',
      conversationKey: 'peer-a',
    });
    await jest.runAllTimersAsync();

    expect(mockWhere).toHaveBeenCalledTimes(1);
    expect(lastWhereBindsParam('peer-a')).toBe(true);

    // Re-setting the same conversation does not refresh again.
    unreadCountService.setActiveConversation({
      accountPubkey: 'active-account',
      conversationKey: 'peer-a',
    });
    await jest.runAllTimersAsync();
    expect(mockWhere).toHaveBeenCalledTimes(1);

    // Closing the chat restores the full aggregate.
    unreadCountService.setActiveConversation(null);
    await jest.runAllTimersAsync();
    expect(mockWhere).toHaveBeenCalledTimes(2);
    expect(lastWhereBindsParam('peer-a')).toBe(false);
  });

  it('keeps counting the open conversation while the user is not present', async () => {
    mockShouldNotifyNow = true;
    jest.useFakeTimers();
    unreadCountService.setActiveAccount('active-account');
    await jest.runAllTimersAsync();
    mockWhere.mockClear();

    unreadCountService.setActiveConversation({
      accountPubkey: 'active-account',
      conversationKey: 'peer-a',
    });
    await jest.runAllTimersAsync();

    expect(mockWhere).toHaveBeenCalledTimes(1);
    expect(lastWhereBindsParam('peer-a')).toBe(false);
  });
});
