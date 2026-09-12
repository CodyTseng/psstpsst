import { useRef, useState } from 'react';
import { Image } from 'expo-image';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { StyleSheet, View } from 'react-native';
import { GestureDetector } from 'react-native-gesture-handler';
import { cancelAnimation, withTiming } from 'react-native-reanimated';

import { IconButton } from '../IconButton';
import { ImagePointerPan } from '../ImagePointerPan';
import { ZoomableImage, type ZoomableImageHandle } from '../ZoomableImage';
import { MediaViewerTopBar } from '@/components/media/MediaViewerTopBar';
import { darkPalette, lightPalette } from '@/theme';

let mockElectron = true;
let mockThemePreference: 'light' | 'dark' = 'light';
jest.mock('@/lib/platform', () => ({ get IS_ELECTRON() { return mockElectron; } }));
jest.mock('@/stores/theme.store', () => ({
  useThemeStore: (selector: (state: { accent: 'blue'; preference: string }) => unknown) =>
    selector({ accent: 'blue', preference: mockThemePreference }),
}));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('@solar-icons/react-native/category/arrows-action/Linear/DownloadMinimalistic', () => ({ DownloadMinimalistic: () => null }), { virtual: true });
jest.mock('lucide-react-native/icons/x', () => ({ __esModule: true, default: () => null }), { virtual: true });
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0 }) }));
jest.mock('expo-image', () => ({ Image: () => null }));
jest.mock('lucide-react-native/icons/minus', () => ({ __esModule: true, default: () => null }), { virtual: true });
jest.mock('lucide-react-native/icons/plus', () => ({ __esModule: true, default: () => null }), { virtual: true });
jest.mock('react-native-gesture-handler', () => ({
  ...jest.requireActual('react-native-gesture-handler'),
  GestureDetector: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('../ImagePointerPan', () => jest.requireActual('../ImagePointerPan.web'));
jest.mock('react-native-reanimated', () => {
  const React = jest.requireActual('react') as typeof import('react');
  const { View } = jest.requireActual('react-native');
  return {
    __esModule: true,
    default: { View, createAnimatedComponent: (component: unknown) => component },
    useSharedValue: (value: number) => React.useRef({ value }).current,
    useAnimatedStyle: (factory: () => { transform: unknown }) => ({
      get transform() { return factory().transform; },
    }),
    runOnJS: (callback: unknown) => callback,
    withSpring: (value: number) => value,
    withTiming: jest.fn((value: number) => value),
    cancelAnimation: jest.fn(),
    Easing: { cubic: (x: number) => x * x * x, out: (ease: (x: number) => number) => (x: number) => 1 - ease(1 - x) },
    ReduceMotion: { System: 'system' },
  };
});

type TestGesture = {
  handlerName: string;
  config: { enabled?: boolean; numberOfTaps?: number; activeOffsetYStart?: number; activeCursor?: string };
  handlers: Record<string, (event: Record<string, number>, success?: boolean) => void>;
};

let renderer: ReactTestRenderer;
const close = jest.fn();
const zoomed = jest.fn();
const progress = jest.fn();
const button = (label: string) => renderer.root.findAllByType(IconButton)
  .find((node) => node.props.accessibilityLabel === `emoji.${label}`)!;
function press(label: string) { act(() => { button(label).props.onPress(); }); }
function gesture(name: string, taps?: number): TestGesture {
  return renderer.root.findByType(GestureDetector).props.gesture.toGestureArray()
    .find((g: TestGesture) => g.handlerName === name && (taps === undefined || g.config.numberOfTaps === taps));
}
function transform() {
  return StyleSheet.flatten(renderer.root.findByType(Image).parent!.props.style).transform;
}
function pan(x: number, y: number) {
  const g = gesture('PanGestureHandler');
  act(() => {
    g.handlers.onStart({});
    g.handlers.onUpdate({ translationX: x, translationY: y });
    g.handlers.onEnd({ velocityX: 0, velocityY: 0 }, true);
  });
}
function Harness() {
  const ref = useRef<ZoomableImageHandle>(null);
  const [scale, setScale] = useState(1);
  return <>
    <ZoomableImage ref={ref} onScaleChange={setScale} uri="test.png" dismissAxis="vertical"
      onRequestClose={close} onZoomedChange={zoomed} onDragProgress={progress} />
    <MediaViewerTopBar onClose={close} onSave={jest.fn()} imageZoom={{
      scale, zoomIn: () => ref.current?.zoomIn(), zoomOut: () => ref.current?.zoomOut(),
    }} />
  </>;
}
function mount() {
  act(() => {
    renderer = create(<Harness />);
  });
}

beforeEach(() => { jest.clearAllMocks(); mockElectron = true; mockThemePreference = 'light'; });
afterEach(() => { act(() => renderer?.unmount()); });

it('zooms within limits, pans cumulatively, and restores centering and paging at fit', () => {
  mount();
  expect(button('zoom_out').props.disabled).toBe(true);
  expect(gesture('PanGestureHandler').config.activeOffsetYStart).toBe(-15);
  press('zoom_in');
  expect(transform()).toEqual([{ translateX: 0 }, { translateY: 0 }, { scale: 1.25 }]);
  expect(zoomed).toHaveBeenLastCalledWith(true);
  expect(gesture('PanGestureHandler').config.activeOffsetYStart).toBeUndefined();
  expect(gesture('PanGestureHandler').config.activeCursor).toBe('grabbing');
  progress.mockClear();
  pan(80, -50);
  pan(20, 10);
  expect(transform()).toEqual([{ translateX: 100 }, { translateY: -40 }, { scale: 1.25 }]);
  expect(close).not.toHaveBeenCalled();
  expect(progress).not.toHaveBeenCalled();
  press('zoom_in');
  expect(transform()).toEqual([{ translateX: 125 }, { translateY: -50 }, { scale: 1.5625 }]);
  for (let i = 0; i < 10; i++) press('zoom_in');
  expect(button('zoom_in').props.disabled).toBe(true);
  expect(transform()[2]).toEqual({ scale: 4 });
  expect(zoomed).toHaveBeenCalledTimes(1);
  for (let i = 0; i < 10; i++) press('zoom_out');
  expect(button('zoom_out').props.disabled).toBe(true);
  expect(transform()).toEqual([{ translateX: 0 }, { translateY: 0 }, { scale: 1 }]);
  expect(zoomed).toHaveBeenLastCalledWith(false);
  expect(gesture('PanGestureHandler').config.activeOffsetYStart).toBe(-15);
});

it('keeps desktop controls in sync with pinch and browser double-click', () => {
  mount();
  expect(gesture('TapGestureHandler', 1).config.enabled).toBe(false);
  expect(gesture('TapGestureHandler', 2).config.enabled).toBe(false);
  const doubleClick = () => {
    act(() => { renderer.root.findByType('div').props.onDoubleClick({ preventDefault: jest.fn(), stopPropagation: jest.fn() }); });
  };
  doubleClick();
  expect(transform()[2]).toEqual({ scale: 2 });
  const pinch = gesture('PinchGestureHandler');
  act(() => { pinch.handlers.onUpdate({ scale: 3 }); pinch.handlers.onEnd({}, true); });
  expect(button('zoom_in').props.disabled).toBe(true);
  doubleClick();
  expect(button('zoom_out').props.disabled).toBe(true);
  expect(close).not.toHaveBeenCalled();
});

it('toggles exactly once per desktop double-click across consecutive zoom changes', () => {
  mount();
  for (const expectedScale of [2, 1, 2, 1, 2]) {
    // The touch recognizer runs at pointer-up, before the DOM dblclick event.
    // If both paths own this interaction, the first zoom is immediately undone.
    const tap = gesture('TapGestureHandler', 2);
    if (tap.config.enabled !== false) {
      act(() => { tap.handlers.onEnd({}, true); });
    }
    act(() => { renderer.root.findByType('div').props.onDoubleClick({ preventDefault: jest.fn(), stopPropagation: jest.fn() }); });
    expect(transform()[2]).toEqual({ scale: expectedScale });
  }
  expect(close).not.toHaveBeenCalled();
});

it.each(['light', 'dark'] as const)('uses themed controls outside the fixed gesture target in %s mode', (theme) => {
  mockThemePreference = theme;
  mount();
  const detector = renderer.root.findByType(GestureDetector);
  expect(detector.findAllByType(IconButton)).toHaveLength(0);
  expect(StyleSheet.flatten(detector.findAllByType(View)[0].props.style).transform).toBeUndefined();
  expect(detector.props.touchAction).toBe('none');
  expect(renderer.root.findByType(Image).props.draggable).toBe(false);
  const actions = renderer.root.findAllByType(IconButton);
  expect(actions.map((action) => action.props.accessibilityLabel)).toEqual([
    'common.close', 'emoji.zoom_out', 'emoji.zoom_in', 'attach.save',
  ]);
  expect(actions.every((action) => action.props.variant === 'overlay')).toBe(true);
  expect(new Set(actions.map((action) => action.props.size)).size).toBe(1);
  expect(button('zoom_in').parent).toBe(actions[3].parent);
  expect(button('zoom_in').props.icon.props.color).toBe(
    (theme === 'light' ? lightPalette : darkPalette).onOverlay,
  );
});

it('preserves mobile gestures without desktop controls', () => {
  mockElectron = false;
  mount();
  expect(button('zoom_in')).toBeUndefined();
  expect(button('zoom_out')).toBeUndefined();
  expect(gesture('TapGestureHandler', 2).config.enabled).toBe(true);
  act(() => { gesture('TapGestureHandler', 2).handlers.onEnd({}, true); });
  expect(transform()[2]).toEqual({ scale: 2 });
  act(() => { gesture('TapGestureHandler', 2).handlers.onEnd({}, true); });
  expect(transform()[2]).toEqual({ scale: 1 });
  pan(0, 150);
  expect(close).toHaveBeenCalledTimes(1);
});


it('moves the zoomed image through desktop pointer events and resumes from the last position', () => {
  mount();
  press('zoom_in');
  const surface = () => renderer.root.findByType('div');
  const target = {
    setPointerCapture: jest.fn(), hasPointerCapture: () => true, releasePointerCapture: jest.fn(),
  };
  const event = (clientX: number, clientY: number) => ({
    clientX, clientY, pointerId: 1, pointerType: 'mouse', button: 0,
    currentTarget: target, preventDefault: jest.fn(), stopPropagation: jest.fn(),
  });
  act(() => { surface().props.onPointerDownCapture(event(100, 100)); });
  act(() => { surface().props.onPointerMoveCapture(event(180, 50)); });
  expect(transform()).toEqual([{ translateX: 80 }, { translateY: -50 }, { scale: 1.25 }]);
  act(() => { surface().props.onPointerUpCapture(event(180, 50)); });
  act(() => { surface().props.onPointerDownCapture(event(180, 50)); });
  act(() => { surface().props.onPointerMoveCapture(event(200, 60)); });
  act(() => { surface().props.onPointerUpCapture(event(200, 60)); });
  expect(transform()).toEqual([{ translateX: 100 }, { translateY: -40 }, { scale: 1.25 }]);
  expect(close).not.toHaveBeenCalled();
  for (let i = 0; i < 2; i++) {
    act(() => { surface().props.onPointerDownCapture(event(200, 60)); });
    act(() => { surface().props.onPointerUpCapture(event(200, 60)); });
  }
  act(() => { surface().props.onDoubleClick({ preventDefault: jest.fn(), stopPropagation: jest.fn() }); });
  expect(transform()).toEqual([{ translateX: 0 }, { translateY: 0 }, { scale: 1 }]);
  expect(button('zoom_out').props.disabled).toBe(true);
});

it('zooms around the trackpad focus and pans incrementally with two fingers', () => {
  mount();
  const surface = () => renderer.root.findByType(ImagePointerPan);

  act(() => { surface().props.onWheelZoom(2, 100, -50); });
  expect(transform()).toEqual([{ translateX: -100 }, { translateY: 50 }, { scale: 2 }]);
  expect(button('zoom_out').props.disabled).toBe(false);
  expect(zoomed).toHaveBeenLastCalledWith(true);

  act(() => { surface().props.onWheelPan(30, -20); });
  expect(transform()).toEqual([{ translateX: -70 }, { translateY: 30 }, { scale: 2 }]);

  act(() => { surface().props.onWheelZoom(0.5, 100, -50); });
  expect(transform()).toEqual([{ translateX: 0 }, { translateY: 0 }, { scale: 1 }]);
  expect(button('zoom_out').props.disabled).toBe(true);
  expect(zoomed).toHaveBeenLastCalledWith(false);
});


it('retargets rapid zoom presses from the visible frame without shifting the image centre', () => {
  mount();
  press('zoom_in');
  pan(100, -40);
  // Sample an in-flight frame instead of completing the first animation.
  jest.mocked(withTiming).mockReturnValueOnce(110).mockReturnValueOnce(-44).mockReturnValueOnce(1.375);
  press('zoom_in');
  expect(transform()).toEqual([{ translateX: 110 }, { translateY: -44 }, { scale: 1.375 }]);
  press('zoom_in');
  expect(transform()).toEqual([{ translateX: 156.25 }, { translateY: -62.5 }, { scale: 1.953125 }]);
});

it('takes over a moving image from its visible position when dragging begins', () => {
  mount();
  press('zoom_in');
  pan(100, -40);
  jest.mocked(withTiming).mockReturnValueOnce(110).mockReturnValueOnce(-44).mockReturnValueOnce(1.375);
  press('zoom_in');
  jest.mocked(cancelAnimation).mockClear();
  pan(20, 10);
  expect(cancelAnimation).toHaveBeenCalledTimes(2);
  expect(transform()).toEqual([{ translateX: 130 }, { translateY: -34 }, { scale: 1.375 }]);
});
