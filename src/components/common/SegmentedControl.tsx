import { useCallback, useEffect, useRef, useState } from 'react';
import { type StyleProp, View, type ViewStyle } from 'react-native';

import { InteractivePressable as Pressable } from '@/components/common/InteractivePressable';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { useLanguageDirection } from '@/i18n/direction';
import { radius, spacing, uiDensity, useThemeColors } from '@/theme';

import { AppText } from './AppText';

type Option<T extends string> = {
  value: T;
  label: string;
};

type Props<T extends string> = {
  value: T;
  options: readonly Option<T>[];
  onChange: (value: T) => void;
  /** Shrink-wrap the control and size each tab from its label. */
  compact?: boolean;
  style?: StyleProp<ViewStyle>;
};

type TabLayout = {
  x: number;
  width: number;
};

type PendingTransition<T extends string> = {
  from: T;
  to: T;
  commit: boolean;
};

const SLIDE_DURATION = 220;

/** A two-or-three-way local mode switch with full-width and compact layouts. */
export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  compact = false,
  style,
}: Props<T>) {
  const c = useThemeColors();
  const direction = useLanguageDirection();
  const [visualValue, setVisualValue] = useState(value);
  const visualValueRef = useRef(value);
  const onChangeRef = useRef(onChange);
  const tabLayoutsRef = useRef<Record<string, TabLayout>>({});
  const pendingTransitionRef = useRef<PendingTransition<T> | null>(null);
  const indicatorGeometry = useSharedValue<[number, number]>([0, 0]);
  const indicatorOpacity = useSharedValue(0);
  const hasPositionedIndicator = useRef(false);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  const commitSelection = useCallback((nextValue: T) => {
    // A newer tap may have cancelled this transition just as its UI-thread
    // completion crossed back to JS. Only the latest visual target may commit.
    if (visualValueRef.current === nextValue) {
      onChangeRef.current(nextValue);
    }
  }, []);

  const placeIndicator = useCallback(
    (layout: TabLayout) => {
      indicatorGeometry.set([layout.x, layout.width]);
      indicatorOpacity.set(1);
      hasPositionedIndicator.current = true;
    },
    [indicatorGeometry, indicatorOpacity],
  );

  const animateIndicator = useCallback(
    (nextValue: T, layout: TabLayout, commit: boolean) => {
      // Position and width live in one vector so they share one animation clock
      // and cannot drift a frame apart.
      indicatorGeometry.set(
        withTiming<[number, number]>(
          [layout.x, layout.width],
          { duration: SLIDE_DURATION, easing: Easing.inOut(Easing.cubic) },
          (finished) => {
            if (finished && commit) runOnJS(commitSelection)(nextValue);
          },
        ),
      );
    },
    [commitSelection, indicatorGeometry],
  );

  const startTransition = useCallback(
    (from: T, to: T, commit: boolean) => {
      if (!hasPositionedIndicator.current) {
        const sourceLayout = tabLayoutsRef.current[from];
        if (sourceLayout) placeIndicator(sourceLayout);
      }

      const targetLayout = tabLayoutsRef.current[to];
      if (!hasPositionedIndicator.current || !targetLayout) {
        pendingTransitionRef.current = { from, to, commit };
        return;
      }

      pendingTransitionRef.current = null;
      animateIndicator(to, targetLayout, commit);
    },
    [animateIndicator, placeIndicator],
  );

  // A parent may change the controlled value without a tab press. Keep the
  // visual target in sync, but do not call the parent's handler back.
  useEffect(() => {
    if (visualValueRef.current === value) return;
    const previous = visualValueRef.current;
    visualValueRef.current = value;
    setVisualValue(value);
    startTransition(previous, value, false);
  }, [startTransition, value]);

  const indicatorStyle = useAnimatedStyle(() => ({
    opacity: indicatorOpacity.value,
    width: indicatorGeometry.value[1],
    transform: [{ translateX: indicatorGeometry.value[0] }],
  }));

  return (
    <View
      accessibilityRole="tablist"
      style={[
        {
          direction,
          height: uiDensity.segmentedControlHeight,
          padding: 3,
          flexDirection: 'row',
          gap: spacing.xs,
          alignSelf: compact ? 'center' : undefined,
          borderRadius: radius.full,
          backgroundColor: c.surfaceMuted,
        },
        style,
      ]}
    >
      <Animated.View
        style={[
          {
            position: 'absolute',
            top: 3,
            bottom: 3,
            left: 0,
            borderRadius: radius.full,
            backgroundColor: c.surfaceElevated,
          },
          indicatorStyle,
          { pointerEvents: 'none' },
        ]}
      />
      {options.map((option) => {
        const selected = option.value === visualValue;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            onPress={() => {
              if (option.value === visualValueRef.current) return;
              const previous = visualValueRef.current;
              visualValueRef.current = option.value;
              setVisualValue(option.value);
              // Move the lightweight indicator first. The parent swaps the
              // potentially expensive page only after this UI-thread animation
              // completes, so list mounting cannot interrupt the glide.
              startTransition(previous, option.value, true);
            }}
            onLayout={({ nativeEvent: { layout } }) => {
              const nextLayout = { x: layout.x, width: layout.width };
              const previousLayout = tabLayoutsRef.current[option.value];
              if (
                previousLayout?.x === nextLayout.x &&
                previousLayout.width === nextLayout.width
              ) {
                return;
              }
              tabLayoutsRef.current[option.value] = nextLayout;

              const pending = pendingTransitionRef.current;
              if (pending) {
                startTransition(pending.from, pending.to, pending.commit);
                return;
              }

              if (option.value !== visualValueRef.current) return;
              if (!hasPositionedIndicator.current) {
                // Initial selection is placed during layout, before any tap, so
                // the first actual change always has a real animation origin.
                placeIndicator(nextLayout);
              } else {
                animateIndicator(option.value, nextLayout, false);
              }
            }}
            style={{
              flex: compact ? undefined : 1,
              paddingHorizontal: compact ? spacing.lg : undefined,
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: radius.full,
              backgroundColor: 'transparent',
              zIndex: 1,
            }}
          >
            <AppText
              variant="body"
              weight="medium"
              style={{ color: selected ? c.text : c.textMuted }}
            >
              {option.label}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}
