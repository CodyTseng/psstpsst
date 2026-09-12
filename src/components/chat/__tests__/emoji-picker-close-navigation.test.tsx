import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { EmojiPickerSheet } from '../EmojiPickerSheet';

const mockPush = jest.fn();

jest.mock('expo-router', () => ({
  router: { push: (...args: unknown[]) => mockPush(...args) },
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock('react-native-keyboard-controller', () => ({
  useReanimatedKeyboardAnimation: () => ({
    height: { value: 0 },
    progress: { value: 0 },
  }),
}));

jest.mock('react-native-reanimated', () => {
  const { FlatList, View } = jest.requireActual('react-native') as typeof import('react-native');
  const timing = (
    value: number,
    _config?: unknown,
    completion?: (finished: boolean) => void,
  ) => {
    completion?.(true);
    return value;
  };
  return {
    __esModule: true,
    default: {
      View,
      createAnimatedComponent: () => FlatList,
    },
    Easing: {
      cubic: jest.fn(),
      in: () => jest.fn(),
      out: () => jest.fn(),
    },
    FadeIn: { duration: () => undefined },
    runOnJS: (callback: (...args: unknown[]) => unknown) => callback,
    useAnimatedScrollHandler: () => jest.fn(),
    useAnimatedStyle: (factory: () => unknown) => factory(),
    useSharedValue: (value: number) => ({ value }),
    withSpring: timing,
    withTiming: timing,
  };
});

jest.mock('react-native-gesture-handler', () => {
  const { View } = jest.requireActual('react-native') as typeof import('react-native');
  const gesture = {
    activeOffsetY: () => gesture,
    onEnd: () => gesture,
    onUpdate: () => gesture,
    simultaneousWithExternalGesture: () => gesture,
  };
  return {
    Gesture: {
      Native: () => gesture,
      Pan: () => gesture,
      Simultaneous: () => gesture,
    },
    GestureDetector: View,
    GestureHandlerRootView: View,
  };
});

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

jest.mock('@/hooks/use-add-custom-emoji', () => ({
  useAddCustomEmoji: () => jest.fn(),
}));

jest.mock('@/i18n/direction', () => ({
  useLanguageDirection: () => 'ltr',
}));

jest.mock('@/theme', () => ({
  contentWidth: { sheet: 600 },
  emojiPickerLayout: { horizontalGutter: 16 },
  emojiSize: { desktopGrid: {}, grid: {} },
  radius: { lg: 12, md: 8, '2xl': 24 },
  shadow: { float: {} },
  spacing: { sm: 8, md: 12, xl: 20 },
  useThemeColors: () => ({
    accent: '#000',
    accentSoft: '#000',
    background: '#fff',
    border: '#000',
    overlay: '#000',
    surfaceElevated: '#fff',
    surfaceMuted: '#fff',
    text: '#000',
    textMuted: '#000',
  }),
}));

jest.mock('@/components/common/SegmentedControl', () => ({
  SegmentedControl: () => null,
}));

jest.mock('../EmojiPickerPanel', () => {
  const React = jest.requireActual('react') as typeof import('react');
  const { Pressable } = jest.requireActual('react-native') as typeof import('react-native');
  return {
    EmojiPickerPanel: ({ onOpenEmojiPacks }: { onOpenEmojiPacks: () => void }) =>
      React.createElement(Pressable, {
        accessibilityLabel: 'emoji.my_packs',
        onPress: onOpenEmojiPacks,
      }),
  };
});

jest.mock('../emoji-picker-tabs', () => ({
  EmojiPickerTabs: () => null,
}));

jest.mock('../emoji-picker-search-field', () => ({
  EmojiPickerSearchField: () => null,
}));

describe('EmojiPickerSheet close navigation', () => {
  let renderer: ReactTestRenderer | null = null;

  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = null;
    mockPush.mockClear();
    jest.useRealTimers();
  });

  it('keeps the picker mounted until the packs action runs after close', () => {
    jest.useFakeTimers();

    function Owner() {
      const React = jest.requireActual('react') as typeof import('react');
      const [mounted, setMounted] = React.useState(true);
      const [visible, setVisible] = React.useState(true);

      return mounted ? (
        <EmojiPickerSheet
          visible={visible}
          initialMode="custom"
          onClose={() => setVisible(false)}
          onClosed={() => setMounted(false)}
          onSelect={() => {}}
        />
      ) : null;
    }

    act(() => {
      renderer = create(<Owner />);
    });
    act(() => {
      jest.runOnlyPendingTimers();
    });

    const packsTab = renderer!.root.findByProps({ accessibilityLabel: 'emoji.my_packs' });
    act(() => {
      packsTab.props.onPress();
    });
    expect(mockPush).not.toHaveBeenCalled();
    act(() => {
      jest.runAllTimers();
    });

    expect(mockPush).toHaveBeenCalledWith('/emoji-packs');
    expect(renderer!.toJSON()).toBeNull();
  });
});
