import { router } from 'expo-router';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { AppText } from '@/components/common/AppText';
import { CustomEmojiGrid } from '@/components/emoji/custom-emoji-grid';
import { StandaloneEmojiGrid } from '@/components/emoji/standalone-emoji-grid';
import { EmojiPackAuthorRow } from '@/components/emoji/EmojiPackAuthorRow';
import { useAddCustomEmoji } from '@/hooks/use-add-custom-emoji';
import type { CustomEmoji, EmojiPack } from '@/lib/nostr/custom-emoji';
import { emojiPickerLayout, spacing } from '@/theme';

import { EmojiPickerSearchField } from './emoji-picker-search-field';
import { EmojiPickerTabs, STANDALONE_EMOJI_TAB } from './emoji-picker-tabs';

type Props = {
  active: boolean;
  onSelect: (emoji: CustomEmoji) => void;
  onAddStandaloneEmoji?: () => void;
  onOpenEmojiAuthor?: (authorPubkey: string) => void;
  onOpenEmojiPacks?: () => void;
  allowStandaloneEditing?: boolean;
  backgroundColor?: string;
  customPacks?: EmojiPack[];
  standaloneCustomEmojis?: CustomEmoji[];
  safeBottom: number;
  /** Show a shortcode search field above the source rail, filtering across
   * every custom source. Only modal sheet surfaces opt in: the touch
   * composer's inline panel is a keyboard replacement with no typing. */
  searchable?: boolean;
};

// The field's `value` tracks keystrokes immediately; only the *filter* input
// lags by this debounce, so typing stays snappy while a keystroke never runs
// the collection scan synchronously.
const SEARCH_DEBOUNCE_MS = 200;

/**
 * The shared custom-emoji panel used by the composer and reaction picker.
 * Unicode emoji stay outside this surface; it switches only between standalone
 * kind-10030 entries and collected packs. Sheet surfaces can opt into a
 * shortcode search field (`searchable`) that filters across all sources.
 */
