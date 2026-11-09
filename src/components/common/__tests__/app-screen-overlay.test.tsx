import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppScreen, AppScreenHorizontalSafeArea } from '../AppScreen';

jest.mock('@/theme', () => ({ useThemeColors: () => ({ background: 'background' }), useEffectiveColorScheme: () => 'light' }));
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: ({ children }: { children: React.ReactNode }) => children }));

it.each([['left', 'right'], ['right']] as const)('keeps window chrome outside horizontal content insets: %s', (...horizontalEdges) => {
  let renderer!: ReactTestRenderer;
  act(() => { renderer = create(<AppScreenHorizontalSafeArea edges={horizontalEdges}>
    <AppScreen edges={['top', 'bottom']} windowOverlay={<View testID="drawer" />}>
      <View testID="document" />
    </AppScreen>
  </AppScreenHorizontalSafeArea>); });
  const [content, overlay] = renderer.root.findAllByType(SafeAreaView);
  expect(content.props.edges).toEqual([...horizontalEdges, 'top', 'bottom']);
  expect(content.findAllByProps({ testID: 'drawer' })).toHaveLength(0);
  expect(overlay.props.edges).toEqual(['top', 'bottom']);
  expect(StyleSheet.flatten(overlay.props.style)).toMatchObject({ left: 0, right: 0, top: 0, bottom: 0, pointerEvents: 'box-none' });
  expect(overlay.findAllByProps({ testID: 'document' })).toHaveLength(0);
  expect(overlay.findByProps({ testID: 'drawer' })).toBeTruthy();
  act(() => renderer.unmount());
});
