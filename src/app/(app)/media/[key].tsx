import { useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, type ViewToken, View } from 'react-native';

import { AppScreen } from '@/components/common/AppScreen';
import { AppText } from '@/components/common/AppText';
import { ChromeBackdrop } from '@/components/common/ChromeBackdrop';
import { ScreenHeader, useScreenHeaderClearance } from '@/components/common/ScreenHeader';
import { SectionLabel } from '@/components/common/SectionLabel';
import { MediaThumbnail } from '@/components/media/MediaThumbnail';
import { useIsContact } from '@/hooks/use-contacts';
import { useScrolled } from '@/hooks/use-scrolled';
import { type ConversationMediaItem, useConversationMedia } from '@/hooks/use-conversation-media';
import { formatMonthLabel, monthKey } from '@/lib/time';
import { useActiveAccount } from '@/stores/active-account.store';
import { spacing, typography } from '@/theme';

const COLS = 3;
const GAP = 2;
const MONTH_HEADER_STYLE = {
  paddingHorizontal: spacing.lg,
  paddingVertical: spacing.sm,
};
const MONTH_HEADER_HEIGHT = typography.caption.lineHeight + spacing.sm * 2;

/** A month divider, or a grid row of up to COLS media. `monthLabel` rides on both
 * so the floating header can read it off the topmost visible item. */
type MonthItem = { type: 'month'; key: string; monthLabel: string };
type RowItem = { type: 'row'; key: string; monthLabel: string; items: ConversationMediaItem[] };
type AlbumItem = MonthItem | RowItem;

/**
 * Conversation media gallery — an album of every image/video in the thread,
 * grouped by month. Built like the chat: an **inverted** `FlatList` (newest at
 * the bottom, opens there, scroll up for older) over a **windowed** query
 * (`useConversationMedia`) so it never loads the whole history. Opened fresh from
 * the profile it tails the newest; opened from an image deep in history (the
 * pager's grid button passes `?focus`/`focusOrderAt`) it anchors there and pages both
 * ways. A floating month label pins the current month to the top.
 */
