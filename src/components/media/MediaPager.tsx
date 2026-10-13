import type { ImageRef } from 'expo-image';
import { router } from 'expo-router';
import { ChatRound as MessageCircle } from '@solar-icons/react-native/category/messages/Linear/ChatRound';
import { GalleryWide as Images } from '@solar-icons/react-native/category/video/Linear/GalleryWide';
import DownloadIcon from 'lucide-react-native/icons/download';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type Ref } from 'react';
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

import { IconButton } from '@/components/common/IconButton';
import { AttachmentTransferProgress } from '@/components/chat/AttachmentTransferProgress';
import { ZoomableImage, type ZoomableImageHandle } from '@/components/common/ZoomableImage';
import { MediaViewerContextMenu } from './MediaViewerContextMenu';
import { copyAttachment, copyImageUri } from '@/services/files/attachment-copy.service';
import { MediaViewerTopBar } from '@/components/media/MediaViewerTopBar';
import type { MediaViewerPreview } from '@/stores/media-viewer.store';
import { useMediaViewerTransition } from '@/components/media/use-media-viewer-transition';
import { MediaVideoPage } from '@/components/media/MediaVideoPage';
import { MediaTouchPager } from './MediaTouchPager';
import { MediaChromeProvider, MediaTopChrome } from './MediaChrome';
import { MediaDismissSurface } from '@/components/media/MediaDismissSurface';
import { MediaImagePlaceholder } from '@/components/common/MediaImagePlaceholder';
import { useCachedMediaImages } from '@/hooks/use-cached-media-images';
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
 * Zooming an image disables paging. Selection uses media identity so prepends
 * and viewport changes retain the selected surface and playback session.
 */
export function MediaPager(props: Props) {
  return <MediaChromeProvider><MediaPagerContent {...props} /></MediaChromeProvider>;
}

