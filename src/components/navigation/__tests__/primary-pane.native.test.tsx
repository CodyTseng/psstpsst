import React from 'react';
import { StyleSheet, View } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { PrimaryPane } from '../PrimaryPane';

type GestureCallbacks = {
  onStart?: () => void;
  onUpdate?: (event: { translationX: number }) => void;
  onPanEnd?: () => void;
  onFinalize?: () => void;
  onDoubleTapEnd?: (event: object, success: boolean) => void;
};

const mockGestureCallbacks: GestureCallbacks = {};
let mockRTL = false;
let mockTapCount: number | undefined;
let mockStoredPrimaryWidth: number | null = null;
const mockSetPrimaryWidth = jest.fn();
const mockResetPrimaryWidth = jest.fn();

jest.mock('@/stores/touch-layout.store', () => ({
  useTouchLayoutStore: {
    getState: () => ({
      primaryWidth: mockStoredPrimaryWidth,
      setPrimaryWidth: mockSetPrimaryWidth,
      resetPrimaryWidth: mockResetPrimaryWidth,
    }),
  },
}));

jest.mock('react-native-gesture-handler', () => ({
  GestureDetector: ({ children }: { children: React.ReactNode }) => children,
  Gesture: {
    Pan: () => {
      const gesture = {} as {
        activeOffsetX: jest.Mock;
        failOffsetY: jest.Mock;
        onStart: jest.Mock;
        onUpdate: jest.Mock;
        onEnd: jest.Mock;
        onFinalize: jest.Mock;
      };
      gesture.activeOffsetX = jest.fn(() => gesture);
      gesture.failOffsetY = jest.fn(() => gesture);
      gesture.onStart = jest.fn((callback: GestureCallbacks['onStart']) => {
        mockGestureCallbacks.onStart = callback;
        return gesture;
      });
      gesture.onUpdate = jest.fn((callback: GestureCallbacks['onUpdate']) => {
        mockGestureCallbacks.onUpdate = callback;
        return gesture;
      });
      gesture.onEnd = jest.fn((callback: GestureCallbacks['onPanEnd']) => {
        mockGestureCallbacks.onPanEnd = callback;
        return gesture;
      });
      gesture.onFinalize = jest.fn((callback: GestureCallbacks['onFinalize']) => {
        mockGestureCallbacks.onFinalize = callback;
        return gesture;
      });
      return gesture;
    },
    Tap: () => {
      const gesture = {} as {
        numberOfTaps: jest.Mock;
        onEnd: jest.Mock;
      };
      gesture.numberOfTaps = jest.fn((count: number) => {
        mockTapCount = count;
        return gesture;
      });
      gesture.onEnd = jest.fn((callback: GestureCallbacks['onDoubleTapEnd']) => {
        mockGestureCallbacks.onDoubleTapEnd = callback;
        return gesture;
      });
      return gesture;
    },
    Race: (...gestures: unknown[]) => ({ gestures }),
  },
}));

jest.mock('react-native-reanimated', () => {
  const ReactModule = jest.requireActual<typeof React>('react');
  const { View: NativeView } = jest.requireActual<typeof import('react-native')>('react-native');

  return {
    __esModule: true,
    default: { View: NativeView },
    useSharedValue: (initial: unknown) => {
      const ref = ReactModule.useRef<{
        current: unknown;
        get: () => unknown;
        set: (next: unknown) => void;
      } | null>(null);
      if (!ref.current) {
        ref.current = {
          current: initial,
          get() { return this.current; },
          set(next) { this.current = next; },
        };
      }
      return ref.current;
    },
    useAnimatedStyle: (worklet: () => object) => worklet(),
  };
});

jest.mock('react-native-worklets', () => ({
  scheduleOnRN: (callback: (...args: never[]) => void, ...args: never[]) => callback(...args),
}));
jest.mock('@/i18n/direction', () => ({ useIsRTL: () => mockRTL }));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('@/theme', () => ({
  radius: { full: 9999 },
  spacing: { xs: 4, lg: 16 },
  useThemeColors: () => ({
    border: 'border',
    accent: 'accent',
  }),
}));

beforeEach(() => {
  mockRTL = false;
  mockStoredPrimaryWidth = null;
  mockSetPrimaryWidth.mockClear();
  mockResetPrimaryWidth.mockClear();
});

