import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { ActivityIndicator, FlatList, RefreshControl, View } from 'react-native';
import { useDiscovery } from '@/stores/explore-discovery.store';
import { ExploreDiscovery } from '../ExploreDiscovery';
import type { ExploreEntry } from '@/services/explore/model';
import { useProfilesMap } from '@/hooks/use-profile';
import { AppButton } from '@/components/common/AppButton';
import { AppText } from '@/components/common/AppText';
import { discoverApplications, loadMoreApplications } from '@/services/explore/discovery';
import { useToastStore } from '@/stores/toast.store';
import { darkPalette, lightPalette } from '@/theme';

jest.mock('react-native-reanimated', () => {
  const native = jest.requireActual<typeof import('react-native')>('react-native');
  const react = jest.requireActual<typeof import('react')>('react');
  return {
    __esModule: true,
    default: { FlatList: native.FlatList, View: native.View },
    useSharedValue: (value: number) => react.useRef({
      value, get() { return this.value; }, set(next: number) { this.value = next; },
    }).current,
    useAnimatedScrollHandler: (handler: (event: unknown) => void) => handler,
    useAnimatedStyle: (style: () => unknown) => style(),
    useAnimatedReaction: jest.fn(),
  };
});
jest.mock('lucide-react-native/icons/x', () => () => null);
jest.mock('react-native-worklets', () => ({ scheduleOnRN: jest.fn() }));

let mockScheme: 'light' | 'dark' = 'light';
const mockAddressSearch = { active: false, entry: undefined as ExploreEntry | undefined, loading: false };
jest.mock('@/hooks/use-application-address-search', () => ({ useApplicationAddressSearch: () => mockAddressSearch }));
let mockProfiles: Record<string, { name: string; displayName?: string }> = {};
let mockContacts: Record<string, { petname: string }> = {};
jest.mock('@/hooks/use-profile', () => ({ useProfilesMap: jest.fn(() => mockProfiles) }));
jest.mock('@/hooks/use-contacts', () => ({ useContactsMap: () => mockContacts }));
const mockState = { entries: [] as ExploreEntry[], visibleEntries: [] as ExploreEntry[], loaded: true, loading: false, loadingMore: false, error: false, hasMore: true };
jest.mock('@/stores/theme.store', () => ({ useThemeStore: (select: (state: object) => unknown) => select({ accent: 'blue', preference: mockScheme }) }));
jest.mock('@/stores/explore-discovery.store', () => ({ useDiscovery: jest.fn(() => mockState) }));
jest.mock('@/services/explore/discovery', () => ({ discoverApplications: jest.fn(), loadMoreApplications: jest.fn() }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string, options?: { action?: string }) => options?.action ? `${key}: ${options.action}` : key }) }));
jest.mock('@/theme', () => ({ ...jest.requireActual('@/theme'),
  useThemeColors: () => jest.requireActual('@/theme')[mockScheme === 'light' ? 'lightPalette' : 'darkPalette'],
}));
jest.mock('@/components/common/AppText', () => ({ AppText: 'Text' }));
jest.mock('@/components/common/AppButton', () => ({ AppButton: 'Button' }));
jest.mock('@/components/napplet/ApplicationContextRow', () => ({ ApplicationContextRow: 'Row' }));
jest.mock('@solar-icons/react-native/category/map/Linear/Compass', () => ({ Compass: () => null }), { virtual: true });
jest.mock('@/services/explore/model', () => ({ applicationListEntry: (entry: unknown) => entry }));

let renderer: ReactTestRenderer;
let mockAction: { name: string; auxiliary: boolean } | undefined;
let mockQuery = '';
let mockScope: 'favorites' | 'discover' = 'discover';
let mockFavorites: ExploreEntry[] = [];
const screen = () => <ExploreDiscovery actionFilter={mockAction} onClearAction={() => { mockAction = undefined; renderer.update(screen()); }} query={mockQuery} scope={mockScope} favorites={mockFavorites} account="account" onFavorite={() => {}} onPermissions={() => {}} onShare={() => {}} bottomInset={0} onDetails={() => {}} onScrollChange={() => {}} />;
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(useDiscovery).mockImplementation(() => mockState as ReturnType<typeof useDiscovery>);
  mockAction = undefined; mockQuery = ''; mockScope = 'discover'; mockFavorites = [];
  Object.assign(mockAddressSearch, { active: false, entry: undefined, loading: false });
  mockProfiles = {};
  mockContacts = {};
  Object.assign(mockState, { entries: [], visibleEntries: [], loaded: true, loading: false, loadingMore: false, error: false, hasMore: true });
});
afterEach(() => { act(() => renderer?.unmount()); });

