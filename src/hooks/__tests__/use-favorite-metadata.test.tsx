import { useEffect } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { useFavoriteMetadata } from '../use-favorite-metadata';
import { resolveFavoriteMetadata } from '@/services/explore/favorite-metadata';
import type { ExploreEntry } from '@/services/explore/model';
jest.mock('@/services/explore/favorite-metadata', () => ({
  needsFavoriteMetadata: (app: ExploreEntry) => app.kind !== 'website' && !app.manifest,
  resolveFavoriteMetadata: jest.fn(),
}));
const app: ExploreEntry = { key: 'app', address: 'address', title: 'Reference', kind: 'napp', servers: [], required: [], description: '', desktopPosition: 1, lastUsedAt: null };
let state: ReturnType<typeof useFavoriteMetadata>;
function Probe({ entry = app, account = 'account' }: { entry?: ExploreEntry; account?: string }) {
  const current = useFavoriteMetadata(entry, account);
  useEffect(() => { state = current; }, [current]);
  return null;
}
let renderer: ReactTestRenderer;
afterEach(() => { act(() => renderer?.unmount()); jest.clearAllMocks(); });
it('keeps a signed reference unresolved until verified metadata arrives', async () => {
  let finish!: (entry: ExploreEntry) => void;
  jest.mocked(resolveFavoriteMetadata).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await act(async () => { renderer = create(<Probe />); });
  expect(state.unresolved).toBe(true);
  await act(async () => { finish({ ...app, title: 'Notes', manifest: {} as ExploreEntry['manifest'], desktopPosition: 4 }); });
  expect(state.unresolved).toBe(false);
  expect(state.entry).toMatchObject({ title: 'Notes', desktopPosition: 1 });
});
it('does not launch or drop a saved reference when metadata lookup fails', async () => {
  jest.mocked(resolveFavoriteMetadata).mockRejectedValueOnce(new Error('napplets.not_found'));
  await act(async () => { renderer = create(<Probe />); });
  expect(state).toMatchObject({ unresolved: true, entry: app, error: 'napplets.not_found' });
});
it('aborts an old account lookup and ignores its late result', async () => {
  let finish!: (entry: ExploreEntry) => void;
  jest.mocked(resolveFavoriteMetadata).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  jest.mocked(resolveFavoriteMetadata).mockResolvedValueOnce({ ...app, title: 'New', manifest: {} as ExploreEntry['manifest'] });
  await act(async () => { renderer = create(<Probe />); });
  const oldSignal = jest.mocked(resolveFavoriteMetadata).mock.calls[0][2];
  await act(async () => { renderer.update(<Probe account="other" />); });
  await act(async () => { finish({ ...app, title: 'Old' }); });
  expect(oldSignal.aborted).toBe(true);
  expect(state.entry?.title).toBe('New');
});
