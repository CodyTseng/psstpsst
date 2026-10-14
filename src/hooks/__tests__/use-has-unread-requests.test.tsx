import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { useEffect } from 'react';
import type { DatabaseSync } from 'node:sqlite';

import { useHasUnreadRequests } from '../use-conversations';

let mockIndicatorsEnabled = true;
const mockUnsubscribe = jest.fn();
const mockAddChangeListener = jest.fn(() => mockUnsubscribe);
jest.mock('@/stores/unread-count.store', () => ({
  useUnreadCount: () => 0,
  useUnreadIndicatorsEnabled: () => mockIndicatorsEnabled,
}));
jest.mock('@/platform', () => ({
  platform: { database: { addChangeListener: () => mockAddChangeListener() } },
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
function Harness({ account }: { account: string }) {
  const hasUnreadRequests = useHasUnreadRequests(account);
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

it('checks for one unread request without counting all matches', async () => {
  seed('self', 'alice');
  seed('self', 'bob', 10);
  await render();
  expect(result).toBe(true);
  expect(queries).toHaveLength(1);
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
});

it('does not query or subscribe with indicators disabled or without an account', async () => {
  seed('self', 'alice');
  mockIndicatorsEnabled = false;
  await render();
  expect(result).toBe(false);
  expect(queries).toHaveLength(0);
  expect(mockAddChangeListener).not.toHaveBeenCalled();
  mockIndicatorsEnabled = true;
  await render('');
  expect(result).toBe(false);
  expect(queries).toHaveLength(0);
});

it('unsubscribes when disabled and rechecks current rows when enabled again', async () => {
  seed('self', 'alice');
  await render();
  expect(result).toBe(true);
  mockIndicatorsEnabled = false;
  await render();
  expect(result).toBe(false);
  expect(mockUnsubscribe).toHaveBeenCalledTimes(1);
  expect(queries).toHaveLength(1);
  sqlite.exec('UPDATE conversations SET unread_count = 0');
  mockIndicatorsEnabled = true;
  await render();
  expect(result).toBe(false);
  expect(queries).toHaveLength(2);
});
