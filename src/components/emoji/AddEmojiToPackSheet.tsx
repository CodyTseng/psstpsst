import Check from 'lucide-react-native/icons/check';
import { BoxMinimalistic as PackageOpen } from '@solar-icons/react-native/category/ui/Linear/BoxMinimalistic';
import { DirectionalChevron as ChevronRight } from '@/components/common/DirectionalChevron';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { AppButton } from '@/components/common/AppButton';
import { AppText } from '@/components/common/AppText';
import { BottomSheet } from '@/components/common/BottomSheet';
import { ListRow } from '@/components/common/ListRow';
import Plus from 'lucide-react-native/icons/plus';
import {
  MAX_EMOJIS_PER_PACK,
  type CustomEmoji,
  type EmojiPack,
} from '@/lib/nostr/custom-emoji';
import { iconStrokeWidth } from '@/theme/icons';
import { emojiSize, spacing, useThemeColors } from '@/theme';

import { CustomEmojiImage } from './CustomEmojiImage';
import { EmojiPackRowSkeleton } from './EmojiPackCard';

type Props = {
  visible: boolean;
  emoji: CustomEmoji | null;
  packs: EmojiPack[];
  loaded: boolean;
  onClose: () => void;
  onClosed: () => void;
  onSelectPack: (coordinate: string) => void;
  onCreatePack: () => void;
};

/** Choose an owned pack before handing the emoji to the existing pack editor. */
export function AddEmojiToPackSheet({
  visible,
  emoji,
  packs,
  loaded,
  onClose,
  onClosed,
  onSelectPack,
  onCreatePack,
}: Props) {
  const { t } = useTranslation();
  const c = useThemeColors();

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      onClosed={onClosed}
      title={t('emoji.add_to_pack')}
      contentStyle={{ gap: spacing.lg }}
    >
      {!loaded ? (
        <View style={{ gap: spacing.sm }}>
          <EmojiPackRowSkeleton />
          <EmojiPackRowSkeleton />
        </View>
      ) : packs.length === 0 ? (
        <View
          style={{
            alignItems: 'center',
            gap: spacing.sm,
            padding: spacing.xl,
          }}
        >
          <PackageOpen size={48} color={c.textMuted} />
          <AppText variant="subtitle" weight="semibold" align="center">
            {t('emoji.no_owned_packs_title')}
          </AppText>
          <AppText tone="muted" align="center">
            {t('emoji.no_owned_packs_hint')}
          </AppText>
          <AppButton
            label={t('emoji.create_pack')}
            variant="primary"
            fullWidth={false}
            iconLeft={<Plus strokeWidth={iconStrokeWidth.default} size={20} color={c.accentForeground} />}
            onPress={onCreatePack}
          />
        </View>
      ) : (
        <>
          <View style={{ gap: spacing.sm }}>
            {packs.map((pack) => {
              const alreadyAdded = !!emoji && pack.emojis.some(
                (item) =>
                  item.shortcode.toLowerCase() === emoji.shortcode.toLowerCase() &&
                  item.url === emoji.url,
              );
              const full = pack.emojis.length >= MAX_EMOJIS_PER_PACK;
              const disabled = alreadyAdded || full;
              return (
                <ListRow
                  key={pack.coordinate}
                  icon={
                    pack.emojis[0] ? (
                      <CustomEmojiImage
                        emoji={pack.emojis[0]}
                        size={emojiSize.listImage}
                        clickable={false}
                      />
                    ) : undefined
                  }
                  title={pack.title || t('emoji.untitled_pack')}
                  subtitle={
                    alreadyAdded
                      ? t('emoji.already_in_pack')
                      : full
                        ? t('emoji.pack_full')
                        : t('emoji.emoji_count', { count: pack.emojis.length })
                  }
                  trailing={
                    alreadyAdded ? (
                      <Check strokeWidth={iconStrokeWidth.default} size={18} color={c.accent} />
                    ) : full ? undefined : (
                      <ChevronRight size={18} color={c.textMuted} />
                    )
                  }
                  disabled={disabled}
                  onPress={() => onSelectPack(pack.coordinate)}
                />
              );
            })}
          </View>
          <AppButton
            label={t('emoji.create_pack')}
            variant="secondary"
            iconLeft={<Plus strokeWidth={iconStrokeWidth.default} size={20} color={c.accent} />}
            onPress={onCreatePack}
          />
        </>
      )}
    </BottomSheet>
  );
}
