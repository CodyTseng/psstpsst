import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { StyleSheet, View } from 'react-native';
import { GestureDetector } from 'react-native-gesture-handler';
import type { SharedValue } from 'react-native-reanimated';

import { MediaDismissSurface } from '../MediaDismissSurface';

let mockElectron = false;
let mockReducedMotion = false;
jest.mock('@/lib/platform', () => ({ get IS_ELECTRON() { return mockElectron; } }));
jest.mock('react-native-gesture-handler', () => ({
  ...jest.requireActual('react-native-gesture-handler'),
  GestureDetector: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('react-native-worklets', () => ({
  scheduleOnRN: (callback: () => void) => callback(),
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
    withSpring: (value: number) => value,
  };
});

type TestGesture = {
  config: Record<string, unknown>;
  handlers: Record<string, (event: Record<string, number>, success?: boolean) => void>;
};
let renderer: ReactTestRenderer;
let opacity: { value: number; get: () => number; set: (next: number) => void };
const close = jest.fn();
const gesture = () => renderer.root.findByType(GestureDetector).props.gesture as TestGesture;
const translation = () => StyleSheet.flatten(
  renderer.root.findByType(GestureDetector).findAllByType(View)[1].props.style,
).transform;
function mount(active = true) {
  act(() => { renderer = create(
    <MediaDismissSurface active={active} backdrop={opacity as SharedValue<number>} onRequestClose={close}>
      {null}
    </MediaDismissSurface>,
  ); });
}
function drag(distance: number, velocity: number, success = true) {
  const { handlers } = gesture();
  act(() => {
    handlers.onStart({});
    handlers.onUpdate({ translationY: distance });
    if (success) handlers.onEnd({ velocityY: velocity }, true);
    handlers.onFinalize({}, success);
  });
}
beforeEach(() => {
  jest.clearAllMocks();
  mockElectron = false;
  mockReducedMotion = false;
  opacity = { value: 1, get() { return this.value; }, set(next) { this.value = next; } };
});
afterEach(() => act(() => renderer?.unmount()));

it.each([[150, 0], [-150, 0], [20, 1200], [-20, -1200]])(
  'closes for a vertical drag of %s with velocity %s', (distance, velocity) => {
    mount();
    drag(distance, velocity);
    expect(close).toHaveBeenCalledTimes(1);
    expect(translation()).toEqual([{ translateY: distance }]);
    expect(opacity.value).toBeLessThan(1);
  },
);

it.each([true, false])('restores content and backdrop after an uncommitted drag (success=%s)', (success) => {
  mount();
  drag(60, 0, success);
  expect(close).not.toHaveBeenCalled();
  expect(translation()).toEqual([{ translateY: 0 }]);
  expect(opacity.value).toBe(1);
});

it('lets horizontal swipes and native taps win before vertical activation', () => {
  mount();
  expect(gesture().config).toMatchObject({
    activeOffsetYStart: -15, activeOffsetYEnd: 15,
    failOffsetXStart: -15, failOffsetXEnd: 15, maxPointers: 1,
  });
  act(() => gesture().handlers.onFinalize({}, false));
  expect(close).not.toHaveBeenCalled();
});

it('preserves dismissal without displacement under Reduce Motion', () => {
  mockReducedMotion = true;
  mount();
  drag(150, 0);
  expect(close).toHaveBeenCalledTimes(1);
  expect(translation()).toEqual([{ translateY: 0 }]);
});

it('disables gestures for neighbouring pages and Electron', () => {
  mount(false);
  expect(gesture().config.enabled).toBe(false);
  mockElectron = true;
  act(() => renderer.update(
    <MediaDismissSurface active backdrop={opacity as SharedValue<number>} onRequestClose={close}>
      {null}
    </MediaDismissSurface>,
  ));
  expect(gesture().config.enabled).toBe(false);
});
