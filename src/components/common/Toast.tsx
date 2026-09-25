import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Reanimated, {
  cancelAnimation,
  Easing,
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useReanimatedKeyboardAnimation } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';

import { AppText } from '@/components/common/AppText';
import { toastKeyboardTranslateY } from '@/lib/layout/toast-keyboard-position';
import { useToastStore } from '@/stores/toast.store';
import { contentWidth, radius, spacing, useThemeColors } from '@/theme';

const VISIBLE_MS = 1800;
const ENTER_MS = 180;
const EXIT_MS = 220;
const ENTER_OFFSET = spacing.sm;

type Props = {
  /** Keep false for a mirror rendered inside a native modal. The root Toast
   * remains responsible for clearing the shared message. */
  managesLifetime?: boolean;
};

function hideToastIfCurrent(id: number) {
  const toast = useToastStore.getState();
  if (toast.id === id) toast.hide();
}

/**
 * The single global toast (rendered once at the root). A centered `surface`
 * capsule near the bottom that fades + lifts in, holds briefly, then fades out.
 * Driven by `toast.store`; `pointerEvents="none"` so it never blocks taps.
 */
export function Toast({ managesLifetime = true }: Props = {}) {
  const c = useThemeColors();
  const insets = useSafeAreaInsets();
  const message = useToastStore((s) => s.message);
  const id = useToastStore((s) => s.id);
  const keyboard = useReanimatedKeyboardAnimation();
  const visibility = useSharedValue(0);
  const animatedStyle = useAnimatedStyle(
    () => ({
      opacity: visibility.value,
      transform: [
        {
          translateY:
            toastKeyboardTranslateY(
              keyboard.height.value,
              keyboard.progress.value,
              insets.bottom,
            ) +
            (1 - visibility.value) * ENTER_OFFSET,
        },
      ],
    }),
    [insets.bottom],
  );

  useEffect(() => {
    if (!message) return;
    cancelAnimation(visibility);
    // eslint-disable-next-line react-hooks/immutability -- Reanimated shared values are mutable.
    visibility.value = 0;
    visibility.value = withTiming(1, {
      duration: ENTER_MS,
      easing: Easing.out(Easing.cubic),
      reduceMotion: ReduceMotion.System,
    });
    const timer = setTimeout(() => {
      visibility.value = withTiming(
        0,
        {
          duration: EXIT_MS,
          easing: Easing.out(Easing.cubic),
          reduceMotion: ReduceMotion.System,
        },
        (finished) => {
          if (finished && managesLifetime) scheduleOnRN(hideToastIfCurrent, id);
        },
      );
    }, VISIBLE_MS);
    return () => {
      clearTimeout(timer);
      cancelAnimation(visibility);
    };
  }, [id, managesLifetime, message, visibility]);

  if (!message) return null;

  return (
    <Reanimated.View
      pointerEvents="none"
      style={[
        {
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: insets.bottom + 80,
          zIndex: 1,
          alignItems: 'center',
          paddingHorizontal: 24,
        },
        animatedStyle,
      ]}
    >
      <View
        style={{
          maxWidth: contentWidth.toast,
          paddingHorizontal: 16,
          paddingVertical: 10,
          borderRadius: radius.full,
          backgroundColor: c.surfaceElevated,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: c.border,
        }}
      >
        <AppText variant="body" numberOfLines={2}>
          {message}
        </AppText>
      </View>
    </Reanimated.View>
  );
}
