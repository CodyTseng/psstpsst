import { router } from 'expo-router';
import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { MessageCard } from '@/components/chat/MessageCard';
import { MessageCardHeader } from '@/components/chat/MessageCardHeader';
import { MessageCardSource } from '@/components/chat/MessageCardSource';

import { useCachedImages } from '@/hooks/use-cached-images';
import { AppButton } from '@/components/common/AppButton';
import { AppText } from '@/components/common/AppText';
import type { RemoteContentMode } from '@/components/chat/remote-content-policy';
import { emojiSetCoordinate, type EmojiPack } from '@/lib/nostr/custom-emoji';
import { getEmojiPack } from '@/services/emoji/custom-emoji.service';
import { spacing } from '@/theme';

import { CustomEmojiImage } from './CustomEmojiImage';

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

export function EmojiPackReferenceCard({ authorPubkey, identifier, metaSlot, loadRemote = true, downloadMode = 'auto' }: Props) {
  const { t } = useTranslation();
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
    <MessageCard
      type="emoji_pack"
      disabled={!loadRemote}
      accessibilityLabel={t('emoji.view_pack')}
      onPress={() =>
        router.push({
          pathname: '/emoji-pack/[coordinate]',
          params: { coordinate },
        })
      }
      metaSlot={metaSlot}
      header={<MessageCardHeader title={pack?.title || t('emoji.untitled_pack')}
        subtitle={<MessageCardSource pubkey={pack?.authorPubkey ?? authorPubkey} loadRemote={loadRemote && !!pack} />} />}
    >
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
                    <CustomEmojiImage
                      sourceUri={previewImages[rowIndex * PREVIEW_COLUMN_COUNT + columnIndex]?.uri ?? null}
                      loadRemote={downloadAllowed && !previewImages[rowIndex * PREVIEW_COLUMN_COUNT + columnIndex]?.failed}
                      emoji={emoji}
                      size="100%"
                      clickable={false}
                    />
                  ) : null}
                </View>
              );
            })}
          </View>
        ))}
        {!pack ? <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center', padding: spacing.sm }]}>
          <AppText variant="caption" tone="muted">{t(loaded ? 'emoji.pack_unavailable' : 'emoji.loading_pack')}</AppText>
        </View> : null}
        {showLoadPrompt ? (
          <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]}>
            <View style={{ maxWidth: '100%' }}>
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
          </View>
        ) : null}
      </View>
    </MessageCard>
  );
}

const styles = StyleSheet.create({
  previewCell: {
    flex: 1,
    minWidth: 0,
    aspectRatio: 1,
  },
});
