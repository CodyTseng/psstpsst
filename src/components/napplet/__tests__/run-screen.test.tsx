import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { PRIMARY_PANE_RESET_MARKER } from '@/components/navigation/responsive-stack-router';
import { NappletSurface } from '@/platform/napplet-surface';
import { router } from 'expo-router';
import { usePreventRemove } from 'expo-router/react-navigation';
import { useFocusedOverlayDismiss } from '@/components/common/use-focused-overlay-dismiss';
import { ScreenHeader } from '@/components/common/ScreenHeader';
import { nappletService } from '@/services/napplet/service';
import { AppButton } from '@/components/common/AppButton';
import { ActivityIndicator, ScrollView } from 'react-native';
import { ApplicationIcon } from '@/components/napplet/ApplicationIcon';
import NappletRunScreen from '../../../app/(app)/napplet-run';
import { AppScreen } from '@/components/common/AppScreen';
import { AppProgressBar } from '@/components/common/AppProgressBar';
import type { ArtifactProgress } from '@/services/napplet/artifacts';
import { AppText } from '@/components/common/AppText';
import { showToast } from '@/stores/toast.store';

jest.mock('@/stores/toast.store', () => ({ showToast: jest.fn() }));
jest.mock('@/components/common/DesktopWindowFrame', () => ({ useDesktopWindowTitlebar: jest.fn() }));
jest.mock('lucide-react-native/icons/external-link', () => () => null);