it.each(['light', 'dark'] as const)('loads on scroll and shows themed footer progress in %s mode', async scheme => {
  mockScheme = scheme;
  await act(async () => { renderer = create(screen()); });
  expect(discoverApplications).toHaveBeenCalledWith('account', false, 'all');
  await act(async () => { renderer.root.findByType(FlatList).props.onEndReached(); });
  expect(loadMoreApplications).toHaveBeenCalledWith('account', 'all');
  mockState.loadingMore = true;
  await act(async () => { renderer.update(screen()); });
  await act(async () => { renderer.root.findByType(FlatList).props.onEndReached(); });
  expect(loadMoreApplications).toHaveBeenCalledTimes(1);
  expect(renderer.root.findByType(ActivityIndicator).props.color).toBe((scheme === 'light' ? lightPalette : darkPalette).textMuted);
  expect(renderer.root.findAllByType(AppText).some(node => node.props.children === 'napplets.discovery_empty')).toBe(false);
  await act(async () => { renderer.root.findByType(FlatList).props.onRefresh(); });
  expect(discoverApplications).toHaveBeenLastCalledWith('account', true, 'all');
});

it.each(['light', 'dark'] as const)('keeps pull-to-refresh below the scrolling search field in %s mode', async scheme => {
  mockScheme = scheme;
  const screenWithHeader = () => <ExploreDiscovery account="account" header={<View testID="search-field" />} headerHeight={48}
    bottomInset={0} onDetails={() => {}} onFavorite={() => {}} onPermissions={() => {}} onShare={() => {}} onScrollChange={() => {}} />;
  await act(async () => { renderer = create(screenWithHeader()); });
  const list = () => renderer.root.findByType(FlatList);
  const headerStyle = () => renderer.root.findByProps({ testID: 'search-field' }).parent!.props.style;
  const headerHeight = () => renderer.root.findByProps({ testID: 'explore-search-header' }).props.style[1].height;
  const control = list().props.refreshControl;
  expect(control.type).toBe(RefreshControl);
  expect(control.props.progressViewOffset).toBeUndefined();
  expect(control.props.tintColor).toBe((scheme === 'light' ? lightPalette : darkPalette).textMuted);
  expect(control.props.colors).toEqual([(scheme === 'light' ? lightPalette : darkPalette).textMuted]);
  expect(headerHeight()).toBe(48);
  for (const y of [-32, -4, -60, 0]) {
    await act(async () => { list().props.onScroll({ contentOffset: { y } }); renderer.update(screenWithHeader()); });
    expect(headerStyle().transform[0].translateY).toBeCloseTo(0);
    expect(headerHeight()).toBe(48);
  }
  await act(async () => { list().props.onScroll({ contentOffset: { y: 80 } }); renderer.update(screenWithHeader()); });
  expect(headerStyle().transform).toEqual([{ translateY: -48 }]);
  expect(headerHeight()).toBe(0);
  await act(async () => { list().props.onRefresh(); });
  expect(discoverApplications).toHaveBeenLastCalledWith('account', true, 'all');
});

it('does not pull the iOS list open for a background reload', async () => {
  const app = { key: 'cached', title: 'Cached app', description: '' } as ExploreEntry;
  mockState.entries = [app]; mockState.visibleEntries = [app]; mockState.loading = true;
  await act(async () => { renderer = create(screen()); });
  expect(renderer.root.findByType(FlatList).props.refreshing).toBe(false);
  expect(renderer.root.findByType(FlatList).props.data).toEqual([app]);
});

