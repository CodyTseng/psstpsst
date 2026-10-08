import { useMemo, type ReactNode } from 'react';
import { View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { Host } from '@expo/ui';

import { uiDensity, useThemeColors } from '@/theme';
import type { MediaSliderProps } from './MediaSlider.types';

/** Native slider gestures own their touch sequence instead of paging/dismissal. */
export function MediaSliderHost({ children, value, max = 1, disabled, accessibilityLabel, onSlidingStart, onValueChange, onSlidingComplete }: MediaSliderProps & { children: ReactNode }) {
  const c = useThemeColors();
  const gesture = useMemo(() => Gesture.Native().shouldCancelWhenOutside(false).shouldActivateOnStart(true).disallowInterruption(true), []);
  return (
    <GestureDetector gesture={gesture}>
      <View
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={accessibilityLabel}
        accessibilityState={{ disabled }}
        accessibilityValue={{ min: 0, max, now: value }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={(event) => {
          if (disabled) return;
          const delta = event.nativeEvent.actionName === 'increment' ? 1 : -1;
          const next = Math.min(max, Math.max(0, value + delta * max / 20));
          onSlidingStart?.();
          onValueChange(next);
          onSlidingComplete(next);
        }}
      >
        <Host
          style={{ height: uiDensity.inputHeight, width: '100%' }}
          colorScheme="dark"
          seedColor={c.onOverlay}
          layoutDirection="leftToRight"
          ignoreSafeArea="all"
        >
          {children}
        </Host>
      </View>
    </GestureDetector>
  );
}
