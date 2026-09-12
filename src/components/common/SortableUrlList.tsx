/* eslint-disable react-hooks/immutability -- Reanimated SharedValue updates are intentional in UI-thread gesture worklets. */
import GripVertical from 'lucide-react-native/icons/grip-vertical';
import { useEffect } from 'react';
import { View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  runOnJS,
  type SharedValue,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { iconStrokeWidth } from '@/theme/icons';
import { radius, spacing, uiDensity, useThemeColors } from '@/theme';

import { AppCard } from './AppCard';
import { AppText } from './AppText';
import { CloseIcon } from './CloseIcon';
import { IconButton } from './IconButton';

type Props = {
  value: string[];
  onChange: (next: string[]) => void;
  onRemove: (url: string) => void;
  removeAccessibilityLabel: string;
};

type Slots = Record<string, number>;

const ROW_HEIGHT = uiDensity.listRowTwoLineHeight;
const ROW_GAP = spacing.sm;
const ROW_STEP = ROW_HEIGHT + ROW_GAP;
const HANDLE_WIDTH = spacing['2xl'];
const LONG_PRESS_MS = 180;
const MOVE_MS = 160;
const EASE_OUT = Easing.out(Easing.cubic);
const AnimatedAppCard = Animated.createAnimatedComponent(AppCard);

function moveSlot(slots: Slots, from: number, to: number): Slots {
  'worklet';
  const next: Slots = {};
  for (const key in slots) {
    const at = slots[key];
    if (at === from) next[key] = to;
    else if (from < to && at > from && at <= to) next[key] = at - 1;
    else if (from > to && at < from && at >= to) next[key] = at + 1;
    else next[key] = at;
  }
  return next;
}

export function SortableUrlList({ value, onChange, onRemove, removeAccessibilityLabel }: Props) {
  const slots = useSharedValue<Slots>(Object.fromEntries(value.map((url, index) => [url, index])));
  const orderKey = value.join('\n');
  const height = value.length * ROW_HEIGHT + Math.max(0, value.length - 1) * ROW_GAP;

  useEffect(() => {
    slots.value = Object.fromEntries(value.map((url, index) => [url, index]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderKey]);

  function commitOrder() {
    const positions = slots.value;
    const next = [...value].sort((a, b) => (positions[a] ?? 0) - (positions[b] ?? 0));
    onChange(next);
  }

  return (
    <View style={{ height }}>
      {value.map((url, index) => (
        <SortableUrlRow
          key={url}
          url={url}
          index={index}
          count={value.length}
          slots={slots}
          onCommit={commitOrder}
          onRemove={onRemove}
          removeAccessibilityLabel={removeAccessibilityLabel}
        />
      ))}
    </View>
  );
}

type RowProps = {
  url: string;
  index: number;
  count: number;
  slots: SharedValue<Slots>;
  onCommit: () => void;
  onRemove: (url: string) => void;
  removeAccessibilityLabel: string;
};

function SortableUrlRow({
  url,
  index,
  count,
  slots,
  onCommit,
  onRemove,
  removeAccessibilityLabel,
}: RowProps) {
  const c = useThemeColors();
  const y = useSharedValue(index * ROW_STEP);
  const dragging = useSharedValue(false);
  const startY = useSharedValue(0);

  useAnimatedReaction(
    () => slots.value[url],
    (slot, prev) => {
      if (slot != null && slot !== prev && !dragging.value) {
        y.value = withTiming(slot * ROW_STEP, { duration: MOVE_MS, easing: EASE_OUT });
      }
    },
  );

  const pan = Gesture.Pan()
    .enabled(count > 1)
    .activateAfterLongPress(LONG_PRESS_MS)
    .onStart(() => {
      dragging.value = true;
      startY.value = slots.value[url] * ROW_STEP;
    })
    .onUpdate((event) => {
      y.value = startY.value + event.translationY;
      const from = slots.value[url];
      const to = Math.max(0, Math.min(count - 1, Math.round(y.value / ROW_STEP)));
      if (to !== from) slots.value = moveSlot(slots.value, from, to);
    })
    .onEnd(() => {
      y.value = withTiming(slots.value[url] * ROW_STEP, { duration: MOVE_MS, easing: EASE_OUT });
    })
    .onFinalize(() => {
      if (dragging.value) {
        dragging.value = false;
        runOnJS(onCommit)();
      }
    });

  const rowStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: y.value },
      { scale: withTiming(dragging.value ? 1.02 : 1, { duration: MOVE_MS, easing: EASE_OUT }) },
    ],
    zIndex: dragging.value ? 1 : 0,
    backgroundColor: dragging.value ? c.surfaceMuted : c.surfaceElevated,
  }));

  return (
    <GestureDetector gesture={pan}>
      <AnimatedAppCard
        variant="outlined"
        style={[
          {
            position: 'absolute',
            start: 0,
            end: 0,
            top: 0,
            height: ROW_HEIGHT,
            flexDirection: 'row',
            alignItems: 'center',
            gap: spacing.md,
            paddingVertical: 0,
            paddingStart: spacing.sm,
            paddingEnd: spacing.sm,
            borderRadius: radius.xl,
          },
          rowStyle,
        ]}
      >
        <View
          style={{
            width: HANDLE_WIDTH,
            alignItems: 'center',
            justifyContent: 'center',
            pointerEvents: 'none',
          }}
        >
          <GripVertical strokeWidth={iconStrokeWidth.default} size={20} color={c.textMuted} />
        </View>

        <View style={{ flex: 1 }}>
          <AppText variant="code" numberOfLines={1}>
            {url}
          </AppText>
        </View>

        <IconButton
          onPress={() => onRemove(url)}
          hitSlop={spacing.sm}
          size={spacing['2xl']}
          icon={<CloseIcon size={16} color={c.textMuted} />}
          accessibilityLabel={removeAccessibilityLabel}
        />
      </AnimatedAppCard>
    </GestureDetector>
  );
}
