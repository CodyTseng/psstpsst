import { Image } from 'expo-image';
import { router } from 'expo-router';
import { ChatRound as MessageCircle } from '@solar-icons/react-native/category/messages/Linear/ChatRound';
import { GalleryWide as Images } from '@solar-icons/react-native/category/video/Linear/GalleryWide';
import DownloadIcon from 'lucide-react-native/icons/download';
import { useLayoutEffect, useMemo, useRef, useState, type Ref } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';

import { InteractivePressable as Pressable } from '@/components/common/InteractivePressable';
import Animated, { useSharedValue } from 'react-native-reanimated';

import { ZoomableImage, type ZoomableImageHandle } from '@/components/common/ZoomableImage';
import { MediaViewerTopBar } from '@/components/media/MediaViewerTopBar';
import type { MediaViewerPreview } from '@/stores/media-viewer.store';
import { useMediaViewerTransition } from '@/components/media/use-media-viewer-transition';
import { MediaVideoPage } from '@/components/media/MediaVideoPage';
import { useAttachment } from '@/hooks/use-attachment';
import {
  type ConversationMediaItem,
  useConversationMedia,
} from '@/hooks/use-conversation-media';
import { revealOrRetry } from '@/lib/attachments/failure';
import type { FileAttachmentMeta } from '@/lib/nostr/file-tags';
import { IS_ELECTRON } from '@/lib/platform';
import { platform } from '@/platform';
import {
  saveAttachmentToLibrary,
  saveRemoteMediaToLibrary,
} from '@/services/files/media-save.service';
import { useActiveAccount } from '@/stores/active-account.store';
import { iconStrokeWidth } from '@/theme/icons';
import { desktopChrome, uiDensity, useThemeColors } from '@/theme';

type Props = {
  preview?: MediaViewerPreview;
  conversationKey: string;
  focusMessageId: string;
  focusOrderAt: number;
  focusUrl: string;
  /** Show the "open album" button — hidden when the pager was opened from the
   * album itself (the user is already there). */
  showGrid: boolean;
  onClose: () => void;
};

// Within this many cells of an end, page in the next window of media.
const EDGE = 3;

type MediaPageItem = ConversationMediaItem | {
  source: 'preview';
  mediaKey: string;
  isVideo: false;
};

/**
 * Swipeable full-screen pager over a conversation's indexed images/videos,
 * **windowed** around the tapped item (`useConversationMedia` anchored) — it
 * loads a page each side and extends as you swipe, never the whole history.
 * Zooming an image disables paging (the pan then moves within it). New older
 * media prepended on paging keep the current page put via
 * `maintainVisibleContentPosition`.
 */
