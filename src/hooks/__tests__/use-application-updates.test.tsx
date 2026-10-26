import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { useApplicationUpdates } from '../use-application-updates';
import { platform } from '@/platform';
import type { ExploreEntry } from '@/services/explore/model';

let mockElectron = false;
let mockWindowFocused = true;
let mockFocusListener: ((focused: boolean) => void) | undefined;
jest.mock('@/lib/platform', () => ({ get IS_ELECTRON() { return mockElectron; } }));
let mockLatest: ((entry: ExploreEntry) => void) | undefined;
const mockRefresh = jest.fn(), mockStop = jest.fn();
jest.mock('@/services/explore/application-metadata', () => ({ watchApplicationMetadata: (_account: string, _entry: unknown, callback: typeof mockLatest) => {
  mockLatest = callback; return { refresh: mockRefresh, stop: mockStop };
} }));
jest.mock('@/platform', () => ({ platform: { appState: { currentState: () => 'active' },
  windowChrome: { getFocusState: async () => mockWindowFocused, addFocusListener: (listener: typeof mockFocusListener) => { mockFocusListener = listener; return () => {}; } },
  confirmationDialog: { confirm: jest.fn(async () => false) } } }));
jest.mock('@/stores/toast.store', () => ({ showToast: jest.fn() }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
const entry = { key: 'app', address: 'app', kind: 'napp', title: 'App', required: [], description: '', servers: [],
  desktopPosition: null, lastUsedAt: null, manifest: { id: 'old', created_at: 1, kind: 35130, pubkey: 'publisher', sig: 'signature', content: '', tags: [] } } as ExploreEntry;
const updated = { ...entry, manifest: { ...entry.manifest!, id: 'new', created_at: 2 } };
const restart = jest.fn(async () => {});
let renderer: ReactTestRenderer;
function Fixture({ active = true, blocked = false, app = entry }) {
  useApplicationUpdates({ entry: app, account: 'account', blocked, restart }, active); return null;
}
beforeEach(() => { jest.clearAllMocks(); mockElectron = false; mockWindowFocused = true; mockFocusListener = undefined; mockLatest = undefined; jest.mocked(platform.confirmationDialog.confirm).mockResolvedValue(false); });
afterEach(() => { act(() => renderer?.unmount()); });
it('defers an update prompt until the app is foreground and other overlays close', async () => {
  await act(async () => { renderer = create(<Fixture active={false} />); });
  act(() => { mockLatest!(updated); });
  expect(platform.confirmationDialog.confirm).not.toHaveBeenCalled();
  await act(async () => { renderer.update(<Fixture blocked />); });
  expect(platform.confirmationDialog.confirm).not.toHaveBeenCalled();
  await act(async () => { renderer.update(<Fixture />); });
  expect(platform.confirmationDialog.confirm).toHaveBeenCalledTimes(1);
  expect(restart).not.toHaveBeenCalled();
  await act(async () => { mockLatest!({ ...updated }); });
  expect(platform.confirmationDialog.confirm).toHaveBeenCalledTimes(1);
});
it('restarts only after acceptance and ignores older cache versions', async () => {
  jest.mocked(platform.confirmationDialog.confirm).mockResolvedValue(true);
  await act(async () => { renderer = create(<Fixture />); });
  await act(async () => { mockLatest!({ ...entry, manifest: { ...entry.manifest!, created_at: 0 } }); });
  expect(platform.confirmationDialog.confirm).not.toHaveBeenCalled();
  await act(async () => { mockLatest!(updated); });
  expect(restart).toHaveBeenCalledWith(updated);
});

it('coalesces another release arriving while the first restart decision is pending', async () => {
  let answer!: (value: boolean) => void;
  jest.mocked(platform.confirmationDialog.confirm).mockImplementationOnce(() => new Promise(resolve => { answer = resolve; }));
  await act(async () => { renderer = create(<Fixture />); });
  await act(async () => { mockLatest!(updated); });
  const newest = { ...updated, manifest: { ...updated.manifest, id: 'newest', created_at: 3 } };
  await act(async () => { mockLatest!(newest); });
  expect(platform.confirmationDialog.confirm).toHaveBeenCalledTimes(1);
  await act(async () => { answer(true); });
  expect(restart).toHaveBeenCalledWith(newest);
});


it('defers desktop prompts until the actual application window receives focus', async () => {
  mockElectron = true; mockWindowFocused = false;
  await act(async () => { renderer = create(<Fixture />); });
  await act(async () => { mockLatest!(updated); });
  expect(platform.confirmationDialog.confirm).not.toHaveBeenCalled();
  await act(async () => { mockWindowFocused = true; mockFocusListener!(true); });
  expect(platform.confirmationDialog.confirm).toHaveBeenCalledTimes(1);
});
