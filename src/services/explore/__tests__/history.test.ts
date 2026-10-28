import { ExploreHistory } from '../history';
import { forget, readHistoryPage, type HistoryPage } from '../repository';
import { websiteEntry } from '../model';
import { notifyApplicationChange } from '../application-changes';

jest.mock('../repository', () => ({ forget: jest.fn(async () => {}), readHistoryPage: jest.fn() }));
const entry = { ...websiteEntry('https://history.example/'), lastUsedAt: 100 };
beforeEach(() => jest.resetAllMocks());

it('does not read history until opened and coalesces overlapping page requests', async () => {
  const history = new ExploreHistory('account');
  expect(readHistoryPage).not.toHaveBeenCalled();
  let finish!: (page: HistoryPage) => void;
  jest.mocked(readHistoryPage).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const first = history.open(), repeated = history.loadMore();
  expect(readHistoryPage).toHaveBeenCalledTimes(1);
  expect(history.store.getState().loaded).toBe(false);
  const cursor = { key: entry.key, lastUsedAt: 100 };
  finish({ entries: [entry], cursor, hasMore: true });
  await Promise.all([first, repeated]);
  jest.mocked(readHistoryPage).mockResolvedValueOnce({ entries: [], cursor, hasMore: false });
  await history.loadMore();
  expect(readHistoryPage).toHaveBeenLastCalledWith('account', cursor);
  await history.loadMore();
  expect(readHistoryPage).toHaveBeenCalledTimes(2);
  expect(history.store.getState().entries).toEqual([entry]);
});

it('ignores requests completing after the page is closed', async () => {
  const history = new ExploreHistory('account');
  let finish!: (page: HistoryPage) => void;
  jest.mocked(readHistoryPage).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const pending = history.open();
  history.reset();
  finish({ entries: [entry], hasMore: false });
  await pending;
  expect(history.store.getState()).toMatchObject({ entries: [], loaded: false, loading: false });
  await history.loadMore();
  expect(readHistoryPage).toHaveBeenCalledTimes(1);
});

it('retains previous pages after a failure and retries the same cursor', async () => {
  const history = new ExploreHistory('account'), cursor = { key: entry.key, lastUsedAt: 100 };
  jest.mocked(readHistoryPage).mockResolvedValueOnce({ entries: [entry], cursor, hasMore: true })
    .mockRejectedValueOnce(new Error('busy')).mockResolvedValueOnce({ entries: [], hasMore: false });
  await history.open();
  await history.loadMore();
  expect(history.store.getState()).toMatchObject({ entries: [entry], error: 'applications.request_failed' });
  await history.loadMore();
  expect(readHistoryPage).toHaveBeenLastCalledWith('account', cursor);
  expect(history.store.getState().error).toBeNull();
});

it('does not resurrect a removed row when a pending page returns it', async () => {
  const history = new ExploreHistory('account');
  let finish!: (page: HistoryPage) => void;
  jest.mocked(readHistoryPage).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const pending = history.open();
  await history.remove(entry);
  finish({ entries: [entry], hasMore: false });
  await pending;
  expect(forget).toHaveBeenCalledWith('account', entry.key);
  expect(history.store.getState().entries).toEqual([]);
});

it('updates only the changed item across loaded pages and keeps the next-page cursor', async () => {
  const history = new ExploreHistory('account');
  const entries = Array.from({ length: 100 }, (_, index) => ({ ...websiteEntry(`https://app-${index}.example/`), lastUsedAt: 1000 - index }));
  const cursor = { key: entries[99].key, lastUsedAt: entries[99].lastUsedAt };
  jest.mocked(readHistoryPage).mockResolvedValueOnce({ entries: entries.slice(0, 50), cursor: { key: entries[49].key, lastUsedAt: entries[49].lastUsedAt }, hasMore: true })
    .mockResolvedValueOnce({ entries: entries.slice(50), cursor, hasMore: true })
    .mockResolvedValueOnce({ entries: [], cursor, hasMore: false });
  await history.open(); await history.loadMore();
  const before = history.store.getState();
  notifyApplicationChange({ ...entries[73], title: 'Updated title', description: 'Updated description', lastUsedAt: 9999, desktopPosition: 0 });
  const after = history.store.getState();
  expect(after).toMatchObject({ loaded: true, loading: false, hasMore: true });
  expect(after.entries).toHaveLength(100);
  entries.forEach((entry, index) => {
    if (index === 73) expect(after.entries[index]).toMatchObject({ title: 'Updated title', description: 'Updated description', lastUsedAt: entry.lastUsedAt, desktopPosition: null });
    else expect(after.entries[index]).toBe(before.entries[index]);
  });
  notifyApplicationChange({ ...entries[73], title: 'Updated title', description: 'Updated description' });
  expect(history.store.getState()).toBe(after);
  await history.loadMore();
  expect(readHistoryPage).toHaveBeenLastCalledWith('account', cursor);
  history.reset();
});
