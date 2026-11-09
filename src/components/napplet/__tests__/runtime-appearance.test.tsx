import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { StatusBar, StyleSheet, Text, View } from 'react-native';
import { ApplicationRuntimePage } from '../ApplicationRuntimePage';
import { ApplicationTaskControls } from '../ApplicationTaskControls';
import { ScreenHeader } from '@/components/common/ScreenHeader';
import { ChromeBackdrop } from '@/components/common/ChromeBackdrop';
import { IconButton } from '@/components/common/IconButton';
import { AppText } from '@/components/common/AppText';
import { useThemeColors } from '@/theme';
import { darkPalette, lightPalette } from '@/theme/palette';
import { pageAppearance, type PageAppearance } from '@/lib/page-appearance';
import { useDesktopWindowTitlebar } from '@/components/common/DesktopWindowFrame';

let mockScheme: 'light' | 'dark' = 'light';
let mockAppearance: PageAppearance | undefined;
jest.mock('@/theme', () => {
  const React = jest.requireActual('react');
  const ThemeColorsContext = React.createContext(null);
  const palettes = jest.requireActual('@/theme/palette');
  const { density, contentWidth } = jest.requireActual('@/theme/layout');
  return {
    ThemeColorsContext, contentWidth, uiDensity: density.mobile, headerHeight: density.mobile.headerHeight,
    spacing: jest.requireActual('@/theme/spacing').spacing,
    radius: { lg: 16 }, shadow: { float: {} },
    ...jest.requireActual('@/theme/typography'),
    useEffectiveColorScheme: () => mockScheme,
    useThemeColors: () => React.useContext(ThemeColorsContext) ?? (mockScheme === 'dark' ? palettes.darkPalette : palettes.lightPalette),
  };
});
jest.mock('@/lib/platform', () => ({ IS_ELECTRON: false, DESKTOP_OS: 'darwin' }));
jest.mock('@/lib/navigation', () => ({ backSafely: jest.fn() }));
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: jest.requireActual('react-native').View, useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }) }));
jest.mock('@/platform', () => ({ platform: { napplet: {} } }));
jest.mock('@/platform/napplet-appearance', () => ({ useNappletAppearance: () => mockAppearance }));
jest.mock('@/hooks/use-application-updates', () => ({ useApplicationUpdates: jest.fn() }));
jest.mock('@/hooks/use-application-navigation', () => ({ useApplicationNavigation: () => ({ canGoBack: true, canGoForward: false }) }));
jest.mock('@/components/common/DesktopWindowFrame', () => ({ useDesktopWindowTitlebar: jest.fn() }));
jest.mock('@/components/common/IconButton', () => ({ IconButton: () => null }));
jest.mock('@/components/common/AppButton', () => ({ AppButton: () => null }));
jest.mock('@/components/common/AppProgressBar', () => ({ AppProgressBar: () => null }));
jest.mock('@/components/common/FrostedBackdrop', () => ({ FrostedBackdrop: () => null }));
jest.mock('@/components/common/ChromeDivider', () => ({ ChromeDivider: () => null }));
jest.mock('../ApplicationIcon', () => ({ APPLICATION_ICON_SIZE: 64, ApplicationIcon: () => null }));
jest.mock('lucide-react-native/icons/x', () => () => null);
jest.mock('lucide-react-native/icons/chevron-left', () => () => null);
jest.mock('lucide-react-native/icons/chevron-right', () => () => null);
jest.mock('lucide-react-native/icons/ellipsis', () => () => null);
jest.mock('@solar-icons/react-native/category/arrows-action/Linear/SquareTopDown', () => ({ SquareTopDown: () => null }), { virtual: true });

function HostOverlay() {
  const colors = useThemeColors();
  return <View testID="host-overlay" style={{ backgroundColor: colors.background }} />;
}
function Fixture({ loading = false, error, windowed = false }: { loading?: boolean; error?: string; windowed?: boolean }) {
  return <ApplicationRuntimePage containerId="app" title="Application" active windowed={windowed} menuEnabled loading={loading} error={error}
    onClose={() => {}} onBack={() => {}} onForward={() => {}} onMore={() => {}} onRetry={() => {}} overlay={<HostOverlay />} />;
}
let renderer: ReactTestRenderer;
afterEach(() => { act(() => renderer?.unmount()); });