function MediaPagerContent({
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
  const desktopPosition = useRef<{ mediaKey: string; index: number } | null>(null);
  const previousWidth = useRef(width);
  const resizing = useRef(false);
  const dragWidth = useRef<number | null>(null);

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
    if (!IS_ELECTRON || !ready) return;
    const previous = desktopPosition.current;
    desktopPosition.current = { mediaKey: currentId, index: currentIndex };
    if (!(preview && !previous) &&
      !(previous?.mediaKey === currentId && previous.index !== currentIndex)) return;
    // React Native Web does not implement native visible-position anchoring.
    // Retain selection when the initial window or older neighbours arrive.
    resizing.current = currentIndex !== 0;
    listRef.current?.scrollToOffset({ offset: currentIndex * width, animated: false });
  }, [preview, ready, currentId, currentIndex, width]);

  useLayoutEffect(() => {
    if (previousWidth.current === width) return;
    previousWidth.current = width;
    resizing.current = true;
    dragWidth.current = null;
  }, [width]);

  const videoActive = !IS_ELECTRON && !!currentItem?.isVideo && !isClosing;
  useEffect(() => {
    if (IS_ELECTRON) return;
    void platform.screenOrientation.setVideoActive(videoActive).catch(() => {});
  }, [videoActive]);
  useEffect(() => () => {
    if (!IS_ELECTRON) void platform.screenOrientation.setVideoActive(false).catch(() => {});
  }, []);

  function alignResizedPage() {
    if (resizing.current && ready) {
      listRef.current?.scrollToOffset({ offset: currentIndex * width, animated: false });
      // At offset zero, a resize may not produce any browser scroll event.
      if (IS_ELECTRON && currentIndex === 0) resizing.current = false;
    }
  }

  function selectPage(index: number) {
    const item = pages[index];
    if (item && item.mediaKey !== currentId) {
      setImageScale(0);
      setZoomed(false);
      setCurrentId(item.mediaKey);
    }
    if (index <= EDGE && hasMore) loadOlder();
    if (index >= pages.length - 1 - EDGE && hasMoreNewer) loadNewer();
  }

  const cachedImages = useCachedMediaImages(
    ready ? items[currentIndex - 1] : undefined,
    currentItem,
    ready ? items[currentIndex + 1] : undefined,
  );

  function renderPage(item: MediaPageItem, active: boolean) {
    if (item.isVideo) {
      if (!active && !IS_ELECTRON) return <MediaPagePreview item={item} />;
      return (
        <MediaDismissSurface active={active} backdrop={backdrop} onRequestClose={() => requestClose()}>
          <MediaVideoPage item={item} active={active} />
        </MediaDismissSurface>
      );
    }
    const cachedImage = cachedImages.get(item.mediaKey);
    return (
      <MediaImagePage
        active={active}
        preview={item.mediaKey === focusMediaKey ? preview : undefined}
        decodedImage={typeof cachedImage === 'string' ? undefined : cachedImage ?? undefined}
        cachedUri={typeof cachedImage === 'string' ? cachedImage : undefined}
        cachePending={!IS_ELECTRON && !cachedImages.has(item.mediaKey)}
        imageRef={active ? imageRef : undefined}
        onScaleChange={active ? setImageScale : undefined}
        item={item}
        onRequestClose={() => requestClose()}
        onZoomedChange={setZoomed}
        onDragProgress={(p) => { backdrop.value = 1 - p * 0.6; }}
      />
    );
  }

  const selectedPage = ready ? currentIndex : 0;
  const touchPage = pages[selectedPage];

  return (
    <MediaViewerContextMenu
      disabled={saving || isClosing || !currentItem}
      onSave={!currentItem || (currentItem.source === 'embedded' && currentItem.meta.streaming)
        ? undefined : () => save(currentItem)}
      onGoToMessage={!showGrid && currentItem ? () => jumpToChat(currentItem) : undefined}
      onCopy={!currentItem || currentItem.isVideo ? undefined : () =>
        currentItem.source === 'attachment'
          ? copyAttachment(currentItem.meta, { accountPubkey })
          : copyImageUri(currentItem.meta.url)}
      style={[StyleSheet.absoluteFill, { zIndex: 50, elevation: 50, overflow: 'hidden' }]}
    >
      <Animated.View
        style={[StyleSheet.absoluteFill, { backgroundColor: c.lightboxBackdrop }, animatedStyle]}
      />
      <Animated.View style={[{ flex: 1 }, contentStyle]} pointerEvents={isClosing || (!IS_ELECTRON && !ready) ? 'none' : 'auto'}>
        {!ready && !preview ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color={c.onOverlay} /></View>
        ) : !IS_ELECTRON && touchPage ? (
          <MediaTouchPager
            width={width}
            height={pageHeight}
            pageKey={touchPage.mediaKey}
            enabled={!zoomed && !isClosing}
            previousKey={pages[selectedPage - 1]?.mediaKey}
            nextKey={pages[selectedPage + 1]?.mediaKey}
            previous={selectedPage > 0 ? renderPage(pages[selectedPage - 1], false) : undefined}
            next={selectedPage < pages.length - 1 ? renderPage(pages[selectedPage + 1], false) : undefined}
            onPage={(step) => selectPage(selectedPage + step)}
          >
            {renderPage(touchPage, true)}
          </MediaTouchPager>
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
            onLayout={(e) => {
              if (Math.abs(e.nativeEvent.layout.width - width) < 1) alignResizedPage();
            }}
            onContentSizeChange={(contentWidth) => {
              if (Math.abs(contentWidth - pages.length * width) < 1) alignResizedPage();
            }}
            scrollEventThrottle={16}
            onScroll={IS_ELECTRON ? (e) => {
              // Web emits scroll events, not native drag/momentum callbacks.
              // Commit only snapped pages so passing a neighbour cannot fetch it.
              if (!ready || zoomed || isClosing || width <= 0 ||
                Math.abs(e.nativeEvent.layoutMeasurement.width - width) >= 1) return;
              const offset = e.nativeEvent.contentOffset.x;
              if (resizing.current) {
                if (Math.abs(offset - currentIndex * width) < 1) resizing.current = false;
                return;
              }
              const index = Math.round(offset / width);
              if (index !== currentIndex && index >= 0 && index < pages.length &&
                Math.abs(offset - index * width) < 1) selectPage(index);
            } : undefined}
            onScrollBeginDrag={() => {
              resizing.current = false;
              dragWidth.current = width;
            }}
            onMomentumScrollEnd={(e) => {
              // Rotation/programmatic alignment is not a user's page selection.
              if (resizing.current || dragWidth.current !== width) return;
              dragWidth.current = null;
              selectPage(Math.round(e.nativeEvent.contentOffset.x / width));
            }}
            // Retain cached neighbour images without starting remote downloads.
            windowSize={3}
            renderItem={({ item, index }) => (
              <View style={{ width, height: pageHeight }}>
                {Math.abs(index - currentIndex) <= 1
                  ? renderPage(item, index === currentIndex)
                  : <MediaPagePreview item={item} />}
              </View>
            )}
          />
        )}
      </Animated.View>
      <Animated.View style={[StyleSheet.absoluteFill, animatedStyle]} pointerEvents={isClosing ? 'none' : 'box-none'}>
        <MediaTopChrome>
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
        </MediaTopChrome>
      </Animated.View>
    </MediaViewerContextMenu>
  );
}

