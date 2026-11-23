import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { StyleSheet, View } from 'react-native';

import DiscoveryRelaysScreen from '@/app/(app)/explore-discovery-relays';
import { saveDiscoveryRelays } from '@/services/explore/discovery-relays';
import { refreshDiscoverySources } from '@/services/explore/discovery';
import { RelaySettingsScreen } from '../RelaySettingsScreen';
import { AppInput } from '@/components/common/AppInput';
import { AppButton } from '@/components/common/AppButton';
import { SegmentedControl } from '@/components/common/SegmentedControl';
import { SortableUrlList } from '@/components/common/SortableUrlList';
import { darkPalette, lightPalette } from '@/theme';
import { saveWriteRelays, saveDmRelays } from '@/services/relay/relay-list.service';
import { dmService } from '@/services/dm/dm.service';
import { AppText } from '@/components/common/AppText';

jest.mock('@/services/explore/discovery', () => ({ refreshDiscoverySources: jest.fn() }));
jest.mock('@/services/explore/discovery-relays', () => ({
  loadDiscoveryRelays: jest.fn(async () => mockDiscoveryLists),
  saveDiscoveryRelays: jest.fn(async (kind: 'napp' | 'napplet', urls: string[]) => { mockDiscoveryLists[kind] = urls; }),
  DEFAULT_DISCOVERY_RELAYS: { napp: ['wss://relay.nostrapps.com/'], napplet: ['wss://relay.napplet.soy/'] },
}));

