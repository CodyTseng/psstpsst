import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppButton } from '@/components/common/AppButton';
import { AppText } from '@/components/common/AppText';
import { BottomSheet } from '@/components/common/BottomSheet';
import { IconButton } from '@/components/common/IconButton';
import { SingleImageLightbox } from '@/components/common/MediaViewer';
import { useCustomEmojis } from '@/hooks/use-custom-emojis';
import type { CustomEmoji, EmojiPack } from '@/lib/nostr/custom-emoji';
import { platform } from '@/platform';
import { KIND_CHAT } from '@/services/crypto/nip17-gift-wrap';
import {
  addEmojiPack,
  addStandaloneEmoji,
  emojiPackShareContentFromCoordinate,
  getEmojiPack,
  removeEmojiPack,
  removeStandaloneEmoji,
} from '@/services/emoji/custom-emoji.service';
import { useActiveAccount } from '@/stores/active-account.store';
import { useCustomEmojiDetail } from '@/stores/custom-emoji-detail.store';
import { useForwardDraftStore } from '@/stores/forward-draft.store';
import { emojiSize, radius, shadow, spacing, useThemeColors } from '@/theme';

import { CustomEmojiGrid } from './custom-emoji-grid';
import { CustomEmojiImage } from './CustomEmojiImage';
import { EmojiPackAuthorRow } from './EmojiPackAuthorRow';

export function CustomEmojiDetailSheet() {
  const { t } = useTranslation();
  const c = useThemeColors();
  const insets = useSafeAreaInsets();
  const emoji = useCustomEmojiDetail((state) => state.emoji);
  const [shownEmoji, setShownEmoji] = useState<CustomEmoji | null>(emoji);
  if (emoji && emoji !== shownEmoji) setShownEmoji(emoji);
  const close = useCustomEmojiDetail((state) => state.close);
  const accountPubkey = useActiveAccount((state) => state.activePubkey);
  const startForwardDraft = useForwardDraftStore((state) => state.start);
  const collection = useCustomEmojis(accountPubkey);
  const [lightboxUri, setLightboxUri] = useState<string>();
  const [pendingShareCoordinate, setPendingShareCoordinate] = useState<string>();
  const [pendingAuthorPubkey, setPendingAuthorPubkey] = useState<string>();
  const [packState, setPackState] = useState<{
    address?: string;
    pack: EmojiPack | null;
  }>({ pack: null });

  useEffect(() => {
    const address = emoji?.setAddress;
    if (!address) return;
    let active = true;
    void getEmojiPack(address)
      .then((result) => {
        if (active) setPackState({ address, pack: result });
      })
      .catch(() => {
        if (active) setPackState({ address, pack: null });
      });
    return () => {
      active = false;
    };
  }, [emoji?.setAddress]);

  const pack =
    emoji?.setAddress && packState.address === emoji.setAddress ? packState.pack : null;
  const loading = !!emoji?.setAddress && packState.address !== emoji.setAddress;
  const packCollected =
    !!pack && collection.packs.some((item) => item.coordinate === pack.coordinate);
  const floatingActionBottom = Math.max(insets.bottom, spacing.lg);

  function togglePack() {
    if (!accountPubkey || !pack) return;
    const mutation = packCollected
      ? removeEmojiPack(accountPubkey, pack.coordinate)
      : addEmojiPack(accountPubkey, pack);
    void mutation.catch(() =>
      platform.confirmationDialog.notify({
        title: t('emoji.save_failed'),
        okLabel: t('common.ok'),
      }),
    );
  }

  function closeTopSurface() {
    if (lightboxUri) setLightboxUri(undefined);
    else close();
  }

  function sharePack() {
    if (!pack) return;
    setPendingShareCoordinate(pack.coordinate);
    close();
  }

  function openAuthorPacks(pubkey: string) {
    setPendingAuthorPubkey(pubkey);
    close();
  }

  function handleClosed() {
    if (pendingShareCoordinate) {
      const coordinate = pendingShareCoordinate;
      setPendingShareCoordinate(undefined);
      const content = emojiPackShareContentFromCoordinate(coordinate);
      if (!accountPubkey || !content) return;
      startForwardDraft({
        accountPubkey,
        sourceConversationKey: null,
        messages: [{ kind: KIND_CHAT, content, tags: [] }],
      });
      router.push('/forward');
      return;
    }
    if (pendingAuthorPubkey) {
      const pubkey = pendingAuthorPubkey;
      setPendingAuthorPubkey(undefined);
      router.push({
        pathname: '/emoji-author/[pubkey]',
        params: { pubkey },
      });
    }
  }

  return (
    <BottomSheet
      visible={!!emoji}
      onClose={closeTopSurface}
      onClosed={handleClosed}
      title={shownEmoji?.shortcode ?? ''}
      contentStyle={[
        { gap: spacing.lg },
        pack && {
          paddingBottom: floatingActionBottom + spacing['3xl'] + spacing.lg,
        },
      ]}
      scrollOverlay={
        emoji?.setAddress && pack ? (
          <View style={[StyleSheet.absoluteFill, { pointerEvents: 'box-none' }]}>
            <View
              style={{
                position: 'absolute',
                left: spacing.xl,
                right: spacing.xl,
                bottom: floatingActionBottom,
              }}
            >
              <View style={{ flexDirection: 'row', gap: spacing.xl }}>
                <View
                  style={{
                    flex: 1,
                    backgroundColor: c.surfaceElevated,
                    borderRadius: radius.full,
                    ...shadow.float,
                  }}
                >
                  <AppButton
                    variant="secondary"
                    size="md"
                    corner="full"
                    label={t('emoji.share_in_chat')}
                    onPress={sharePack}
                  />
                </View>
                <View
                  style={{
                    flex: 1,
                    backgroundColor: c.surfaceElevated,
                    borderRadius: radius.full,
                    ...shadow.float,
                  }}
                >
                  <AppButton
                    variant="primary"
                    size="md"
                    corner="full"
                    label={packCollected ? t('emoji.remove_pack') : t('emoji.add_pack')}
                    onPress={togglePack}
                  />
                </View>
              </View>
            </View>
          </View>
        ) : undefined
      }
      modalOverlay={
        lightboxUri ? (
          <SingleImageLightbox uri={lightboxUri} onClose={() => setLightboxUri(undefined)} />
        ) : undefined
      }
    >
      {shownEmoji ? (
        <EmojiDetailContent
          key={`${shownEmoji.shortcode}:${shownEmoji.url}:${shownEmoji.setAddress ?? ''}`}
          emoji={shownEmoji}
          collection={collection}
          pack={pack}
          loading={loading}
          onOpenAuthor={openAuthorPacks}
          onOpenImage={() => setLightboxUri(shownEmoji.url)}
        />
      ) : null}
    </BottomSheet>
  );
}