const mockDispatch = jest.fn();
let mockFocused = true;
let mockSharing = false;
let mockOverlayActive = false;
let mockPanel: object | null = null;
let mockLaunching = false;
let mockRunId = 1;
let mockLaunch: { release: { title: string }; pending: boolean; showLoading?: boolean; download?: ArtifactProgress; error: string | null } | null = null;
let mockRunning: object | null = { release: { title: 'App' }, containerId: 'test' };
jest.mock('expo-router', () => ({ router: { back: jest.fn() }, useFocusEffect: jest.fn(), useLocalSearchParams: () => ({ runId: '1' }), useNavigation: () => ({ dispatch: mockDispatch }) }));
jest.mock('expo-router/react-navigation', () => ({ useIsFocused: () => mockFocused, usePreventRemove: jest.fn() }));
jest.mock('@/components/common/use-focused-overlay-dismiss', () => ({ useFocusedOverlayDismiss: jest.fn() }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('lucide-react-native/icons/x', () => () => null);
jest.mock('lucide-react-native/icons/ellipsis', () => () => null);
jest.mock('@solar-icons/react-native/category/arrows-action/Linear/SquareTopDown', () => ({ SquareTopDown: () => null }), { virtual: true });
jest.mock('@/components/share/ForwardTargetScreen', () => ({ ForwardTargetScreen: () => null }));
jest.mock('@/components/common/AppScreen', () => ({ AppScreen: ({ children }: { children: React.ReactNode }) => children }));
jest.mock('@/components/common/ScreenHeader', () => ({ ScreenHeader: () => null, useScreenHeaderClearance: () => 56 }));
jest.mock('@/components/common/IconButton', () => ({ IconButton: () => null }));
jest.mock('@/components/common/AppText', () => ({ AppText: ({ children }: { children: React.ReactNode }) => children }));
jest.mock('@/components/common/AppButton', () => ({ AppButton: () => null }));
jest.mock('@/components/napplet/ApplicationIcon', () => ({ APPLICATION_ICON_SIZE: 64, ApplicationIcon: () => null }));
jest.mock('@/platform/napplet-surface', () => ({ NappletSurface: () => null }));
jest.mock('@/platform/napplet-appearance', () => ({ useNappletAppearance: (id?: string) => id === 'test'
  ? { background: '#121212', dark: true } : undefined }));
jest.mock('@/services/napplet/service', () => ({ nappletService: { stop: jest.fn(), goBack: jest.fn(async () => {}), openPanel: jest.fn(), startPreparedOpen: jest.fn(), retryOpen: jest.fn() } }));
jest.mock('@/stores/napplet.store', () => ({ useNapplets: () => ({ running: mockRunning, launching: mockLaunching, launch: mockLaunch, runId: mockRunId, panel: mockPanel, overlayActive: mockOverlayActive, sharing: mockSharing }) }));
jest.mock('@/theme', () => ({ contentWidth: { sheet: 480 }, radius: { full: 9999 }, spacing: { xs: 4, lg: 16, xl: 24 }, uiDensity: { iconButtonSize: 32, headerActionSize: 36, headerActionIconSize: 20 }, useThemeColors: () => ({ text: 'text', accent: 'accent' }) }));

beforeEach(() => {
  jest.clearAllMocks();
  mockFocused = true; mockSharing = false;
  mockOverlayActive = false; mockPanel = null;
  mockLaunching = false; mockLaunch = null; mockRunId = 1;
  mockRunning = { release: { title: 'App' }, containerId: 'test' };
});

it('keeps the app visible behind a sheet and blocks it until the exit finishes', () => {
  let renderer!: ReactTestRenderer;
  act(() => { renderer = create(<NappletRunScreen />); });
  const surface = renderer.root.findByType(NappletSurface);
  mockPanel = { page: 'about', release: { title: 'App' } }; mockOverlayActive = true;
  act(() => { renderer.update(<NappletRunScreen />); });
  expect(renderer.root.findByType(NappletSurface)).toBe(surface);
  expect(surface.props.visible).toBe(true);
  expect(surface.props.obscured).toBe(true);
  expect(useFocusedOverlayDismiss).toHaveBeenLastCalledWith(false, expect.any(Function));
  mockPanel = null;
  act(() => { renderer.update(<NappletRunScreen />); });
  expect(surface.props.visible).toBe(true);
  expect(surface.props.obscured).toBe(true);
  mockOverlayActive = false;
  act(() => { renderer.update(<NappletRunScreen />); });
  expect(surface.props.visible).toBe(true);
  expect(surface.props.obscured).toBe(false);
  act(() => renderer.unmount());
});

it('uses the live document canvas and releases status-bar ownership when unfocused', () => {
  let renderer!: ReactTestRenderer;
  act(() => { renderer = create(<NappletRunScreen />); });
  expect(renderer.root.findByType(AppScreen).props.appearance).toEqual({ background: '#121212', dark: true });
  mockFocused = false;
  act(() => { renderer.update(<NappletRunScreen />); });
  expect(renderer.root.findByType(AppScreen).props.statusBarActive).toBe(false);
  mockSharing = true;
  act(() => { renderer.update(<NappletRunScreen />); });
  expect(renderer.root.findByType(AppScreen).props.appearance).toBeUndefined();
  act(() => renderer.unmount());
});

it('shows a cold download until the mounted app presents its first frame', () => {
  mockRunning = null; mockLaunching = true;
  mockLaunch = { release: { title: 'New app' }, pending: false, showLoading: true, error: null };
  let renderer!: ReactTestRenderer;
  act(() => { renderer = create(<NappletRunScreen />); });
  expect(renderer.root.findAllByType(ActivityIndicator)).toHaveLength(1);
  expect(renderer.root.findAllByType(ApplicationIcon)).toHaveLength(1);
  mockRunning = { release: { title: 'New app' }, containerId: 'new' }; mockLaunching = false;
  act(() => { renderer.update(<NappletRunScreen />); });
  expect(renderer.root.findAllByType(NappletSurface)).toHaveLength(1);
  expect(renderer.root.findAllByType(ActivityIndicator)).toHaveLength(1);
  mockLaunch = { ...mockLaunch, showLoading: false };
  act(() => { renderer.update(<NappletRunScreen />); });
  expect(renderer.root.findAllByType(ActivityIndicator)).toHaveLength(0);
  expect(renderer.root.findAllByType(ApplicationIcon)).toHaveLength(0);
  act(() => renderer.unmount());
});

it('shows the container before starting a prepared app and cancels its startup timer on exit', () => {
  jest.useFakeTimers();
  let renderer!: ReactTestRenderer;
  try {
    mockRunning = null; mockLaunching = true;
    mockLaunch = { release: { title: 'Loading app' }, pending: true, error: null };
    act(() => { renderer = create(<NappletRunScreen />); });
    expect(renderer.root.findByType(ScreenHeader).props.title).toBe('Loading app');
    expect(renderer.root.findAllByType(ActivityIndicator)).toHaveLength(0);
    expect(JSON.stringify(renderer.toJSON())).not.toContain('applications.runtime_loading');
    expect(router.back).not.toHaveBeenCalled();
    expect(nappletService.startPreparedOpen).not.toHaveBeenCalled();
    act(() => { jest.runOnlyPendingTimers(); });
    expect(nappletService.startPreparedOpen).toHaveBeenCalledWith(1);
    act(() => renderer.unmount());
    jest.mocked(nappletService.startPreparedOpen).mockClear();
    act(() => { renderer = create(<NappletRunScreen />); });
    act(() => renderer.unmount());
    act(() => { jest.runOnlyPendingTimers(); });
    expect(nappletService.startPreparedOpen).not.toHaveBeenCalled();
  } finally { jest.useRealTimers(); }
});

it('keeps failed launches in the container and retries the same run', () => {
  mockRunning = null;
  mockLaunch = { release: { title: 'App' }, pending: false, error: 'applications.download_failed' };
  let renderer!: ReactTestRenderer;
  act(() => { renderer = create(<NappletRunScreen />); });
  expect(router.back).not.toHaveBeenCalled();
  const failure = renderer.root.findByType(AppText);
  expect(failure.props.children).toBe('applications.download_failed');
  expect(failure.props.accessibilityRole).toBe('alert');
  expect(showToast).not.toHaveBeenCalled();
  const retry = renderer.root.findByType(AppButton);
  expect(retry.props.label).toBe('common.retry');
  act(() => { retry.props.onPress(); });
  expect(nappletService.retryOpen).toHaveBeenCalledWith(1);
  mockLaunching = true;
  mockLaunch = { ...mockLaunch!, showLoading: true, error: null };
  act(() => { renderer.update(<NappletRunScreen />); });
  expect(JSON.stringify(renderer.toJSON())).not.toContain('applications.download_failed');
  expect(renderer.root.findAllByType(AppButton)).toHaveLength(0);
  expect(renderer.root.findAllByType(ActivityIndicator)).toHaveLength(1);
  act(() => renderer.unmount());
});

it('uses a localized fallback for unexpected launch errors', () => {
  mockRunning = null;
  mockLaunch = { release: { title: 'App' }, pending: false, error: 'The operation was aborted' };
  let renderer!: ReactTestRenderer;
  act(() => { renderer = create(<NappletRunScreen />); });
  expect(renderer.root.findByType(AppText).props.children).toBe('applications.request_failed');
  expect(showToast).not.toHaveBeenCalled();
  act(() => renderer.unmount());
});

it('places explicit close at the start and sends system back to the app', async () => {
  let renderer!: ReactTestRenderer;
  act(() => { renderer = create(<NappletRunScreen />); });
  const header = renderer.root.findByType(ScreenHeader);
  expect(header.props.left.props.accessibilityLabel).toBe('common.close');
  expect(header.props.right.props.accessibilityLabel).toBe('applications.runtime_more');
  const [active, back] = jest.mocked(useFocusedOverlayDismiss).mock.calls.at(-1)!;
  expect(active).toBe(true);
  await act(async () => { back(); });
  expect(nappletService.goBack).toHaveBeenCalledTimes(1);
  expect(nappletService.stop).not.toHaveBeenCalled();
  expect(usePreventRemove).toHaveBeenLastCalledWith(true, expect.any(Function));
  const preventedBack = jest.mocked(usePreventRemove).mock.calls.at(-1)![1];
  await act(async () => { preventedBack({ data: { action: { type: 'GO_BACK' } } }); });
  expect(nappletService.goBack).toHaveBeenCalledTimes(2);
  expect(mockDispatch).not.toHaveBeenCalled();
  act(() => { header.props.left.props.onPress(); });
  expect(nappletService.stop).toHaveBeenCalledTimes(1);
  act(() => renderer.unmount());
});

it('does not pop the share/profile route when the background app session stops', () => {
  let renderer!: ReactTestRenderer;
  act(() => { renderer = create(<NappletRunScreen />); });
  expect(router.back).not.toHaveBeenCalled();
  mockFocused = false; mockRunning = null;
  act(() => { renderer.update(<NappletRunScreen />); });
  expect(router.back).not.toHaveBeenCalled();
  mockFocused = true;
  act(() => { renderer.update(<NappletRunScreen />); });
  expect(router.back).toHaveBeenCalledTimes(1);
  act(() => renderer.unmount());
});

it('keeps the same app surface mounted while the embedded share picker is open', () => {
  mockFocused = true; mockRunning = { release: { title: 'App' }, containerId: 'original' };
  mockSharing = false;
  let renderer!: ReactTestRenderer;
  act(() => { renderer = create(<NappletRunScreen />); });
  const original = renderer.root.findByType(NappletSurface);
  mockSharing = true;
  act(() => { renderer.update(<NappletRunScreen />); });
  expect(renderer.root.findByType(NappletSurface)).toBe(original);
  expect(original.props.visible).toBe(false);
  expect(useFocusedOverlayDismiss).toHaveBeenLastCalledWith(false, expect.any(Function));
  mockSharing = false;
  act(() => { renderer.update(<NappletRunScreen />); });
  expect(renderer.root.findByType(NappletSurface)).toBe(original);
  expect(original.props.visible).toBe(true);
  act(() => renderer.unmount());
});

it('allows primary-pane selections to replace a running app instead of navigating its history', () => {
  let renderer!: ReactTestRenderer;
  act(() => { renderer = create(<NappletRunScreen />); });
  const handler = jest.mocked(usePreventRemove).mock.calls.at(-1)![1];
  const action = { type: 'PUSH', payload: { name: 'napplet-recent', singular: PRIMARY_PANE_RESET_MARKER } };
  act(() => { handler({ data: { action } }); });
  expect(mockDispatch).toHaveBeenCalledWith(action);
  expect(nappletService.goBack).not.toHaveBeenCalled();
  expect(router.back).not.toHaveBeenCalled();
  act(() => renderer.unmount());
});

it.each([undefined, 4096])('shows real download bytes with total=%s and no cancellation button', total => {
  mockRunning = null;
  mockLaunch = { release: { title: 'App' }, pending: false, showLoading: true, error: null,
    download: { phase: 'downloading', received: 1024, total } };
  let renderer!: ReactTestRenderer;
  act(() => { renderer = create(<NappletRunScreen />); });
  expect(JSON.stringify(renderer.toJSON())).toContain('1.0 KB');
  expect(renderer.root.findAllByType(AppButton)).toHaveLength(0);
  if (total) {
    expect(renderer.root.findByType(AppProgressBar).props.value).toBe(0.25);
    expect(JSON.stringify(renderer.toJSON())).toContain('25%');
  } else {
    expect(renderer.root.findAllByType(AppProgressBar)).toHaveLength(0);
    expect(renderer.root.findAllByType(ActivityIndicator)).toHaveLength(1);
  }
  mockLaunch = { ...mockLaunch, download: { phase: 'verifying', received: 4096, total: 4096 } };
  act(() => { renderer.update(<NappletRunScreen />); });
  expect(JSON.stringify(renderer.toJSON())).toContain('applications.runtime_verifying');
  expect(renderer.root.findAllByType(AppProgressBar)).toHaveLength(0);
  act(() => renderer.unmount());
});

it('labels multi-file progress as file readiness rather than a byte percentage', () => {
  mockRunning = null;
  mockLaunch = { release: { title: 'App' }, pending: false, showLoading: true, error: null,
    download: { phase: 'downloading', received: 2048, files: { ready: 2, total: 5 } } };
  let renderer!: ReactTestRenderer;
  act(() => { renderer = create(<NappletRunScreen />); });
  expect(renderer.root.findByType(AppProgressBar).props.value).toBe(0.4);
  expect(JSON.stringify(renderer.toJSON())).toContain('applications.runtime_files_ready');
  expect(JSON.stringify(renderer.toJSON())).toContain('applications.runtime_bytes_downloaded');
  expect(renderer.root.findAllByType(AppText).some(node => typeof node.props.children === 'string' && node.props.children.includes('40%'))).toBe(false);
  act(() => renderer.unmount());
});

it.each<ArtifactProgress>([
  { phase: 'preparing', received: 0 },
  { phase: 'downloading', received: 0 },
  { phase: 'downloading', received: 0, total: 4096 },
  { phase: 'downloading', received: 0, files: { ready: 0, total: 5 } },
])('keeps preparation free of zero-byte progress: %j', download => {
  mockRunning = null;
  mockLaunch = { release: { title: 'App' }, pending: false, showLoading: true, error: null, download };
  let renderer!: ReactTestRenderer;
  act(() => { renderer = create(<NappletRunScreen />); });
  expect(renderer.root.findAllByType(AppProgressBar)).toHaveLength(0);
  expect(renderer.root.findAllByType(ActivityIndicator)).toHaveLength(1);
  expect(JSON.stringify(renderer.toJSON())).toContain('applications.runtime_loading');
  expect(JSON.stringify(renderer.toJSON())).not.toContain('applications.runtime_downloading');
  expect(JSON.stringify(renderer.toJSON())).not.toContain('0 B');
  mockLaunch = { ...mockLaunch, download: { phase: 'downloading', received: 1024, total: 4096 } };
  act(() => { renderer.update(<NappletRunScreen />); });
  expect(renderer.root.findByType(AppProgressBar).props.value).toBe(0.25);
  expect(JSON.stringify(renderer.toJSON())).toContain('1.0 KB');
  act(() => renderer.unmount());
});

it('shows cache readiness without implying that zero bytes have downloaded', () => {
  mockRunning = null;
  mockLaunch = { release: { title: 'App' }, pending: false, showLoading: true, error: null,
    download: { phase: 'downloading', received: 0, files: { ready: 2, total: 5 } } };
  let renderer!: ReactTestRenderer;
  act(() => { renderer = create(<NappletRunScreen />); });
  expect(renderer.root.findByType(AppProgressBar).props.value).toBe(0.4);
  expect(JSON.stringify(renderer.toJSON())).toContain('applications.runtime_files_ready');
  expect(JSON.stringify(renderer.toJSON())).not.toContain('applications.runtime_bytes_downloaded');
  expect(JSON.stringify(renderer.toJSON())).not.toContain('0 B');
  act(() => renderer.unmount());
});

it('keeps the same centered icon while loading, progress and failure content changes', () => {
  mockRunning = null;
  mockLaunch = { release: { title: 'App' }, pending: false, showLoading: true, error: null };
  let renderer!: ReactTestRenderer;
  act(() => { renderer = create(<NappletRunScreen />); });
  const icon = renderer.root.findByType(ApplicationIcon);
  const anchor = icon.parent;
  const center = { flex: 1, alignItems: 'center', justifyContent: 'center' };
  const details = { position: 'absolute', top: '50%', marginTop: 48, bottom: 0, start: 0, end: 0 };
  expect(anchor!.props.style).toEqual(center);
  for (const download of [
    { phase: 'downloading' as const, received: 1024 },
    { phase: 'downloading' as const, received: 1024, total: 4096 },
    { phase: 'downloading' as const, received: 2048, files: { ready: 2, total: 5 } },
    { phase: 'verifying' as const, received: 4096, total: 4096 },
    { phase: 'preparing' as const, received: 4096 },
  ]) {
    mockLaunch = { ...mockLaunch!, download };
    act(() => { renderer.update(<NappletRunScreen />); });
    expect(renderer.root.findByType(ApplicationIcon)).toBe(icon);
    expect(icon.parent).toBe(anchor);
    expect(anchor!.props.style).toEqual(center);
    expect(renderer.root.findByType(ScrollView).props.style).toEqual(details);
  }
  mockLaunch = { ...mockLaunch!, showLoading: false, error: 'applications.download_failed' };
  act(() => { renderer.update(<NappletRunScreen />); });
  expect(renderer.root.findByType(ApplicationIcon)).toBe(icon);
  expect(icon.parent).toBe(anchor);
  expect(renderer.root.findByType(ScrollView).props.style).toEqual(details);
  expect(renderer.root.findByType(AppButton).props.label).toBe('common.retry');
  act(() => renderer.unmount());
});
