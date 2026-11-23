import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { StyleSheet, Text, View } from 'react-native';

import MediaServersPage from '@/app/(app)/media-servers';
import { AppButton } from '@/components/common/AppButton';
import { AppInput } from '@/components/common/AppInput';
import { AppText } from '@/components/common/AppText';
import { SortableUrlList } from '@/components/common/SortableUrlList';
import { saveMediaServers } from '@/services/files/media-server.service';
import { darkPalette, lightPalette } from '@/theme';

let mockScheme: 'light' | 'dark' = 'light';
const mockAccount = { activePubkey: 'self' };
let mockServers: string[];
const mockChangeListeners = new Set<(event: { tableName?: string }) => void>();
jest.mock('@/stores/theme.store', () => ({
  useThemeStore: (selector: (state: object) => unknown) => selector({ accent: 'blue', preference: mockScheme }),
}));
jest.mock('@/stores/active-account.store', () => ({
  useActiveAccount: Object.assign((select: (state: typeof mockAccount) => unknown) => select(mockAccount), {
    getState: () => mockAccount,
  }),
}));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('@/services/files/media-server.service', () => ({
  loadAccountMediaServers: async () => mockServers,
  saveMediaServers: jest.fn(async () => {}),
}));
jest.mock('@/hooks/use-scrolled', () => ({ useScrolled: () => ({ scrolled: false, scrollProps: {} }) }));
jest.mock('@/components/common/ScreenHeader', () => ({ ScreenHeader: () => null, useScreenHeaderClearance: () => 48 }));
jest.mock('@/components/common/AppFormScrollView', () => ({ AppFormScrollView: jest.requireActual('react-native').ScrollView }));
jest.mock('@/components/common/SortableUrlList', () => ({ SortableUrlList: () => null }));
jest.mock('@solar-icons/react-native/category/devices/Linear/ServerSquare', () => ({ ServerSquare: () => null }), { virtual: true });
jest.mock('lucide-react-native/icons/plus', () => () => null, { virtual: true });
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: jest.requireActual('react-native').View,
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('@/platform', () => ({ platform: { database: {
  addChangeListener: (listener: (event: { tableName?: string }) => void) => {
    mockChangeListeners.add(listener);
    return () => mockChangeListeners.delete(listener);
  },
} } }));

let renderer: ReactTestRenderer;
beforeEach(() => {
  mockServers = ['https://old.example/'];
  jest.mocked(saveMediaServers).mockReset().mockImplementation(async (_account, urls) => { mockServers = urls; });
});
afterEach(() => { act(() => renderer?.unmount()); jest.clearAllMocks(); });

it.each(['light', 'dark'] as const)('autosaves and keeps a local write failure retryable in %s mode', async (scheme) => {
  mockScheme = scheme;
  jest.mocked(saveMediaServers).mockRejectedValueOnce(new Error('disk unavailable'));
  await act(async () => { renderer = create(<MediaServersPage />); });
  expect(renderer.root.findAllByType(AppButton)).toHaveLength(0);
  const palette = scheme === 'dark' ? darkPalette : lightPalette;
  const backgrounds = renderer.root.findAllByType(View).map(node => StyleSheet.flatten(node.props.style)?.backgroundColor);
  expect(backgrounds).toContain(palette.background);
  const list = renderer.root.findByType(SortableUrlList);
  await act(async () => { list.props.onChange(['https://new.example/']); });
  expect(list.props.value).toEqual(['https://new.example/']);
  expect(renderer.root.findByType(AppInput).props.error).toBeUndefined();
  const failure = renderer.root.findAllByType(AppText).find(node => node.props.children === 'media_servers.save_error')!;
  expect(StyleSheet.flatten(failure.findByType(Text).props.style).color).toBe(palette.danger);
  const retry = renderer.root.findByType(AppButton);
  expect(retry.props.label).toBe('common.retry');
  await act(async () => { await retry.props.onPress(); });
  expect(saveMediaServers).toHaveBeenLastCalledWith('self', ['https://new.example/']);
  expect(renderer.root.findAllByType(AppButton)).toHaveLength(0);
});

it('keeps subsequent edits interactive during a local write', async () => {
  let fail!: (error: Error) => void;
  jest.mocked(saveMediaServers).mockImplementationOnce(() => new Promise((_, reject) => { fail = reject; }));
  await act(async () => { renderer = create(<MediaServersPage />); });
  const list = renderer.root.findByType(SortableUrlList);
  act(() => { list.props.onChange(['https://new.example/']); });
  await act(async () => { list.props.onChange(['https://latest.example/']); });
  await act(async () => { fail(new Error('old write failed')); });
  expect(list.props.value).toEqual(['https://latest.example/']);
  expect(saveMediaServers).toHaveBeenLastCalledWith('self', ['https://latest.example/']);
  expect(renderer.root.findAllByType(AppButton)).toHaveLength(0);
});

it('adds canonical HTTP URLs and rejects equivalent duplicates', async () => {
  await act(async () => { renderer = create(<MediaServersPage />); });
  act(() => { renderer.root.findByType(AppInput).props.onChangeText('HTTPS://MEDIA.example//api/?z=2&a=1#fragment'); });
  await act(async () => { renderer.root.findByType(AppInput).props.onSubmitEditing(); });
  expect(renderer.root.findByType(SortableUrlList).props.value)
    .toEqual(['https://old.example/', 'https://media.example/api?a=1&z=2']);
  expect(saveMediaServers).toHaveBeenCalledWith('self', ['https://old.example/', 'https://media.example/api?a=1&z=2']);
  act(() => { renderer.root.findByType(AppInput).props.onChangeText('https://media.example/api/?a=1&z=2'); });
  await act(async () => { renderer.root.findByType(AppInput).props.onSubmitEditing(); });
  expect(renderer.root.findByType(AppInput).props.error).toBe('media_servers.duplicate');
  expect(renderer.root.findByType(SortableUrlList).props.value).toHaveLength(2);
});

it('shows the effective server list after an edit is superseded while the page is open', async () => {
  await act(async () => { renderer = create(<MediaServersPage />); });
  await act(async () => { renderer.root.findByType(SortableUrlList).props.onChange(['https://draft.example/']); });
  await act(async () => {
    mockServers = ['https://remote.example/'];
    mockChangeListeners.forEach(listener => listener({ tableName: 'routing_settings_edits' }));
    await new Promise(resolve => setTimeout(resolve, 0));
  });
  expect(renderer.root.findByType(SortableUrlList).props.value).toEqual(['https://remote.example/']);
  expect(saveMediaServers).toHaveBeenCalledTimes(1);
});
