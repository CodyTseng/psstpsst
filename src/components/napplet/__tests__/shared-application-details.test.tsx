import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { naddrEncode, neventEncode } from 'nostr-tools/nip19';
import ExploreDetailsScreen from '../../../app/(app)/explore-details';
import { ApplicationDetailsPage } from '../ApplicationDetailsPage';
import { useFavoriteMetadata } from '@/hooks/use-favorite-metadata';
import { exploreService } from '@/services/explore/service';
import type { ExploreEntry } from '@/services/explore/model';
import { applicationEntryFromAddress } from '@/services/explore/application-reference';
import { ApplicationPermissionsPage } from '../ApplicationPermissionsPage';

let mockParams: { address?: string; key?: string; permissions?: string } = {};
let mockActiveAccount = 'account';
let mockState: { account: string | null; loaded: boolean; entries: ExploreEntry[]; accessRevision: number };
jest.mock('expo-router', () => ({ router: { push: jest.fn() }, useLocalSearchParams: () => mockParams }));
jest.mock('@/stores/active-account.store', () => ({ useActiveAccount: (select: (state: object) => unknown) => select({ activePubkey: mockActiveAccount }) }));
jest.mock('@/stores/explore.store', () => ({ useExplore: () => mockState }));
jest.mock('@/stores/explore-discovery.store', () => ({ useDiscovery: () => ({ entries: [], addressCache: { entries: [], account: null } }) }));
jest.mock('@/stores/explore-publisher.store', () => ({ usePublisherApplications: () => ({ entries: [], loaded: true, error: false }) }));
jest.mock('@/hooks/use-favorite-metadata', () => ({ useFavoriteMetadata: jest.fn() }));
jest.mock('@/hooks/use-open-publisher', () => ({ useOpenPublisher: () => jest.fn() }));
jest.mock('@/hooks/use-explore-share', () => ({ useExploreShare: () => jest.fn() }));
jest.mock('@/hooks/use-explore-access', () => ({ useExploreAccess: () => ({ loaded: true, approved: true }) }));
jest.mock('@/hooks/use-napplet-access', () => ({ useNappletAccess: () => ({ loaded: true, approved: true }) }));
jest.mock('@/services/explore/application-metadata', () => ({ resolveApplicationMetadata: jest.fn() }));
jest.mock('@/services/explore/service', () => ({ exploreService: { activate: jest.fn(async () => {}), signingSource: (entry: ExploreEntry) => entry.key }, SUPPORTED_NAPP_DOMAINS: [] }));
jest.mock('@/services/napplet/service', () => ({ nappletService: {} }));
jest.mock('@/services/explore/windows', () => ({ tryOpenApplicationWindow: jest.fn() }));
jest.mock('../ApplicationDetailsPage', () => ({ ApplicationDetailsPage: () => null }));
jest.mock('../ApplicationPermissionsPage', () => ({ ApplicationPermissionsPage: () => null }));
jest.mock('../ApplicationSettings', () => ({ ApplicationSettings: () => null }));
jest.mock('../ApplicationAccessControls', () => ({ ApplicationAccessControls: () => null }));

const author = 'a'.repeat(64);
const pointer = (kind: number) => kind === 5129
  ? neventEncode({ id: 'b'.repeat(64), kind, author, relays: ['wss://relay.example/'] })
  : naddrEncode({ kind, pubkey: author, identifier: kind >= 30000 ? 'app' : '', relays: ['wss://relay.example/'] });
let renderer: ReactTestRenderer;
beforeEach(() => {
  jest.clearAllMocks();
  mockActiveAccount = 'account';
  mockState = { account: 'account', loaded: true, entries: [], accessRevision: 0 };
  jest.mocked(useFavoriteMetadata).mockImplementation((entry, account) => ({
    entry: entry && account ? { ...entry, title: 'Shared app', manifest: { id: 'verified', pubkey: author } as never } : entry,
    unresolved: !!entry && !account, error: undefined,
  }));
});
afterEach(() => { act(() => renderer?.unmount()); });

