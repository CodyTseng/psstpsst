import { memo, useState } from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';

import { InteractivePressable as Pressable } from '@/components/common/InteractivePressable';

import { AppText } from '@/components/common/AppText';
import { InteractionOverlay } from '@/components/common/InteractionOverlay';
import { CustomEmojiImage } from '@/components/emoji/CustomEmojiImage';
import type { ReactionAggregate } from '@/lib/nostr/reactions';
import { emojiSize, messageLayout, radius, spacing, useThemeColors } from '@/theme';

type Props = {
  reactions: ReactionAggregate[];
  isSelfBubble: boolean;
  loadRemote?: boolean;
  onTapReaction: (reaction: ReactionAggregate) => void;
};

// Distinct reactions shown before collapsing the rest into a "+N" chip. Keeps
// the row to a single line; tapping "+N" expands to all (wrapped). 1:1 chats
// rarely reach this, but groups can.
const MAX_VISIBLE = 6;
// Fractional hairlines can rasterize unevenly around a capsule on Android.
// One logical pixel keeps the arc continuous across screen densities.
const REACTION_BADGE_ACTIVE_BORDER_WIDTH =
  process.env.EXPO_OS === 'android' ? 1 : StyleSheet.hairlineWidth;

/** Quiet reaction badges below a message, aligned to the same logical edge. */
function ReactionsRowBase({
  reactions,
  isSelfBubble,
  loadRemote = false,
  onTapReaction,
}: Props) {
  const c = useThemeColors();
  const [loadedEmojis, setLoadedEmojis] = useState<Set<string>>(() => new Set());
  const [expanded, setExpanded] = useState(false);

  if (reactions.length === 0) return null;

  const overflow = !expanded && reactions.length > MAX_VISIBLE;
  // Leave a slot for the "+N" chip when overflowing.
  const visible = overflow ? reactions.slice(0, MAX_VISIBLE - 1) : reactions;
  const hiddenCount = reactions.length - visible.length;

  const chipBase: ViewStyle = {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    minHeight: spacing.lg + spacing.xs,
    paddingHorizontal: spacing.xs,
    borderRadius: radius.full,
    borderWidth: REACTION_BADGE_ACTIVE_BORDER_WIDTH,
    backgroundColor: c.surface,
  };

  return (
    <View
      style={{
        flexDirection: 'row',
        // Single line until expanded; then wrap so all chips fit.
        flexWrap: expanded ? 'wrap' : 'nowrap',
        gap: spacing.xs,
        justifyContent: isSelfBubble ? 'flex-end' : 'flex-start',
        marginTop: messageLayout.reactionGap,
        alignSelf: isSelfBubble ? 'flex-end' : 'flex-start',
      }}
    >
      {visible.map((r) => (
        <Pressable
          key={JSON.stringify([r.emoji, r.customEmoji?.url ?? null])}
          onPress={() => {
            if (r.customEmoji && !loadRemote && !r.selfReacted && !loadedEmojis.has(r.customEmoji.url)) {
              setLoadedEmojis((current) => new Set(current).add(r.customEmoji!.url));
              return;
            }
            onTapReaction(r);
          }}
          hitSlop={spacing.xs}
          fallbackHoverOpacity={false}
          style={{
            ...chipBase,
            borderColor: r.selfReacted ? c.accent : 'transparent',
          }}
        >
          {({ pressed }) => (
            <>
              {pressed ? <InteractionOverlay borderRadius={radius.full} /> : null}
              {r.customEmoji && (loadRemote || r.selfReacted || loadedEmojis.has(r.customEmoji.url)) ? (
                <CustomEmojiImage
                  emoji={r.customEmoji}
                  size={emojiSize.reactionImage}
                  clickable={false}
                />
              ) : (
                <AppText style={emojiSize.chip}>{r.emoji}</AppText>
              )}
              {r.count > 1 ? (
                <AppText
                  variant="micro"
                  weight="semibold"
                  style={{
                    color: r.selfReacted ? c.accent : c.textMuted,
                    fontVariant: ['tabular-nums'],
                  }}
                >
                  {r.count}
                </AppText>
              ) : null}
            </>
          )}
        </Pressable>
      ))}

      {overflow ? (
        <Pressable
          onPress={() => setExpanded(true)}
          hitSlop={spacing.xs}
          fallbackHoverOpacity={false}
          style={{
            ...chipBase,
            borderColor: 'transparent',
          }}
        >
          {({ pressed }) => (
            <>
              {pressed ? <InteractionOverlay borderRadius={radius.full} /> : null}
              <AppText
                variant="micro"
                weight="semibold"
                style={{ color: c.textMuted, fontVariant: ['tabular-nums'] }}
              >
                +{hiddenCount}
              </AppText>
            </>
          )}
        </Pressable>
      ) : null}
    </View>
  );
}

function areReactionRowsEqual(a: Props, b: Props): boolean {
  if (
    a.isSelfBubble !== b.isSelfBubble ||
    a.loadRemote !== b.loadRemote ||
    a.reactions.length !== b.reactions.length
  ) {
    return false;
  }
  for (let index = 0; index < a.reactions.length; index += 1) {
    const left = a.reactions[index];
    const right = b.reactions[index];
    if (
      left.emoji !== right.emoji ||
      left.customEmoji?.url !== right.customEmoji?.url ||
      left.count !== right.count ||
      left.selfReacted !== right.selfReacted
    ) {
      return false;
    }
  }
  return true;
}

/** Keep selection-mode updates out of unchanged reaction subtrees. */
export const ReactionsRow = memo(ReactionsRowBase, areReactionRowsEqual);
