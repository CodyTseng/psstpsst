import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { ApplicationRuntimePage } from '../ApplicationRuntimePage';
import { ApplicationNavigation, APPLICATION_NAVIGATION_WIDTH } from '../ApplicationNavigation';
import { useDesktopWindowTitlebar } from '@/components/common/DesktopWindowFrame';
import { useApplicationNavigation } from '@/hooks/use-application-navigation';
import { ApplicationTaskContext } from '../ApplicationTaskContext';
import { IconButton } from '@/components/common/IconButton';
import { ScreenHeader } from '@/components/common/ScreenHeader';
import type { ExploreKind } from '@/services/explore/model';
import { AppScreen } from '@/components/common/AppScreen';
import { BackHandler, View } from 'react-native';
import { ApplicationTaskControls } from '../ApplicationTaskControls';


jest.mock('@/lib/platform', () => ({ IS_ANDROID: true }));
jest.mock('lucide-react-native/icons/chevron-left', () => () => null);
jest.mock('lucide-react-native/icons/chevron-right', () => () => null);
jest.mock('lucide-react-native/icons/x', () => () => null);
jest.mock('lucide-react-native/icons/ellipsis', () => () => null);
jest.mock('@solar-icons/react-native/category/arrows-action/Linear/SquareTopDown', () => ({ SquareTopDown: () => null }), { virtual: true });
jest.mock('@/hooks/use-application-navigation', () => ({ useApplicationNavigation: jest.fn(() => ({ canGoBack: false, canGoForward: false })) }));
jest.mock('@/platform', () => ({ platform: { napplet: {} } }));
jest.mock('@/platform/napplet-appearance', () => ({ useNappletAppearance: () => undefined }));
jest.mock('@/components/common/DesktopWindowFrame', () => ({ useDesktopWindowTitlebar: jest.fn() }));
jest.mock('@/components/common/AppScreen', () => ({ AppScreen: ({ children, windowOverlay }: { children: React.ReactNode; windowOverlay?: React.ReactNode }) => <>{children}{windowOverlay}</> }));
jest.mock('@/components/common/ScreenHeader', () => ({ ScreenHeader: () => null, useScreenHeaderClearance: () => 56 }));
jest.mock('@/components/common/IconButton', () => ({ IconButton: () => null }));
jest.mock('@/components/common/AppText', () => ({ AppText: () => null }));
jest.mock('@/components/common/AppButton', () => ({ AppButton: () => null }));
jest.mock('../ApplicationIcon', () => ({ APPLICATION_ICON_SIZE: 64, ApplicationIcon: () => null }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('@/theme', () => ({ ThemeColorsContext: jest.requireActual('react').createContext(null), radius: { lg: 16 }, shadow: { float: {} }, spacing: { xs: 4, sm: 8, lg: 16, xl: 24 }, uiDensity: { headerActionSize: 36, headerActionIconSize: 20 }, useThemeColors: () => ({ text: 'text' }) }));

beforeEach(() => { jest.mocked(useApplicationNavigation).mockReturnValue({ canGoBack: false, canGoForward: false }); });

it.each<[string | null, ExploreKind, boolean]>([[null, 'website', true], [null, 'napp', true], ['task', 'website', false], ['task', 'nsite', false], ['task', 'napp', false], ['task', 'napplet', false]])(
  'shows navigation/menu chrome for host=%s, kind=%s: %s', (task, kind, header) => {
    let renderer!: ReactTestRenderer;
    act(() => { renderer = create(<ApplicationTaskContext.Provider value={task}>
      <ApplicationRuntimePage application={{ title: 'Page', description: '', required: [], servers: [], kind }}
        menuEnabled onClose={() => {}} onMore={() => {}} onRetry={() => {}} />
    </ApplicationTaskContext.Provider>); });
    expect(renderer.root.findAllByType(ScreenHeader)).toHaveLength(header ? 1 : 0);
    expect(renderer.root.findByType(AppScreen).props.edges).toEqual(task ? ['top', 'bottom'] : ['bottom']);
    expect(renderer.root.findAllByType(View).some(view => view.props.style?.marginTop === (header ? 56 : 0))).toBe(true);
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
  expect(controls()[0].props.accessibilityLabel).toBe('applications.open_in_new_window');
  expect(controls()[1].props.accessibilityLabel).toBe('applications.runtime_more');
  act(() => { controls()[0].props.onPress(); });
  expect(onOpenWindow).toHaveBeenCalledTimes(1);
  act(() => renderer.update(render(true)));
  expect(controls()[0].props.disabled).toBe(true);
  act(() => renderer.unmount());
});

it.each([false, true])('keeps expand out of the independent host controls: windowed=%s', windowed => {
  let renderer!: ReactTestRenderer;
  act(() => { renderer = create(<ApplicationTaskContext.Provider value={windowed ? null : 'task'}>
    <ApplicationRuntimePage title="Website" windowed={windowed} menuEnabled onOpenWindow={() => {}}
      onClose={() => {}} onMore={() => {}} onRetry={() => {}} />
  </ApplicationTaskContext.Provider>); });
  expect(renderer.root.findAllByType(IconButton)).toHaveLength(windowed ? 0 : 4);
  expect(renderer.root.findAllByType(ApplicationTaskControls)).toHaveLength(windowed ? 0 : 1);
  expect(renderer.root.findAllByType(IconButton).some(button => button.props.accessibilityLabel === 'applications.open_in_new_window')).toBe(false);
  expect(renderer.root.findAllByType(ScreenHeader)).toHaveLength(0);
  act(() => renderer.unmount());
});

it('expands Android task controls, navigates once, and collapses before opening More', async () => {
  jest.mocked(useApplicationNavigation).mockReturnValue({ canGoBack: true, canGoForward: false });
  const onBack = jest.fn(async () => {}), onMore = jest.fn();
  let renderer!: ReactTestRenderer;
  await act(async () => { renderer = create(<ApplicationTaskContext.Provider value="task">
    <ApplicationRuntimePage containerId="page" menuEnabled onBack={onBack} onForward={() => {}}
      onClose={() => {}} onMore={onMore} onRetry={() => {}} />
  </ApplicationTaskContext.Provider>); });
  const controls = () => renderer.root.findByType(ApplicationTaskControls);
  const open = () => { act(() => { controls().findAllByType(IconButton)[0].props.onPress(); }); };
  open();
  expect(controls().findAllByType(IconButton)).toHaveLength(4);
  expect(controls().findByType(ApplicationNavigation).props.canGoForward).toBe(false);
  await act(async () => { controls().findByType(ApplicationNavigation).props.onBack(); });
  expect(onBack).toHaveBeenCalledTimes(1);
  expect(controls().findByProps({ importantForAccessibility: 'no-hide-descendants' })).toBeTruthy();
  open();
  act(() => { controls().findAllByType(IconButton).at(-1)!.props.onPress(); });
  expect(onMore).toHaveBeenCalledTimes(1);
  expect(controls().findByProps({ importantForAccessibility: 'no-hide-descendants' })).toBeTruthy();
  act(() => renderer.unmount());
});

it('consumes system Back while expanded and hides task controls behind host overlays', () => {
  const remove = jest.fn();
  const listener = jest.spyOn(BackHandler, 'addEventListener').mockReturnValue({ remove });
  let renderer!: ReactTestRenderer;
  const render = (navigationBlocked = false, active = true) => <ApplicationTaskContext.Provider value="task">
    <ApplicationRuntimePage containerId="page" active={active} navigationBlocked={navigationBlocked} menuEnabled
      onClose={() => {}} onMore={() => {}} onRetry={() => {}} />
  </ApplicationTaskContext.Provider>;
  act(() => { renderer = create(render()); });
  act(() => { renderer.root.findAllByType(IconButton)[0].props.onPress(); });
  const back = listener.mock.calls.at(-1)![1];
  act(() => { expect(back({ type: 'hardwareBackPress', timeStamp: 0 })).toBe(true); });
  expect(remove).toHaveBeenCalled();
  expect(renderer.root.findByProps({ importantForAccessibility: 'no-hide-descendants' })).toBeTruthy();
  act(() => renderer.update(render(true)));
  expect(renderer.root.findByType(ApplicationTaskControls).props.active).toBe(false);
  act(() => renderer.update(render(false, false)));
  expect(renderer.root.findByType(ApplicationTaskControls).props.active).toBe(false);
  act(() => renderer.unmount());
  listener.mockRestore();
});


it('disables root Back, enables it for history and reserves symmetric title space', async () => {
  let renderer!: ReactTestRenderer;
  const onBack = jest.fn(async () => {}), onForward = jest.fn(async () => {});
  await act(async () => { renderer = create(<ApplicationRuntimePage containerId="page" title="A very long page title" menuEnabled
    onBack={onBack} onForward={onForward} onClose={() => {}} onMore={() => {}} onRetry={() => {}} />); });
  const navigation = () => renderer.root.findByType(ScreenHeader).props.left.props.children[1];
  expect(navigation().props.enabled).toBe(true);
  expect(navigation().props.canGoBack).toBe(false);
  expect(navigation().props.canGoForward).toBe(false);
  await act(async () => { navigation().props.onBack(); });
  expect(onBack).not.toHaveBeenCalled();
  jest.mocked(useApplicationNavigation).mockReturnValue({ canGoBack: true, canGoForward: false });
  await act(async () => { renderer.update(<ApplicationRuntimePage containerId="page" menuEnabled
    onBack={onBack} onForward={onForward} onClose={() => {}} onMore={() => {}} onRetry={() => {}} />); });
  expect(navigation().props.canGoBack).toBe(true);
  await act(async () => { navigation().props.onBack(); });
  expect(onBack).toHaveBeenCalledTimes(1);
  expect(renderer.root.findByType(ScreenHeader).props.titleSideInset).toBe(36 + 4 + APPLICATION_NAVIGATION_WIDTH + 16);
  jest.mocked(useApplicationNavigation).mockReturnValue({ canGoBack: false, canGoForward: true });
  await act(async () => { renderer.update(<ApplicationRuntimePage containerId="page" menuEnabled navigationBlocked
    onBack={onBack} onForward={onForward} onClose={() => {}} onMore={() => {}} onRetry={() => {}} />); });
  expect(navigation().props.enabled).toBe(false);
  await act(async () => { navigation().props.onForward(); });
  expect(onForward).not.toHaveBeenCalled();
  act(() => renderer.unmount());
});

it('allows Back at a child root and blocks it while a host overlay is open', async () => {
  let renderer!: ReactTestRenderer;
  const onBack = jest.fn(async () => {});
  const render = (navigationBlocked = false) => <ApplicationRuntimePage containerId="child" menuEnabled canReturnToParent
    navigationBlocked={navigationBlocked} onBack={onBack} onForward={() => {}}
    onClose={() => {}} onMore={() => {}} onRetry={() => {}} />;
  await act(async () => { renderer = create(render()); });
  const navigation = () => renderer.root.findByType(ScreenHeader).props.left.props.children[1];
  expect(navigation().props.canGoBack).toBe(true);
  await act(async () => { navigation().props.onBack(); });
  expect(onBack).toHaveBeenCalledTimes(1);
  await act(async () => { renderer.update(render(true)); });
  expect(navigation().props.enabled).toBe(false);
  await act(async () => { navigation().props.onBack(); });
  expect(onBack).toHaveBeenCalledTimes(1);
  act(() => renderer.unmount());
});

it('publishes window navigation with its measured width to the single native titlebar', () => {
  let renderer!: ReactTestRenderer;
  act(() => { renderer = create(<ApplicationRuntimePage windowed containerId="page" title="Long window title" menuEnabled
    onBack={() => {}} onForward={() => {}} onClose={() => {}} onMore={() => {}} onRetry={() => {}} />); });
  expect(useDesktopWindowTitlebar).toHaveBeenLastCalledWith(expect.objectContaining({ title: 'Long window title',
    navigationWidth: APPLICATION_NAVIGATION_WIDTH, navigation: expect.objectContaining({ type: ApplicationNavigation }) }));
  act(() => renderer.unmount());
});
