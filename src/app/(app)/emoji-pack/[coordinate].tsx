import { router, useLocalSearchParams } from 'expo-router';
import { PenNewSquare as Edit3 } from '@solar-icons/react-native/category/messages/Linear/PenNewSquare';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppButton } from '@/components/common/AppButton';
import { AppScreen } from '@/components/common/AppScreen';
import { AppText } from '@/components/common/AppText';
import { IconButton } from '@/components/common/IconButton';
import { ScreenHeader, useScreenHeaderClearance } from '@/components/common/ScreenHeader';
import { CustomEmojiGrid } from '@/components/emoji/custom-emoji-grid';
import { EmojiPackAuthorRow } from '@/components/emoji/EmojiPackAuthorRow';
import { EmojiPackSkeleton } from '@/components/emoji/EmojiPackCard';
import { useCustomEmojis } from '@/hooks/use-custom-emojis';
import { useScrolled } from '@/hooks/use-scrolled';
import type { EmojiPack } from '@/lib/nostr/custom-emoji';
import { platform } from '@/platform';
import {
  addEmojiPack,
  emojiPackShareContentFromCoordinate,
  getEmojiPack,
  removeEmojiPack,
} from '@/services/emoji/custom-emoji.service';
import { KIND_CHAT } from '@/services/crypto/nip17-gift-wrap';
import { useActiveAccount } from '@/stores/active-account.store';
import { useForwardDraftStore } from '@/stores/forward-draft.store';
import { radius, shadow, spacing, uiDensity, useThemeColors } from '@/theme';

export default function EmojiPackDetailScreen() {
  const { t } = useTranslation();
  const c = useThemeColors();
  const insets = useSafeAreaInsets();
  const titleClearance = useScreenHeaderClearance();
  const { scrolled, scrollProps } = useScrolled();
  const { coordinate } = useLocalSearchParams<{ coordinate: string }>();
  const accountPubkey = useActiveAccount((state) => state.activePubkey);
  const startForwardDraft = useForwardDraftStore((state) => state.start);
  const collection = useCustomEmojis(accountPubkey);
  const [pack, setPack] = useState<EmojiPack | null>(null);
  const [loaded, setLoaded] = useState(false);
  const floatingActionBottom = Math.max(insets.bottom, spacing.lg);

  useEffect(() => {
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
  }, [coordinate]);

  const collected = useMemo(
    () => collection.packs.some((item) => item.coordinate === coordinate),
    [collection.packs, coordinate],
  );
  function updateCollection(nextCollected: boolean) {
    if (!accountPubkey || !pack) return;
    const mutation = nextCollected
      ? addEmojiPack(accountPubkey, pack)
      : removeEmojiPack(accountPubkey, pack.coordinate);
    void mutation.catch(() =>
      platform.confirmationDialog.notify({
        title: t('emoji.save_failed'),
        okLabel: t('common.ok'),
      }),
    );
  }

  function toggleCollection() {
    if (!pack) return;
    if (!collected) {
      void updateCollection(true);
      return;
    }
    void platform.confirmationDialog
      .confirm({
        title: t('emoji.remove_pack_title'),
        message: t('emoji.remove_pack_message', {
          name: pack.title || t('emoji.untitled_pack'),
        }),
        cancelLabel: t('common.cancel'),
        confirmLabel: t('emoji.remove_pack_confirm'),
        destructive: true,
      })
      .then((confirmed) => {
        if (confirmed) void updateCollection(false);
      });
  }

  function shareInChat() {
    if (!accountPubkey || !pack) return;
    const content = emojiPackShareContentFromCoordinate(pack.coordinate);
    if (!content) return;
    startForwardDraft({
      accountPubkey,
      sourceConversationKey: null,
      messages: [{ kind: KIND_CHAT, content, tags: [] }],
    });
    router.push('/forward');
  }

  return (
    <AppScreen edges={[]}>
      {pack ? (
        <>
          <CustomEmojiGrid
            style={{ flex: 1 }}
            emojis={pack.emojis}
            listHeader={
              <View style={{ paddingBottom: pack.description ? spacing.sm : 0 }}>
                <View style={{ paddingHorizontal: spacing.lg }}>
                  <EmojiPackAuthorRow
                    authorPubkey={pack.authorPubkey}
                    packTitle={pack.title || undefined}
                  />
                </View>
                {pack.description ? (
                  <AppText
                    tone="muted"
                    style={{
                      paddingHorizontal: spacing.lg,
                      paddingTop: spacing.sm,
                    }}
                  >
                    {pack.description}
                  </AppText>
                ) : null}
              </View>
            }
            contentContainerStyle={{
              paddingTop: titleClearance + spacing.md,
              paddingBottom: floatingActionBottom + spacing['3xl'] + spacing.lg,
            }}
            {...scrollProps}
          />
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
                  label={t('emoji.share_in_chat')}
                  variant="secondary"
                  size="md"
                  corner="full"
                  onPress={shareInChat}
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
                  label={collected ? t('emoji.remove_pack') : t('emoji.add_pack')}
                  variant="primary"
                  size="md"
                  corner="full"
                  loading={!collection.loaded}
                  onPress={toggleCollection}
                />
              </View>
            </View>
          </View>
        </>
      ) : (
        <View style={{ flex: 1, padding: spacing.lg, paddingTop: titleClearance + spacing.lg }}>
          {loaded ? (
            <View
              style={{
                alignItems: 'center',
                gap: spacing.sm,
                paddingVertical: spacing['3xl'],
              }}
            >
              <AppText variant="subtitle" weight="semibold">
                {t('emoji.pack_unavailable')}
              </AppText>
              <AppText tone="muted" align="center">
                {t('emoji.pack_unavailable_hint')}
              </AppText>
              <AppButton
                label={t('common.back')}
                variant="primary"
                fullWidth={false}
                onPress={() => router.back()}
              />
            </View>
          ) : (
            <EmojiPackSkeleton />
          )}
        </View>
      )}
      <ScreenHeader
        bordered={scrolled}
        title={pack?.title || t('emoji.untitled_pack')}
        right={
          pack?.authorPubkey === accountPubkey ? (
            <IconButton
              variant="plain"
              size={uiDensity.headerActionSize}
              icon={<Edit3 size={uiDensity.headerActionIconSize} color={c.text} />}
              accessibilityLabel={t('common.edit')}
              onPress={() => router.push({ pathname: '/emoji-pack-editor', params: { coordinate } })}
            />
          ) : undefined
        }
      />
    </AppScreen>
  );
}
