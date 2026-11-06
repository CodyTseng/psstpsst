import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { DefaultApplicationsPage } from '../DefaultApplicationsPage';
import { useDefaultHandlers } from '@/hooks/use-default-handlers';
import { useApplicationChoices } from '@/hooks/use-application-choices';
import { BottomSheet } from '@/components/common/BottomSheet';

jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ bottom: 0 }) }));
jest.mock('lucide-react-native/icons/check', () => () => null);
jest.mock('@/hooks/use-default-handler-application', () => ({ useDefaultHandlerApplication: () => ({ servers: [] }) }));
jest.mock('../ApplicationIcon', () => ({ ApplicationIcon: 'ApplicationIcon' }));
jest.mock('@/hooks/use-default-handlers', () => ({ useDefaultHandlers: jest.fn() }));
jest.mock('@/hooks/use-application-choices', () => ({ useApplicationChoices: jest.fn() }));
jest.mock('@/hooks/use-scrolled', () => ({ useScrolled: () => ({ scrolled: false, scrollProps: {} }) }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('@/theme', () => ({ spacing: { sm: 8, md: 12, lg: 16, '2xl': 32, '3xl': 48 }, useThemeColors: () => ({ textMuted: 'gray' }) }));
jest.mock('@/components/common/AppScreen', () => ({ AppScreen: 'AppScreen' }));
jest.mock('@/components/common/AppText', () => ({ AppText: 'AppText' }));
jest.mock('@/components/common/AppButton', () => ({ AppButton: 'AppButton' }));
jest.mock('@/components/common/BottomSheet', () => ({ BottomSheet: 'BottomSheet' }));
jest.mock('@/components/common/ListRow', () => ({ ListRow: 'ListRow' }));
jest.mock('@/components/common/SectionLabel', () => ({ SectionLabel: 'SectionLabel' }));
jest.mock('@/components/common/DirectionalChevron', () => ({ DirectionalChevron: () => null }));
jest.mock('@/components/common/ScreenHeader', () => ({ ScreenHeader: 'ScreenHeader', useScreenHeaderClearance: () => 64 }));
jest.mock('@/components/common/DelayedActivityIndicator', () => ({ DelayedActivityIndicator: 'Loading' }));
jest.mock('../ApplicationListRow', () => ({ ApplicationListRow: 'ApplicationListRow', APPLICATION_LIST_ICON_SIZE: 40 }));
jest.mock('@solar-icons/react-native/category/settings/Linear/Widget', () => ({ Widget: () => null }), { virtual: true });

let renderer: ReactTestRenderer;
afterEach(() => act(() => renderer?.unmount()));

it.each(['profile', 'view:0', 'view:30023'].flatMap(name => [false, true].map(auxiliary => ({ name, auxiliary }))))(
  'preserves $name and auxiliary=$auxiliary in settings and the shared discovery picker', ({ name, auxiliary }) => {
  const save = jest.fn(), discover = jest.fn(), more = jest.fn(), select = jest.fn();
  const selected = { type: { kind: 'action' as const, name, auxiliary }, sourceId: 'reader', title: 'Reader' };
  const saved = { key: 'reader', address: 'reader', title: 'Reader', kind: 'napp' as const, servers: [],
    description: '', required: [], desktopPosition: 0, lastUsedAt: null };
  jest.mocked(useDefaultHandlers).mockReturnValue({
    entries: [selected, { ...selected, type: { ...selected.type, auxiliary: !auxiliary } }], selected, selectionId: 2, loaded: true, error: false,
    candidates: { entries: [saved], loaded: true, error: false }, saving: false, saveError: false,
    save, select, retry: jest.fn(),
  });
  jest.mocked(useApplicationChoices).mockReturnValue({
    choices: [{ key: 'source:reader', title: 'Reader', application: saved }, { key: 'discovery:other', title: 'Other reader', application: { key: 'other', title: 'Other reader', kind: 'napp', servers: [] } }],
    savedCount: 1, canDiscover: true, footerAction: 'discover', loading: false, manualLoading: false,
    error: false, hasMore: true, discover, more, retry: jest.fn(),
  });
  act(() => { renderer = create(<DefaultApplicationsPage account="account" />); });
  expect(useApplicationChoices).toHaveBeenLastCalledWith(expect.objectContaining({
    accountPubkey: 'account', requestId: 'default:2',
    applicationSelection: expect.objectContaining({ discovery: { name, auxiliary } }),
  }));
  const rows = renderer.root.findAllByType('ListRow' as never).filter(row => row.props.title === name);
  expect(rows).toHaveLength(2);
  expect(rows[0].props.subtitle).toBe(auxiliary ? 'applications.auxiliary_mode' : undefined);
  expect(rows[1].props.subtitle).toBe(auxiliary ? undefined : 'applications.auxiliary_mode');
  act(() => { rows[0].props.onPress(); });
  expect(select).toHaveBeenCalledWith(selected);
  const sheet = renderer.root.findByType(BottomSheet);
  expect(sheet.props.fixedSubheader.props.children[0].props.children[0].props.children[0].props.children).toBe(name);
  const modeLabel = sheet.props.fixedSubheader.props.children[0].props.children[0].props.children[1];
  if (auxiliary) expect(modeLabel.props.children).toBe('applications.auxiliary_mode');
  else expect(modeLabel).toBeNull();
  expect(sheet.props.title).toBe('applications.default_app_title');
  act(() => { sheet.props.listProps.ListFooterComponent.props.children.props.onPress(); });
  expect(discover).toHaveBeenCalled();
  const current = sheet.props.listProps.renderItem({ item: sheet.props.listProps.data[0], index: 0 }).props.children[1];
  expect(current.props.active).toBeUndefined();
  expect(current.props.accessibilityState).toEqual({ checked: true });
  expect(current.props.trailing.props.children).not.toBeNull();
  const item = sheet.props.listProps.data[1];
  const row = sheet.props.listProps.renderItem({ item, index: 1 }).props.children[1];
  act(() => { row.props.onPress(); });
  expect(save).toHaveBeenCalledWith({ key: 'other' }, true);
  expect(sheet.props.listProps.onEndReached).toBe(more);
  expect(sheet.props.fixedFooter).toBeUndefined();
  expect(sheet.props.listProps.ListFooterComponent.props.children.props.variant).toBe('secondary');
  expect(row.props.accessibilityState).toEqual({ checked: false });
  expect(row.props.trailing.props.children).toBeNull();
  const askEveryTime = sheet.props.fixedSubheader.props.children[1];
  expect(askEveryTime.props.variant).toBe('card');
  expect(askEveryTime.props.subtitle).toBe('applications.ask_every_time_notice');
  expect(askEveryTime.props.accessibilityRole).toBe('button');
  act(() => { askEveryTime.props.onPress(); });
  expect(save).toHaveBeenLastCalledWith(null);
});