/** Neighbours never allocate players or fetch full attachments just for paging. */
function MediaPagePreview({ item, showPlaceholder = true }: { item: MediaPageItem; showPlaceholder?: boolean }) {
  const c = useThemeColors();
  const thumbhash = item.source === 'preview' ? undefined : item.meta.thumbhash;
  const blurhash = item.source === 'preview' ? undefined : item.meta.blurhash;
  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: c.lightboxBackdrop }]}>
      {showPlaceholder ? (
        <MediaImagePlaceholder thumbhash={thumbhash} blurhash={blurhash} aspectRatio={mediaAspectRatio(item)} />
      ) : null}
    </View>
  );
}

type ImagePageProps = {
  cachedUri?: string;
  decodedImage?: ImageRef;
  imageRef?: Ref<ZoomableImageHandle>;
  onScaleChange?: (scale: number) => void;
  onRequestClose: () => void;
  onZoomedChange: (zoomed: boolean) => void;
  onDragProgress: (progress: number) => void;
};

/** Retain the decoded preview; resolve other attachments only when needed. */
function MediaImagePage({ item, preview, active, cachePending, imageRef, cachedUri, ...imageProps }: ImagePageProps & {
  item: MediaPageItem;
  preview?: MediaViewerPreview;
  cachePending: boolean;
  active: boolean;
}) {
  const [visited, setVisited] = useState(active);
  if (active && !visited) setVisited(true);
  if (!active && !visited && !imageProps.decodedImage && !cachedUri && !preview) {
    return <MediaPagePreview item={item} showPlaceholder={!cachePending} />;
  }
  if (!preview && item.source === 'attachment') {
    return <AttachmentMediaImagePage {...imageProps} cachedUri={cachedUri} active={active} imageRef={imageRef} meta={item.meta} />;
  }
  const image = preview ?? (item.source === 'embedded' ? {
    uri: cachedUri ?? item.meta.url,
    cacheKey: item.meta.sha256 ?? item.meta.url,
    thumbhash: cachePending ? undefined : item.meta.thumbhash,
    blurhash: cachePending ? undefined : item.meta.blurhash,
  } : undefined);
  return image ? <ZoomableImage interactionEnabled={active} {...imageProps} {...image} aspectRatio={mediaAspectRatio(item)} ref={imageRef} dismissAxis="vertical" /> : null;
}

function AttachmentMediaImagePage({ meta, active, imageRef, cachedUri, ...imageProps }: ImagePageProps & {
  meta: FileAttachmentMeta;
  active: boolean;
}) {
  const { t } = useTranslation();
  const c = useThemeColors();
  // A later cache fill must not recycle an image already displaying its local URI.
  const [preparedImage] = useState(imageProps.decodedImage);
  const { state, pause, resume, retry, reveal } = useAttachment(meta, { autoLoad: active });

  if (state.status === 'ready' || preparedImage || cachedUri) {
    return (
      <ZoomableImage
        interactionEnabled={active}
        ref={imageRef}
        {...imageProps}
        decodedImage={preparedImage}
        thumbhash={meta.thumbhash}
        blurhash={meta.blurhash}
        uri={preparedImage ? meta.url : cachedUri ?? (state.status === 'ready' ? state.localUri : meta.url)}
        aspectRatio={attachmentAspectRatio(meta)}
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
      {IS_ELECTRON || state.status !== 'checking' ? (
        <MediaImagePlaceholder thumbhash={meta.thumbhash} blurhash={meta.blurhash} aspectRatio={attachmentAspectRatio(meta)} />
      ) : null}
      {state.status === 'loading' ? (
        <IconButton
          onPress={pause}
          accessibilityLabel={t('common.pause')}
          size={56}
          icon={<AttachmentTransferProgress url={meta.url} size="media" tone="media" fallbackPercent={0} />}
        />
      ) : <ActivityIndicator color={c.onOverlay} />}
    </View>
  );
}

function attachmentAspectRatio(meta: FileAttachmentMeta): number | undefined {
  const match = meta.dim?.match(/^(\d+)x(\d+)$/);
  if (!match) return undefined;
  const width = Number(match[1]);
  const height = Number(match[2]);
  return width > 0 && height > 0 ? width / height : undefined;
}

function mediaAspectRatio(item: MediaPageItem): number | undefined {
  if (item.source === 'preview') return undefined;
  if (item.source === 'attachment') return attachmentAspectRatio(item.meta);
  return item.meta.width && item.meta.height ? item.meta.width / item.meta.height : undefined;
}
