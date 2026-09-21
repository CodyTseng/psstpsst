import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import type { DatabaseSync } from 'node:sqlite';
import { useMessages } from '../use-messages';
jest.mock('@/i18n', () => ({ language: 'en', t: (key: string) => key }));

jest.mock('@/db/client', () => {
  const { DatabaseSync } = jest.requireActual('node:sqlite');
  const { drizzle } = jest.requireActual('drizzle-orm/sqlite-proxy');
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`CREATE TABLE messages (
    account_pubkey TEXT, id TEXT, conversation_key TEXT, sender_pubkey TEXT,
    kind INTEGER, content TEXT, created_at INTEGER, order_at INTEGER,
    reply_to_id TEXT, subject TEXT, tags TEXT, rumor TEXT, source_relays TEXT
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
jest.mock('@/platform', () => {
  const listeners = new Set();
  return {
    databaseListeners: listeners,
    platform: {
      database: {
        addChangeListener: jest.fn((listener) => {
          listeners.add(listener);
          return () => listeners.delete(listener);
        }),
      },
    },
  };
});

const { sqlite, queries } = jest.requireMock('@/db/client') as {
  sqlite: DatabaseSync;
  queries: string[];
};
const { databaseListeners } = jest.requireMock('@/platform') as {
  databaseListeners: Set<(event: { tableName?: string }) => void>;
};

async function notifyMessagesChanged() {
  for (const listener of databaseListeners) listener({ tableName: 'messages' });
  await new Promise((resolve) => setTimeout(resolve, 10));
}

describe('chat cursor pagination', () => {
  let renderer: ReactTestRenderer;
  let result: ReturnType<typeof useMessages>;
  function Harness() {
    result = useMessages('account', 'conversation');
    return null;
  }
  beforeEach(async () => {
    sqlite.exec('DELETE FROM messages');
    const insert = sqlite.prepare('INSERT INTO messages VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, NULL)');
    for (let i = 1; i <= 420; i++) {
      insert.run('account', String(i), 'conversation', 'peer', 14, 'hello', 1000, i, '[]', '{}');
    }
    // Reactions between messages must not decide sender/date grouping.
    insert.run('account', 'reaction', 'conversation', 'account', 7, '+', 999, 105.5, '[]', '{}');
    queries.length = 0;
    await act(async () => { renderer = create(<Harness />); });
  });
  afterEach(() => act(() => renderer.unmount()));
  afterAll(() => sqlite.close());

  it('prefetches and commits one stable database batch per history step', async () => {
    expect(result!.oldestBoundary).toEqual({ createdAt: 1000, senderPubkey: 'peer' });
    const latestIds = result!.bubbleMessages.map((row) => row.id);
    queries.length = 0;

    await act(async () => { result.loadOlder(); });
    expect(result!.messages).toHaveLength(60);
    expect(Object.keys(result!.presentationsByMessageId)).toHaveLength(15);
    expect(Object.keys(result!.bubbleRenderItemsById)).toHaveLength(15);
    const databaseReads = queries.filter((query) => query.includes('"rumor"')).length;
    expect(databaseReads).toBe(1);

    await act(async () => { result.loadOlder(); });
    expect(result!.messages).toHaveLength(120);
    expect(result!.hasMoreNewer).toBe(false);
    expect(result!.anchored).toBe(false);
    expect(result!.tailJumpVersion).toBe(0);
    expect(result!.oldestBoundary?.senderPubkey).toBe('peer');
    expect(new Set(result!.messages.map((row) => row.id)).size).toBe(result!.messages.length);
    expect(result!.bubbleMessages.slice(-latestIds.length).map((row) => row.id)).toEqual(latestIds);
    expect(queries.filter((query) => query.includes('"rumor"'))).toHaveLength(databaseReads + 1);
  });

  it('coalesces repeated requests and does not requery the live tail for every page', async () => {
    queries.length = 0;
    await act(async () => {
      result.loadOlder();
      result.loadOlder();
      result.loadOlder();
    });
    expect(result!.messages).toHaveLength(60);
    expect(queries.filter((query) => query.includes('"rumor"'))).toHaveLength(1);
    expect(result!.loadingOlder).toBe(false);
  });

  it('only increments the tail jump command for an explicit jump', async () => {
    await act(async () => result.loadOlder());
    expect(result!.tailJumpVersion).toBe(0);
    await act(async () => result.jumpToTail());
    expect(result!.tailJumpVersion).toBe(1);
    expect(result!.messages).toHaveLength(60);
  });

  it('uses retained cursor pages in both anchor directions', async () => {
    await act(async () => result.focusAnchor({ id: '210', orderAt: 210 }));
    expect(result!.anchored).toBe(true);
    expect(result!.windowLoaded).toBe(true);
    expect(result!.messages).toHaveLength(20);
    queries.length = 0;

    await act(async () => result.loadOlder());
    await act(async () => result.loadNewer());
    expect(result!.messages).toHaveLength(120);
    expect(queries.filter((query) => query.includes('"rumor"'))).toHaveLength(2);

    await act(async () => result.jumpToTail());
    queries.length = 0;
    await act(async () => result.focusAnchor({ id: '210', orderAt: 210 }));
    expect(result!.messages).toHaveLength(120);
    expect(queries.filter((query) => query.includes('"rumor"'))).toHaveLength(0);
  });

  it('retains the reading window across a burst larger than the live tail', async () => {
    await act(async () => result.loadOlder());
    const retainedIds = new Set(result!.messages.map((message) => message.id));
    const insert = sqlite.prepare('INSERT INTO messages VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, NULL)');
    for (let i = 421; i <= 500; i++) {
      insert.run('account', String(i), 'conversation', 'peer', 14, 'new', 1001, i, '[]', '{}');
    }
    await act(async () => notifyMessagesChanged());

    for (const id of retainedIds) {
      expect(result!.messages.some((message) => message.id === id)).toBe(true);
    }
    for (let id = 421; id <= 500; id++) {
      expect(result!.messages.some((message) => message.id === String(id))).toBe(true);
    }
    expect(result!.messages.at(-1)?.id).toBe('500');
  });
});