it.each([5129, 15129, 35129, 15128, 35128, 35130])('opens shared kind %s without Explore membership or catalogue entries', async kind => {
  mockParams = { address: pointer(kind) };
  await act(async () => { renderer = create(<ExploreDetailsScreen />); });
  const source = jest.mocked(useFavoriteMetadata).mock.calls.at(-1)![0]!;
  expect(source.address).toBe(mockParams.address);
  expect(source.kind).toBe(kind === 35130 ? 'napp' : [15128, 35128].includes(kind) ? 'nsite' : 'napplet');
  expect(useFavoriteMetadata).toHaveBeenLastCalledWith(source, 'account');
  const page = renderer.root.findByType(ApplicationDetailsPage);
  expect(page.props.application.title).toBe('Shared app');
  expect(page.props.error).toBeUndefined();
  expect(page.props.actions.entry.address).toBe(mockParams.address);
});

it('activates the current account before resolving a chat share when Explore has not loaded', async () => {
  mockParams = { address: pointer(35130) };
  mockState.account = null; mockState.loaded = false;
  await act(async () => { renderer = create(<ExploreDetailsScreen />); });
  expect(exploreService.activate).toHaveBeenCalledWith('account');
  expect(useFavoriteMetadata).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'napp' }), null);
  expect(renderer.root.findByType(ApplicationDetailsPage).props.application).toBeUndefined();
  mockState = { ...mockState, account: 'account', loaded: true };
  await act(async () => { renderer.update(<ExploreDetailsScreen />); });
  expect(useFavoriteMetadata).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'napp' }), 'account');
  expect(renderer.root.findByType(ApplicationDetailsPage).props.application.title).toBe('Shared app');
});

it('rejects a non-application address instead of treating it as a signed application', async () => {
  mockParams = { address: pointer(30023) };
  await act(async () => { renderer = create(<ExploreDetailsScreen />); });
  expect(renderer.root.findByType(ApplicationDetailsPage).props.error).toBe('applications.invalid_manifest');
  expect(useFavoriteMetadata).toHaveBeenLastCalledWith(undefined, 'account');
});

it('preserves existing key-based navigation', async () => {
  const entry: ExploreEntry = { key: 'saved', address: 'https://example.com/', kind: 'website', title: 'Saved',
    description: '', required: [], servers: [], desktopPosition: 0, lastUsedAt: null };
  mockParams = { key: entry.key }; mockState.entries = [entry];
  await act(async () => { renderer = create(<ExploreDetailsScreen />); });
  expect(useFavoriteMetadata).toHaveBeenLastCalledWith(entry, 'account');
  expect(exploreService.activate).not.toHaveBeenCalled();
});

it.each([5129, 15129, 35129, 15128, 35128, 35130])('resolves a cold canonical kind-%s key instead of requiring a list cache hit', async kind => {
  const source = applicationEntryFromAddress(pointer(kind))!;
  mockParams = { key: source.key };
  await act(async () => { renderer = create(<ExploreDetailsScreen />); });
  expect(useFavoriteMetadata).toHaveBeenLastCalledWith(expect.objectContaining({ key: source.key, kind: source.kind }), 'account');
  expect(renderer.root.findByType(ApplicationDetailsPage).props.application.title).toBe('Shared app');
  expect(renderer.root.findByType(ApplicationDetailsPage).props.error).toBeUndefined();
});

it('resolves a permission-page key when all application lists are empty', async () => {
  mockParams = { key: pointer(35130), permissions: '1' };
  await act(async () => { renderer = create(<ExploreDetailsScreen />); });
  expect(useFavoriteMetadata).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'napp' }), 'account');
  expect(renderer.root.findByType(ApplicationPermissionsPage).props.application.title).toBe('Shared app');
  expect(renderer.root.findByType(ApplicationPermissionsPage).props.error).toBeUndefined();
});

it('opens an uncached website key without requiring a saved entry', async () => {
  mockParams = { key: 'https://example.com/' };
  await act(async () => { renderer = create(<ExploreDetailsScreen />); });
  expect(useFavoriteMetadata).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'website', address: mockParams.key }), 'account');
  expect(renderer.root.findByType(ApplicationDetailsPage).props.error).toBeUndefined();
});
