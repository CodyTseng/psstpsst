import { Heart } from '@solar-icons/react-native/category/like/Linear/Heart';
import GripVertical from 'lucide-react-native/icons/grip-vertical';
import { Box as Package } from '@solar-icons/react-native/category/ui/Linear/Box';
import { View } from 'react-native';

import { InteractivePressable as Pressable } from '@/components/common/InteractivePressable';
import { useTranslation } from 'react-i18next';
import { memo, useEffect } from 'react';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { AppCard } from '@/components/common/AppCard';
import { AppButton } from '@/components/common/AppButton';
import { AppText } from '@/components/common/AppText';
import type { CustomEmoji, EmojiPack } from '@/lib/nostr/custom-emoji';
import { iconStrokeWidth } from '@/theme/icons';
import { emojiSize, radius, spacing, uiDensity, useThemeColors } from '@/theme';

import { CustomEmojiImage } from './CustomEmojiImage';

const PACK_EDIT_RAIL_WIDTH = 36;
const PACK_EDIT_TRANSITION_MS = 180;
const PACK_ROW_HEIGHT = uiDensity.conversationRowHeight;
const PACK_COVER_SIZE = uiDensity.conversationAvatarSize;

type PersonalCollectionProps = {
  emojis: CustomEmoji[];
  onPress: () => void;
};

/** Fixed kind-10030 standalone collection summary shown before collected packs. */
export const PersonalEmojiCollectionListRow = memo(
  function PersonalEmojiCollectionListRow({
    emojis,
    onPress,
  }: PersonalCollectionProps) {
    const { t } = useTranslation();
    const c = useThemeColors();
    const cover = emojis[0];

    return (
      <Pressable
        accessibilityRole="button"
        pressFeedback="delayed"
        accessibilityLabel={t('emoji.personal_collection')}
        onPress={onPress}
        style={({ pressed }) => ({
          height: PACK_ROW_HEIGHT,
          paddingHorizontal: spacing.lg,
          flexDirection: 'row',
          alignItems: 'center',
          gap: spacing.md,
          backgroundColor: pressed ? c.interactionOverlay : c.background,
        })}
      >
        <View
          style={{
            width: PACK_COVER_SIZE,
            height: PACK_COVER_SIZE,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {cover ? (
            <CustomEmojiImage
              emoji={cover}
              size={PACK_COVER_SIZE}
              clickable={false}
            />
          ) : (
            <Heart size={24} color={c.accent} />
          )}
        </View>
        <View style={{ flex: 1, gap: spacing.xs }}>
          <AppText variant="subtitle" numberOfLines={1}>
            {t('emoji.personal_collection')}
          </AppText>
          <AppText variant="body" tone="muted" numberOfLines={1}>
            {t('emoji.emoji_count', { count: emojis.length })}
          </AppText>
        </View>
      </Pressable>
    );
  },
);

type Props = {
  pack: EmojiPack;
  collected: boolean | null;
  onPress: (coordinate: string) => void;
  onToggleCollection: (pack: EmojiPack, collected: boolean) => void | Promise<void>;
  editing?: boolean;
};

export const EmojiPackListRow = memo(function EmojiPackListRow({
  pack,
  collected,
  onPress,
  onToggleCollection,
  editing = false,
}: Props) {
  const { t } = useTranslation();
  const c = useThemeColors();
  const cover = pack.emojis[0];
  const editProgress = useSharedValue(editing ? 1 : 0);

  useEffect(() => {
    editProgress.value = withTiming(editing ? 1 : 0, {
      duration: PACK_EDIT_TRANSITION_MS,
    });
  }, [editProgress, editing]);

  const contentStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: editProgress.value * PACK_EDIT_RAIL_WIDTH }],
  }));
  const gripStyle = useAnimatedStyle(() => ({
    opacity: editProgress.value,
  }));
  const actionStyle = useAnimatedStyle(() => ({
    opacity: 1 - editProgress.value,
  }));

  return (
    <Pressable
      accessible={!editing}
      pressFeedback="delayed"
      disabled={editing}
      onPress={() => onPress(pack.coordinate)}
      style={({ pressed }) => ({
        height: PACK_ROW_HEIGHT,
        backgroundColor: pressed ? c.interactionOverlay : c.background,
      })}
    >
      <Animated.View
        style={[
          {
            position: 'absolute',
            start: spacing.lg,
            top: 0,
            bottom: 0,
            width: PACK_EDIT_RAIL_WIDTH,
            alignItems: 'center',
            justifyContent: 'center',
          },
          gripStyle,
          { pointerEvents: 'none' },
        ]}
      >
        <GripVertical strokeWidth={iconStrokeWidth.default} size={20} color={c.textMuted} />
      </Animated.View>
      <Animated.View
        style={[
          {
            flex: 1,
            height: PACK_ROW_HEIGHT,
            paddingHorizontal: spacing.lg,
            flexDirection: 'row',
            alignItems: 'center',
            gap: spacing.md,
          },
          contentStyle,
        ]}
      >
        <View
          style={{
            width: PACK_COVER_SIZE,
            height: PACK_COVER_SIZE,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {cover ? (
            <CustomEmojiImage emoji={cover} size={PACK_COVER_SIZE} clickable={false} />
          ) : (
            <Package size={22} color={c.textMuted} />
          )}
        </View>
        <View style={{ flex: 1, gap: spacing.xs }}>
          <AppText variant="subtitle" numberOfLines={1}>
            {pack.title || t('emoji.untitled_pack')}
          </AppText>
          <AppText variant="body" tone="muted" numberOfLines={1}>
            {t('emoji.emoji_count', { count: pack.emojis.length })}
          </AppText>
        </View>
        <Animated.View
          style={[actionStyle, { pointerEvents: editing ? 'none' : 'auto' }]}
        >
          {collected == null ? (
            <View
              style={{
                width: 64,
                height: 36,
                borderRadius: radius.full,
                backgroundColor: c.surfaceMuted,
              }}
            />
          ) : (
            <AppButton
              label={collected ? t('emoji.collected') : t('emoji.add')}
              variant={collected ? 'secondary' : 'primary'}
              size="sm"
              fullWidth={false}
              corner="full"
              accessibilityLabel={
                collected ? t('emoji.remove_pack') : t('emoji.add_pack')
              }
              onPress={(event) => {
                event.stopPropagation();
                void onToggleCollection(pack, collected);
              }}
            />
          )}
        </Animated.View>
      </Animated.View>
    </Pressable>
  );
}, (previous, next) =>
  previous.pack.event.id === next.pack.event.id &&
  previous.collected === next.collected &&
  previous.editing === next.editing &&
  previous.onPress === next.onPress &&
  previous.onToggleCollection === next.onToggleCollection,
);