it('resizes the touch pane on the UI thread without rerendering its content', () => {
  const contentRender = jest.fn();
  function Content() {
    contentRender();
    return <View />;
  }
  const child = <Content />;
  let renderer!: ReactTestRenderer;

  act(() => {
    renderer = create(<PrimaryPane windowWidth={1024}>{child}</PrimaryPane>);
  });

  const handle = () => renderer.root.findByProps({ accessibilityRole: 'adjustable' });
  const pane = () => renderer.root.findAllByType(View)[0];
  expect(handle().props.accessibilityValue).toEqual({ min: 280, max: 560, now: 410 });
  expect(mockTapCount).toBe(2);
  expect(StyleSheet.flatten(pane().props.style).zIndex).toBe(1);

  act(() => {
    mockGestureCallbacks.onStart?.();
    mockGestureCallbacks.onUpdate?.({ translationX: 100 });
    mockGestureCallbacks.onPanEnd?.();
    mockGestureCallbacks.onFinalize?.();
  });

  expect(StyleSheet.flatten(pane().props.style).width).toBe(510);
  expect(handle().props.accessibilityValue.now).toBe(510);
  expect(mockSetPrimaryWidth).toHaveBeenLastCalledWith(510);
  expect(contentRender).toHaveBeenCalledTimes(1);

  act(() => {
    handle().props.onAccessibilityAction({ nativeEvent: { actionName: 'decrement' } });
  });
  expect(handle().props.accessibilityValue.now).toBe(494);

  mockRTL = true;
  act(() => {
    renderer.update(<PrimaryPane windowWidth={1024}>{child}</PrimaryPane>);
  });
  act(() => {
    mockGestureCallbacks.onStart?.();
    mockGestureCallbacks.onUpdate?.({ translationX: 100 });
    mockGestureCallbacks.onPanEnd?.();
    mockGestureCallbacks.onFinalize?.();
  });
  expect(handle().props.accessibilityValue.now).toBe(394);

  act(() => {
    mockGestureCallbacks.onDoubleTapEnd?.({}, true);
  });
  expect(handle().props.accessibilityValue.now).toBe(410);
  expect(mockResetPrimaryWidth).toHaveBeenCalledTimes(1);

  act(() => {
    handle().props.onAccessibilityAction({ nativeEvent: { actionName: 'increment' } });
    handle().props.onAccessibilityAction({ nativeEvent: { actionName: 'activate' } });
  });
  expect(handle().props.accessibilityValue.now).toBe(410);
  expect(mockSetPrimaryWidth).toHaveBeenLastCalledWith(426);
  expect(mockResetPrimaryWidth).toHaveBeenCalledTimes(2);
  expect(contentRender).toHaveBeenCalledTimes(1);
});

it('keeps the default width responsive until the user customizes it', () => {
  let renderer!: ReactTestRenderer;

  act(() => {
    renderer = create(<PrimaryPane windowWidth={700}><View /></PrimaryPane>);
  });

  const handle = () => renderer.root.findByProps({ accessibilityRole: 'adjustable' });
  expect(handle().props.accessibilityValue.now).toBe(280);

  act(() => {
    renderer.update(<PrimaryPane windowWidth={1024}><View /></PrimaryPane>);
  });
  expect(handle().props.accessibilityValue.now).toBe(410);
  expect(mockSetPrimaryWidth).not.toHaveBeenCalled();
  expect(mockResetPrimaryWidth).not.toHaveBeenCalled();
});

it('restores the preferred width without overwriting it when the window is narrower', () => {
  mockStoredPrimaryWidth = 540;
  let renderer!: ReactTestRenderer;

  act(() => {
    renderer = create(<PrimaryPane windowWidth={800}><View /></PrimaryPane>);
  });

  const handle = () => renderer.root.findByProps({ accessibilityRole: 'adjustable' });
  expect(handle().props.accessibilityValue).toEqual({ min: 280, max: 520, now: 520 });
  expect(mockSetPrimaryWidth).not.toHaveBeenCalled();

  act(() => {
    renderer.update(<PrimaryPane windowWidth={1024}><View /></PrimaryPane>);
  });
  expect(handle().props.accessibilityValue.now).toBe(540);
  expect(mockSetPrimaryWidth).not.toHaveBeenCalled();
});