export function MediaPager({
  preview,
  conversationKey,
  focusMessageId,
  focusOrderAt,
  focusUrl,
  showGrid,
  onClose,
}: Props) {
  const { t } = useTranslation();
  const c = useThemeColors();
  const { width, height: windowHeight } = useWindowDimensions();
  // Page height is the viewer's container height, not the window's: on desktop
  // the window frame's title bar takes a row above the viewer (DesktopWindowFrame);
  // on mobile the viewer fills the window, so the heights match.
  const pageHeight = windowHeight - (IS_ELECTRON ? desktopChrome.titlebarHeight : 0);
  const accountPubkey = useActiveAccount((s) => s.activePubkey);

  const focusMediaKey = `${focusMessageId}\u0000${focusUrl}`;
  // Give the source image its final list key from the first frame. Loading the
  // surrounding window then inserts neighbours without replacing this bitmap.
  const initialPages = useMemo<MediaPageItem[]>(() => preview
    ? [{ source: 'preview', mediaKey: focusMediaKey, isVideo: false }]
    : [], [preview, focusMediaKey]);
  const [currentId, setCurrentId] = useState(focusMediaKey);
  const backdrop = useSharedValue(1);
  const { animatedStyle, contentStyle, isClosing, entered, requestClose } =
    useMediaViewerTransition(onClose, backdrop);

  const anchor = useMemo(
    () => ({ orderAt: focusOrderAt, messageId: focusMessageId, url: focusUrl }),
    [focusOrderAt, focusMessageId, focusUrl],
  );
  const { items, loadOlder, loadNewer, hasMore, hasMoreNewer, loaded } = useConversationMedia(
    accountPubkey ?? '',
    conversationKey,
    anchor,
    // The already decoded source animates first; media rows and adjacent
    // images load after the entrance has finished on the UI thread.
    !preview || IS_ELECTRON || entered,
  );

  // The currently shown item, tracked by id (indices shift as older media page
  // in). Seeded to the focus; save / active-video derive from it. The initial
  // scroll index is frozen once, on first load (adjust-state-on-render, so it's
  // set before paint without a ref written mid-render).
  const [initialIndex, setInitialIndex] = useState<number | null>(null);
  if (initialIndex === null && loaded && items.length > 0) {
    const i = items.findIndex((it) => it.mediaKey === focusMediaKey);
    setInitialIndex(i >= 0 ? i : 0);
    if (i < 0) setCurrentId(items[0].mediaKey);
  }

  const currentIndex = useMemo(() => {
    const i = items.findIndex((it) => it.mediaKey === currentId);
    return i >= 0 ? i : (initialIndex ?? 0);
  }, [items, currentId, initialIndex]);

  const [zoomed, setZoomed] = useState(false);
  const imageRef = useRef<ZoomableImageHandle>(null);
  const [imageScale, setImageScale] = useState(0);
  const listRef = useRef<FlatList<MediaPageItem>>(null);
  const desktopPositioned = useRef(false);

  const [saving, setSaving] = useState(false);
  async function save(item: (typeof items)[number]) {
    if (saving) return;
    setSaving(true);
    const result =
      item.source === 'attachment'
        ? await saveAttachmentToLibrary(item.meta, { accountPubkey })
        : await saveRemoteMediaToLibrary(item.meta);
    setSaving(false);
    if (result === 'denied')
      void platform.confirmationDialog.notify({
        title: t('attach.save_permission'),
        okLabel: t('common.ok'),
      });
    else if (result === 'failed')
      void platform.confirmationDialog.notify({
        title: t('attach.save_failed'),
        okLabel: t('common.ok'),
      });
    else if (result === 'saved' && !IS_ELECTRON)
      void platform.confirmationDialog.notify({
        title: t('attach.saved'),
        okLabel: t('common.ok'),
      });
  }

  function openGrid(item: { messageId: string; orderAt: number; meta: { url: string } }) {
    // `navigate` (not push) so opening the grid from a pager that the grid itself
    // launched returns to it; the anchor params land the album on this item.
    requestClose(() => router.navigate(
      `/media/${encodeURIComponent(conversationKey)}?focus=${encodeURIComponent(item.messageId)}&focusOrderAt=${item.orderAt}&focusUrl=${encodeURIComponent(item.meta.url)}`,
    ));
  }

  function jumpToChat(item: { messageId: string; orderAt: number }) {
    // Jump to this message in the conversation, exactly like tapping a chat-search
    // hit: `navigate` (not push) so it returns to an already-open chat, and the
    // `?focus`/`focusOrderAt` params centre the message list on the bubble.
    requestClose(() => router.navigate(
      `/chat/${encodeURIComponent(conversationKey)}?focus=${encodeURIComponent(item.messageId)}&focusOrderAt=${item.orderAt}`,
    ));
  }

  const ready = loaded && initialIndex !== null && items.length > 0;
  const currentItem = ready ? (items[currentIndex] ?? items[0]) : undefined;
  const pages: MediaPageItem[] = ready ? items : initialPages;

  useLayoutEffect(() => {
    if (!IS_ELECTRON || !preview || !ready || desktopPositioned.current) return;
    // React Native Web does not implement native visible-position anchoring.
    // Align the retained source cell before paint when its neighbours arrive.
    listRef.current?.scrollToOffset({ offset: currentIndex * width, animated: false });
    desktopPositioned.current = true;
  }, [preview, ready, currentIndex, width]);

  return (
    <View style={[StyleSheet.absoluteFill, { zIndex: 50, elevation: 50, overflow: 'hidden' }]}>
      <Animated.View
        style={[StyleSheet.absoluteFill, { backgroundColor: c.lightboxBackdrop }, animatedStyle]}
      />
      <Animated.View style={[{ flex: 1 }, contentStyle]} pointerEvents={isClosing || (!IS_ELECTRON && !ready) ? 'none' : 'auto'}>
        {!ready && !preview ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color={c.onOverlay} /></View>
        ) : (
          <FlatList<MediaPageItem>
            ref={listRef}
            data={pages}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            initialNumToRender={1}
            maxToRenderPerBatch={3}
            // The small virtualized window bounds memory. Native clipping can
            // detach the retained bitmap before prepend anchoring catches up.
            removeClippedSubviews={false}
            initialScrollIndex={preview ? 0 : initialIndex ?? 0}
            getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
            keyExtractor={(it) => it.mediaKey}
            scrollEnabled={!zoomed}
            // Older media paged in at the front mustn't shift the current page.
            maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
            onMomentumScrollEnd={(e) => {
              const idx = Math.round(e.nativeEvent.contentOffset.x / width);
              const item = pages[idx];
              if (item && item.mediaKey !== currentId) {
                setImageScale(0);
                setCurrentId(item.mediaKey);
              }
              if (idx <= EDGE && hasMore) loadOlder();
              if (idx >= pages.length - 1 - EDGE && hasMoreNewer) loadNewer();
            }}
            // Only the selected image mounts below: paging must not download
            // neighbouring non-contact resources as a side effect.
            windowSize={3}
            renderItem={({ item, index }) => (
              <View style={{ width, height: pageHeight }}>
                {item.isVideo ? (
                  <MediaVideoPage item={item} active={index === currentIndex} />
                ) : index === currentIndex ? (
                  <MediaImagePage
                    preview={item.mediaKey === focusMediaKey ? preview : undefined}
                    imageRef={index === currentIndex ? imageRef : undefined}
                    onScaleChange={index === currentIndex ? setImageScale : undefined}
                    item={item}
                    onRequestClose={() => requestClose()}
                    onZoomedChange={setZoomed}
                    onDragProgress={(p) => {
                      backdrop.value = 1 - p * 0.6;
                    }}
                  />
                ) : null}
              </View>
            )}
          />
        )}
      </Animated.View>
      <Animated.View style={[StyleSheet.absoluteFill, animatedStyle]} pointerEvents={isClosing ? 'none' : 'box-none'}>
        <MediaViewerTopBar
          imageZoom={!currentItem || currentItem.isVideo ? undefined : {
            scale: imageScale,
            zoomIn: () => imageRef.current?.zoomIn(),
            zoomOut: () => imageRef.current?.zoomOut(),
          }}
          onClose={() => requestClose()}
          onSave={() => { if (currentItem) void save(currentItem); }}
          disabled={saving || !currentItem || (currentItem.source === 'embedded' && !!currentItem.meta.streaming)}
          extraAction={!currentItem ? undefined : (
            showGrid
              ? {
                  onPress: () => openGrid(currentItem),
                  icon: <Images size={uiDensity.headerActionIconSize} color={c.onOverlay} />,
                  accessibilityLabel: t('media.show_all'),
                }
              : {
                  onPress: () => jumpToChat(currentItem),
                  icon: (
                    <MessageCircle size={uiDensity.headerActionIconSize} color={c.onOverlay} />
                  ),
                  accessibilityLabel: t('media.go_to_message'),
                }
          )}
        />
      </Animated.View>
    </View>
  );
}

