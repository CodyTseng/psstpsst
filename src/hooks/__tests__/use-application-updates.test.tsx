import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { useApplicationUpdates } from '../use-application-updates';
import { platform } from '@/platform';
import type { ExploreEntry } from '@/services/explore/model';

let mockElectron = false;
let mockWindowFocused = true;
let mockFocusListener: ((focused: boolean) => void) | undefined;
jest.mock('@/lib/platform', () => ({ get IS_ELECTRON() { return mockElectron; } }));
let mockLatest: ((entry: ExploreEntry) => void) | undefined;
let mockAppState = 'active';
let mockAppStateListener: ((state: string) => void) | undefined;
const mockResolve = jest.fn();
jest.mock('@/services/explore/application-metadata', () => ({ resolveApplicationMetadata: (...args: unknown[]) => mockResolve(...args) }));
jest.mock('@/platform', () => ({ platform: { appState: { currentState: () => mockAppState, addChangeListener: (listener: typeof mockAppStateListener) => { mockAppStateListener = listener; return () => {}; } },
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
beforeEach(() => {
  jest.useFakeTimers(); jest.clearAllMocks(); mockElectron = false; mockWindowFocused = true;
  mockAppState = 'active'; mockFocusListener = undefined; mockAppStateListener = undefined; mockLatest = undefined;
  mockResolve.mockImplementation(() => new Promise(resolve => { mockLatest = resolve; }));
  jest.mocked(platform.confirmationDialog.confirm).mockResolvedValue(false);
});
afterEach(() => { act(() => renderer?.unmount()); jest.useRealTimers(); });
async function startCheck() { await act(async () => { jest.advanceTimersByTime(0); }); }
it('defers an update prompt until the app is foreground and other overlays close', async () => {
  await act(async () => { renderer = create(<Fixture active={false} />); });
  expect(mockResolve).not.toHaveBeenCalled();
  await act(async () => { renderer.update(<Fixture blocked />); });
  await startCheck();
  await act(async () => { mockLatest!(updated); });
  expect(platform.confirmationDialog.confirm).not.toHaveBeenCalled();
  await act(async () => { renderer.update(<Fixture />); });
  expect(platform.confirmationDialog.confirm).toHaveBeenCalledTimes(1);
  expect(restart).not.toHaveBeenCalled();
  await act(async () => { renderer.update(<Fixture blocked />); renderer.update(<Fixture />); });
  expect(platform.confirmationDialog.confirm).toHaveBeenCalledTimes(1);
});
it('restarts only after acceptance', async () => {
  jest.mocked(platform.confirmationDialog.confirm).mockResolvedValue(true);
  await act(async () => { renderer = create(<Fixture />); });
  await startCheck();
  await act(async () => { mockLatest!(updated); });
  expect(restart).toHaveBeenCalledWith(updated);
});

it('ignores older versions returned by the opening check', async () => {
  await act(async () => { renderer = create(<Fixture />); });
  await startCheck();
  await act(async () => { mockLatest!({ ...entry, manifest: { ...entry.manifest!, created_at: 0 } }); });
  expect(platform.confirmationDialog.confirm).not.toHaveBeenCalled();
  expect(restart).not.toHaveBeenCalled();
});

it('defers desktop prompts until the actual application window receives focus', async () => {
  mockElectron = true; mockWindowFocused = false;
  await act(async () => { renderer = create(<Fixture />); });
  await startCheck();
  await act(async () => { mockLatest!(updated); });
  expect(platform.confirmationDialog.confirm).not.toHaveBeenCalled();
  await act(async () => { mockWindowFocused = true; mockFocusListener!(true); });
  expect(platform.confirmationDialog.confirm).toHaveBeenCalledTimes(1);
});

it('defers the check until opening completes and bypasses metadata freshness', async () => {
  await act(async () => { renderer = create(<Fixture active={false} />); });
  await startCheck();
  expect(mockResolve).not.toHaveBeenCalled();
  await act(async () => { renderer.update(<Fixture />); });
  expect(mockResolve).not.toHaveBeenCalled();
  await startCheck();
  expect(mockResolve).toHaveBeenCalledTimes(1);
  expect(mockResolve).toHaveBeenCalledWith('account', entry, expect.any(AbortSignal), { refresh: true, known: [entry] });
});

it('does not poll or recheck on focus, foreground or visibility changes', async () => {
  mockElectron = true;
  await act(async () => { renderer = create(<Fixture />); });
  await startCheck();
  await act(async () => { jest.advanceTimersByTime(7_200_000); });
  await act(async () => { mockWindowFocused = false; mockFocusListener!(false); });
  await act(async () => { mockWindowFocused = true; mockFocusListener!(true); });
  await act(async () => { mockAppState = 'background'; mockAppStateListener!('background'); });
  await act(async () => { mockAppState = 'active'; mockAppStateListener!('active'); });
  await act(async () => { renderer.update(<Fixture active={false} />); });
  await act(async () => { renderer.update(<Fixture />); });
  await startCheck();
  expect(mockResolve).toHaveBeenCalledTimes(1);
  await act(async () => { mockLatest!(updated); });
  expect(platform.confirmationDialog.confirm).toHaveBeenCalledTimes(1);
});

it('cancels a closed session and checks again on reopening', async () => {
  await act(async () => { renderer = create(<Fixture />); });
  await startCheck();
  const signal = mockResolve.mock.calls[0][2] as AbortSignal;
  const complete = mockLatest!;
  act(() => { renderer.unmount(); });
  expect(signal.aborted).toBe(true);
  await act(async () => { complete(updated); });
  expect(platform.confirmationDialog.confirm).not.toHaveBeenCalled();
  await act(async () => { renderer = create(<Fixture />); });
  await startCheck();
  expect(mockResolve).toHaveBeenCalledTimes(2);
});

it('silently leaves the current app running if the update check fails', async () => {
  mockResolve.mockRejectedValue(new Error('offline'));
  await act(async () => { renderer = create(<Fixture />); });
  await startCheck();
  expect(platform.confirmationDialog.confirm).not.toHaveBeenCalled();
  expect(restart).not.toHaveBeenCalled();
});

it.each(['website', 'snapshot'] as const)('does not check %s updates', async kind => {
  const app = kind === 'website' ? { ...entry, kind: 'website' as const } : { ...entry, manifest: { ...entry.manifest!, kind: 5129 } };
  await act(async () => { renderer = create(<Fixture app={app} />); });
  await startCheck();
  expect(mockResolve).not.toHaveBeenCalled();
});
