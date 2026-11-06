import { useLayoutEffect } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { useExploreSearchHistory } from '../use-explore-search-history';
import { readSearchHistory } from '@/services/explore/search-history';
import { notifyExploreVisit } from '@/services/explore/visits';

jest.mock('@/db/client', () => ({ db: {} }));
let mockDatabaseListener: (event: { tableName: string }) => void;
jest.mock('@/platform', () => ({ platform: { database: { addChangeListener: jest.fn(listener => { mockDatabaseListener = listener; return jest.fn(); }) } } }));
jest.mock('@/services/explore/search-history', () => ({ ...jest.requireActual('@/services/explore/search-history'), readSearchHistory: jest.fn(async () => []) }));
let current: ReturnType<typeof useExploreSearchHistory>;
let renderer: ReactTestRenderer;
function Probe({ account = 'account', active = true, query = '' }: { account?: string; active?: boolean; query?: string }) {
  const state = useExploreSearchHistory(account, active, query);
  useLayoutEffect(() => { current = state; });
  return null;
}
beforeEach(() => { jest.useFakeTimers(); jest.clearAllMocks(); jest.mocked(readSearchHistory).mockResolvedValue([]); });
afterEach(() => { act(() => renderer?.unmount()); jest.useRealTimers(); });

it('reads once per activation and matches keystrokes in memory, hiding empty and exact input', async () => {
  jest.mocked(readSearchHistory).mockResolvedValue(['https://example.com/Notes', 'https://other.com/']);
  await act(async () => { renderer = create(<Probe active={false} />); });
  expect(readSearchHistory).not.toHaveBeenCalled();
  await act(async () => { renderer.update(<Probe />); });
  expect(current.suggestions).toEqual([]);
  await act(async () => { renderer.update(<Probe query="EXAMPLE.COM/no" />); });
  expect(current.suggestions).toEqual(['https://example.com/Notes']);
  for (const query of ['   ', 'https://example.com/Notes']) {
    await act(async () => { renderer.update(<Probe query={query} />); });
    expect(current.suggestions).toEqual([]);
  }
  expect(readSearchHistory).toHaveBeenCalledTimes(1);
});

it('refreshes committed visits and removals while discarding stale pending reads', async () => {
  let finish!: (addresses: string[]) => void;
  jest.mocked(readSearchHistory).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }))
    .mockResolvedValueOnce(['https://opened.example/']);
  await act(async () => { renderer = create(<Probe query="example" />); });
  await act(async () => { notifyExploreVisit({ accountPubkey: 'other', key: 'ignored' }); await jest.advanceTimersByTimeAsync(40); });
  expect(readSearchHistory).toHaveBeenCalledTimes(1);
  await act(async () => { notifyExploreVisit({ accountPubkey: 'account', key: 'https://opened.example/' }); await jest.advanceTimersByTimeAsync(40); });
  await act(async () => { finish(['https://stale.example/']); });
  expect(current.suggestions).toEqual(['https://opened.example/']);
  jest.mocked(readSearchHistory).mockResolvedValueOnce([]);
  await act(async () => { mockDatabaseListener({ tableName: 'explore_history' }); await jest.advanceTimersByTimeAsync(40); });
  expect(current.suggestions).toEqual([]);
});

it('hides the previous account history and discards late reads after switching', async () => {
  let finish!: (addresses: string[]) => void;
  jest.mocked(readSearchHistory).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }))
    .mockResolvedValueOnce(['https://other.example/']);
  await act(async () => { renderer = create(<Probe query="example" />); });
  await act(async () => { renderer.update(<Probe account="other" query="example" />); });
  await act(async () => { finish(['https://private.example/']); });
  expect(current.suggestions).toEqual(['https://other.example/']);
  await act(async () => { renderer.update(<Probe account="other" active={false} />); });
  expect(current.suggestions).toEqual([]);
});