export default function ConversationMediaGallery() {
  const { scrolled, scrollProps, measurementProps } = useScrolled({ inverted: true });
  const { t } = useTranslation();
  const params = useLocalSearchParams<{
    key: string;
    focus?: string;
    focusOrderAt?: string;
    focusAt?: string;
    focusUrl?: string;
  }>();
  const conversationKey = decodeURIComponent(params.key ?? '');
  const accountPubkey = useActiveAccount((s) => s.activePubkey);
  const isContact = useIsContact(accountPubkey ?? '', conversationKey);
  const [galleryWidth, setGalleryWidth] = useState(0);
  const titleClearance = useScreenHeaderClearance();

  const anchor = useMemo(() => {
    const orderAt = params.focusOrderAt
      ? Number(params.focusOrderAt)
      : params.focusAt
        ? Number(params.focusAt) * 1000
        : undefined;
    return params.focus && params.focusUrl && orderAt
      ? { orderAt, messageId: params.focus, url: params.focusUrl }
      : null;
  }, [params.focus, params.focusOrderAt, params.focusAt, params.focusUrl]);

  const { items, loadOlder, loadNewer, hasMore, hasMoreNewer, anchored, loaded } =
    useConversationMedia(accountPubkey ?? '', conversationKey, anchor);

  const cellSize = Math.floor((galleryWidth - GAP * (COLS - 1)) / COLS);
  const rowHeight = cellSize + GAP; // cell + its marginBottom

  // Group the ascending items into month sections, each chunked into grid rows,
  // then reverse so the newest is data[0] (the bottom of the inverted list).
  const data = useMemo<AlbumItem[]>(() => {
    const asc: AlbumItem[] = [];
    let curMonth = '';
    let label = '';
    let buf: ConversationMediaItem[] = [];
    const flushRow = () => {
      if (buf.length) {
        asc.push({ type: 'row', key: `r:${buf[0].mediaKey}`, monthLabel: label, items: buf });
        buf = [];
      }
    };
    for (const item of items) {
      const m = monthKey(item.createdAt);
      if (m !== curMonth) {
        flushRow();
        curMonth = m;
        label = formatMonthLabel(item.createdAt);
        asc.push({ type: 'month', key: `m:${m}`, monthLabel: label });
      }
      buf.push(item);
      if (buf.length === COLS) flushRow();
    }
    flushRow();
    return asc.reverse();
  }, [items]);

  // Precomputed offsets so `getItemLayout` is O(1) — lets `scrollToIndex` (the
  // anchor jump) land exactly without measuring rows first.
  const offsets = useMemo(() => {
    const out: number[] = [];
    let off = 0;
    for (const it of data) {
      out.push(off);
      off += it.type === 'month' ? MONTH_HEADER_HEIGHT : rowHeight;
    }
    return out;
  }, [data, rowHeight]);

  const getItemLayout = useCallback(
    (_data: ArrayLike<AlbumItem> | null | undefined, index: number) => ({
      length: data[index]?.type === 'month' ? MONTH_HEADER_HEIGHT : rowHeight,
      offset: offsets[index] ?? 0,
      index,
    }),
    [data, offsets, rowHeight],
  );

  const listRef = useRef<FlatList<AlbumItem>>(null);

  // Anchored open: jump to the focused item's row once it's in the window.
  const didAnchorScroll = useRef(false);
  useEffect(() => {
    if (
      didAnchorScroll.current ||
      galleryWidth === 0 ||
      !anchored ||
      !params.focus ||
      data.length === 0
    )
      return;
    const idx = data.findIndex(
      (it) =>
        it.type === 'row' &&
        it.items.some(
          (media) => media.messageId === params.focus && media.meta.url === params.focusUrl,
        ),
    );
    if (idx < 0) return;
    didAnchorScroll.current = true;
    requestAnimationFrame(() =>
      listRef.current?.scrollToIndex({ index: idx, viewPosition: 0.5, animated: false }),
    );
  }, [anchored, params.focus, params.focusUrl, data, galleryWidth]);

  // Floating month label = the topmost visible item's month (inverted, so the
  // highest viewable index sits highest on screen).
  const [floatingMonth, setFloatingMonth] = useState<string | null>(null);
  // Stable identities (FlatList rejects changing these on the fly), without a
  // ref read during render.
  const onViewableItemsChanged = useCallback((info: { viewableItems: ViewToken[] }) => {
    let top: AlbumItem | null = null;
    let maxIndex = -1;
    for (const v of info.viewableItems) {
      if (v.index != null && v.index > maxIndex) {
        maxIndex = v.index;
        top = v.item as AlbumItem;
      }
    }
    // Always show the topmost item's month — so the label stays continuously
    // pinned (reads as a sticky header), only swapping text at a boundary. When
    // an inline divider reaches the top it's the same month, with matching
    // geometry. True sticky headers aren't available on an inverted list.
    if (top) setFloatingMonth(top.monthLabel);
  }, []);
  const viewabilityConfig = useMemo(() => ({ itemVisiblePercentThreshold: 10 }), []);

  return (
    <AppScreen edges={[]}>
      {!loaded ? null : data.length === 0 ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, paddingTop: titleClearance + 24 }}>
          <AppText variant="body" tone="muted">
            {t('media.empty')}
          </AppText>
        </View>
      ) : galleryWidth === 0 ? (
        <View
          onLayout={(event) => setGalleryWidth(event.nativeEvent.layout.width)}
          style={{ flex: 1 }}
        />
      ) : (
        <View
          onLayout={(event) => {
            const nextWidth = event.nativeEvent.layout.width;
            setGalleryWidth((current) => (current === nextWidth ? current : nextWidth));
          }}
          style={{ flex: 1 }}
        >
          <FlatList
            {...measurementProps}
            ref={listRef}
            data={data}
            inverted
            keyExtractor={(item) => item.key}
            getItemLayout={getItemLayout}
            onScrollToIndexFailed={() => {}}
            onViewableItemsChanged={onViewableItemsChanged}
            viewabilityConfig={viewabilityConfig}
            // Inverted lists pin content to the bottom; when it doesn't fill the
            // viewport this top-aligns it instead (flex-end is the visual top once
            // flipped) so a sparse album reads top-down like a photos grid, not
            // stuck at the bottom. No effect once content overflows (then it
            // scrolls, opening at the newest).
            contentContainerStyle={{ flexGrow: 1, justifyContent: 'flex-end', paddingBottom: titleClearance }}
            onEndReached={() => {
              if (hasMore) loadOlder();
            }}
            onEndReachedThreshold={2}
            onScroll={(e) => {
              scrollProps.onScroll(e);
              // Inverted: y == 0 is the bottom (newest). Scrolling down to it in
              // anchored mode pages toward the live tail.
              if (anchored && hasMoreNewer && e.nativeEvent.contentOffset.y < 24) loadNewer();
            }}
            scrollEventThrottle={scrollProps.scrollEventThrottle}
            renderItem={({ item }) =>
              item.type === 'month' ? (
                <View style={MONTH_HEADER_STYLE}>
                  <SectionLabel weight="semibold">{item.monthLabel}</SectionLabel>
                </View>
              ) : (
                <View style={{ flexDirection: 'row', gap: GAP, marginBottom: GAP }}>
                  {item.items.map((media) => (
                    <MediaThumbnail
                      autoLoad={isContact === true || conversationKey === accountPubkey}
                      key={media.mediaKey}
                      item={media}
                      size={cellSize}
                      conversationKey={conversationKey}
                    />
                  ))}
                </View>
              )
            }
          />

          {/* Sticky floating month label pinned to the top (the inverted-list
              equivalent of a sticky section header, as in the chat). Its padding
              matches the inline divider exactly so that when a divider scrolls to
              the top the two coincide pixel-for-pixel — a seamless hand-off. */}
          {floatingMonth ? (
            <View
              style={[MONTH_HEADER_STYLE, {
                position: 'absolute',
                top: titleClearance,
                start: 0,
                end: 0,
                pointerEvents: 'none',
              }]}
            >
              <ChromeBackdrop frosted={scrolled} scrollbarOcclusion="top" />
              <SectionLabel weight="semibold">{floatingMonth}</SectionLabel>
            </View>
          ) : null}
        </View>
      )}
      <ScreenHeader bordered={scrolled && loaded && data.length > 0} title={t('media.title')} />
    </AppScreen>
  );
}
