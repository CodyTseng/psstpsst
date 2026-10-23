import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { ActivityIndicator } from 'react-native';
import { naddrEncode } from 'nostr-tools/nip19';
import NappletsScreen from '../../../app/(app)/(tabs)/napplets';
import type { ExploreEntry } from '@/services/explore/model';
import { SearchTransition } from '@/components/search/SearchTransition';
import { SearchBar } from '@/components/search/SearchBar';
import { QrScanButton } from '@/components/common/QrScanButton';
import { IconButton } from '@/components/common/IconButton';
import { NappletGrid } from '../NappletGrid';
import { AppButton } from '@/components/common/AppButton';
import { AppText } from '@/components/common/AppText';
import { ScreenHeader } from '@/components/common/ScreenHeader';
import { SegmentedControl } from '@/components/common/SegmentedControl';
import { ExploreDiscovery } from '../ExploreDiscovery';
import { useExploreSearchHandoffStore } from '@/stores/explore-search-handoff.store';
import { useToastStore } from '@/stores/toast.store';
import { uiDensity } from '@/theme';
import { resolveApplicationAddress } from '@/services/explore/address-search';
import { exploreService } from '@/services/explore/service';
import { discoveryStore } from '@/services/explore/discovery';

const mockNavigate = jest.fn();
const mockTabsNavigation = { addListener: jest.fn(() => () => {}), getState: () => ({ index: 0, routes: [{ name: 'napplets' }] }) };
let mockHandoff: string | undefined;
let mockFocused = true;
let mockExplore: { account: string | null; loaded: boolean; entries: ExploreEntry[] } = { account: 'account', loaded: true, entries: [] };
jest.mock('expo-router', () => ({ useLocalSearchParams: () => ({ searchHandoff: mockHandoff }), useIsFocused: () => mockFocused, useNavigation: () => mockTabsNavigation, useRoute: () => ({ key: 'napplets' }) }));
jest.mock('@/platform', () => ({ platform: { napplet: {} } }));
jest.mock('@/services/explore/windows', () => ({ tryOpenApplicationWindow: jest.fn(async () => false) }));
jest.mock('@/services/napplet/network', () => ({ NappletNetwork: jest.fn() }));
jest.mock('@/services/explore/repository', () => ({ readEntries: jest.fn() }));
jest.mock('@/services/explore/service', () => ({ exploreService: { activate: jest.fn(async () => {}), loadFavoriteSearchMetadata: jest.fn(async () => {}), loadMoreFavorites: jest.fn(async () => {}), prepare: jest.fn(() => 7) } }));
jest.mock('@/services/explore/address-search', () => ({ ...jest.requireActual('@/services/explore/address-query'), resolveApplicationAddress: jest.fn() }));
jest.mock('@/services/napplet/service', () => ({ nappletService: { prepareOpen: jest.fn() } }));
jest.mock('@/hooks/use-explore-share', () => ({ useExploreShare: () => jest.fn() }));
jest.mock('@/stores/explore.store', () => ({ useExplore: () => mockExplore }));
jest.mock('@/stores/active-account.store', () => ({ useActiveAccount: (select: (state: { activePubkey: string }) => unknown) => select({ activePubkey: 'account' }) }));
jest.mock('@/components/navigation/primary-pane-navigation', () => ({ usePrimaryPaneNavigation: () => ({ open: mockNavigate }) }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, start: 0, end: 0 }) }));
jest.mock('react-i18next', () => { const t = (key: string) => key; return { useTranslation: () => ({ t }) }; });
jest.mock('@/stores/theme.store', () => ({ useThemeStore: (select: (state: object) => unknown) => select({ accent: 'blue' }) }));
jest.mock('@/components/common/AppScreen', () => ({ AppScreen: ({ children }: { children: React.ReactNode }) => children }));
jest.mock('@/components/common/ScreenHeader', () => ({ ScreenHeader: ({ left, right, below, titleControl }: { left?: React.ReactNode; right?: React.ReactNode; below?: React.ReactNode; titleControl?: React.ReactNode }) => <>{left}{right}{titleControl}{below}</>, useScreenHeaderClearance: () => 64 }));
jest.mock('@/components/search/SearchTransition', () => ({ SearchTransition: ({ active, contentActive, activeChrome, activeContent, children }: { active: boolean; contentActive: boolean; activeChrome: React.ReactNode; activeContent: React.ReactNode; children: React.ReactNode }) => <>{active ? activeChrome : null}{contentActive ? activeContent : children}</> }));
jest.mock('@/components/search/SearchBar', () => ({ SearchBar: 'SearchBar', SEARCH_BAR_SCREEN_GUTTER: 12 }));
jest.mock('@/components/common/IconButton', () => ({ IconButton: 'IconButton' }));
jest.mock('lucide-react-native/icons/rotate-ccw-clock', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/common/AppButton', () => ({ AppButton: 'Button' }));
jest.mock('@/components/common/AppText', () => ({ AppText: 'Text' }));
jest.mock('@/components/common/QrScanButton', () => ({ QrScanButton: 'ScanButton' }));
jest.mock('@/components/common/SegmentedControl', () => ({ SegmentedControl: 'Tabs' }));
jest.mock('@/components/napplet/ExploreDiscovery', () => ({ ExploreDiscovery: ({ header }: { header?: React.ReactNode }) => <>{header}</> }));
jest.mock('@/components/napplet/NappletGrid', () => ({ NappletGrid: ({ header }: { header?: React.ReactNode }) => <>{header}</> }));
jest.mock('@solar-icons/react-native/category/settings/Linear/Widget', () => ({ Widget: () => null }), { virtual: true });

let renderer: ReactTestRenderer;
beforeEach(async () => { jest.useFakeTimers(); jest.clearAllMocks(); discoveryStore.setState({ addressCache: { account: null, entries: [] } }); mockHandoff = undefined; mockFocused = true; mockExplore = { account: 'account', loaded: true, entries: [] }; useExploreSearchHandoffStore.setState({ pending: null }); await act(async () => { renderer = create(<NappletsScreen />); }); });
afterEach(() => { act(() => renderer?.unmount()); jest.useRealTimers(); });

it('does not flash a spinner or empty state for a quick local Favorites read', async () => {
  mockExplore = { account: 'account', loaded: false, entries: [] };
  await act(async () => { renderer.update(<NappletsScreen />); });
  await act(async () => { await jest.advanceTimersByTimeAsync(30); });
  expect(renderer.root.findAllByType(ActivityIndicator)).toHaveLength(0);
  expect(renderer.root.findAllByType(AppText).some(node => node.props.children === 'napplets.empty_title')).toBe(false);
  mockExplore = { account: 'account', loaded: true, entries: [{ key: 'saved', desktopPosition: 0 } as ExploreEntry] };
  await act(async () => { renderer.update(<NappletsScreen />); await jest.advanceTimersByTimeAsync(150); });
  expect(renderer.root.findAllByType(ActivityIndicator)).toHaveLength(0);
  expect(renderer.root.findAllByType(NappletGrid)).toHaveLength(1);
});

it('shows loading feedback when the local Favorites read remains pending', async () => {
  mockExplore = { account: 'account', loaded: false, entries: [] };
  await act(async () => { renderer.update(<NappletsScreen />); });
  await act(async () => { await jest.advanceTimersByTimeAsync(150); });
  expect(renderer.root.findAllByType(ActivityIndicator)).toHaveLength(1);
});

it('shows the grid when the local Favorites snapshot is ready', async () => {
  mockExplore = { account: 'account', loaded: true,
    entries: [{ key: 'favorite', title: 'Saved app', desktopPosition: 0, lastUsedAt: null } as ExploreEntry] };
  await act(async () => { renderer.update(<NappletsScreen />); });
  expect(renderer.root.findByType(NappletGrid).props.items).toEqual(mockExplore.entries);
});

it('uses the shared header-sized scanner and points empty Favorites to Discover', async () => {
  const scanner = renderer.root.findByType(QrScanButton);
  expect(renderer.root.findByType(ScreenHeader).props.right.type).toBe(QrScanButton);
  expect(renderer.root.findByType(ScreenHeader).props.title).toBeUndefined();
  expect(renderer.root.findByType(ScreenHeader).props.below).toBeUndefined();
  expect(renderer.root.findByType(ScreenHeader).props.belowHeight).toBeUndefined();
  expect(renderer.root.findByType(SearchBar).props.onPress).toEqual(expect.any(Function));
  expect(renderer.root.findByType(ScreenHeader).props.titleControl.type).toBe(SegmentedControl);
  expect(scanner.props).toMatchObject({ size: uiDensity.headerActionSize, iconSize: uiDensity.headerActionIconSize, variant: 'plain' });
  const discover = renderer.root.findByType(AppButton);
  expect(discover.props.label).toBe('napplets.discover');
  await act(async () => { discover.props.onPress(); });
  expect(renderer.root.findByType(ExploreDiscovery).props.query ?? '').toBe('');
  expect(mockNavigate).not.toHaveBeenCalled();
});

it('uses scrolling search headers in both modes and exits empty search on drag', async () => {
  const favorite = { key: 'favorite', desktopPosition: 0, lastUsedAt: null } as ExploreEntry;
  mockExplore.entries = [favorite];
  await act(async () => { renderer.update(<NappletsScreen />); });
  expect(renderer.root.findByType(NappletGrid).props.header.type).toBeDefined();
  await act(async () => { renderer.root.findByType(SearchBar).props.onPress(); });
  expect(renderer.root.findByType(SearchTransition).props.active).toBe(true);
  expect(renderer.root.findByType(SearchTransition).props.contentActive).toBe(false);
  await act(async () => { renderer.root.findByType(NappletGrid).props.onScrollBeginDrag(); });
  expect(renderer.root.findByType(SearchTransition).props.active).toBe(false);
  await act(async () => { renderer.root.findByType(SegmentedControl).props.onChange('discover'); });
  expect(renderer.root.findByType(ExploreDiscovery).props.header.type).toBeDefined();
  await act(async () => { renderer.root.findByType(SearchBar).props.onPress(); });
  await act(async () => { renderer.root.findByType(ExploreDiscovery).props.onScrollBeginDrag(); });
  expect(renderer.root.findByType(SearchTransition).props.active).toBe(false);
});

it.each(['https://example.com/app', 'http://example.com/app'])('opens scanned %s directly in the website runtime', async value => {
  await act(async () => { renderer.root.findByType(QrScanButton).props.onScanned(`  ${value}  `); });
  await act(async () => { await jest.advanceTimersByTimeAsync(0); });
  expect(renderer.root.findByType(SegmentedControl).props.value).toBe('favorites');
  expect(renderer.root.findByType(SearchBar).props.value).toBe('');
  expect(exploreService.prepare).toHaveBeenCalledWith(expect.objectContaining({ kind: 'website', address: value }), 'account');
  expect(mockNavigate).toHaveBeenCalledWith('/explore-run?runId=7');
  expect(resolveApplicationAddress).not.toHaveBeenCalled();
});

it.each([35129, 35130, 35128])('opens scanned kind-%s naddr details after verified resolution', async kind => {
  const value = naddrEncode({ kind, pubkey: 'a'.repeat(64), identifier: 'app' });
  const app = { key: value, title: 'App' } as ExploreEntry;
  jest.mocked(resolveApplicationAddress).mockResolvedValueOnce(app);
  await act(async () => { renderer.root.findByType(QrScanButton).props.onScanned(`nostr:${value}`); });
  await act(async () => { await jest.advanceTimersByTimeAsync(0); });
  expect(mockNavigate).toHaveBeenCalledWith(`/explore-details?key=${value}&catalog=1`);
  expect(discoveryStore.getState().addressCache.entries).toEqual([app]);
  expect(exploreService.prepare).not.toHaveBeenCalled();
  expect(renderer.root.findByType(SearchBar).props.value).toBe('');
});

it('ignores a late naddr result after a replacement scan', async () => {
  let finish!: (app: ExploreEntry) => void;
  jest.mocked(resolveApplicationAddress).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const value = naddrEncode({ kind: 35130, pubkey: 'a'.repeat(64), identifier: 'old' });
  await act(async () => { renderer.root.findByType(QrScanButton).props.onScanned(value); });
  await act(async () => { await jest.advanceTimersByTimeAsync(0); });
  const signal = jest.mocked(resolveApplicationAddress).mock.calls[0][3];
  await act(async () => { renderer.root.findByType(QrScanButton).props.onScanned('https://example.com/new'); });
  await act(async () => { await jest.advanceTimersByTimeAsync(0); });
  await act(async () => { finish({ key: value } as ExploreEntry); });
  expect(signal.aborted).toBe(true);
  expect(mockNavigate).toHaveBeenCalledTimes(1);
  expect(mockNavigate).toHaveBeenCalledWith('/explore-run?runId=7');
  expect(discoveryStore.getState().addressCache.entries).toEqual([]);
});

it('reports a failed naddr lookup without launching or recording an application', async () => {
  const value = naddrEncode({ kind: 35130, pubkey: 'a'.repeat(64), identifier: 'missing' });
  jest.mocked(resolveApplicationAddress).mockRejectedValueOnce(new Error('napplets.not_found'));
  await act(async () => { renderer.root.findByType(QrScanButton).props.onScanned(value); });
  await act(async () => { await jest.advanceTimersByTimeAsync(0); });
  expect(mockNavigate).not.toHaveBeenCalled();
  expect(discoveryStore.getState().addressCache.entries).toEqual([]);
  expect(useToastStore.getState()).toMatchObject({ message: 'napplets.not_found', variant: 'error', target: 'primary' });
  expect(renderer.root.findAllByType(AppText).some(node => node.props.children === 'napplets.not_found')).toBe(false);
});

it('keeps invalid scans out of discovery search', async () => {
  await act(async () => { renderer.root.findByType(QrScanButton).props.onScanned('not-an-app-address'); });
  expect(renderer.root.findByType(SegmentedControl).props.value).toBe('favorites');
  expect(renderer.root.findAllByType(ExploreDiscovery)).toHaveLength(0);
  expect(useToastStore.getState()).toMatchObject({ message: 'napplets.invalid_manifest', variant: 'error', target: 'primary' });
  expect(renderer.root.findAllByType(AppText).some(node => node.props.children === 'napplets.invalid_manifest')).toBe(false);
});

it('opens a home-scanned website directly without changing scope', async () => {
  const value = 'https://example.com/from-home';
  let id!: number;
  act(() => { id = useExploreSearchHandoffStore.getState().start({ account: 'account', value }); });
  mockHandoff = String(id);
  await act(async () => { renderer.update(<NappletsScreen />); });
  expect(renderer.root.findByType(SegmentedControl).props.value).toBe('favorites');
  await act(async () => { await jest.advanceTimersByTimeAsync(0); });
  expect(mockNavigate).toHaveBeenCalledWith('/explore-run?runId=7');
  expect(renderer.root.findByType(SearchBar).props.value).toBe('');
  expect(useExploreSearchHandoffStore.getState().pending).toBeNull();
});

it("does not consume another account's scan", async () => {
  let id!: number;
  act(() => { id = useExploreSearchHandoffStore.getState().start({ account: 'other', value: 'https://example.com/private' }); });
  mockHandoff = String(id);
  await act(async () => { renderer.update(<NappletsScreen />); });
  expect(renderer.root.findByType(SegmentedControl).props.value).toBe('favorites');
  expect(renderer.root.findAllByType(ExploreDiscovery)).toHaveLength(0);
});

it('shares query text across modes and restricts Favorites keyword scope to shortcuts', async () => {
  const favorite = { key: 'favorite', title: 'Saved app', desktopPosition: 0, lastUsedAt: null } as ExploreEntry;
  const recent = { key: 'recent', title: 'Recent app', desktopPosition: null, lastUsedAt: 10 } as ExploreEntry;
  mockExplore.entries = [favorite, recent];
  await act(async () => { renderer.update(<NappletsScreen />); });
  await act(async () => { renderer.root.findByType(SearchBar).props.onPress(); });
  await act(async () => { renderer.root.findAllByType(SearchBar).find(node => node.props.autoFocus)!.props.onChangeText('app'); });
  expect(renderer.root.findByType(ExploreDiscovery).props.scope).toBe('favorites');
  expect(renderer.root.findByType(ExploreDiscovery).props.favorites).toEqual([favorite]);
  await act(async () => { renderer.root.findByType(SegmentedControl).props.onChange('discover'); });
  expect(renderer.root.findByType(SearchBar).props.value).toBe('app');
  expect(renderer.root.findByType(ExploreDiscovery).props.query).toBe('app');
  expect(renderer.root.findByType(ExploreDiscovery).props.scope).toBe('discover');
});

it('keeps history accessible in both modes and recent apps out of the Favorites grid', async () => {
  const favorite = { key: 'favorite', desktopPosition: 0, lastUsedAt: null } as ExploreEntry;
  const recent = { key: 'recent', desktopPosition: null, lastUsedAt: 10 } as ExploreEntry;
  mockExplore.entries = [favorite, recent];
  await act(async () => { renderer.update(<NappletsScreen />); });
  expect(renderer.root.findByType(NappletGrid).props.items).toEqual([favorite]);
  expect(renderer.root.findByType(NappletGrid).props.recent).toBeUndefined();
  const history = renderer.root.findByType(IconButton);
  expect(history.props.accessibilityLabel).toBe('napplets.recent');
  await act(async () => { history.props.onPress(); });
  expect(mockNavigate).toHaveBeenCalledWith('/explore-recent');
  await act(async () => { renderer.root.findByType(SegmentedControl).props.onChange('discover'); });
  const discoverHistory = renderer.root.findByType(IconButton);
  expect(discoverHistory.props.accessibilityLabel).toBe('napplets.recent');
  await act(async () => { discoverHistory.props.onPress(); });
  expect(mockNavigate).toHaveBeenLastCalledWith('/explore-recent');
});

it('shows empty Favorites for accounts with only recent apps while keeping history accessible', async () => {
  mockExplore.entries = [{ key: 'recent', desktopPosition: null, lastUsedAt: 10 } as ExploreEntry];
  await act(async () => { renderer.update(<NappletsScreen />); });
  expect(renderer.root.findAllByType(NappletGrid)).toHaveLength(0);
  expect(renderer.root.findAllByType(AppText).some(node => node.props.children === 'napplets.empty_title')).toBe(true);
  expect(renderer.root.findByType(IconButton).props.accessibilityLabel).toBe('napplets.recent');
});


it('queries Favorites once on entry without repeating the query for store updates', async () => {
  expect(exploreService.activate).toHaveBeenCalledWith('account', { refresh: true });
  mockExplore = { account: 'account', loaded: true, entries: [] };
  await act(async () => { renderer.update(<NappletsScreen />); });
  expect(exploreService.activate).toHaveBeenCalledTimes(1);
});

it('queries Favorites again each time focus returns and does no query while blurred', async () => {
  jest.mocked(exploreService.activate).mockClear();
  mockFocused = false;
  mockExplore = { account: null, loaded: false, entries: [] };
  await act(async () => { renderer.update(<NappletsScreen />); });
  expect(exploreService.activate).not.toHaveBeenCalled();
  mockFocused = true;
  await act(async () => { renderer.update(<NappletsScreen />); });
  expect(exploreService.activate).toHaveBeenCalledTimes(1);
  mockExplore = { account: 'account', loaded: true, entries: [] };
  await act(async () => { renderer.update(<NappletsScreen />); });
  mockFocused = false;
  await act(async () => { renderer.update(<NappletsScreen />); });
  mockFocused = true;
  await act(async () => { renderer.update(<NappletsScreen />); });
  expect(exploreService.activate).toHaveBeenCalledTimes(2);
});

it('shows launch failures in an error toast while preserving the Favorites grid', async () => {
  mockExplore.entries = [{ key: 'saved', desktopPosition: 0, lastUsedAt: null } as ExploreEntry];
  await act(async () => { renderer.update(<NappletsScreen />); });
  jest.mocked(exploreService.prepare).mockImplementationOnce(() => { throw new Error('failed'); });
  await act(async () => { await renderer.root.findByType(NappletGrid).props.onOpen(mockExplore.entries[0]); });
  expect(useToastStore.getState()).toMatchObject({ message: 'napplets.request_failed', variant: 'error', target: 'primary' });
  expect(renderer.root.findAllByType(AppText).some(node => node.props.children === 'napplets.request_failed')).toBe(false);
  expect(renderer.root.findByType(NappletGrid).props.items).toEqual(mockExplore.entries);
});
