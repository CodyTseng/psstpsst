import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { naddrEncode } from 'nostr-tools/nip19';
import NappletsScreen from '../../../app/(app)/(tabs)/napplets';
import type { ExploreEntry } from '@/services/explore/model';
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
import { spacing, uiDensity } from '@/theme';

const mockNavigate = jest.fn();
let mockHandoff: string | undefined;
let mockExplore = { account: 'account', loaded: true, entries: [] as ExploreEntry[] };
jest.mock('expo-router', () => ({ useLocalSearchParams: () => ({ searchHandoff: mockHandoff }) }));
jest.mock('@/platform', () => ({ platform: { napplet: {} } }));
jest.mock('@/services/explore/windows', () => ({ openApplicationWindow: jest.fn() }));
jest.mock('@/services/napplet/network', () => ({ NappletNetwork: jest.fn() }));
jest.mock('@/services/explore/repository', () => ({ readEntries: jest.fn() }));
jest.mock('@/services/explore/service', () => ({ exploreService: { activate: jest.fn(async () => {}) } }));
jest.mock('@/services/napplet/service', () => ({ nappletService: { prepareOpen: jest.fn() } }));
jest.mock('@/hooks/use-explore-share', () => ({ useExploreShare: () => jest.fn() }));
jest.mock('@/stores/explore.store', () => ({ useExplore: () => mockExplore }));
jest.mock('@/stores/active-account.store', () => ({ useActiveAccount: (select: (state: { activePubkey: string }) => unknown) => select({ activePubkey: 'account' }) }));
jest.mock('@/components/navigation/primary-pane-navigation', () => ({ usePrimaryPaneNavigation: () => ({ open: mockNavigate }) }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, start: 0, end: 0 }) }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('@/stores/theme.store', () => ({ useThemeStore: (select: (state: object) => unknown) => select({ accent: 'blue' }) }));
jest.mock('@/components/common/AppScreen', () => ({ AppScreen: ({ children }: { children: React.ReactNode }) => children }));
jest.mock('@/components/common/ScreenHeader', () => ({ ScreenHeader: ({ left, right, below, titleControl }: { left?: React.ReactNode; right?: React.ReactNode; below?: React.ReactNode; titleControl?: React.ReactNode }) => <>{left}{right}{titleControl}{below}</>, useScreenHeaderClearance: () => 64 }));
jest.mock('@/components/search/SearchBar', () => ({ SearchBar: 'SearchBar', SEARCH_BAR_SCREEN_GUTTER: 12 }));
jest.mock('@/components/common/IconButton', () => ({ IconButton: 'IconButton' }));
jest.mock('lucide-react-native/icons/rotate-ccw-clock', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/common/AppButton', () => ({ AppButton: 'Button' }));
jest.mock('@/components/common/AppText', () => ({ AppText: 'Text' }));
jest.mock('@/components/common/QrScanButton', () => ({ QrScanButton: 'ScanButton' }));
jest.mock('@/components/common/SegmentedControl', () => ({ SegmentedControl: 'Tabs' }));
jest.mock('@/components/napplet/ExploreDiscovery', () => ({ ExploreDiscovery: 'Discovery' }));
jest.mock('@/components/napplet/NappletGrid', () => ({ NappletGrid: 'Grid' }));
jest.mock('@solar-icons/react-native/category/settings/Linear/Widget', () => ({ Widget: () => null }), { virtual: true });

let renderer: ReactTestRenderer;
beforeEach(async () => { jest.clearAllMocks(); mockHandoff = undefined; mockExplore = { account: 'account', loaded: true, entries: [] }; useExploreSearchHandoffStore.setState({ pending: null }); await act(async () => { renderer = create(<NappletsScreen />); }); });
afterEach(() => { act(() => renderer?.unmount()); });

it('uses the shared header-sized scanner and points empty Favorites to Discover', async () => {
  const scanner = renderer.root.findByType(QrScanButton);
  expect(renderer.root.findByType(ScreenHeader).props.right.type).toBe(QrScanButton);
  expect(renderer.root.findByType(ScreenHeader).props.title).toBeUndefined();
  expect(renderer.root.findByType(ScreenHeader).props.belowHeight).toBe(uiDensity.searchBarHeight + spacing.sm);
  const searchInset = renderer.root.findByType(ScreenHeader).props.below.props.style;
  expect(searchInset.paddingTop ?? searchInset.paddingVertical ?? 0).toBe(0);
  expect(searchInset.paddingBottom).toBe(spacing.sm);
  expect(renderer.root.findByType(ScreenHeader).props.titleControl.type).toBe(SegmentedControl);
  expect(scanner.props).toMatchObject({ size: uiDensity.headerActionSize, iconSize: uiDensity.headerActionIconSize, variant: 'plain' });
  const discover = renderer.root.findByType(AppButton);
  expect(discover.props.label).toBe('napplets.discover');
  await act(async () => { discover.props.onPress(); });
  expect(renderer.root.findByType(ExploreDiscovery).props.query).toBe('');
  expect(mockNavigate).not.toHaveBeenCalled();
});

it.each(['https://example.com/app', `nostr:${naddrEncode({ kind: 35130, pubkey: 'a'.repeat(64), identifier: 'app' })}`])('sends scanned %s into the existing search flow without launching the app', async value => {
  await act(async () => { renderer.root.findByType(QrScanButton).props.onScanned(`  ${value}  `); });
  expect(renderer.root.findByType(SegmentedControl).props.value).toBe('favorites');
  expect(renderer.root.findByType(ExploreDiscovery).props.query).toBe(value);
  expect(mockNavigate).not.toHaveBeenCalled();
});

it('keeps invalid scans out of discovery search', async () => {
  await act(async () => { renderer.root.findByType(QrScanButton).props.onScanned('not-an-app-address'); });
  expect(renderer.root.findByType(SegmentedControl).props.value).toBe('favorites');
  expect(renderer.root.findAllByType(ExploreDiscovery)).toHaveLength(0);
  expect(renderer.root.findAllByType(AppText).some(node => node.props.children === 'napplets.invalid_manifest')).toBe(true);
});

it('consumes a home-scan handoff into shared address search without changing scope', async () => {
  const value = 'https://example.com/from-home';
  const id = useExploreSearchHandoffStore.getState().start({ account: 'account', value });
  mockHandoff = String(id);
  await act(async () => { renderer.update(<NappletsScreen />); });
  expect(renderer.root.findByType(SegmentedControl).props.value).toBe('favorites');
  expect(renderer.root.findByType(ExploreDiscovery).props.query).toBe(value);
  expect(useExploreSearchHandoffStore.getState().pending).toBeNull();
});

it("does not consume another account's scan", async () => {
  const id = useExploreSearchHandoffStore.getState().start({ account: 'other', value: 'https://example.com/private' });
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
  await act(async () => { renderer.root.findByType(SearchBar).props.onChangeText('app'); });
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
