import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { View } from 'react-native';
import { platform } from '@/platform';
import { DesktopWindowFrame, useDesktopWindowTitlebar } from '../DesktopWindowFrame';

jest.mock('react-native', () => {
  const descriptors = Object.getOwnPropertyDescriptors(jest.requireActual('react-native'));
  descriptors.View = { value: 'View', enumerable: true, configurable: true };
  return Object.defineProperties({}, descriptors);
});
jest.mock('expo-router', () => ({ useFocusEffect: jest.fn() }));
let mockDesktopOs = 'darwin';
jest.mock('@/lib/platform', () => ({ IS_ELECTRON: true, get DESKTOP_OS() { return mockDesktopOs; } }));
jest.mock('@/platform', () => ({ platform: { windowChrome: { setTitle: jest.fn(async () => {}), setTheme: jest.fn(async () => {}) } } }));
jest.mock('@/stores/theme.store', () => ({ useThemeStore: (selector: (state: object) => unknown) => selector({ preference: 'system', accent: 'blue', loaded: true }) }));
jest.mock('@/theme', () => ({
  ThemeColorsContext: jest.requireActual('react').createContext(null),
  ...jest.requireActual('@/theme/layout'),
  get desktopChrome() { return jest.requireActual('@/theme/desktop-chrome').desktopChromeForPlatform(mockDesktopOs); },
  uiDensity: jest.requireActual('@/theme/layout').density.desktop,
  spacing: jest.requireActual('@/theme/spacing').spacing,
  useThemeColors: () => jest.requireActual('@/theme/palette').lightPalette,
}));
jest.mock('../AppText', () => ({ AppText: () => null }));

const navigation = <View testID="navigation-buttons" />;
function Application({ enabled }: { enabled: boolean }) {
  useDesktopWindowTitlebar(enabled ? { title: 'Application', navigation, navigationWidth: 76 } : null);
  return null;
}
const fixture = (enabled: boolean, applicationWindow = false) => <DesktopWindowFrame applicationWindow={applicationWindow}><Application enabled={enabled} /></DesktopWindowFrame>;

beforeEach(() => { mockDesktopOs = 'darwin'; jest.clearAllMocks(); });

it('keeps navigation outside the drag region when an application registers after the titlebar mounts', () => {
  const properties = new Map<string, string>();
  const node = { style: {
    setProperty: jest.fn((key: string, value: string) => { properties.set(key, value); }),
    removeProperty: jest.fn((key: string) => { properties.delete(key); }),
  } };
  let renderer!: ReactTestRenderer;
  act(() => { renderer = create(fixture(false), { createNodeMock: element => (element.props as { testID?: string }).testID === 'desktop-window-navigation'
    ? node : { style: { setProperty: jest.fn(), removeProperty: jest.fn() } } }); });
  const wrapper = renderer.root.findByProps({ testID: 'desktop-window-navigation' });
  expect(renderer.root.findAllByProps({ testID: 'navigation-buttons' })).toHaveLength(0);
  expect(properties.get('-webkit-app-region')).toBe('no-drag');

  act(() => renderer.update(fixture(true)));
  expect(renderer.root.findByProps({ testID: 'desktop-window-navigation' })).toBe(wrapper);
  expect(renderer.root.findAllByProps({ testID: 'navigation-buttons' }).length).toBeGreaterThan(0);
  expect(properties.get('-webkit-app-region')).toBe('no-drag');

  act(() => renderer.update(fixture(false)));
  act(() => renderer.update(fixture(true)));
  expect(renderer.root.findByProps({ testID: 'desktop-window-navigation' })).toBe(wrapper);
  expect(properties.get('-webkit-app-region')).toBe('no-drag');
  act(() => renderer.unmount());
  expect(properties.has('-webkit-app-region')).toBe(false);
});


it.each(['darwin', 'win32', 'linux'])('keeps application chrome fixed before, during and after content registration on %s', os => {
  mockDesktopOs = os;
  let renderer!: ReactTestRenderer;
  const options = { createNodeMock: () => ({ style: { setProperty: jest.fn(), removeProperty: jest.fn() } }) };
  act(() => { renderer = create(fixture(false, true), options); });
  const titlebar = () => renderer.root.findByProps({ testID: 'desktop-window-titlebar' });
  expect(titlebar().props.style.height).toBe(44);
  expect(platform.windowChrome.setTheme).toHaveBeenCalledWith(expect.objectContaining({ titlebarHeight: 44 }));
  act(() => renderer.update(fixture(true, true)));
  expect(titlebar().props.style.height).toBe(44);
  act(() => renderer.update(fixture(false, true)));
  expect(titlebar().props.style.height).toBe(44);
  expect(jest.mocked(platform.windowChrome.setTheme).mock.calls.every(([theme]) => theme.titlebarHeight === 44)).toBe(true);
  act(() => renderer.unmount());
});
