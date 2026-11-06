import { useToastStore } from '@/stores/toast.store';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { ActivityIndicator, FlatList } from 'react-native';
import { router } from 'expo-router';
import { darkPalette, lightPalette } from '@/theme';
import PublisherApplicationsScreen from '../../../app/(app)/explore-publisher';
import { ApplicationListRow } from '../ApplicationListRow';
import { AppText } from '@/components/common/AppText';
import { AppButton } from '@/components/common/AppButton';
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

it('opens the publisher conversation immediately and collapses repeated contact taps', async () => {
  await act(async () => { renderer = create(<PublisherApplicationsScreen />); });
  const contact = renderer.root.findAllByType(AppButton).find(node => node.props.label === 'applications.contact_author')!;
  expect(contact.props.disabled).toBe(false);
  await act(async () => {
    contact.props.onPress();
    contact.props.onPress();
  });
  expect(router.push).toHaveBeenCalledTimes(1);
  expect(router.push).toHaveBeenCalledWith(`/chat/${pubkey}`);
});

it('offers expansion only for overflowing bios and resets when the bio changes', async () => {
  mockAbout = 'A long publisher biography that wraps across several lines.';
  await act(async () => { renderer = create(<PublisherApplicationsScreen />); });
  const bio = () => renderer.root.findAllByType(AppText).find(node => node.props.selectable)!;
  const toggle = () => renderer.root.findAllByType(AppButton).find(node =>
    ['applications.expand_bio', 'applications.collapse_bio'].includes(node.props.label));
  const measure = async (height: number) => {
    const probes = renderer.root.findAllByType(AppText).filter(node => node.props.onLayout);
    await act(async () => {
      probes.find(node => node.props.numberOfLines === 5)!.props.onLayout({ nativeEvent: { layout: { height: 100 } } });
      probes.find(node => node.props.numberOfLines === 6)!.props.onLayout({ nativeEvent: { layout: { height } } });
    });
  };

  expect(bio().props.numberOfLines).toBe(5);
  await measure(100);
  expect(toggle()).toBeUndefined();
  await measure(120);
  expect(toggle()!.props.label).toBe('applications.expand_bio');
  await act(async () => { toggle()!.props.onPress(); });
  expect(bio().props.numberOfLines).toBeUndefined();
  expect(toggle()!.props.accessibilityState).toEqual({ expanded: true });
  await act(async () => { toggle()!.props.onPress(); });
  expect(bio().props.numberOfLines).toBe(5);
  await act(async () => { toggle()!.props.onPress(); });
  mockAbout = 'Updated biography.';
  await act(async () => { renderer.update(<PublisherApplicationsScreen />); });
  expect(bio().props.numberOfLines).toBe(5);
  expect(toggle()).toBeUndefined();
});

it('rejects array-valued publisher parameters without querying applications', async () => {
  mockPubkey = [pubkey];
  await act(async () => { renderer = create(<PublisherApplicationsScreen />); });
  expect(mockLoad).not.toHaveBeenCalled();
  expect(useToastStore.getState()).toMatchObject({ message: 'new_chat.invalid_npub', variant: 'error' });
  expect(renderer.root.findAllByType(AppText).some(node => node.props.children === 'new_chat.invalid_npub')).toBe(false);
});
