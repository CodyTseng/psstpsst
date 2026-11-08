import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { View } from 'react-native';
import { DesktopWindowFrame, useDesktopWindowTitlebar } from '../DesktopWindowFrame';

jest.mock('react-native', () => {
  const descriptors = Object.getOwnPropertyDescriptors(jest.requireActual('react-native'));
  descriptors.View = { value: 'View', enumerable: true, configurable: true };
  return Object.defineProperties({}, descriptors);
});
jest.mock('expo-router', () => ({ useFocusEffect: jest.fn() }));
jest.mock('@/lib/platform', () => ({ IS_ELECTRON: true, DESKTOP_OS: 'darwin' }));
jest.mock('@/platform', () => ({ platform: { windowChrome: { setTitle: jest.fn(async () => {}), setTheme: jest.fn(async () => {}) } } }));
jest.mock('@/stores/theme.store', () => ({ useThemeStore: (selector: (state: object) => unknown) => selector({ preference: 'system', accent: 'blue', loaded: true }) }));
jest.mock('@/theme', () => ({
  ThemeColorsContext: jest.requireActual('react').createContext(null),
  ...jest.requireActual('@/theme/layout'),
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
const fixture = (enabled: boolean) => <DesktopWindowFrame><Application enabled={enabled} /></DesktopWindowFrame>;

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