it('keeps the refresh control active only for the user-requested refresh lifetime', async () => {
  await act(async () => { renderer = create(screen()); });
  let finish!: () => void;
  jest.mocked(discoverApplications).mockReturnValueOnce(new Promise<void>(resolve => { finish = resolve; }));
  act(() => { void renderer.root.findByType(FlatList).props.onRefresh(); });
  expect(renderer.root.findByType(FlatList).props.refreshing).toBe(true);
  await act(async () => { finish(); });
  expect(renderer.root.findByType(FlatList).props.refreshing).toBe(false);
});

it('keeps an explicit pull refreshing before the first successful load', async () => {
  mockState.loaded = false;
  await act(async () => { renderer = create(screen()); });
  let finish!: () => void;
  jest.mocked(discoverApplications).mockReturnValueOnce(new Promise<void>(resolve => { finish = resolve; }));
  act(() => { void renderer.root.findByType(FlatList).props.refreshControl.props.onRefresh(); });
  expect(renderer.root.findByType(FlatList).props.refreshControl.props.refreshing).toBe(true);
  expect(renderer.root.findAllByType(ActivityIndicator)).toHaveLength(0);
  await act(async () => { finish(); });
  expect(renderer.root.findByType(FlatList).props.refreshControl.props.refreshing).toBe(false);
});

it('shows a catalogue request error only when no content can be displayed', async () => {
  const app = { key: 'cached', title: 'Cached app', description: '' } as ExploreEntry;
  mockState.error = true;
  await act(async () => { renderer = create(screen()); });
  expect(useToastStore.getState()).toMatchObject({ message: 'napplets.request_failed', variant: 'error', target: 'primary' });
  expect(renderer.root.findAllByType(AppText).some(node => node.props.children === 'napplets.request_failed')).toBe(false);
  mockState.entries = [app]; mockState.visibleEntries = [app];
  await act(async () => { renderer.update(screen()); });
  expect(renderer.root.findAllByType(AppText).some(node => node.props.children === 'napplets.request_failed')).toBe(false);
  expect(renderer.root.findByType(FlatList).props.data).toEqual([app]);
  mockQuery = 'no local match';
  await act(async () => { renderer.update(screen()); });
  expect(renderer.root.findAllByType(AppText).some(node => node.props.children === 'napplets.request_failed')).toBe(false);
  expect(renderer.root.findAllByType(AppText).some(node => node.props.children === 'search.empty')).toBe(true);
});

it.each(['loading', 'error', 'exhausted'])('does not request another page while %s', async state => {
  mockState.loading = state === 'loading';
  mockState.error = state === 'error';
  mockState.hasMore = state !== 'exhausted';
  await act(async () => { renderer = create(screen()); });
  await act(async () => { renderer.root.findByType(FlatList).props.onEndReached(); });
  expect(loadMoreApplications).not.toHaveBeenCalled();
});

it('searches all cached app names and descriptions without querying relays', async () => {
  const shown = { key: 'shown', title: 'Notes', description: 'Write ideas' } as ExploreEntry;
  const cached = { key: 'cached', title: 'Photo Gallery', description: 'Private photo albums' } as ExploreEntry;
  mockState.entries = [shown, cached];
  mockState.visibleEntries = [shown];
  await act(async () => { renderer = create(screen()); });
  expect(renderer.root.findByType(FlatList).props.data).toEqual([shown]);
  await act(async () => { mockQuery = '  PRIVATE photo  '; renderer.update(screen()); });
  expect(renderer.root.findByType(FlatList).props.data).toEqual([cached]);
  await act(async () => { renderer.root.findByType(FlatList).props.onEndReached(); });
  expect(loadMoreApplications).not.toHaveBeenCalled();
  expect(discoverApplications).toHaveBeenCalledTimes(1);
  await act(async () => { mockQuery = 'nothing matches'; renderer.update(screen()); });
  expect(renderer.root.findByType(FlatList).props.data).toEqual([]);
  expect(renderer.root.findAllByType(AppText).some(node => node.props.children === 'search.empty')).toBe(true);
  await act(async () => { mockQuery = ''; renderer.update(screen()); });
  expect(renderer.root.findByType(FlatList).props.data).toEqual([shown]);
});

