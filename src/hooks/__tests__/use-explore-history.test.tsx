import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { useLayoutEffect } from 'react';
import { useExploreHistory } from '../use-explore-history';
import { readHistoryPage, type HistoryPage } from '@/services/explore/repository';
import { websiteEntry } from '@/services/explore/model';

let mockFocused = false;
let mockDatabaseListener: (event: { tableName?: string; external?: boolean }) => void;
jest.mock('expo-router', () => ({ useIsFocused: () => mockFocused }));
jest.mock('@/platform', () => ({ platform: { database: { addChangeListener: jest.fn(listener => { mockDatabaseListener = listener; return jest.fn(); }) } } }));
jest.mock('@/services/explore/repository', () => ({ readHistoryPage: jest.fn(), forget: jest.fn() }));
let current: ReturnType<typeof useExploreHistory>;
let renderer: ReactTestRenderer;
function Probe({ account }: { account: string }) {
  const state = useExploreHistory(account);
  useLayoutEffect(() => { current = state; }, [state]);
  return null;
}
beforeEach(() => { jest.clearAllMocks(); mockFocused = false; });
afterEach(() => { act(() => renderer.unmount()); });

it('reads history only when focused, then fetches additional pages on demand', async () => {
  const entry = { ...websiteEntry('https://recent.example/'), lastUsedAt: 100 };
  const cursor = { key: entry.key, lastUsedAt: 100 };
  jest.mocked(readHistoryPage).mockResolvedValueOnce({ entries: [entry], cursor, hasMore: true })
    .mockResolvedValueOnce({ entries: [], cursor, hasMore: false });
  await act(async () => { renderer = create(<Probe account="account" />); });
  expect(readHistoryPage).not.toHaveBeenCalled();
  mockFocused = true;
  await act(async () => { renderer.update(<Probe account="account" />); });
  expect(readHistoryPage).toHaveBeenCalledTimes(1);
  expect(current.entries).toEqual([entry]);
  await act(async () => { await current.loadMore(); });
  expect(readHistoryPage).toHaveBeenLastCalledWith('account', cursor);
});

it('does not expose a pending previous-account page after switching accounts', async () => {
  mockFocused = true;
  let finish!: (page: HistoryPage) => void;
  jest.mocked(readHistoryPage).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }))
    .mockResolvedValueOnce({ entries: [], hasMore: false });
  await act(async () => { renderer = create(<Probe account="first" />); });
  await act(async () => { renderer.update(<Probe account="second" />); });
  await act(async () => { finish({ entries: [{ ...websiteEntry('https://first.example/'), lastUsedAt: 100 }], hasMore: false }); });
  expect(current.entries).toEqual([]);
  expect(readHistoryPage).toHaveBeenLastCalledWith('second', undefined);
});

it('keeps loaded history pages when unrelated table or coarse database notifications arrive', async () => {
  mockFocused = true;
  const entries = Array.from({ length: 100 }, (_, index) => ({ ...websiteEntry(`https://history-${index}.example/`), lastUsedAt: 1000 - index }));
  const cursor = { key: entries[99].key, lastUsedAt: entries[99].lastUsedAt };
  jest.mocked(readHistoryPage).mockResolvedValueOnce({ entries: entries.slice(0, 50), hasMore: true })
    .mockResolvedValueOnce({ entries: entries.slice(50), cursor, hasMore: true });
  await act(async () => { renderer = create(<Probe account="account" />); });
  await act(async () => { await current.loadMore(); });
  const before = current.entries;
  jest.useFakeTimers();
  try {
    await act(async () => {
      mockDatabaseListener({ tableName: 'cached_events', external: true });
      mockDatabaseListener({ tableName: 'replaceable_events', external: true });
      mockDatabaseListener({ external: true });
      await jest.advanceTimersByTimeAsync(100);
    });
    expect(current.entries).toBe(before);
    expect(current.entries).toHaveLength(100);
    expect(readHistoryPage).toHaveBeenCalledTimes(2);
  } finally { jest.useRealTimers(); }
});
