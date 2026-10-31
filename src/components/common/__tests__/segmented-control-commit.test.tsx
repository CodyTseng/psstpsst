import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { InteractivePressable } from '../InteractivePressable';
import { SegmentedControl } from '../SegmentedControl';

const mockCompletions: (() => void)[] = [];
jest.mock('../InteractivePressable', () => ({ InteractivePressable: () => null }));
jest.mock('../AppText', () => ({ AppText: () => null }));
jest.mock('@/i18n/direction', () => ({ useLanguageDirection: () => 'ltr' }));
jest.mock('@/theme', () => ({
  spacing: { xs: 4 }, radius: { full: 999 }, uiDensity: { segmentedControlHeight: 32 }, useThemeColors: () => ({}),
}));
jest.mock('react-native-reanimated', () => ({
  __esModule: true,
  default: { View: jest.requireActual('react-native').View },
  Easing: { inOut: () => () => 0, cubic: () => 0 },
  runOnJS: (callback: unknown) => callback,
  useAnimatedStyle: (callback: () => unknown) => callback(),
  useSharedValue: (value: unknown) => jest.requireActual('react').useRef({ value, set(next: unknown) { this.value = next; } }).current,
  withTiming: (value: unknown, _config: unknown, completed?: (finished: boolean) => void) => {
    if (completed) mockCompletions.push(() => completed(true));
    return value;
  },
}));

it.each([false, true])('uses the configured change timing (deferChange: %s)', deferChange => {
  const onChange = jest.fn();
  let renderer!: ReactTestRenderer;
  act(() => { renderer = create(<SegmentedControl value="am" options={[{ value: 'am', label: 'AM' }, { value: 'pm', label: 'PM' }]} onChange={onChange} deferChange={deferChange} />); });
  const tabs = renderer.root.findAllByType(InteractivePressable);
  act(() => {
    tabs[0].props.onLayout({ nativeEvent: { layout: { x: 0, width: 100 } } });
    tabs[1].props.onLayout({ nativeEvent: { layout: { x: 100, width: 100 } } });
  });
  act(() => { tabs[1].props.onPress(); });
  expect(onChange).toHaveBeenCalledTimes(deferChange ? 0 : 1);
  act(() => { mockCompletions.splice(0).forEach(finish => finish()); });
  expect(onChange).toHaveBeenCalledTimes(1);
  expect(onChange).toHaveBeenCalledWith('pm');
  act(() => renderer.unmount());
});