let mockScheme: 'light' | 'dark' = 'light';
const mockAccount = { activePubkey: 'self' };
let mockDmRelays: string[];
let mockWriteRelays: string[];
let mockDiscoveryLists: { napp: string[]; napplet: string[] };
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
jest.mock('@/services/dm/dm.service', () => ({ dmService: { refreshRelayConfiguration: jest.fn() } }));
jest.mock('@/services/relay/relay-list.service', () => ({
  loadAccountDmRelays: async () => mockDmRelays,
  loadLocalWriteRelays: async () => mockWriteRelays,
  saveWriteRelays: jest.fn(async (_account: string, urls: string[]) => { mockWriteRelays = urls; }),
  saveDmRelays: jest.fn(async (_account: string, urls: string[]) => { mockDmRelays = urls; }),
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
jest.mock('@/platform', () => ({ platform: { database: {
  addChangeListener: (listener: (event: { tableName?: string }) => void) => {
    mockChangeListeners.add(listener);
    return () => mockChangeListeners.delete(listener);
  },
} } }));

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
beforeEach(() => {
  mockDmRelays = ['wss://dm.example/'];
  mockWriteRelays = ['wss://write.example/'];
  mockDiscoveryLists = { napp: ['wss://napp.example/'], napplet: ['wss://napplet.example/'] };
});
afterEach(() => { act(() => renderer?.unmount()); jest.clearAllMocks(); });

it.each(['light', 'dark'] as const)('edits publishing relays independently in %s mode', async (scheme) => {
  mockScheme = scheme;
  await renderSettings('write');
  const backgrounds = renderer.root.findAllByType(View).map((node) => StyleSheet.flatten(node.props.style)?.backgroundColor);
  expect(backgrounds).toContain((scheme === 'dark' ? darkPalette : lightPalette).background);
  expect(JSON.stringify(renderer.toJSON())).toContain('relays.write_subtitle');
  expect(activePanel().findByType(SortableUrlList).props.value).toEqual(['wss://write.example/']);
  act(() => { activePanel().findByType(AppInput).props.onChangeText('new.example'); });
  await act(async () => { activePanel().findByType(AppInput).props.onSubmitEditing(); });
  expect(saveWriteRelays).toHaveBeenCalledWith('self', ['wss://write.example/', 'wss://new.example/']);
  expect(saveDmRelays).not.toHaveBeenCalled();
  expect(dmService.refreshRelayConfiguration).toHaveBeenCalledWith('self');
  expect(activePanel().findAllByType(AppButton)).toHaveLength(0);
});

it.each(['dm', 'write'] as const)('keeps a failed %s relay edit retryable', async (mode) => {
  const save = mode === 'dm' ? saveDmRelays : saveWriteRelays;
  jest.mocked(save).mockRejectedValueOnce(new Error('disk unavailable'));
  await renderSettings(mode);
  await act(async () => { activePanel().findByType(SortableUrlList).props.onChange(['wss://new.example/']); });
  expect(activePanel().findByType(AppInput).props.error).toBeUndefined();
  expect(activePanel().findAllByType(AppText).some((node) => node.props.children === 'relays.save_error')).toBe(true);
  expect(activePanel().findByType(SortableUrlList).props.value).toEqual(['wss://new.example/']);
  expect(dmService.refreshRelayConfiguration).not.toHaveBeenCalled();
  const retry = activePanel().findByType(AppButton);
  expect(retry.props.label).toBe('common.retry');
  await act(async () => { await retry.props.onPress(); });
  expect(save).toHaveBeenLastCalledWith('self', ['wss://new.example/']);
  expect(activePanel().findAllByType(AppButton)).toHaveLength(0);
});

it('applies each tab immediately and preserves unfinished input across tabs', async () => {
  await renderSettings('dm');
  await act(async () => { activePanel().findByType(SortableUrlList).props.onChange(['wss://new-dm.example/']); });
  act(() => { activePanel().findByType(AppInput).props.onChangeText('unfinished.example'); });
  await selectTab('write');
  await act(async () => { activePanel().findByType(SortableUrlList).props.onChange(['wss://new-write.example/']); });
  expect(saveDmRelays).toHaveBeenCalledWith('self', ['wss://new-dm.example/']);
  expect(saveWriteRelays).toHaveBeenCalledWith('self', ['wss://new-write.example/']);
  await selectTab('dm');
  expect(activePanel().findByType(AppInput).props.value).toBe('unfinished.example');
  expect(activePanel().findByType(SortableUrlList).props.value).toEqual(['wss://new-dm.example/']);
});

it('keeps at least one inbox relay', async () => {
  await renderSettings('dm');
  const list = activePanel().findByType(SortableUrlList);
  expect(list.props.removeDisabled).toBe(true);
  await act(async () => { list.props.onRemove('wss://dm.example/'); });
  expect(saveDmRelays).not.toHaveBeenCalled();
});

it.each(['light', 'dark'] as const)('prefills only the message-relay input without adding or saving in %s mode', async (scheme) => {
  mockScheme = scheme;
  activeMode = 'dm';
  await act(async () => {
    renderer = create(<RelaySettingsScreen initialDmRelay="wss://relay.psstpsst.chat/" />);
  });
  expect(activePanel().findByType(AppInput).props.value).toBe('wss://relay.psstpsst.chat/');
  expect(activePanel().findByType(SortableUrlList).props.value).toEqual(['wss://dm.example/']);
  expect(saveDmRelays).not.toHaveBeenCalled();
  await selectTab('write');
  expect(activePanel().findByType(AppInput).props.value).toBe('');
  await selectTab('dm');
  expect(activePanel().findByType(AppInput).props.value).toBe('wss://relay.psstpsst.chat/');
});


it.each(['light', 'dark'] as const)('applies discovery edits immediately and retries failed writes in %s mode', async scheme => {
  mockScheme = scheme;
  await act(async () => { renderer = create(<DiscoveryRelaysScreen />); });
  const panel = (format: string) => renderer.root.findByProps({ testID: `discovery-panel-${format}` });
  expect(renderer.root.findAllByProps({ label: 'relays.save' })).toHaveLength(0);
  jest.mocked(saveDiscoveryRelays).mockRejectedValueOnce(new Error('disk full'));
  await act(async () => { panel('napp').findByType(SortableUrlList).props.onChange(['wss://custom.example/']); });
  expect(panel('napp').findByType(SortableUrlList).props.value).toEqual(['wss://custom.example/']);
  expect(refreshDiscoverySources).not.toHaveBeenCalled();
  await act(async () => { await panel('napp').findByProps({ label: 'common.retry' }).props.onPress(); });
  expect(saveDiscoveryRelays).toHaveBeenLastCalledWith('napp', ['wss://custom.example/']);
  expect(refreshDiscoverySources).toHaveBeenCalledTimes(1);
  expect(panel('napp').findAllByProps({ label: 'common.retry' })).toHaveLength(0);
  await act(async () => { renderer.root.findByType(SegmentedControl).props.onChange('napplet'); });
  expect(panel('napplet').findByType(SortableUrlList).props.value).toEqual(['wss://napplet.example/']);
  await act(async () => { panel('napplet').findByType(SortableUrlList).props.onRemove('wss://napplet.example/'); });
  expect(saveDiscoveryRelays).toHaveBeenLastCalledWith('napplet', []);
  await act(async () => { renderer.root.findByType(SegmentedControl).props.onChange('napp'); });
  expect(panel('napp').findByType(SortableUrlList).props.value).toEqual(['wss://custom.example/']);
  await act(async () => { panel('napp').findByProps({ label: 'common.reset' }).props.onPress(); });
  expect(saveDiscoveryRelays).toHaveBeenLastCalledWith('napp', ['wss://relay.nostrapps.com/']);
  expect(saveDmRelays).not.toHaveBeenCalled();
  expect(saveWriteRelays).not.toHaveBeenCalled();
  act(() => { panel('napp').findByType(AppInput).props.onChangeText('added.example'); });
  await act(async () => { panel('napp').findByType(AppInput).props.onSubmitEditing(); });
  expect(saveDiscoveryRelays).toHaveBeenLastCalledWith('napp', ['wss://relay.nostrapps.com/', 'wss://added.example/']);
});

it('keeps newer discovery edits interactive and ignores failures from older edits', async () => {
  await act(async () => { renderer = create(<DiscoveryRelaysScreen />); });
  const panel = renderer.root.findByProps({ testID: 'discovery-panel-napp' });
  let fail!: (error: Error) => void;
  jest.mocked(saveDiscoveryRelays).mockImplementationOnce(() => new Promise((_, reject) => { fail = reject; }));
  act(() => { panel.findByType(SortableUrlList).props.onChange(['wss://first.example/']); });
  await act(async () => { panel.findByType(SortableUrlList).props.onChange(['wss://latest.example/']); });
  await act(async () => { fail(new Error('old write failed')); });
  expect(panel.findByType(SortableUrlList).props.value).toEqual(['wss://latest.example/']);
  expect(panel.findAllByProps({ label: 'common.retry' })).toHaveLength(0);
});

it.each([
  ['dm', 'relay_lists', saveDmRelays],
  ['write', 'replaceable_events', saveWriteRelays],
] as const)('reloads the open %s list after it changes and adds to the updated list', async (mode, tableName, save) => {
  await renderSettings(mode);
  act(() => { activePanel().findByType(AppInput).props.onChangeText('added.example'); });
  await act(async () => {
    if (mode === 'dm') mockDmRelays = ['wss://remote.example/'];
    else mockWriteRelays = ['wss://remote.example/'];
    mockChangeListeners.forEach(listener => listener({ tableName }));
    await new Promise(resolve => setTimeout(resolve, 0));
  });
  expect(activePanel().findByType(SortableUrlList).props.value).toEqual(['wss://remote.example/']);
  expect(activePanel().findByType(AppInput).props.value).toBe('added.example');
  expect(save).not.toHaveBeenCalled();
  await act(async () => { activePanel().findByType(AppInput).props.onSubmitEditing(); });
  expect(save).toHaveBeenCalledWith('self', ['wss://remote.example/', 'wss://added.example/']);
});
