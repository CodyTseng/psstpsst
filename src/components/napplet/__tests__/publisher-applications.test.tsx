import { useToastStore } from '@/stores/toast.store';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { ActivityIndicator, FlatList } from 'react-native';
import { router } from 'expo-router';
import { darkPalette, lightPalette } from '@/theme';
import PublisherApplicationsScreen from '../../../app/(app)/explore-publisher';
import { ApplicationListRow } from '../ApplicationListRow';
import { AppText } from '@/components/common/AppText';
import type { ExploreEntry } from '@/services/explore/model';

const pubkey = 'a'.repeat(64);
let mockPubkey: unknown = pubkey;
let mockScheme: 'light' | 'dark' = 'light';
let mockAbout: string | null = null;
jest.mock('@/stores/theme.store', () => ({ useThemeStore: (select: (state: object) => unknown) => select({ accent: 'blue', preference: mockScheme }) }));
const mockLoad = jest.fn(async () => {});
const mockState = { entries: [] as ExploreEntry[], loading: false, loaded: false, error: false, load: mockLoad };
jest.mock('expo-router', () => ({ router: { push: jest.fn() }, useLocalSearchParams: () => ({ pubkey: mockPubkey }) }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('@/theme', () => ({
  ...jest.requireActual('@/theme'),
  useThemeColors: () => jest.requireActual('@/theme')[mockScheme === 'light' ? 'lightPalette' : 'darkPalette'],
}));
jest.mock('@/components/common/AppScreen', () => ({ AppScreen: 'Page' }));
jest.mock('@/components/common/ScreenHeader', () => ({ ScreenHeader: 'Header', useScreenHeaderClearance: () => 64 }));
jest.mock('@/components/common/Avatar', () => ({ Avatar: () => null }));
jest.mock('@/components/common/AppButton', () => ({ AppButton: 'Button' }));
jest.mock('@/components/common/AppText', () => ({ AppText: 'Text' }));
jest.mock('@/components/napplet/ApplicationListRow', () => ({ ApplicationListRow: 'ApplicationRow' }));
jest.mock('@solar-icons/react-native/category/settings/Linear/Widget', () => ({ Widget: () => null }), { virtual: true });
jest.mock('@/hooks/use-display-name', () => ({ useDisplayName: () => ({ name: 'Publisher', profile: { about: mockAbout } }) }));
jest.mock('@/stores/active-account.store', () => ({ useActiveAccount: (select: (state: { activePubkey: string }) => unknown) => select({ activePubkey: 'account' }) }));
jest.mock('@/stores/explore-publisher.store', () => ({ usePublisherApplications: () => mockState }));
jest.mock('@/services/explore/publishers', () => ({ isPublisher: (value: unknown) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value) }));
jest.mock('@/services/explore/model', () => ({ applicationListEntry: (entry: unknown) => entry }));

let renderer: ReactTestRenderer;
beforeEach(() => { jest.clearAllMocks(); mockPubkey = pubkey; mockAbout = null; mockState.entries = []; mockState.loaded = false; mockState.error = false; });
afterEach(() => { act(() => renderer?.unmount()); });

it.each(['light', 'dark'] as const)('shows themed loading before an empty publisher result in %s mode', async scheme => {
  mockScheme = scheme;
  mockAbout = '  Building small apps.\nOpen source.  ';
  await act(async () => { renderer = create(<PublisherApplicationsScreen />); });
  expect(mockLoad).toHaveBeenCalledWith('account');
  expect(renderer.root.findByType(ActivityIndicator).props.color).toBe((scheme === 'light' ? lightPalette : darkPalette).accent);
  expect(renderer.root.findAllByType(AppText).some(node => node.props.children === 'Building small apps.\nOpen source.' && node.props.selectable)).toBe(true);
  expect(renderer.root.findAllByType(AppText).some(node => node.props.children === 'applications.discovery_empty')).toBe(false);
  mockState.loaded = true;
  mockAbout = '   ';
  await act(async () => { renderer.update(<PublisherApplicationsScreen />); });
  expect(renderer.root.findAllByType(AppText).some(node => node.props.children === 'applications.discovery_empty')).toBe(true);
  expect(renderer.root.findAllByType(AppText).some(node => node.props.selectable)).toBe(false);
});

it('opens a published application through the shared detail route with its catalogue context', async () => {
  mockState.loaded = true;
  mockState.entries = [{ key: 'app-key', title: 'App' } as ExploreEntry];
  await act(async () => { renderer = create(<PublisherApplicationsScreen />); });
  const list = renderer.root.findByType(FlatList);
  let row!: ReactTestRenderer;
  await act(async () => { row = create(list.props.renderItem({ item: mockState.entries[0] })); });
  await act(async () => { row.root.findByType(ApplicationListRow).props.onPress(); });
  expect(router.push).toHaveBeenCalledWith({ pathname: '/explore-details', params: { key: 'app-key', publisher: pubkey, catalog: '1' } });
  act(() => row.unmount());
});

it('rejects array-valued publisher parameters without querying applications', async () => {
  mockPubkey = [pubkey];
  await act(async () => { renderer = create(<PublisherApplicationsScreen />); });
  expect(mockLoad).not.toHaveBeenCalled();
  expect(useToastStore.getState()).toMatchObject({ message: 'new_chat.invalid_npub', variant: 'error' });
  expect(renderer.root.findAllByType(AppText).some(node => node.props.children === 'new_chat.invalid_npub')).toBe(false);
});
