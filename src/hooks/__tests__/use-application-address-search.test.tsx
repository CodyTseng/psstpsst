import { useEffect } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { naddrEncode } from 'nostr-tools/nip19';
import { useApplicationAddressSearch } from '../use-application-address-search';
import { resolveApplicationAddress } from '@/services/explore/address-search';
import { cacheApplicationAddress, type ApplicationAddressCache } from '@/services/explore/discovery';
import type { ExploreEntry } from '@/services/explore/model';

jest.mock('@/services/napplet/network', () => ({ NappletNetwork: jest.fn() }));
jest.mock('@/services/explore/repository', () => ({ readEntries: jest.fn() }));
jest.mock('@/services/explore/address-search', () => ({ ...jest.requireActual('@/services/explore/address-search'), resolveApplicationAddress: jest.fn() }));
jest.mock('@/services/explore/discovery', () => ({ cacheApplicationAddress: jest.fn() }));
let mockSaved = { account: 'account', entries: [] as ExploreEntry[] };
jest.mock('@/stores/explore.store', () => ({ useExplore: () => mockSaved }));
const address = (identifier: string) => naddrEncode({ kind: 35130, pubkey: 'a'.repeat(64), identifier });
const entry = (identifier: string) => ({ key: address(identifier), address: address(identifier), title: identifier, kind: 'napp' }) as ExploreEntry;
const cache: ApplicationAddressCache = { account: null, entries: [] };
const empty: ExploreEntry[] = [];
let state: ReturnType<typeof useApplicationAddressSearch>;
function Harness({ value, entries = empty }: { value: string; entries?: ExploreEntry[] }) {
  const current = useApplicationAddressSearch('account', value, entries, cache);
  useEffect(() => { state = current; }, [current]);
  return null;
}
let renderer: ReactTestRenderer;
beforeEach(() => { jest.useFakeTimers(); jest.clearAllMocks(); mockSaved = { account: 'account', entries: [] }; });
afterEach(() => { act(() => renderer?.unmount()); jest.useRealTimers(); });

it('shows a local saved application immediately without scheduling network resolution', async () => {
  const app = entry('local');
  mockSaved.entries = [app];
  await act(async () => { renderer = create(<Harness value={address('local')} />); });
  expect(state!).toMatchObject({ active: true, entry: app, loading: false });
  await act(async () => { await jest.advanceTimersByTimeAsync(300); });
  expect(resolveApplicationAddress).not.toHaveBeenCalled();
});

it('cancels stale lookups and never caches late results over a newer address', async () => {
  let finishOld!: (entry: ExploreEntry) => void;
  jest.mocked(resolveApplicationAddress).mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve; }))
    .mockResolvedValueOnce(entry('new'));
  await act(async () => { renderer = create(<Harness value={address('old')} />); });
  expect(state!.loading).toBe(true);
  await act(async () => { await jest.advanceTimersByTimeAsync(300); });
  const oldSignal = jest.mocked(resolveApplicationAddress).mock.calls[0][3];
  await act(async () => { renderer.update(<Harness value={address('new')} />); });
  expect(oldSignal.aborted).toBe(true);
  await act(async () => { await jest.advanceTimersByTimeAsync(300); });
  expect(state!.entry?.title).toBe('new');
  await act(async () => { finishOld(entry('old')); });
  expect(state!.entry?.title).toBe('new');
  expect(cacheApplicationAddress).toHaveBeenCalledTimes(1);
  expect(cacheApplicationAddress).toHaveBeenCalledWith('account', entry('new'));
});

it('cancels the debounce when the user switches back to a keyword', async () => {
  await act(async () => { renderer = create(<Harness value={address('app')} />); });
  await act(async () => { renderer.update(<Harness value="photo" />); });
  await act(async () => { await jest.advanceTimersByTimeAsync(300); });
  expect(state!.active).toBe(false);
  expect(resolveApplicationAddress).not.toHaveBeenCalled();
});

it('replaces an earlier lookup error when the app subsequently appears in local data', async () => {
  jest.mocked(resolveApplicationAddress).mockRejectedValueOnce(new Error('napplets.not_found'));
  await act(async () => { renderer = create(<Harness value={address('app')} />); });
  await act(async () => { await jest.advanceTimersByTimeAsync(300); });
  expect(state!.error).toBe('napplets.not_found');
  await act(async () => { renderer.update(<Harness value={address('app')} entries={[entry('app')]} />); });
  expect(state!.entry?.title).toBe('app');
  expect(state!.error).toBeUndefined();
});
