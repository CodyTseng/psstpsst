import { useEffect } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { StyleSheet, View } from 'react-native';
import { GestureDetector } from 'react-native-gesture-handler';

import { MediaTouchPager } from '../MediaTouchPager';

let mockRTL = false;
let mockReducedMotion = false;
jest.mock('@/i18n/direction', () => ({ useIsRTL: () => mockRTL }));
jest.mock('react-native-gesture-handler', () => ({
  ...jest.requireActual('react-native-gesture-handler'),
  GestureDetector: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('react-native-worklets', () => ({
  scheduleOnRN: (callback: (step: number) => void, step: number) => callback(step),
}));
jest.mock('react-native-reanimated', () => {
  const React = jest.requireActual('react') as typeof import('react');
  return {
    __esModule: true,
    default: { View: jest.requireActual('react-native').View, createAnimatedComponent: (component: unknown) => component },
    useSharedValue: (value: number | boolean) => React.useRef({
      value,
      get() { return this.value; },
      set(next: number | boolean) { this.value = next; },
    }).current,
    useAnimatedStyle: (factory: () => { transform: unknown }) => ({
      get transform() { return factory().transform; },
    }),
    useReducedMotion: () => mockReducedMotion,
    cancelAnimation: jest.fn(),
    withSpring: (value: number, _config: unknown, callback?: (finished: boolean) => void) => {
      callback?.(true);
      return value;
    },
  };
});

type TestGesture = {
  config: Record<string, unknown>;
  handlers: Record<string, (event: Record<string, number>, success?: boolean) => void>;
};
let renderer: ReactTestRenderer;
const onPage = jest.fn();
const mounted = jest.fn();
const unmounted = jest.fn();
function Player() {
  useEffect(() => { mounted(); return () => { unmounted(); }; }, []);
  return <View testID="player" />;
}
function render(width = 400, height = 800, pageKey = 'video', previous = true, next = true) {
  const element = <MediaTouchPager width={width} height={height} pageKey={pageKey} enabled
    previous={previous ? <View testID="previous" /> : undefined}
    next={next ? <View testID="next" /> : undefined} onPage={onPage}>
    <Player />
  </MediaTouchPager>;
  act(() => { if (renderer) renderer.update(element); else renderer = create(element); });
}
function drag(translationX: number, velocityX = 0, success = true) {
  const { handlers } = renderer.root.findByType(GestureDetector).props.gesture as TestGesture;
  act(() => {
    handlers.onStart({});
    handlers.onUpdate({ translationX });
    if (success) handlers.onEnd({ translationX, velocityX });
    handlers.onFinalize({}, success);
  });
}
const translation = () => StyleSheet.flatten(renderer.root.findByProps({ testID: 'media-current-surface' }).props.style).transform;
beforeEach(() => { jest.clearAllMocks(); mockRTL = false; mockReducedMotion = false; });
afterEach(() => { act(() => renderer.unmount()); renderer = undefined as unknown as ReactTestRenderer; });

it('retains the player and clears an unfinished drag when the viewport rotates', () => {
  render();
  const gesture = renderer.root.findByType(GestureDetector).props.gesture as TestGesture;
  act(() => gesture.handlers.onUpdate({ translationX: -60 }));
  expect(translation()).toEqual([{ translateX: -60 }]);
  render(800, 400);
  expect(translation()).toEqual([{ translateX: 0 }]);
  expect(mounted).toHaveBeenCalledTimes(1);
  expect(unmounted).not.toHaveBeenCalled();
});

it('positions previews outside the native viewport without pixel widths', () => {
  render();
  expect(StyleSheet.flatten(renderer.root.findByProps({ testID: 'previous' }).parent?.props.style)).toMatchObject({ start: '-100%', end: '100%' });
  expect(StyleSheet.flatten(renderer.root.findByProps({ testID: 'next' }).parent?.props.style)).toMatchObject({ start: '100%', end: '-100%' });
});

it.each([[false, -120, 1], [false, 120, -1], [true, 120, 1], [true, -120, -1]])(
  'pages in the correct reading direction (RTL=%s, distance=%s)', (rtl, distance, step) => {
    mockRTL = rtl;
    render();
    drag(distance);
    expect(onPage).toHaveBeenCalledWith(step);
  },
);

it('restores a cancelled or short swipe and cannot page beyond the loaded edge', () => {
  render(400, 800, 'video', false, false);
  drag(-120);
  drag(120);
  drag(-60, 0, false);
  expect(onPage).not.toHaveBeenCalled();
  expect(translation()).toEqual([{ translateX: 0 }]);
});

it('supports fast swipes with Reduce Motion without moving the surface', () => {
  mockReducedMotion = true;
  render();
  drag(-20, -1000);
  expect(onPage).toHaveBeenCalledWith(1);
  expect(translation()).toEqual([{ translateX: 0 }]);
});
