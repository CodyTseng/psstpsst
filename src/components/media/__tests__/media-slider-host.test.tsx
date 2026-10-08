import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { View } from 'react-native';
import { GestureDetector } from 'react-native-gesture-handler';

import { MediaSliderHost } from '../MediaSliderHost';

jest.mock('@expo/ui', () => ({ Host: ({ children }: { children: React.ReactNode }) => children }));
jest.mock('@/theme', () => ({ uiDensity: { inputHeight: 48 }, useThemeColors: () => ({ onOverlay: 'white' }) }));
jest.mock('react-native-gesture-handler', () => ({
  ...jest.requireActual('react-native-gesture-handler'),
  GestureDetector: ({ children }: { children: React.ReactNode }) => children,
}));

it('retains a native scrub outside its bounds and keeps accessibility seeking available', () => {
  const start = jest.fn();
  const change = jest.fn();
  const complete = jest.fn();
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(<MediaSliderHost value={20} max={100} accessibilityLabel="Seek"
      onSlidingStart={start} onValueChange={change} onSlidingComplete={complete}>{null}</MediaSliderHost>);
  });
  expect(renderer.root.findByType(GestureDetector).props.gesture.config).toMatchObject({
    shouldCancelWhenOutside: false,
    shouldActivateOnStart: true,
    disallowInterruption: true,
  });
  act(() => {
    renderer.root.findByType(View).props.onAccessibilityAction({ nativeEvent: { actionName: 'increment' } });
  });
  expect(start).toHaveBeenCalledTimes(1);
  expect(change).toHaveBeenCalledWith(25);
  expect(complete).toHaveBeenCalledWith(25);
  act(() => renderer.unmount());
});
