import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { useEffect } from 'react';
import type { DatabaseSync } from 'node:sqlite';

import { useHasUnreadRequests, useUnreadRequestCount } from '../use-conversations';

let mockIndicatorsEnabled = true;
const mockUnsubscribe = jest.fn();
const mockChangeListeners = new Set<(event: { tableName?: string }) => void>();
const mockAddChangeListener = jest.fn((listener: (event: { tableName?: string }) => void) => {
  mockChangeListeners.add(listener);
  return () => {
    mockChangeListeners.delete(listener);
    mockUnsubscribe();
  };
});
jest.mock('@/stores/unread-count.store', () => ({
  useUnreadCount: () => 0,
  useUnreadIndicatorsEnabled: () => mockIndicatorsEnabled,
}));
jest.mock('@/platform', () => ({
  platform: { database: { addChangeListener: (listener: (event: { tableName?: string }) => void) => mockAddChangeListener(listener) } },
}));
jest.mock('@/db/client', () => {
  const { DatabaseSync } = jest.requireActual('node:sqlite');
  const { drizzle } = jest.requireActual('drizzle-orm/sqlite-proxy');
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`CREATE TABLE conversations (
    account_pubkey TEXT, conversation_key TEXT, deleted INTEGER,
    has_replied INTEGER, unread_count INTEGER
  )`);
  const queries: string[] = [];
  return {
    sqlite, queries,
    db: drizzle(async (query: string, params: unknown[]) => {
      queries.push(query);
      const statement = sqlite.prepare(query);
      statement.setReturnArrays(true);
      return { rows: statement.all(...params) };
    }),
  };
});

const { sqlite, queries } = jest.requireMock('@/db/client') as {
  sqlite: DatabaseSync; queries: string[];
};
let renderer: ReactTestRenderer | undefined;
let result = false;
let count = 0;
function Harness({ account }: { account: string }) {
  const hasUnreadRequests = useHasUnreadRequests(account);
  const unreadCount = useUnreadRequestCount(account);
  useEffect(() => { count = unreadCount; }, [unreadCount]);
  useEffect(() => { result = hasUnreadRequests; }, [hasUnreadRequests]);
  return null;
}
async function render(account = 'self') {
  await act(async () => {
    if (renderer) renderer.update(<Harness account={account} />);
    else renderer = create(<Harness account={account} />);
  });
}
function seed(account: string, key: string, unread = 1, replied = 0, deleted = 0) {
  sqlite.prepare('INSERT INTO conversations VALUES (?, ?, ?, ?, ?)')
    .run(account, key, deleted, replied, unread);
}

beforeEach(() => {
  sqlite.exec('DELETE FROM conversations');
  queries.length = 0;
  mockIndicatorsEnabled = true;
  mockAddChangeListener.mockClear();
  mockUnsubscribe.mockClear();
});
afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
});
afterAll(() => sqlite.close());

it('counts unread conversations while the dot query stops after one match', async () => {
  seed('self', 'alice');
  seed('self', 'bob', 10);
  await render();
  expect(result).toBe(true);
  expect(queries).toHaveLength(2);
  expect(count).toBe(2);
  expect(queries[0]).toMatch(/limit \?/i);
  expect(queries[0]).not.toMatch(/count\(/i);
});

it('excludes read, accepted, deleted, and other-account conversations', async () => {
  seed('self', 'read', 0);
  seed('self', 'accepted', 3, 1);
  seed('self', 'deleted', 2, 0, 1);
  seed('other', 'stranger');
  await render();
  expect(result).toBe(false);
  expect(count).toBe(0);
});

it('rejects retained results immediately on account switches', async () => {
  seed('self', 'alice');
  await render();
  expect(result).toBe(true);
  act(() => {
    renderer!.update(<Harness account="other" />);
  });
  expect(result).toBe(false);
  await render('other');
  expect(result).toBe(false);
  expect(count).toBe(0);
});

it('hides request counts and dots without querying when global indicators are disabled', async () => {
  seed('self', 'alice');
  mockIndicatorsEnabled = false;
  await render();
  expect(result).toBe(false);
  expect(count).toBe(0);
  expect(queries).toHaveLength(0);
  expect(mockAddChangeListener).not.toHaveBeenCalled();
});

it('does not query or subscribe without an account', async () => {
  await render('');
  expect(result).toBe(false);
  expect(count).toBe(0);
  expect(queries).toHaveLength(0);
  expect(mockAddChangeListener).not.toHaveBeenCalled();
});

it('unsubscribes when indicators are disabled and restores the request count when enabled', async () => {
  seed('self', 'alice');
  await render();
  expect(count).toBe(1);
  mockIndicatorsEnabled = false;
  await render();
  expect(result).toBe(false);
  expect(count).toBe(0);
  expect(mockUnsubscribe).toHaveBeenCalledTimes(2);
  mockIndicatorsEnabled = true;
  await render();
  expect(count).toBe(1);
  expect(queries).toHaveLength(4);
});

it('updates the Contacts count when a new request arrives in the foreground', async () => {
  await render();
  expect(count).toBe(0);
  await act(async () => {
    seed('self', 'new-stranger', 1);
    for (const listener of mockChangeListeners) listener({ tableName: 'conversations' });
    await new Promise(resolve => setTimeout(resolve, 20));
  });
  expect(count).toBe(1);
  expect(result).toBe(true);
  await act(async () => {
    sqlite.exec('UPDATE conversations SET unread_count = 20');
    for (const listener of mockChangeListeners) listener({ tableName: 'conversations' });
    await new Promise(resolve => setTimeout(resolve, 20));
  });
  expect(count).toBe(1);
});