it('reveals cached search results in batches of 20 without fetching more', async () => {
  mockState.entries = Array.from({ length: 45 }, (_, i) => ({ key: String(i), title: `Photo ${i}`, description: 'Album' }) as ExploreEntry);
  await act(async () => { renderer = create(screen()); });
  await act(async () => { mockQuery = 'photo'; renderer.update(screen()); });
  expect(renderer.root.findByType(FlatList).props.data).toHaveLength(20);
  await act(async () => { renderer.root.findByType(FlatList).props.onEndReached(); });
  expect(renderer.root.findByType(FlatList).props.data).toHaveLength(40);
  expect(loadMoreApplications).not.toHaveBeenCalled();
});

it('updates author-name matches when profiles arrive and includes local contact names', async () => {
  const publisher = 'b'.repeat(64);
  const app = { key: 'cached', title: 'Gallery', description: 'Photo albums', manifest: { pubkey: publisher } } as ExploreEntry;
  mockState.entries = [app, { ...app, key: 'second-app', title: 'Notes', description: 'Write ideas' }];
  await act(async () => { renderer = create(screen()); });
  const publisherKeys = jest.mocked(useProfilesMap).mock.calls[0][0];
  expect(publisherKeys).toEqual([publisher]);
  await act(async () => { mockQuery = 'ALBUMS creator'; renderer.update(screen()); });
  expect(renderer.root.findByType(FlatList).props.data).toEqual([]);
  mockProfiles = { [publisher]: { name: 'creator', displayName: 'The Creator' } };
  await act(async () => { renderer.update(screen()); });
  expect(renderer.root.findByType(FlatList).props.data).toEqual([app]);
  expect(jest.mocked(useProfilesMap).mock.calls.at(-1)?.[0]).toBe(publisherKeys);
  mockContacts = { [publisher]: { petname: 'My friend' } };
  await act(async () => { renderer.update(screen()); });
  await act(async () => { mockQuery = 'friend gallery'; renderer.update(screen()); });
  expect(renderer.root.findByType(FlatList).props.data).toEqual([app]);
  await act(async () => { mockQuery = 'updated'; renderer.update(screen()); });
  expect(renderer.root.findByType(FlatList).props.data).toEqual([]);
  mockProfiles = { [publisher]: { name: 'updated', displayName: 'Updated Author' } };
  await act(async () => { renderer.update(screen()); });
  expect(renderer.root.findByType(FlatList).props.data).toHaveLength(2);
  expect(loadMoreApplications).not.toHaveBeenCalled();
  expect(discoverApplications).toHaveBeenCalledTimes(1);
});

it('shows exact-address lookup progress and results without advancing catalogue pagination', async () => {
  mockAddressSearch.active = true;
  mockAddressSearch.loading = true;
  await act(async () => { renderer = create(screen()); });
  expect(renderer.root.findAllByType(ActivityIndicator)).toHaveLength(1);
  expect(discoverApplications).not.toHaveBeenCalled();
  expect(renderer.root.findAllByType(AppText).some(node => node.props.children === 'search.empty')).toBe(false);
  const entry = { key: 'address-result', title: 'Direct app', kind: 'napp' } as ExploreEntry;
  Object.assign(mockAddressSearch, { loading: false, entry });
  await act(async () => { renderer.update(screen()); });
  expect(renderer.root.findByType(FlatList).props.data).toEqual([entry]);
  await act(async () => { renderer.root.findByType(FlatList).props.onEndReached(); });
  expect(loadMoreApplications).not.toHaveBeenCalled();
});

it('searches only saved Favorites and keeps relay discovery dormant in that scope', async () => {
  const favorite = { key: 'favorite', title: 'Photo tool', description: 'Saved app' } as ExploreEntry;
  const discovered = { key: 'discovered', title: 'Photo editor', description: 'Public app' } as ExploreEntry;
  mockFavorites = [favorite]; mockState.entries = [discovered];
  mockScope = 'favorites'; mockQuery = 'photo';
  await act(async () => { renderer = create(screen()); });
  expect(renderer.root.findByType(FlatList).props.data).toEqual([favorite]);
  expect(discoverApplications).not.toHaveBeenCalled();
  await act(async () => { renderer.root.findByType(FlatList).props.onEndReached(); });
  expect(loadMoreApplications).not.toHaveBeenCalled();
  mockScope = 'discover';
  await act(async () => { renderer.update(screen()); });
  expect(renderer.root.findByType(FlatList).props.data).toEqual([discovered]);
  expect(discoverApplications).toHaveBeenCalledWith('account', false, 'all');
});

