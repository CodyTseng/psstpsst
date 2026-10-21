import { useEffect } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { useApplicationFavorite } from '../use-application-favorite';
import { exploreService } from '@/services/explore/service';
import { showToast } from '@/stores/toast.store';
import type { ExploreEntry } from '@/services/explore/model';

const app: ExploreEntry = { key: 'app', address: 'https://example.com/', title: 'Notes', kind: 'website', description: '', servers: [], required: [], desktopPosition: null, lastUsedAt: null };
let mockState = { account: 'account' as string | null, loaded: true, entries: [] as ExploreEntry[] };
jest.mock('@/stores/explore.store', () => ({ getExploreState: () => mockState }));
jest.mock('@/services/explore/service', () => ({ exploreService: { activate: jest.fn(), move: jest.fn() } }));
jest.mock('@/stores/toast.store', () => ({ showToast: jest.fn() }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
let toggle: ReturnType<typeof useApplicationFavorite>;
function Probe() {
  const favorite = useApplicationFavorite('account', 'detail');
  useEffect(() => { toggle = favorite; }, [favorite]);
  return null;
}
let renderer: ReactTestRenderer;
beforeEach(async () => {
  jest.clearAllMocks(); mockState = { account: 'account', loaded: true, entries: [] };
  jest.mocked(exploreService.move).mockResolvedValue(undefined);
  await act(async () => { renderer = create(<Probe />); });
});
afterEach(() => { act(() => renderer.unmount()); });

it('adds a new favorite after existing favorites and confirms success', async () => {
  mockState.entries = [{ ...app, key: 'other', desktopPosition: 0 }];
  await act(async () => { await toggle(app, true); });
  expect(exploreService.move).toHaveBeenCalledWith(app, 1, 'account');
  expect(showToast).toHaveBeenCalledWith('napplets.favorited', { target: 'detail' });
});
it('uses the current saved entry and confirms unfavoriting', async () => {
  const saved = { ...app, desktopPosition: 2, lastUsedAt: 100 };
  mockState.entries = [saved];
  await act(async () => { await toggle(app, false); });
  expect(exploreService.move).toHaveBeenCalledWith(saved, null, 'account');
  expect(showToast).toHaveBeenCalledWith('napplets.unfavorited', { target: 'detail' });
});
it('loads favorite state before changing an app opened outside Explore', async () => {
  mockState = { account: null, loaded: false, entries: [] };
  jest.mocked(exploreService.activate).mockImplementation(async () => { mockState = { account: 'account', loaded: true, entries: [{ ...app, desktopPosition: 0 }] }; });
  await act(async () => { await toggle(app, true); });
  expect(exploreService.activate).toHaveBeenCalledWith('account');
  expect(exploreService.move).toHaveBeenCalledWith(mockState.entries[0], 0, 'account');
});
it('shows an error instead of a success toast when persistence fails', async () => {
  jest.mocked(exploreService.move).mockRejectedValue(new Error('failed'));
  await act(async () => { await toggle(app, true); });
  expect(showToast).toHaveBeenCalledTimes(1);
  expect(showToast).toHaveBeenCalledWith('napplets.request_failed', { target: 'detail' });
});