export function EmojiPackRowSkeleton() {
  const c = useThemeColors();
  return (
    <View
      style={{
        height: PACK_ROW_HEIGHT,
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.md,
        paddingHorizontal: spacing.lg,
      }}
    >
      <View
        style={{
          width: PACK_COVER_SIZE,
          height: PACK_COVER_SIZE,
          borderRadius: radius.sm,
          backgroundColor: c.surfaceMuted,
        }}
      />
      <View style={{ flex: 1, gap: spacing.sm }}>
        <View style={{ width: 120, height: 16, borderRadius: radius.sm, backgroundColor: c.surfaceMuted }} />
        <View style={{ width: 72, height: 12, borderRadius: radius.sm, backgroundColor: c.surfaceMuted }} />
      </View>
      <View
        style={{
          width: 64,
          height: 36,
          borderRadius: radius.full,
          backgroundColor: c.surfaceMuted,
        }}
      />
    </View>
  );
}

export function EmojiPackSkeleton() {
  const { t } = useTranslation();
  const c = useThemeColors();
  return (
    <AppCard accessibilityLabel={t('emoji.loading_pack')} style={{ gap: spacing.md }}>
      <View style={{ gap: spacing.sm }}>
        <View style={{ width: 120, height: 18, borderRadius: radius.sm, backgroundColor: c.surfaceMuted }} />
        <View style={{ width: 72, height: 14, borderRadius: radius.sm, backgroundColor: c.surfaceMuted }} />
      </View>
      <View style={{ flexDirection: 'row', gap: spacing.sm }}>
        {[0, 1, 2, 3].map((index) => (
          <View
            key={index}
            style={{
              width: emojiSize.packImage,
              height: emojiSize.packImage,
              borderRadius: radius.md,
              backgroundColor: c.surfaceMuted,
            }}
          />
        ))}
      </View>
    </AppCard>
  );
}
