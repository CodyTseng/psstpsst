import { useEffect, useRef } from 'react';
import { Animated, Platform, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/common/AppText';
import { useToastStore } from '@/stores/toast.store';
import { contentWidth, radius, useThemeColors } from '@/theme';

const VISIBLE_MS = 1800;

/**
 * The single global toast (rendered once at the root). A centered `surface`
 * capsule near the bottom that fades + lifts in, holds briefly, then fades out.
 * Driven by `toast.store`; `pointerEvents="none"` so it never blocks taps.
 */
export function Toast() {
  const c = useThemeColors();
  const insets = useSafeAreaInsets();
  const message = useToastStore((s) => s.message);
  const id = useToastStore((s) => s.id);

  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!message) return;
    anim.setValue(0);
    Animated.timing(anim, { toValue: 1, duration: 180, useNativeDriver: Platform.OS !== 'web' }).start();
    const timer = setTimeout(() => {
      Animated.timing(anim, { toValue: 0, duration: 220, useNativeDriver: Platform.OS !== 'web' }).start(
        ({ finished }) => {
          if (finished) useToastStore.getState().hide();
        },
      );
    }, VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [id, message, anim]);

  if (!message) return null;

  return (
    <Animated.View
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: insets.bottom + 80,
        alignItems: 'center',
        paddingHorizontal: 24,
        opacity: anim,
        transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) }],
        pointerEvents: 'none',
      }}
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
    </Animated.View>
  );
}
