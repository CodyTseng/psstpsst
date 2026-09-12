import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  type SharedValue,
} from 'react-native-reanimated';

import { AppText } from '@/components/common/AppText';
import { EmojiPickerSheet } from '@/components/chat/EmojiPickerSheet';
import { CustomEmojiImage } from '@/components/emoji/CustomEmojiImage';
import type { CustomEmoji, EmojiPack } from '@/lib/nostr/custom-emoji';
import {
  quickReactionKey,
  quickReactionLabel,
  type QuickReaction,
} from '@/lib/nostr/quick-reaction';
import { emojiSize, radius, spacing, uiDensity, useThemeColors } from '@/theme';

// Gap between tiles; tile size is derived from the measured panel width so all
// slots always fit on one row (the pill is horizontal — WYSIWYG with it).
const GAP = spacing.sm;
// How far a tile must travel before drag-reorder takes over from a tap.
const LONG_PRESS_MS = 180;

type Slot = Record<string, number>;

/** Reindex the slot map when the tile at `from` is dropped onto `to`. */
function moveSlot(slots: Slot, from: number, to: number): Slot {
  'worklet';
  const next: Slot = {};
  for (const key in slots) {
    const at = slots[key];
    if (at === from) next[key] = to;
    else if (from < to && at > from && at <= to) next[key] = at - 1;
    else if (from > to && at < from && at >= to) next[key] = at + 1;
    else next[key] = at;
  }
  return next;
}

type Props = {
  /** The current quick reactions, in display order. */
  value: QuickReaction[];
  /** Called with the next ordered set when a slot is changed or reordered. */
  onChange: (next: QuickReaction[]) => void;
  customPacks?: EmojiPack[];
  standaloneCustomEmojis?: CustomEmoji[];
};

/**
 * The quick-reactions editor (DESIGN §8): a row of emoji tiles inside one
 * `surfaceElevated` panel matching the `ListGroup` cards. **Long-press a tile to
 * drag-reorder** it (horizontal, mirroring the pill); **tap** one to open the
 * full `EmojiPickerSheet` and replace it — picking an emoji that already
 * occupies another slot swaps the two, so the set stays unique and the count
 * fixed. The single place quick reactions are edited.
 */
export function QuickReactionsEditor({
  value,
  onChange,
  customPacks = [],
  standaloneCustomEmojis = [],
}: Props) {
  const c = useThemeColors();
  const [editing, setEditing] = useState<number | null>(null);
  const [rowWidth, setRowWidth] = useState(0);

  const n = value.length;
  const tile = rowWidth > 0 ? Math.floor((rowWidth - GAP * (n - 1)) / n) : 0;
  const step = tile + GAP;

  // Slot map (stable reaction identity -> current index) drives every tile on the UI
  // thread; React's `value` order is the committed source of truth.
  const slots = useSharedValue<Slot>(
    Object.fromEntries(value.map((reaction, index) => [quickReactionKey(reaction), index])),
  );
  useEffect(() => {
    slots.value = Object.fromEntries(
      value.map((reaction, index) => [quickReactionKey(reaction), index]),
    );
  }, [value, slots]);

  function commitOrder() {
    const pos = slots.value;
    const next: QuickReaction[] = [];
    for (const reaction of value) {
      next[pos[quickReactionKey(reaction)]] = reaction;
    }
    onChange(next);
  }

  function replaceSlot(slot: number, reaction: QuickReaction) {
    setEditing(null);
    const reactionId = quickReactionKey(reaction);
    const existing = value.findIndex(
      (candidate) => quickReactionKey(candidate) === reactionId,
    );
    if (existing === slot) return; // unchanged
    const next = [...value];
    if (existing !== -1) next[existing] = next[slot]; // swap to keep the set unique
    next[slot] = reaction;
    onChange(next);
  }

  return (
    <>
      <View
        style={{
          padding: uiDensity.cardPadding,
          borderRadius: radius.lg,
          backgroundColor: c.surfaceElevated,
        }}
      >
        <View
          onLayout={(e) => setRowWidth(e.nativeEvent.layout.width)}
          style={{ height: tile, justifyContent: 'center' }}
        >
          {tile > 0
            ? value.map((reaction, index) => (
                <EmojiTile
                  key={quickReactionKey(reaction)}
                  reaction={reaction}
                  index={index}
                  slots={slots}
                  tile={tile}
                  step={step}
                  count={n}
                  fill={c.surfaceMuted}
                  activeFill={c.accentSoft}
                  onCommit={commitOrder}
                  onTap={(slot) => setEditing(slot)}
                />
              ))
            : null}
        </View>
      </View>

      <EmojiPickerSheet
        visible={editing != null}
        customPacks={customPacks}
        standaloneCustomEmojis={standaloneCustomEmojis}
        onClose={() => setEditing(null)}
        onSelect={(reaction) => {
          if (editing != null) replaceSlot(editing, reaction);
        }}
      />
    </>
  );
}

