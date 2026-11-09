import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { StyleSheet, View } from 'react-native';
import { ApplicationTaskControls } from '../ApplicationTaskControls';
import { IconButton } from '@/components/common/IconButton';
import { platform } from '@/platform';
import type { ApplicationTasksPort } from '@/platform/ports/application-tasks';

jest.mock('@/platform', () => ({ platform: { napplet: {} } }));
jest.mock('@/components/common/IconButton', () => ({ IconButton: () => null }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('@/theme', () => ({ radius: { lg: 16 }, spacing: { xs: 4, sm: 8, lg: 16, xl: 24 },
  uiDensity: { headerActionSize: 40, headerActionIconSize: 24 }, useThemeColors: () => ({ text: 'text', surfaceElevated: 'surface', border: 'border', interactionOverlay: '#00000018' }) }));

let renderer: ReactTestRenderer | undefined;
let receive: (id: string, expanded: boolean, offsetY: number) => void;
const configureDrawer = jest.fn(async () => {}), releaseDrawer = jest.fn(async () => {}), unsubscribe = jest.fn();
const render = (active = true) => <ApplicationTaskControls taskId="task" active={active} enabled canGoBack canGoForward menuEnabled
  onBack={() => {}} onForward={() => {}} onMore={() => {}} />;
beforeEach(() => {
  jest.clearAllMocks();
  platform.napplet.tasks = { configureDrawer, releaseDrawer, onDrawerChange: (listener: typeof receive) => { receive = listener; return unsubscribe; } } as unknown as ApplicationTasksPort;
});
afterEach(() => {
  act(() => renderer?.unmount()); renderer = undefined;
  platform.napplet.tasks = undefined; jest.restoreAllMocks();
});
function mount() {
  jest.spyOn(jest.requireActual('react-native'), 'findNodeHandle').mockReturnValueOnce(42).mockReturnValueOnce(43);
  act(() => { renderer = create(render(), { createNodeMock: () => ({}) }); });
  act(() => { renderer!.root.findByProps({ testID: 'application-task-drawer' }).props.onLayout(); });
}

it('binds native direct manipulation only after both views have native layout', () => {
  mount();
  expect(configureDrawer).toHaveBeenLastCalledWith('task', expect.objectContaining({ viewTag: 42, handleTag: 43,
    active: true, expanded: false, travel: 144, margin: 8, feedbackColor: expect.any(Number) }));
  act(() => renderer!.update(render(false)));
  expect(configureDrawer).toHaveBeenLastCalledWith('task', expect.objectContaining({ active: false, expanded: false }));
  act(() => { renderer!.unmount(); }); renderer = undefined;
  expect(releaseDrawer).toHaveBeenCalledWith('task', 42);
  expect(unsubscribe).toHaveBeenCalled();
});

it('dismisses native-opened chrome on an outside tap without forwarding the tap to the document', () => {
  mount();
  act(() => { receive('other-task', true, 240); });
  expect(renderer!.root.findAllByProps({ testID: 'application-task-drawer-dismiss' })).toHaveLength(0);
  act(() => { receive('task', true, 240); });
  expect(renderer!.root.findByProps({ testID: 'application-task-drawer' }).props.style).toEqual(expect.objectContaining({
    opacity: 1, transform: [{ translateX: 0 }, { translateY: 240 }],
  }));
  const dismiss = renderer!.root.findByProps({ testID: 'application-task-drawer-dismiss' });
  act(() => { dismiss.props.onPress(); });
  expect(configureDrawer).toHaveBeenLastCalledWith('task', expect.objectContaining({ expanded: false }));
  expect(renderer!.root.findAllByProps({ testID: 'application-task-drawer-dismiss' })).toHaveLength(0);
});

it('keeps action hit testing at the native position after vertical movement and forwards More', () => {
  const onMore = jest.fn();
  act(() => { renderer = create(<ApplicationTaskControls taskId="task" enabled canGoBack canGoForward menuEnabled
    onBack={() => {}} onForward={() => {}} onMore={onMore} />); });
  act(() => { receive('task', false, 360); });
  expect(renderer!.root.findByProps({ testID: 'application-task-drawer' }).props.style.transform).toEqual([{ translateX: 144 }, { translateY: 360 }]);
  act(() => { receive('task', true, 180); });
  const drawer = renderer!.root.findByProps({ testID: 'application-task-drawer' });
  expect(drawer.props.style.transform).toEqual([{ translateX: 0 }, { translateY: 180 }]);
  act(() => { drawer.findAllByType(IconButton).at(-1)!.props.onPress(); });
  expect(onMore).toHaveBeenCalledTimes(1);
  expect(renderer!.root.findByProps({ testID: 'application-task-drawer' }).props.style.transform).toEqual([{ translateX: 144 }, { translateY: 180 }]);
});

it('passes input outside collapsed chrome through and paints the entire rectangular handle', () => {
  mount();
  const overlay = renderer!.root.findAllByType(View).find(view => Array.isArray(view.props.style))!;
  expect(StyleSheet.flatten(overlay.props.style).pointerEvents).toBe('box-none');
  expect(overlay.props.unstable_forceActive).toBeUndefined();
  const handle = renderer!.root.findAllByType(IconButton)[0];
  expect(handle.props).toEqual(expect.objectContaining({ width: 16, height: 56, shape: 'rectangle', hoverFeedback: false }));
  expect(handle.props.style).toBeUndefined();
});