type ImagePageProps = {
  imageRef?: Ref<ZoomableImageHandle>;
  onScaleChange?: (scale: number) => void;
  onRequestClose: () => void;
  onZoomedChange: (zoomed: boolean) => void;
  onDragProgress: (progress: number) => void;
};

/** Retain the decoded preview; resolve other attachments only when needed. */
function MediaImagePage({ item, preview, imageRef, ...imageProps }: ImagePageProps & {
  item: MediaPageItem;
  preview?: MediaViewerPreview;
}) {
  if (!preview && item.source === 'attachment') {
    return <AttachmentMediaImagePage {...imageProps} imageRef={imageRef} meta={item.meta} />;
  }
  const image = preview ?? (item.source === 'embedded' ? {
    uri: item.meta.url,
    cacheKey: item.meta.sha256 ?? item.meta.url,
    thumbhash: item.meta.thumbhash,
    blurhash: item.meta.blurhash,
  } : undefined);
  return image ? <ZoomableImage {...imageProps} {...image} ref={imageRef} dismissAxis="vertical" /> : null;
}

function AttachmentMediaImagePage({ meta, imageRef, ...imageProps }: ImagePageProps & {
  meta: FileAttachmentMeta;
}) {
  const { t } = useTranslation();
  const c = useThemeColors();
  const { state, resume, retry, reveal } = useAttachment(meta);

  if (state.status === 'ready') {
    return (
      <ZoomableImage
        ref={imageRef}
        {...imageProps}
        uri={state.localUri}
        thumbhash={meta.thumbhash}
        dismissAxis="vertical"
      />
    );
  }

  if (state.status === 'error') {
    return (
      <Pressable
        onPress={() => revealOrRetry(state.kind, t, 'show', (allow) => (allow ? reveal() : retry()))}
        style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}
      >
        <ActivityIndicator color={c.onOverlay} />
      </Pressable>
    );
  }

  if (state.status === 'paused') {
    return (
      <Pressable
        onPress={resume}
        accessibilityLabel={t('common.resume')}
        style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}
      >
        <DownloadIcon strokeWidth={iconStrokeWidth.default} size={28} color={c.onOverlay} />
      </Pressable>
    );
  }

  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
      {meta.thumbhash ? (
        <Image
          placeholder={{ thumbhash: meta.thumbhash }}
          placeholderContentFit="contain"
          style={StyleSheet.absoluteFill}
          contentFit="contain"
        />
      ) : null}
      <ActivityIndicator color={c.onOverlay} />
    </View>
  );
}
