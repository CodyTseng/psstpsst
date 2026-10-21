import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { ActivityIndicator, FlatList } from 'react-native';
import { ExploreDiscovery } from '../ExploreDiscovery';
import type { ExploreEntry } from '@/services/explore/model';
import { useProfilesMap } from '@/hooks/use-profile';
import { AppText } from '@/components/common/AppText';
import { discoverApplications, loadMoreApplications } from '@/services/explore/discovery';
import { darkPalette, lightPalette } from '@/theme';

let mockScheme: 'light' | 'dark' = 'light';
const mockAddressSearch = { active: false, entry: undefined as ExploreEntry | undefined, loading: false, error: undefined as string | undefined, retry: jest.fn() };
jest.mock('@/hooks/use-application-address-search', () => ({ useApplicationAddressSearch: () => mockAddressSearch }));
let mockProfiles: Record<string, { name: string; displayName?: string }> = {};
let mockContacts: Record<string, { petname: string }> = {};
jest.mock('@/hooks/use-profile', () => ({ useProfilesMap: jest.fn(() => mockProfiles) }));
jest.mock('@/hooks/use-contacts', () => ({ useContactsMap: () => mockContacts }));
const mockState = { entries: [] as ExploreEntry[], visibleEntries: [] as ExploreEntry[], loaded: true, loading: false, loadingMore: false, error: false, hasMore: true };
jest.mock('@/stores/theme.store', () => ({ useThemeStore: (select: (state: object) => unknown) => select({ accent: 'blue', preference: mockScheme }) }));
jest.mock('@/stores/explore-discovery.store', () => ({ useDiscovery: () => mockState }));
jest.mock('@/services/explore/discovery', () => ({ discoverApplications: jest.fn(), loadMoreApplications: jest.fn() }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('@/theme', () => ({ ...jest.requireActual('@/theme'),
  useThemeColors: () => jest.requireActual('@/theme')[mockScheme === 'light' ? 'lightPalette' : 'darkPalette'],
}));
jest.mock('@/components/common/AppText', () => ({ AppText: 'Text' }));
jest.mock('@/components/common/AppButton', () => ({ AppButton: 'Button' }));
jest.mock('@/components/napplet/ApplicationListRow', () => ({ ApplicationListRow: 'Row' }));
jest.mock('@solar-icons/react-native/category/map/Linear/Compass', () => ({ Compass: () => null }), { virtual: true });
jest.mock('@/services/explore/model', () => ({ applicationListEntry: (entry: unknown) => entry }));

let renderer: ReactTestRenderer;
let mockQuery = '';
let mockScope: 'favorites' | 'discover' = 'discover';
let mockFavorites: ExploreEntry[] = [];
const screen = () => <ExploreDiscovery query={mockQuery} scope={mockScope} favorites={mockFavorites} account="account" bottomInset={0} onDetails={() => {}} onScrollChange={() => {}} />;
beforeEach(() => {
  jest.clearAllMocks();
  mockQuery = ''; mockScope = 'discover'; mockFavorites = [];
  Object.assign(mockAddressSearch, { active: false, entry: undefined, loading: false, error: undefined });
  mockProfiles = {};
  mockContacts = {};
  Object.assign(mockState, { entries: [], visibleEntries: [], loaded: true, loading: false, loadingMore: false, error: false, hasMore: true });
});
afterEach(() => { act(() => renderer?.unmount()); });

it.each(['light', 'dark'] as const)('loads on scroll and shows themed footer progress in %s mode', async scheme => {
  mockScheme = scheme;
  await act(async () => { renderer = create(screen()); });
  expect(discoverApplications).toHaveBeenCalledWith('account');
  await act(async () => { renderer.root.findByType(FlatList).props.onEndReached(); });
  expect(loadMoreApplications).toHaveBeenCalledWith('account');
  mockState.loadingMore = true;
  await act(async () => { renderer.update(screen()); });
  await act(async () => { renderer.root.findByType(FlatList).props.onEndReached(); });
  expect(loadMoreApplications).toHaveBeenCalledTimes(1);
  expect(renderer.root.findByType(ActivityIndicator).props.color).toBe((scheme === 'light' ? lightPalette : darkPalette).accent);
  expect(renderer.root.findAllByType(AppText).some(node => node.props.children === 'napplets.discovery_empty')).toBe(false);
  await act(async () => { renderer.root.findByType(FlatList).props.onRefresh(); });
  expect(discoverApplications).toHaveBeenLastCalledWith('account', true);
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
  expect(discoverApplications).toHaveBeenCalledWith('account');
});
