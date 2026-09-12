import { router } from 'expo-router';
import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { InteractivePressable as Pressable } from '@/components/common/InteractivePressable';

import { useCachedImages } from '@/hooks/use-cached-images';
import { AppButton } from '@/components/common/AppButton';
import type { RemoteContentMode } from '@/components/chat/remote-content-policy';
import { AppText } from '@/components/common/AppText';
import { InteractionOverlay } from '@/components/common/InteractionOverlay';
import { MessageCardFooter } from '@/components/chat/MessageCardFooter';
import { emojiSetCoordinate, type EmojiPack } from '@/lib/nostr/custom-emoji';
import { getEmojiPack } from '@/services/emoji/custom-emoji.service';
import { emojiSize, radius, spacing, useThemeColors } from '@/theme';

import { CustomEmojiImage } from './CustomEmojiImage';
import { EmojiPackAuthorRow } from './EmojiPackAuthorRow';

type Props = {
  authorPubkey: string;
  identifier: string;
  metaSlot?: ReactNode;
  loadRemote?: boolean;
  downloadMode?: RemoteContentMode;
};

const PREVIEW_COLUMN_COUNT = 5;
const PREVIEW_ROWS = [0, 1] as const;
const PREVIEW_COLUMNS = [0, 1, 2, 3, 4] as const;
const CARD_WIDTH =
  PREVIEW_COLUMN_COUNT * emojiSize.packImage +
  (PREVIEW_COLUMN_COUNT - 1) * spacing.sm +
  spacing.md * 2 +
  StyleSheet.hairlineWidth * 2;

export function EmojiPackReferenceCard({ authorPubkey, identifier, metaSlot, loadRemote = true, downloadMode = 'auto' }: Props) {
  const { t } = useTranslation();
  const c = useThemeColors();
  const coordinate = emojiSetCoordinate(authorPubkey, identifier);
  const [pack, setPack] = useState<EmojiPack | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [openedCoordinate, setOpenedCoordinate] = useState<string | null>(null);
  const [downloadAttempt, setDownloadAttempt] = useState(0);
  const downloadAllowed = loadRemote && downloadMode !== 'hold' &&
    (downloadMode === 'auto' || openedCoordinate === coordinate);
  const previewImages = useCachedImages(
    pack?.emojis.slice(0, PREVIEW_COLUMN_COUNT * PREVIEW_ROWS.length).map((emoji) => emoji.url) ?? [],
    downloadAllowed,
    downloadAttempt,
  );
  const showLoadPrompt = loadRemote && downloadMode === 'request' &&
    (openedCoordinate !== coordinate || previewImages.some((image) => image.failed)) && previewImages.every((image) => image.checked) &&
    previewImages.some((image) => !image.uri);

  useEffect(() => {
    if (!loadRemote) return;
    let active = true;
    void getEmojiPack(coordinate)
      .then((value) => {
        if (!active) return;
        setPack(value);
        setLoaded(true);
      })
      .catch(() => {
        if (active) setLoaded(true);
      });
    return () => {
      active = false;
    };
  }, [coordinate, loadRemote]);

  return (
    <Pressable
      disabled={!loadRemote}
      accessibilityRole="link"
      accessibilityLabel={t('emoji.view_pack')}
      fallbackHoverOpacity={false}
      onPress={() =>
        router.push({
          pathname: '/emoji-pack/[coordinate]',
          params: { coordinate },
        })
      }
      style={{
        alignSelf: 'flex-start',
        width: CARD_WIDTH,
        maxWidth: '100%',
        minWidth: 0,
        paddingTop: spacing.md,
        paddingHorizontal: spacing.md,
        paddingBottom: spacing.sm,
        borderRadius: radius.lg,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: c.border,
        backgroundColor: c.surface,
      }}
    >
      {({ pressed }) => (
        <>
          {pressed ? <InteractionOverlay borderRadius={radius.lg} /> : null}
          <View style={{ gap: spacing.md }}>
            <View style={{ gap: spacing.xs }}>
              <EmojiPackAuthorRow
                authorPubkey={pack?.authorPubkey ?? authorPubkey}
                packTitle={pack?.title || undefined}
                titleVariant="caption"
                prominentTitle
                withVerticalPadding={false}
                loadRemote={loadRemote && !!pack}
              />
              <AppText variant="caption" tone="muted" numberOfLines={1}>
                {pack
                  ? t('emoji.emoji_count', { count: pack.emojis.length })
                  : loaded
                    ? t('emoji.pack_unavailable')
                    : t('emoji.loading_pack')}
              </AppText>
            </View>
            <View style={{ gap: spacing.sm }}>
              {PREVIEW_ROWS.map((rowIndex) => (
                <View
                  key={rowIndex}
                  style={{ flexDirection: 'row', gap: spacing.sm }}
                >
                  {PREVIEW_COLUMNS.map((columnIndex) => {
                    const emoji = pack?.emojis[rowIndex * PREVIEW_COLUMN_COUNT + columnIndex];
                    return (
                      <View key={columnIndex} style={styles.previewCell}>
                        {emoji ? (
                          <CustomEmojiImage sourceUri={previewImages[rowIndex * PREVIEW_COLUMN_COUNT + columnIndex]?.uri ?? null} emoji={emoji} size="100%" clickable={false} />
                        ) : null}
                      </View>
                    );
                  })}
                </View>
              ))}
              {showLoadPrompt ? (
                <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]}>
                  <AppButton
                    variant="ghost"
                    size="sm"
                    fullWidth={false}
                    label={t('attach.tap_to_load')}
                    onPress={(event) => {
                      event.stopPropagation();
                      setOpenedCoordinate(coordinate);
                      setDownloadAttempt((value) => value + 1);
                    }}
                  />
                </View>
              ) : null}
            </View>
          </View>
          <MessageCardFooter metaSlot={metaSlot} />
        </>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  previewCell: {
    flex: 1,
    minWidth: 0,
    aspectRatio: 1,
  },
});
