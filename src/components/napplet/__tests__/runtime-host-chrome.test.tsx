import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { ApplicationRuntimePage } from '../ApplicationRuntimePage';
import { ApplicationTaskContext } from '../ApplicationTaskContext';
import { IconButton } from '@/components/common/IconButton';
import { ScreenHeader } from '@/components/common/ScreenHeader';
import type { ExploreKind } from '@/services/explore/model';

jest.mock('@/lib/platform', () => ({ IS_ANDROID: true }));
jest.mock('lucide-react-native/icons/x', () => () => null);
jest.mock('lucide-react-native/icons/ellipsis', () => () => null);
jest.mock('@solar-icons/react-native/category/arrows-action/Linear/MaximizeSquareMinimalistic', () => ({ MaximizeSquareMinimalistic: () => null }), { virtual: true });
jest.mock('@/platform', () => ({ platform: { napplet: {} } }));
jest.mock('@/platform/napplet-appearance', () => ({ useNappletAppearance: () => undefined }));
jest.mock('@/components/common/DesktopWindowFrame', () => ({ useDesktopWindowTitlebar: jest.fn() }));
jest.mock('@/components/common/AppScreen', () => ({ AppScreen: ({ children }: { children: React.ReactNode }) => children }));
jest.mock('@/components/common/ScreenHeader', () => ({ ScreenHeader: () => null, useScreenHeaderClearance: () => 56 }));
jest.mock('@/components/common/IconButton', () => ({ IconButton: () => null }));
jest.mock('@/components/common/AppText', () => ({ AppText: () => null }));
jest.mock('@/components/common/AppButton', () => ({ AppButton: () => null }));
jest.mock('../NappletIcon', () => ({ NappletIcon: () => null }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('@/theme', () => ({ spacing: { xs: 4, lg: 16, xl: 24 }, uiDensity: { headerActionSize: 36, headerActionIconSize: 20 }, useThemeColors: () => ({ text: 'text' }) }));

it.each<[string | null, ExploreKind, boolean]>([[null, 'website', true], [null, 'napp', true], ['task', 'website', false], ['task', 'nsite', false], ['task', 'napp', false]])(
  'shows navigation/menu chrome for host=%s, kind=%s: %s', (task, kind, header) => {
    let renderer!: ReactTestRenderer;
    act(() => { renderer = create(<ApplicationTaskContext.Provider value={task}>
      <ApplicationRuntimePage application={{ title: 'Page', description: '', required: [], servers: [], kind }}
        menuEnabled onClose={() => {}} onMore={() => {}} onRetry={() => {}} />
    </ApplicationTaskContext.Provider>); });
    expect(renderer.root.findAllByType(ScreenHeader)).toHaveLength(header ? 1 : 0);
    act(() => renderer.unmount());
  },
);

it('places the expand action before More and disables it while opening', () => {
  let renderer!: ReactTestRenderer;
  const onOpenWindow = jest.fn();
  const render = (openingWindow = false) => <ApplicationRuntimePage title="Website" menuEnabled
    onOpenWindow={onOpenWindow} openingWindow={openingWindow} onClose={() => {}} onMore={() => {}} onRetry={() => {}} />;
  act(() => { renderer = create(render()); });
  const controls = () => renderer.root.findByType(ScreenHeader).props.right.props.children;
  expect(controls()[0].props.accessibilityLabel).toBe('napplets.open_in_new_window');
  expect(controls()[1].props.accessibilityLabel).toBe('napplets.runtime_more');
  act(() => { controls()[0].props.onPress(); });
  expect(onOpenWindow).toHaveBeenCalledTimes(1);
  act(() => renderer.update(render(true)));
  expect(controls()[0].props.disabled).toBe(true);
  act(() => renderer.unmount());
});

it.each([false, true])('omits expand chrome in an independent Android host or Electron window: windowed=%s', windowed => {
  let renderer!: ReactTestRenderer;
  act(() => { renderer = create(<ApplicationTaskContext.Provider value={windowed ? null : 'task'}>
    <ApplicationRuntimePage title="Website" windowed={windowed} menuEnabled onOpenWindow={() => {}}
      onClose={() => {}} onMore={() => {}} onRetry={() => {}} />
  </ApplicationTaskContext.Provider>); });
  expect(renderer.root.findAllByType(IconButton)).toHaveLength(0);
  act(() => renderer.unmount());
});