it('uses the saved favorite set instead of stale catalogue positions for row menus', async () => {
  const app = { key: 'notes', title: 'Notes', description: '', desktopPosition: null } as ExploreEntry;
  mockState.entries = [app]; mockState.visibleEntries = [app];
  mockFavorites = [{ ...app, desktopPosition: 0 }];
  await act(async () => { renderer = create(screen()); });
  const row = renderer.root.findByType(FlatList).props.renderItem({ item: app });
  expect(row.props.favorite).toBe(true);
  mockFavorites = [];
  await act(async () => { renderer.update(screen()); });
  expect(renderer.root.findByType(FlatList).props.renderItem({ item: app }).props.favorite).toBe(false);
});


it.each([
  ['light', 'favorites'], ['dark', 'favorites'], ['light', 'discover'], ['dark', 'discover'],
] as const)('shows only no results for an unsuccessful address search in %s %s', async (scheme, scope) => {
  mockScheme = scheme;
  mockScope = scope;
  mockQuery = 'https://example.com/';
  mockAddressSearch.active = true;
  mockState.error = true;
  useToastStore.getState().hide();
  await act(async () => { renderer = create(screen()); });
  const list = renderer.root.findByType(FlatList);
  expect(list.props.data).toEqual([]);
  expect(list.props.ListHeaderComponent).toBeNull();
  expect(list.props.refreshControl).toBeUndefined();
  expect(renderer.root.findAllByType(ActivityIndicator)).toHaveLength(0);
  expect(renderer.root.findAllByType(AppText).some(node => node.props.children === 'search.empty')).toBe(true);
  expect(useToastStore.getState().message).toBeNull();
  expect(discoverApplications).not.toHaveBeenCalled();
});

it.each(['light', 'dark'] as const)('waits for the first catalogue page before keyword matching in %s mode', async scheme => {
  mockScheme = scheme;
  mockQuery = 'photo';
  const match = { key: 'photo', title: 'Photo Gallery', description: '' } as ExploreEntry;
  mockState.loaded = false;
  mockState.loading = true;
  mockState.entries = [match];
  await act(async () => { renderer = create(screen()); });
  expect(renderer.root.findByType(FlatList).props.data).toEqual([]);
  expect(renderer.root.findAllByType(ActivityIndicator)).toHaveLength(1);
  expect(renderer.root.findAllByType(AppText).some(node => node.props.children === 'search.empty')).toBe(false);
  expect(discoverApplications).toHaveBeenCalledWith('account', false, 'all');

  mockQuery = 'gallery';
  await act(async () => { renderer.update(screen()); });
  expect(renderer.root.findByType(FlatList).props.data).toEqual([]);
  expect(renderer.root.findAllByType(ActivityIndicator)).toHaveLength(1);

  mockState.loaded = true;
  mockState.loading = false;
  await act(async () => { renderer.update(screen()); });
  expect(renderer.root.findByType(FlatList).props.data).toEqual([match]);
  expect(renderer.root.findAllByType(ActivityIndicator)).toHaveLength(0);

  mockQuery = 'no match';
  await act(async () => { renderer.update(screen()); });
  expect(renderer.root.findByType(FlatList).props.data).toEqual([]);
  expect(renderer.root.findAllByType(AppText).some(node => node.props.children === 'search.empty')).toBe(true);
});

it.each(['favorites', 'address'] as const)('keeps %s searches independent of the first Discover page', async mode => {
  mockState.loaded = false;
  mockState.loading = true;
  const match = { key: 'photo', title: 'Photo Gallery', description: '' } as ExploreEntry;
  if (mode === 'favorites') {
    mockScope = 'favorites'; mockQuery = 'photo'; mockFavorites = [match];
  } else {
    mockQuery = 'https://example.com/';
    Object.assign(mockAddressSearch, { active: true, loading: false, entry: match });
  }
  await act(async () => { renderer = create(screen()); });
  expect(renderer.root.findByType(FlatList).props.data).toEqual([match]);
  expect(renderer.root.findAllByType(ActivityIndicator)).toHaveLength(0);
  expect(discoverApplications).not.toHaveBeenCalled();
});