it.each([
  ['light', '#121212', true, '#ffffff'],
  ['dark', '#ffffff', false, '#000000'],
  ['light', '#154c79', true, '#ffffff'],
  ['dark', '#facc15', false, '#000000'],
] as const)('matches header, icons and status text to %s-host document %s', (scheme, background, dark, foreground) => {
  mockScheme = scheme; mockAppearance = pageAppearance(background);
  act(() => { renderer = create(<Fixture />); });
  expect(renderer.root.findByType(StatusBar).props.barStyle).toBe(dark ? 'light-content' : 'dark-content');
  const header = renderer.root.findByType(ScreenHeader);
  const backdrop = header.findByType(ChromeBackdrop);
  expect(backdrop.findAllByType(View).some(view => StyleSheet.flatten(view.props.style)?.backgroundColor === background)).toBe(true);
  expect(StyleSheet.flatten(header.findByType(AppText).findByType(Text).props.style).color).toBe(foreground);
  for (const button of header.findAllByType(IconButton)) expect(button.props.icon.props.color).toBe(foreground);
  expect(renderer.root.findByProps({ testID: 'host-overlay' }).props.style.backgroundColor).toBe((scheme === 'dark' ? darkPalette : lightPalette).background);
});

it('tracks live document colors and falls back to the host for loading, errors and missing hints', () => {
  mockScheme = 'light'; mockAppearance = pageAppearance('#121212');
  act(() => { renderer = create(<Fixture />); });
  expect(renderer.root.findByType(StatusBar).props.barStyle).toBe('light-content');
  for (const props of [{ loading: true }, { error: 'applications.request_failed' }]) {
    act(() => { renderer.update(<Fixture {...props} />); });
    expect(renderer.root.findByType(StatusBar).props.barStyle).toBe('dark-content');
    const close = renderer.root.findAllByType(IconButton).find(button => button.props.accessibilityLabel === 'common.close');
    expect(close!.props.icon.props.color).toBe(lightPalette.text);
  }
  mockAppearance = pageAppearance('#ffffff');
  act(() => { renderer.update(<Fixture />); });
  expect(renderer.root.findAllByType(IconButton)[0].props.icon.props.color).toBe('#000000');
  mockAppearance = undefined;
  act(() => { renderer.update(<Fixture />); });
  expect(renderer.root.findAllByType(IconButton)[0].props.icon.props.color).toBe(lightPalette.text);
});

it('passes the same document palette to the independent desktop titlebar', () => {
  mockScheme = 'dark'; mockAppearance = pageAppearance('#facc15');
  act(() => { renderer = create(<Fixture windowed />); });
  expect(useDesktopWindowTitlebar).toHaveBeenLastCalledWith(expect.objectContaining({ colors: expect.objectContaining({
    background: '#facc15', surfaceMuted: '#facc15', text: '#000000',
  }) }));
});

it.each(['light', 'dark'] as const)('keeps task controls on the %s host palette over a contrasting document', scheme => {
  mockScheme = scheme; mockAppearance = pageAppearance(scheme === 'light' ? '#121212' : '#ffffff');
  const palette = scheme === 'dark' ? darkPalette : lightPalette;
  act(() => { renderer = create(<ApplicationTaskControls enabled canGoBack canGoForward menuEnabled
    onBack={() => {}} onForward={() => {}} onMore={() => {}} />); });
  act(() => { renderer.root.findAllByType(IconButton)[0].props.onPress(); });
  expect(renderer.root.findAllByType(View).some(view => StyleSheet.flatten(view.props.style)?.backgroundColor === palette.surfaceElevated)).toBe(true);
  for (const button of renderer.root.findAllByType(IconButton)) expect(button.props.icon.props.color).toBe(palette.text);
});
