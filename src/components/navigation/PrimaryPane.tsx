import { useCallback, useLayoutEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { useIsRTL } from '@/i18n/direction';
import {
  clampTouchPrimaryPaneWidth,
  getPrimaryPaneWidth,
} from '@/lib/layout/wide-layout';
import { useTouchLayoutStore } from '@/stores/touch-layout.store';
import { radius, spacing, useThemeColors } from '@/theme';
import { wideLayout } from '@/theme/layout';

export type PrimaryPaneProps = { windowWidth: number; children: ReactNode };

export function PrimaryPane({ windowWidth, children }: PrimaryPaneProps) {
  const c = useThemeColors();
  const { t } = useTranslation();
  const isRTL = useIsRTL();
  const [requestedWidth, setRequestedWidth] = useState<number | null>(() => (
    useTouchLayoutStore.getState().primaryWidth
  ));
  const preferredWidth = requestedWidth ?? getPrimaryPaneWidth(windowWidth);
  const initialWidth = clampTouchPrimaryPaneWidth(windowWidth, preferredWidth);
  const paneWidth = useSharedValue(initialWidth);
  const dragStartWidth = useSharedValue(initialWidth);
  const dragging = useSharedValue(false);
  const displayedWidth = clampTouchPrimaryPaneWidth(windowWidth, preferredWidth);
  const defaultWidth = clampTouchPrimaryPaneWidth(windowWidth, getPrimaryPaneWidth(windowWidth));
  const maximumWidth = clampTouchPrimaryPaneWidth(windowWidth, wideLayout.primaryMaxWidth);

  useLayoutEffect(() => {
    paneWidth.set(clampTouchPrimaryPaneWidth(windowWidth, preferredWidth));
  }, [paneWidth, preferredWidth, windowWidth]);

  const commitWidth = useCallback((width: number) => {
    setRequestedWidth(width);
    useTouchLayoutStore.getState().setPrimaryWidth(width);
  }, []);

  const resetWidth = useCallback(() => {
    setRequestedWidth(null);
    useTouchLayoutStore.getState().resetPrimaryWidth();
  }, []);

  const resize = useMemo(() => {
    const pan = Gesture.Pan()
      .activeOffsetX([-spacing.xs, spacing.xs])
      .failOffsetY([-spacing.lg, spacing.lg])
      .onStart(() => {
        dragging.set(true);
        dragStartWidth.set(paneWidth.get());
      })
      .onUpdate((event) => {
        const next = dragStartWidth.get() + event.translationX * (isRTL ? -1 : 1);
        paneWidth.set(clampTouchPrimaryPaneWidth(windowWidth, next));
      })
      .onEnd(() => {
        scheduleOnRN(commitWidth, paneWidth.get());
      })
      .onFinalize(() => {
        dragging.set(false);
      });
    const doubleTap = Gesture.Tap()
      .numberOfTaps(2)
      .onEnd((_event, success) => {
        if (!success) return;
        paneWidth.set(defaultWidth);
        scheduleOnRN(resetWidth);
      });

    return Gesture.Race(pan, doubleTap);
  }, [commitWidth, defaultWidth, dragStartWidth, dragging, isRTL, paneWidth, resetWidth, windowWidth]);

  const paneStyle = useAnimatedStyle(() => ({ width: paneWidth.get() }));
  const activeIndicatorStyle = useAnimatedStyle(() => ({
    opacity: dragging.get() ? 1 : 0,
  }));

  const adjustWidth = useCallback((delta: number) => {
    const next = clampTouchPrimaryPaneWidth(windowWidth, displayedWidth + delta);
    paneWidth.set(next);
    commitWidth(next);
  }, [commitWidth, displayedWidth, paneWidth, windowWidth]);

  return (
    <Animated.View style={[{
      flexShrink: 0,
      // The centered touch target extends into the detail pane. Keep this pane
      // above its later-rendered sibling so the grip remains fully visible and
      // draggable from either side of the divider.
      zIndex: 1,
      borderEndWidth: StyleSheet.hairlineWidth,
      borderEndColor: c.border,
    }, paneStyle]}>
      {children}
      <GestureDetector gesture={resize}>
        <Animated.View
          accessibilityRole="adjustable"
          accessibilityLabel={t('common.resize_sidebar')}
          accessibilityValue={{
            min: wideLayout.primaryMinWidth,
            max: maximumWidth,
            now: displayedWidth,
          }}
          accessibilityActions={[
            { name: 'increment' },
            { name: 'decrement' },
            { name: 'activate' },
          ]}
          onAccessibilityAction={(event) => {
            if (event.nativeEvent.actionName === 'increment') {
              adjustWidth(wideLayout.paneResizeKeyboardStep);
            } else if (event.nativeEvent.actionName === 'decrement') {
              adjustWidth(-wideLayout.paneResizeKeyboardStep);
            } else if (event.nativeEvent.actionName === 'activate') {
              paneWidth.set(defaultWidth);
              resetWidth();
            }
          }}
          style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            end: -wideLayout.paneResizeTouchWidth / 2,
            width: wideLayout.paneResizeTouchWidth,
            zIndex: 1,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <View style={{
            position: 'absolute',
            width: wideLayout.paneResizeIndicatorWidth,
            height: wideLayout.paneResizeIndicatorHeight,
            borderRadius: radius.full,
            backgroundColor: c.border,
          }} />
          <Animated.View style={[{
            position: 'absolute',
            width: wideLayout.paneResizeIndicatorWidth,
            height: wideLayout.paneResizeIndicatorHeight,
            borderRadius: radius.full,
            backgroundColor: c.accent,
          }, activeIndicatorStyle]} />
        </Animated.View>
      </GestureDetector>
    </Animated.View>
  );
}
