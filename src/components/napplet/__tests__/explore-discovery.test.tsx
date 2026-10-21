import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { ActivityIndicator, FlatList } from 'react-native';
import { ExploreDiscovery } from '../ExploreDiscovery';
import { AppText } from '@/components/common/AppText';
import { discoverApplications, loadMoreApplications } from '@/services/explore/discovery';
import { darkPalette, lightPalette } from '@/theme';

let mockScheme: 'light' | 'dark' = 'light';
const mockState = { entries: [], loaded: true, loading: false, loadingMore: false, error: false, hasMore: true };
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
const screen = () => <ExploreDiscovery account="account" bottomInset={0} onDetails={() => {}} onScrollChange={() => {}} />;
beforeEach(() => {
  jest.clearAllMocks();
  Object.assign(mockState, { loaded: true, loading: false, loadingMore: false, error: false, hasMore: true });
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
