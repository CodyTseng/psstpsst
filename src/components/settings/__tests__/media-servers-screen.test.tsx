import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { StyleSheet, Text, View } from 'react-native';

import MediaServersPage from '@/app/(app)/media-servers';
import { AppButton } from '@/components/common/AppButton';
import { AppInput } from '@/components/common/AppInput';
import { AppText } from '@/components/common/AppText';
import { SortableUrlList } from '@/components/common/SortableUrlList';
import { backSafely } from '@/lib/navigation';
import { saveAndPublishMediaServers } from '@/services/files/media-server.service';
import { showToast } from '@/stores/toast.store';
import { darkPalette, lightPalette } from '@/theme';

let mockScheme: 'light' | 'dark' = 'light';
const mockAccount = { activePubkey: 'self' };
jest.mock('@/stores/theme.store', () => ({
  useThemeStore: (selector: (state: object) => unknown) => selector({ accent: 'blue', preference: mockScheme }),
}));
jest.mock('@/stores/active-account.store', () => ({
  useActiveAccount: Object.assign((select: (state: typeof mockAccount) => unknown) => select(mockAccount), {
    getState: () => mockAccount,
  }),
}));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('@/services/account/account-access', () => ({ buildSigner: async () => ({}) }));
jest.mock('@/services/files/media-server.service', () => ({
  loadAccountMediaServers: async () => ['https://old.example/'],
  saveAndPublishMediaServers: jest.fn(async () => {}),
}));
jest.mock('@/stores/toast.store', () => ({ showToast: jest.fn() }));
jest.mock('@/lib/navigation', () => ({ backSafely: jest.fn() }));
jest.mock('@/hooks/use-scrolled', () => ({ useScrolled: () => ({ scrolled: false, scrollProps: {} }) }));
jest.mock('@/components/common/ScreenHeader', () => ({ ScreenHeader: () => null, useScreenHeaderClearance: () => 48 }));
jest.mock('@/components/common/AppFormScrollView', () => ({ AppFormScrollView: jest.requireActual('react-native').ScrollView }));
jest.mock('@/components/common/SortableUrlList', () => ({ SortableUrlList: () => null }));
jest.mock('lucide-react-native/icons/plus', () => () => null, { virtual: true });
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: jest.requireActual('react-native').View,
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('@/platform', () => ({ platform: {} }));

let renderer: ReactTestRenderer;
function saveButton() { return renderer.root.findAllByType(AppButton).find(node => node.props.label === 'media_servers.save')!; }
async function renderDraft() {
  await act(async () => { renderer = create(<MediaServersPage />); });
  act(() => { renderer.root.findByType(SortableUrlList).props.onChange(['https://new.example/']); });
}
beforeEach(() => { jest.mocked(saveAndPublishMediaServers).mockReset().mockResolvedValue(undefined); });
afterEach(() => { act(() => renderer?.unmount()); jest.clearAllMocks(); });

it.each(['light', 'dark'] as const)('keeps a failed draft retryable and reports confirmed success in %s mode', async (scheme) => {
  mockScheme = scheme;
  jest.mocked(saveAndPublishMediaServers).mockRejectedValueOnce(new Error('publish failed'));
  await renderDraft();
  const palette = scheme === 'dark' ? darkPalette : lightPalette;
  const backgrounds = renderer.root.findAllByType(View).map(node => StyleSheet.flatten(node.props.style)?.backgroundColor);
  expect(backgrounds).toContain(palette.background);
  await act(async () => { await saveButton().props.onPress(); });
  expect(showToast).toHaveBeenLastCalledWith('media_servers.save_error', { variant: 'error', target: 'detail' });
  expect(backSafely).not.toHaveBeenCalled();
  expect(renderer.root.findByType(SortableUrlList).props.value).toEqual(['https://new.example/']);
  expect(renderer.root.findByType(AppInput).props.error).toBeUndefined();
  const failure = renderer.root.findAllByType(AppText).find(node => node.props.children === 'media_servers.save_error')!;
  expect(StyleSheet.flatten(failure.findByType(Text).props.style).color).toBe(palette.danger);
  expect(saveButton().props.disabled).toBe(false);
  expect(saveButton().props.loading).toBe(false);
  expect(saveButton().props.label).toBe('media_servers.save');
  await act(async () => { await saveButton().props.onPress(); });
  expect(saveAndPublishMediaServers).toHaveBeenLastCalledWith(expect.objectContaining({
    accountPubkey: 'self', servers: ['https://new.example/'], abort: expect.anything(),
  }));
  expect(showToast).toHaveBeenLastCalledWith('media_servers.save_success', { target: 'detail' });
  expect(backSafely).not.toHaveBeenCalled();
  expect(saveButton().props.disabled).toBe(true);
  expect(renderer.root.findByType(SortableUrlList).props.value).toEqual(['https://new.example/']);
  act(() => { renderer.root.findByType(SortableUrlList).props.onChange(['https://another.example/']); });
  expect(saveButton().props.disabled).toBe(false);
});

it('waits for confirmation without changing the save label and locks list editing', async () => {
  let finish!: () => void;
  jest.mocked(saveAndPublishMediaServers).mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
  await renderDraft();
  let pending!: Promise<void>;
  await act(async () => { pending = saveButton().props.onPress(); });
  expect(saveButton().props.loading).toBe(true);
  expect(saveButton().props.disabled).toBe(true);
  expect(saveButton().props.label).toBe('media_servers.save');
  expect(renderer.root.findByType(AppInput).props.editable).toBe(false);
  act(() => { renderer.root.findByType(SortableUrlList).props.onChange(['https://different.example/']); });
  expect(renderer.root.findByType(SortableUrlList).props.value).toEqual(['https://new.example/']);
  expect(showToast).not.toHaveBeenCalled();
  expect(backSafely).not.toHaveBeenCalled();
  await act(async () => { finish(); await pending; });
  expect(showToast).toHaveBeenCalledWith('media_servers.save_success', { target: 'detail' });
});

it('adds canonical HTTP URLs and rejects equivalent duplicates', async () => {
  await act(async () => { renderer = create(<MediaServersPage />); });
  act(() => { renderer.root.findByType(AppInput).props.onChangeText('HTTPS://MEDIA.example//api/?z=2&a=1#fragment'); });
  act(() => { renderer.root.findByType(AppInput).props.onSubmitEditing(); });
  expect(renderer.root.findByType(SortableUrlList).props.value)
    .toEqual(['https://old.example/', 'https://media.example/api?a=1&z=2']);
  act(() => { renderer.root.findByType(AppInput).props.onChangeText('https://media.example/api/?a=1&z=2'); });
  act(() => { renderer.root.findByType(AppInput).props.onSubmitEditing(); });
  expect(renderer.root.findByType(AppInput).props.error).toBe('media_servers.duplicate');
  expect(renderer.root.findByType(SortableUrlList).props.value).toHaveLength(2);
});

it('cancels a pending save when leaving the page without stale result feedback', async () => {
  let finish!: () => void;
  jest.mocked(saveAndPublishMediaServers).mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
  await renderDraft();
  let pending!: Promise<void>;
  await act(async () => { pending = saveButton().props.onPress(); });
  const signal = jest.mocked(saveAndPublishMediaServers).mock.calls[0][0].abort!;
  act(() => { renderer.unmount(); });
  expect(signal.aborted).toBe(true);
  await act(async () => { finish(); await pending; });
  expect(showToast).not.toHaveBeenCalled();
  expect(backSafely).not.toHaveBeenCalled();
});
