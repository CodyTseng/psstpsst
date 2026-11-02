import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { checkForAppUpdates } from '@/services/app-update';
import type { AppUpdateStatus } from '@/platform';
import { AppUpdatePromptHost } from '../AppUpdatePromptHost';

let mockCurrentStatus: AppUpdateStatus = { state: 'idle' };
const mockCheck = jest.fn(async () => mockCurrentStatus);
const mockOpen = jest.fn(async () => {});
const mockShowToast = jest.fn();
jest.mock('@/lib/platform', () => ({ IS_ELECTRON: true }));
jest.mock('@/platform', () => ({ platform: { appUpdate: { check: () => mockCheck(), openWindow: () => mockOpen() } } }));
jest.mock('@/stores/toast.store', () => ({ showToast: (...args: unknown[]) => mockShowToast(...args) }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

let renderer: ReactTestRenderer;
beforeEach(async () => {
  mockCurrentStatus = { state: 'idle' };
  mockCheck.mockReset().mockImplementation(async () => mockCurrentStatus);
  mockOpen.mockClear(); mockShowToast.mockClear();
  await act(async () => { renderer = create(<AppUpdatePromptHost />); });
});
afterEach(() => act(() => renderer.unmount()));

it('does not open a window or check on mounting', () => {
  expect(mockOpen).not.toHaveBeenCalled(); expect(mockCheck).not.toHaveBeenCalled();
});
it('does not open a window while checking', async () => {
  let finish!: (status: AppUpdateStatus) => void;
  mockCheck.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const pending = checkForAppUpdates();
  expect(mockOpen).not.toHaveBeenCalled();
  finish({ state: 'available', version: '1.2.0' });
  await pending;
  expect(mockOpen).toHaveBeenCalledTimes(1);
});
it.each<AppUpdateStatus>([
  { state: 'available', version: '1.2.0' },
  { state: 'downloading', version: '1.2.0', percent: 45 },
  { state: 'downloaded', version: '1.2.0' },
  { state: 'error', version: '1.2.0', phase: 'download' },
])('opens the independent window for $state, including skipped versions', async status => {
  mockCurrentStatus = status;
  await checkForAppUpdates();
  expect(mockOpen).toHaveBeenCalledTimes(1);
  expect(mockShowToast).not.toHaveBeenCalled();
});
it('reports an up-to-date result without opening a window', async () => {
  await checkForAppUpdates();
  expect(mockShowToast).toHaveBeenCalledWith('app_update.up_to_date');
  expect(mockOpen).not.toHaveBeenCalled();
});
it('reports failure without claiming the app is current or opening a window', async () => {
  mockCheck.mockRejectedValueOnce(new Error('offline'));
  await checkForAppUpdates();
  expect(mockShowToast).toHaveBeenCalledWith('app_update.check_failed', { variant: 'error' });
  expect(mockOpen).not.toHaveBeenCalled();
});
it('coalesces concurrent manual checks', async () => {
  await Promise.all([checkForAppUpdates(), checkForAppUpdates()]);
  expect(mockCheck).toHaveBeenCalledTimes(1);
});
