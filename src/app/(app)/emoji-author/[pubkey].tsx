import { router, useLocalSearchParams } from 'expo-router';
import { DirectionalChevron as ChevronRight } from '@/components/common/DirectionalChevron';
import { BoxMinimalistic as PackageOpen } from '@solar-icons/react-native/category/ui/Linear/BoxMinimalistic';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, StyleSheet, View } from 'react-native';

import { AppButton } from '@/components/common/AppButton';
import { AppScreen } from '@/components/common/AppScreen';
import { AppText } from '@/components/common/AppText';
import { Avatar } from '@/components/common/Avatar';
import { ListRow, ROW_CONTENT_INSET } from '@/components/common/ListRow';
import { ScreenHeader, useScreenHeaderClearance } from '@/components/common/ScreenHeader';
import { EmojiPackListRow, EmojiPackRowSkeleton } from '@/components/emoji/EmojiPackCard';
import { useCustomEmojis } from '@/hooks/use-custom-emojis';
import { useDisplayName } from '@/hooks/use-display-name';
import { useScrolled } from '@/hooks/use-scrolled';
import type { EmojiPack } from '@/lib/nostr/custom-emoji';
import { platform } from '@/platform';
import {
  addEmojiPack,
  fetchEmojiPacksByAuthor,
  loadCachedEmojiPacksByAuthor,
  removeEmojiPack,
} from '@/services/emoji/custom-emoji.service';
import { useActiveAccount } from '@/stores/active-account.store';
import { spacing, useThemeColors } from '@/theme';

const PACK_PAGE_SIZE = 20;

function firstParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? '' : value ?? '';
}

export default function EmojiAuthorPacksScreen() {
  const { t } = useTranslation();
  const c = useThemeColors();
  const titleClearance = useScreenHeaderClearance();
  const params = useLocalSearchParams<{ pubkey: string | string[] }>();
  const authorPubkey = firstParam(params.pubkey);
  const { name, profile } = useDisplayName(authorPubkey);
  const accountPubkey = useActiveAccount((state) => state.activePubkey);
  const collection = useCustomEmojis(accountPubkey);
  const { scrolled, scrollProps } = useScrolled();
  const [packs, setPacks] = useState<EmojiPack[]>([]);
  const [visiblePackCount, setVisiblePackCount] = useState(PACK_PAGE_SIZE);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let active = true;
    setPacks([]);
    setVisiblePackCount(PACK_PAGE_SIZE);
    setLoaded(false);
    void (async () => {
      try {
        const cached = await loadCachedEmojiPacksByAuthor(authorPubkey);
        if (active && cached.length > 0) setPacks(cached);
        const remote = await fetchEmojiPacksByAuthor(authorPubkey);
        if (active) setPacks(remote);
      } catch {
        // Keep any cached packs already painted when the remote refresh fails.
      } finally {
        if (active) setLoaded(true);
      }
    })();
    return () => {
      active = false;
    };
  }, [authorPubkey]);

  const collectedCoordinates = useMemo(
    () => new Set(collection.packs.map((pack) => pack.coordinate)),
    [collection.packs],
  );
  const visiblePacks = useMemo(
    () => packs.slice(0, visiblePackCount),
    [packs, visiblePackCount],
  );

  const loadMorePacks = useCallback(() => {
    setVisiblePackCount((current) => Math.min(current + PACK_PAGE_SIZE, packs.length));
  }, [packs.length]);

  const updatePackCollection = useCallback((pack: EmojiPack, collected: boolean) => {
    if (!accountPubkey) return;
    const mutation = collected
      ? removeEmojiPack(accountPubkey, pack.coordinate)
      : addEmojiPack(accountPubkey, pack);
    void mutation.catch(() =>
      platform.confirmationDialog.notify({
        title: t('emoji.save_failed'),
        okLabel: t('common.ok'),
      }),
    );
  }, [accountPubkey, t]);

  const togglePackCollection = useCallback((pack: EmojiPack, collected: boolean) => {
    if (!collected) {
      updatePackCollection(pack, false);
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
        if (confirmed) updatePackCollection(pack, true);
      });
  }, [t, updatePackCollection]);

  function openPack(coordinate: string) {
    router.push({ pathname: '/emoji-pack/[coordinate]', params: { coordinate } });
  }

  function openProfile() {
    router.push({ pathname: '/profile/[pubkey]', params: { pubkey: authorPubkey } });
  }

  return (
    <AppScreen edges={[]}>
      <FlatList
        data={visiblePacks}
        keyExtractor={(pack) => pack.coordinate}
        renderItem={({ item }) => (
          <EmojiPackListRow
            pack={item}
            collected={
              collection.loaded ? collectedCoordinates.has(item.coordinate) : null
            }
            onPress={openPack}
            onToggleCollection={togglePackCollection}
          />
        )}
        ItemSeparatorComponent={() => (
          <View
            style={{
              height: StyleSheet.hairlineWidth,
              marginStart: 72,
              backgroundColor: c.border,
            }}
          />
        )}
        ListHeaderComponent={(
          <View>
            <ListRow
              variant="list"
              icon={(
                <Avatar
                  pubkey={authorPubkey}
                  picture={profile?.picture}
                  name={name}
                  size={28}
                />
              )}
              title={name}
              subtitle={t('chat.view_profile')}
              trailing={<ChevronRight size={18} color={c.textMuted} />}
              onPress={openProfile}
            />
            <View
              style={{
                height: StyleSheet.hairlineWidth,
                marginStart: ROW_CONTENT_INSET,
                backgroundColor: c.border,
              }}
            />
          </View>
        )}
        ListEmptyComponent={
          !loaded ? (
            <View>
              <EmojiPackRowSkeleton />
              <View
                style={{
                  height: StyleSheet.hairlineWidth,
                  marginStart: 72,
                  backgroundColor: c.border,
                }}
              />
              <EmojiPackRowSkeleton />
            </View>
          ) : (
            <View
              style={{
                flex: 1,
                alignItems: 'center',
                justifyContent: 'center',
                gap: spacing.sm,
                padding: spacing['2xl'],
              }}
            >
              <PackageOpen size={48} color={c.textMuted} />
              <AppText variant="subtitle" tone="muted">
                {t('emoji.no_author_packs_title')}
              </AppText>
              <AppText variant="body" tone="muted" align="center">
                {t('emoji.no_author_packs_hint')}
              </AppText>
              <AppButton
                label={t('chat.view_profile')}
                variant="secondary"
                fullWidth={false}
                onPress={openProfile}
              />
            </View>
          )
        }
        onEndReached={visiblePackCount < packs.length ? loadMorePacks : undefined}
        onEndReachedThreshold={1.5}
        initialNumToRender={12}
        maxToRenderPerBatch={10}
        windowSize={3}
        contentContainerStyle={{
          paddingTop: titleClearance,
          paddingBottom: spacing['2xl'],
          flexGrow: 1,
        }}
        showsVerticalScrollIndicator={false}
        {...scrollProps}
      />
      <ScreenHeader
        bordered={scrolled}
        title={t('emoji.author_packs_title', { name })}
      />
    </AppScreen>
  );
}