it.each(['light', 'dark'] as const)('finds compatible apps beyond the visible page in %s mode', async scheme => {
  mockScheme = scheme;
  mockAction = { name: 'view:1', auxiliary: false };
  const app = (key: string, action: string, auxiliary = false) => ({ key, title: key, kind: 'napp',
    manifest: { tags: [['action', action], ...(auxiliary ? [['mode', 'auxiliary']] : [])] } }) as ExploreEntry;
  const wrong = app('wrong', 'edit');
  const match = app('match', 'view');
  mockState.entries = [wrong]; mockState.visibleEntries = [wrong];
  await act(async () => { renderer = create(screen()); });
  expect(loadMoreApplications).toHaveBeenCalledWith('account', 'napps');
  expect(useDiscovery).toHaveBeenLastCalledWith('napps');
  expect(renderer.root.findAllByType(AppText).some(node => node.props.children === 'napplets.discovery_empty')).toBe(false);
  mockState.entries = [wrong, match, app('auxiliary', 'view:1', true)];
  mockState.hasMore = false;
  await act(async () => { renderer.update(screen()); });
  expect(renderer.root.findByType(FlatList).props.data).toEqual([match]);
  const filter = renderer.root.findAllByType(AppButton).find(node => node.props.label === 'napplets.action_filter: view:1')!;
  expect(filter).toBeDefined();
  await act(async () => { filter.props.onPress(); });
  expect(renderer.root.findByType(FlatList).props.data).toEqual([wrong]);
  expect(renderer.root.findAllByType(AppButton).some(node => node.props.label === 'napplets.action_filter: view:1')).toBe(false);
});

it('shows no results only after filtered discovery is exhausted and retains retry on failure', async () => {
  mockAction = { name: 'edit', auxiliary: false };
  mockState.hasMore = false;
  await act(async () => { renderer = create(screen()); });
  expect(renderer.root.findAllByType(AppText).some(node => node.props.children === 'napplets.no_compatible_apps')).toBe(true);
  mockState.error = true;
  await act(async () => { renderer.update(screen()); });
  expect(renderer.root.findAllByType(AppText).some(node => node.props.children === 'napplets.no_compatible_apps')).toBe(false);
});

it.each(['light', 'dark'] as const)('identifies an auxiliary action filter in %s mode', async scheme => {
  mockScheme = scheme;
  mockAction = { name: 'reply', auxiliary: true };
  await act(async () => { renderer = create(screen()); });
  const filter = renderer.root.findAllByType(AppButton).find(node => node.props.label === 'napplets.auxiliary_action_filter: reply')!;
  expect(filter).toBeDefined();
  expect(filter.props.accessibilityLabel).toContain('napplets.show_all_apps');
});

it('uses a separate napps catalogue for action discovery and restores the full catalogue on clear', async () => {
  const normal = { key: 'normal', kind: 'napplet', title: 'Normal' } as ExploreEntry;
  const napp = { key: 'napp', kind: 'napp', title: 'Napp', manifest: { tags: [['action', 'edit']] } } as ExploreEntry;
  mockState.entries = [normal]; mockState.visibleEntries = [normal];
  const nappsState = { ...mockState, entries: [napp], visibleEntries: [napp], hasMore: false };
  jest.mocked(useDiscovery).mockImplementation(scope => (scope === 'napps' ? nappsState : mockState) as ReturnType<typeof useDiscovery>);
  mockAction = { name: 'edit', auxiliary: false };
  await act(async () => { renderer = create(screen()); });
  expect(discoverApplications).toHaveBeenCalledWith('account', false, 'napps');
  expect(renderer.root.findByType(FlatList).props.data).toEqual([napp]);
  const filter = renderer.root.findAllByType(AppButton).find(node => node.props.label === 'napplets.action_filter: edit')!;
  await act(async () => { filter.props.onPress(); });
  expect(useDiscovery).toHaveBeenLastCalledWith('all');
  expect(discoverApplications).toHaveBeenLastCalledWith('account', false, 'all');
  expect(renderer.root.findByType(FlatList).props.data).toEqual([normal]);
});