function EmojiDetailContent({
  emoji,
  collection,
  pack,
  loading,
  onOpenAuthor,
  onOpenImage,
}: {
  emoji: CustomEmoji;
  collection: ReturnType<typeof useCustomEmojis>;
  pack: EmojiPack | null;
  loading: boolean;
  onOpenAuthor: (authorPubkey: string) => void;
  onOpenImage: () => void;
}) {
  const { t } = useTranslation();
  const c = useThemeColors();
  const accountPubkey = useActiveAccount((state) => state.activePubkey);
  const emojiCollected = collection.standalone.some(
    (item) =>
      item.shortcode.toLowerCase() === emoji.shortcode.toLowerCase() && item.url === emoji.url,
  );
  function toggleEmoji() {
    if (!accountPubkey) return;
    const mutation = emojiCollected
      ? removeStandaloneEmoji(accountPubkey, emoji)
      : addStandaloneEmoji(accountPubkey, emoji);
    void mutation.catch(() =>
      platform.confirmationDialog.notify({
        title: t('emoji.save_failed'),
        okLabel: t('common.ok'),
      }),
    );
  }

  return (
    <>
      <View style={{ alignItems: 'center', gap: spacing.md }}>
        <IconButton
          variant="plain"
          shape="square"
          size={emojiSize.detailImage}
          onPress={onOpenImage}
          accessibilityLabel={`${t('emoji.view_emoji_image')} ${emoji.shortcode}`}
          icon={(
            <CustomEmojiImage emoji={emoji} size={emojiSize.detailImage} clickable={false} />
          )}
        />
        <View style={{ alignSelf: 'center' }}>
          <AppButton
            variant={emojiCollected ? 'secondary' : 'primary'}
            size="md"
            fullWidth={false}
            corner="full"
            label={emojiCollected ? t('emoji.remove_emoji') : t('emoji.add_emoji')}
            onPress={toggleEmoji}
          />
        </View>
      </View>

      {emoji.setAddress ? (
        <View>
          <View
            style={{
              height: StyleSheet.hairlineWidth,
              backgroundColor: c.border,
            }}
          />
          {loading ? (
            <AppText
              variant="body"
              tone="muted"
              align="center"
              style={{ paddingTop: spacing.lg }}
            >
              {t('emoji.loading_pack')}
            </AppText>
          ) : pack ? (
            <View>
              <View style={{ paddingHorizontal: spacing.md }}>
                <EmojiPackAuthorRow
                  authorPubkey={pack.authorPubkey}
                  packTitle={pack.title || undefined}
                  onPress={onOpenAuthor}
                />
              </View>
              <CustomEmojiGrid
                embedded
                emojis={pack.emojis}
                horizontalPadding={0}
              />
            </View>
          ) : (
            <AppText
              variant="body"
              tone="muted"
              align="center"
              style={{ paddingTop: spacing.lg }}
            >
              {t('emoji.pack_unavailable')}
            </AppText>
          )}
        </View>
      ) : null}
    </>
  );
}