export const EmojiPickerPanel = memo(function EmojiPickerPanel({
  active,
  onSelect,
  onAddStandaloneEmoji,
  onOpenEmojiAuthor,
  onOpenEmojiPacks,
  allowStandaloneEditing = true,
  backgroundColor,
  customPacks = [],
  standaloneCustomEmojis = [],
  safeBottom,
  searchable = false,
}: Props) {
  const { t } = useTranslation();
  const initialSource = STANDALONE_EMOJI_TAB;
  const [activeSource, setActiveSource] = useState<string | null>(initialSource);
  const [query, setQuery] = useState('');
  const [filterQuery, setFilterQuery] = useState('');
  const defaultAddStandaloneEmoji = useAddCustomEmoji();

  useEffect(() => {
    const timeout = setTimeout(
      () => setFilterQuery(query),
      SEARCH_DEBOUNCE_MS,
    );
    return () => clearTimeout(timeout);
  }, [query]);

  const resolvedSource =
    activeSource === STANDALONE_EMOJI_TAB
      ? STANDALONE_EMOJI_TAB
      : activeSource && customPacks.some((pack) => pack.coordinate === activeSource)
        ? activeSource
        : STANDALONE_EMOJI_TAB;
  const selectedPack =
    resolvedSource && resolvedSource !== STANDALONE_EMOJI_TAB
      ? customPacks.find((pack) => pack.coordinate === resolvedSource)
      : undefined;
  const selectedEmojis = selectedPack?.emojis;

  // A non-empty query searches every custom source at once (standalone first,
  // then packs in display order), deduplicated by shortcode + artwork URL.
  const normalizedQuery = filterQuery.trim().toLowerCase();
  const searchResults = useMemo<CustomEmoji[] | null>(() => {
    if (!searchable || !normalizedQuery) return null;
    const seen = new Set<string>();
    const matched: CustomEmoji[] = [];
    const consider = (emoji: CustomEmoji) => {
      if (!emoji.shortcode.toLowerCase().includes(normalizedQuery)) return;
      const key = JSON.stringify([emoji.shortcode.toLowerCase(), emoji.url]);
      if (seen.has(key)) return;
      seen.add(key);
      matched.push(emoji);
    };
    standaloneCustomEmojis.forEach(consider);
    for (const pack of customPacks) pack.emojis.forEach(consider);
    return matched;
  }, [searchable, normalizedQuery, standaloneCustomEmojis, customPacks]);

  function selectSource(coordinate: string) {
    // Picking a source tab leaves the search, mirroring the Unicode category
    // rail clearing its query on a category jump. The debounced filter input
    // is cleared synchronously too, so the results grid can't outlive the
    // tab switch.
    setQuery('');
    setFilterQuery('');
    setActiveSource(coordinate);
  }

  const addStandaloneEmoji =
    onAddStandaloneEmoji ?? defaultAddStandaloneEmoji;
  const defaultOpenEmojiPacks = useCallback(() => {
    router.push('/emoji-packs');
  }, []);
  const openEmojiPacks = onOpenEmojiPacks ?? defaultOpenEmojiPacks;
  const defaultOpenEmojiAuthor = useCallback((authorPubkey: string) => {
    router.push({
      pathname: '/emoji-author/[pubkey]',
      params: { pubkey: authorPubkey },
    });
  }, []);
  const openEmojiAuthor = onOpenEmojiAuthor ?? defaultOpenEmojiAuthor;

  return (
    <View
      style={[
        { flex: 1 },
        backgroundColor === undefined ? undefined : { backgroundColor },
      ]}
    >
      {searchable ? (
        <EmojiPickerSearchField value={query} onChangeText={setQuery} content="sticker" />
      ) : null}

      <EmojiPickerTabs
        activePack={resolvedSource}
        backgroundColor={backgroundColor}
        customPacks={customPacks}
        standaloneCustomEmojis={standaloneCustomEmojis}
        onOpenEmojiPacks={openEmojiPacks}
        onSelectPack={selectSource}
        showUnicodeCategories={false}
      />

      {searchResults ? (
        // Search spans every source, so the result grid shows no per-pack
        // author row and no standalone add/edit affordances.
        <CustomEmojiGrid
          style={{ flex: 1 }}
          emojis={searchResults}
          horizontalPadding={emojiPickerLayout.horizontalGutter}
          onSelect={onSelect}
          emptyComponent={
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
              <AppText tone="muted">{t('chat.emoji.none_stickers')}</AppText>
            </View>
          }
          contentContainerStyle={{
            flexGrow: searchResults.length ? undefined : 1,
            paddingBottom: Math.max(safeBottom, spacing.md),
          }}
        />
      ) : resolvedSource === STANDALONE_EMOJI_TAB ? (
        <StandaloneEmojiGrid
          active={active}
          allowEditing={allowStandaloneEditing}
          emojis={standaloneCustomEmojis}
          onAdd={addStandaloneEmoji}
          onSelect={onSelect}
          safeBottom={safeBottom}
          horizontalPadding={emojiPickerLayout.horizontalGutter}
          contentTopPadding={emojiPickerLayout.contentTopGap}
        />
      ) : (
        <CustomEmojiGrid
          key={resolvedSource}
          style={{ flex: 1 }}
          emojis={selectedEmojis ?? []}
          horizontalPadding={emojiPickerLayout.horizontalGutter}
          onSelect={onSelect}
          listHeader={
            selectedPack ? (
              <View
                style={{
                  paddingHorizontal: emojiPickerLayout.horizontalGutter,
                }}
              >
                <EmojiPackAuthorRow
                  authorPubkey={selectedPack.authorPubkey}
                  packTitle={selectedPack.title || undefined}
                  onPress={openEmojiAuthor}
                />
              </View>
            ) : null
          }
          emptyComponent={
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
              <AppText tone="muted">{t('chat.emoji.none_stickers')}</AppText>
            </View>
          }
          contentContainerStyle={{
            flexGrow: selectedEmojis?.length ? undefined : 1,
            paddingBottom: Math.max(safeBottom, spacing.md),
          }}
        />
      )}
    </View>
  );
});
