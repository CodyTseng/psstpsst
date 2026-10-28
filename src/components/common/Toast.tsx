import { useEffect } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
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
import { DangerCircle } from '@solar-icons/react-native/category/ui/Linear/DangerCircle';
import { useIsRTL } from '@/i18n/direction';
import { toastKeyboardTranslateY } from '@/lib/layout/toast-keyboard-position';
import { toastPaneInsets } from '@/lib/layout/toast-pane-position';
import { isWideLayoutSize } from '@/lib/layout/wide-layout';
import { usePaneLayoutStore } from '@/stores/pane-layout.store';
import { useToastStore } from '@/stores/toast.store';
import { contentWidth, radius, spacing, useThemeColors } from '@/theme';

const VISIBLE_MS = 1800;
const ERROR_VISIBLE_MS = 4500;
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
 * The shared toast host. Centers in the window or a requested logical pane,
 * fades + lifts in, holds briefly, then fades out.
 * Driven by `toast.store`; `style.pointerEvents = 'none'` so it never blocks taps.
 */
export function Toast({ managesLifetime = true }: Props = {}) {
  const c = useThemeColors();
  const insets = useSafeAreaInsets();
  const message = useToastStore((s) => s.message);
  const id = useToastStore((s) => s.id);
  const target = useToastStore((s) => s.target);
  const variant = useToastStore((s) => s.variant);
  const isError = variant === 'error';
  const { width, height } = useWindowDimensions();
  const isRTL = useIsRTL();
  // Divider updates only render a host that is displaying a scoped message.
  const primaryWidth = usePaneLayoutStore((s) => message && target ? s.primaryWidth : null);
  const paneInsets = toastPaneInsets(
    target, width, isWideLayoutSize(width, height) ? primaryWidth : null, isRTL,
  );
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
    }, isError ? ERROR_VISIBLE_MS : VISIBLE_MS);
    return () => {
      clearTimeout(timer);
      cancelAnimation(visibility);
    };
  }, [id, isError, managesLifetime, message, visibility]);

  if (!message) return null;

  return (
    <Reanimated.View
      style={[
        {
          position: 'absolute',
          ...paneInsets,
          bottom: insets.bottom + 80,
          zIndex: 1,
          alignItems: 'center',
          paddingHorizontal: spacing.xl,
        },
        animatedStyle, { pointerEvents: 'none' }]}
    >
      <View
        accessibilityRole={isError ? 'alert' : undefined}
        accessibilityLiveRegion={isError ? 'assertive' : 'polite'}
        style={{
          maxWidth: contentWidth.toast,
          flexDirection: 'row',
          alignItems: 'center',
          gap: spacing.sm,
          paddingHorizontal: spacing.lg,
          paddingVertical: spacing.sm,
          borderRadius: radius.full,
          backgroundColor: isError ? c.dangerSoft : c.surfaceElevated,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: isError ? c.danger : c.border,
        }}
      >
        {isError ? <DangerCircle size={spacing.lg} color={c.danger} style={{ flexShrink: 0 }} /> : null}
        <AppText variant="body" tone={isError ? 'danger' : 'default'} numberOfLines={isError ? undefined : 2} style={{ flexShrink: 1 }}>
          {message}
        </AppText>
      </View>
    </Reanimated.View>
  );
}