type TileProps = {
  reaction: QuickReaction;
  /** This tile's slot in the current `value` — the initial position, used so a
   * freshly mounted tile (after a replace) draws before the slot map resyncs. */
  index: number;
  slots: SharedValue<Slot>;
  tile: number;
  step: number;
  count: number;
  fill: string;
  activeFill: string;
  onCommit: () => void;
  onTap: (slot: number) => void;
};

function EmojiTile({
  reaction,
  index,
  slots,
  tile,
  step,
  count,
  fill,
  activeFill,
  onCommit,
  onTap,
}: TileProps) {
  const { t } = useTranslation();
  const reactionId = quickReactionKey(reaction);
  const reactionLabel = quickReactionLabel(reaction);
  const x = useSharedValue(index * step);
  const dragging = useSharedValue(false);
  // Pixel position of this tile's slot when the drag began — the fixed origin
  // the finger's cumulative translation is added to (the live slot shifts as
  // tiles reorder, so it must NOT be the origin, or position jumps to an end).
  const startX = useSharedValue(0);

  // Follow slot changes caused by *other* tiles being dragged past this one.
  useAnimatedReaction(
    () => slots.value[reactionId],
    (slot, prev) => {
      if (slot !== prev && !dragging.value) x.value = withSpring(slot * step);
    },
  );

  const pan = Gesture.Pan()
    .activateAfterLongPress(LONG_PRESS_MS)
    .onStart(() => {
      dragging.value = true;
      startX.value = slots.value[reactionId] * step;
    })
    .onUpdate((e) => {
      x.value = startX.value + e.translationX;
      const from = slots.value[reactionId];
      const to = Math.max(0, Math.min(count - 1, Math.round(x.value / step)));
      if (to !== from) slots.value = moveSlot(slots.value, from, to);
    })
    .onEnd(() => {
      x.value = withSpring(slots.value[reactionId] * step);
    })
    .onFinalize(() => {
      if (dragging.value) {
        dragging.value = false;
        runOnJS(onCommit)();
      }
    });

  const tap = Gesture.Tap().onEnd(() => {
    runOnJS(onTap)(slots.value[reactionId]);
  });

  const style = useAnimatedStyle(() => ({
    transform: [{ translateX: x.value }, { scale: withSpring(dragging.value ? 1.12 : 1) }],
    backgroundColor: dragging.value ? activeFill : fill,
    zIndex: dragging.value ? 1 : 0,
  }));

  return (
    <GestureDetector gesture={Gesture.Exclusive(pan, tap)}>
      <Animated.View
        accessibilityRole="button"
        accessibilityLabel={t('chats.quick_reactions_change', {
          emoji: reactionLabel,
        })}
        style={[
          {
            position: 'absolute',
            width: tile,
            height: tile,
            borderRadius: radius.md,
            alignItems: 'center',
            justifyContent: 'center',
          },
          style,
        ]}
      >
        {typeof reaction === 'string' ? (
          <AppText style={emojiSize.picker}>{reaction}</AppText>
        ) : (
          <CustomEmojiImage
            emoji={reaction}
            size={emojiSize.quickReactionImage}
            clickable={false}
          />
        )}
      </Animated.View>
    </GestureDetector>
  );
}
