import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { StyleSheet, View } from 'react-native';

import { RelaySettingsScreen } from '../RelaySettingsScreen';
import { AppInput } from '@/components/common/AppInput';
import { AppButton } from '@/components/common/AppButton';
import { SegmentedControl } from '@/components/common/SegmentedControl';
import { SortableUrlList } from '@/components/common/SortableUrlList';
import { darkPalette, lightPalette } from '@/theme';
import { saveAndPublishWriteRelays, saveAndPublishDmRelays } from '@/services/relay/relay-list.service';

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
jest.mock('@/services/account/account.service', () => ({ buildSigner: async () => ({}) }));
jest.mock('@/services/dm/dm.service', () => ({ dmService: { refreshRelayConfiguration: jest.fn() } }));
jest.mock('@/services/relay/relay-list.service', () => ({
  loadAccountDmRelays: async () => ['wss://dm.example'],
  loadAccountWriteRelays: async () => ['wss://write.example'],
  saveAndPublishWriteRelays: jest.fn(async () => ({})),
  saveAndPublishDmRelays: jest.fn(async () => {}),
}));
jest.mock('@/hooks/use-scrolled', () => ({ useScrolled: () => ({ scrolled: false, scrollProps: {} }) }));
jest.mock('@/components/common/ScreenHeader', () => ({ ScreenHeader: () => null, useScreenHeaderClearance: () => 48 }));
jest.mock('@/components/common/AppFormScrollView', () => ({ AppFormScrollView: jest.requireActual('react-native').ScrollView }));
jest.mock('@/components/common/SegmentedControl', () => ({ SegmentedControl: () => null }));
jest.mock('@/components/common/SortableUrlList', () => ({ SortableUrlList: () => null }));
jest.mock('lucide-react-native/icons/plus', () => () => null, { virtual: true });
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: jest.requireActual('react-native').View,
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('@/platform', () => ({ platform: {} }));

let renderer: ReactTestRenderer;
let activeMode = 'dm';
function activePanel() { return renderer.root.findByProps({ testID: `relay-panel-${activeMode}` }); }
async function selectTab(mode: 'dm' | 'write') {
  await act(async () => { renderer.root.findByType(SegmentedControl).props.onChange(mode); });
  activeMode = mode;
}
async function renderSettings(mode: 'dm' | 'write') {
  activeMode = 'dm';
  await act(async () => { renderer = create(<RelaySettingsScreen />); });
  if (mode === 'write') await selectTab(mode);
}
afterEach(() => { act(() => renderer?.unmount()); jest.clearAllMocks(); });

it.each(['light', 'dark'] as const)('edits publishing relays independently in %s mode', async (scheme) => {
  mockScheme = scheme;
  await renderSettings('write');
  const backgrounds = renderer.root.findAllByType(View).map((node) => StyleSheet.flatten(node.props.style)?.backgroundColor);
  expect(backgrounds).toContain((scheme === 'dark' ? darkPalette : lightPalette).background);
  expect(JSON.stringify(renderer.toJSON())).toContain('relays.write_subtitle');
  expect(activePanel().findByType(SortableUrlList).props.value).toEqual(['wss://write.example']);
  act(() => { activePanel().findByType(AppInput).props.onChangeText('new.example'); });
  act(() => { activePanel().findByType(AppInput).props.onSubmitEditing(); });
  await act(async () => { await activePanel().findByType(AppButton).props.onPress(); });
  expect(saveAndPublishWriteRelays).toHaveBeenCalledWith(expect.objectContaining({
    accountPubkey: 'self', relays: ['wss://write.example', 'wss://new.example'],
  }));
  expect(saveAndPublishDmRelays).not.toHaveBeenCalled();
});

it('keeps the draft and shows a save failure even when the input is empty', async () => {
  jest.mocked(saveAndPublishWriteRelays).mockRejectedValueOnce(new Error('offline'));
  await renderSettings('write');
  act(() => { activePanel().findByType(SortableUrlList).props.onChange(['wss://new.example']); });
  await act(async () => { await activePanel().findByType(AppButton).props.onPress(); });
  expect(activePanel().findByType(AppInput).props.error).toBe('relays.write_save_error');
  expect(activePanel().findByType(SortableUrlList).props.value).toEqual(['wss://new.example']);
});

it('keeps message-relay edits on their independent save path', async () => {
  await renderSettings('dm');
  act(() => { activePanel().findByType(SortableUrlList).props.onChange(['wss://new-dm.example']); });
  await act(async () => { await activePanel().findByType(AppButton).props.onPress(); });
  expect(saveAndPublishDmRelays).toHaveBeenCalled();
  expect(saveAndPublishWriteRelays).not.toHaveBeenCalled();
});

it('preserves both drafts across tab switches and saves only the selected list', async () => {
  await renderSettings('dm');
  act(() => { activePanel().findByType(SortableUrlList).props.onChange(['wss://draft-dm.example']); });
  act(() => { activePanel().findByType(AppInput).props.onChangeText('unfinished.example'); });
  await selectTab('write');
  act(() => { activePanel().findByType(SortableUrlList).props.onChange(['wss://draft-write.example']); });
  await selectTab('dm');
  expect(activePanel().findByType(SortableUrlList).props.value).toEqual(['wss://draft-dm.example']);
  expect(activePanel().findByType(AppInput).props.value).toBe('unfinished.example');
  await selectTab('write');
  await act(async () => { await activePanel().findByType(AppButton).props.onPress(); });
  expect(saveAndPublishWriteRelays).toHaveBeenCalledWith(expect.objectContaining({ relays: ['wss://draft-write.example'] }));
  expect(saveAndPublishDmRelays).not.toHaveBeenCalled();
  expect(activePanel().findByType(AppButton).props.disabled).toBe(true);
  await selectTab('dm');
  expect(activePanel().findByType(AppButton).props.disabled).toBe(false);
  expect(activePanel().findByType(SortableUrlList).props.value).toEqual(['wss://draft-dm.example']);
});
