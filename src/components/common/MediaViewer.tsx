import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import Animated, { useSharedValue } from 'react-native-reanimated';

import { ZoomableImage, type ZoomableImageHandle } from './ZoomableImage';
import { MediaPager } from '@/components/media/MediaPager';
import { MediaViewerTopBar } from '@/components/media/MediaViewerTopBar';
import { useMediaViewerTransition } from '@/components/media/use-media-viewer-transition';
import { IS_ELECTRON } from '@/lib/platform';
import { platform } from '@/platform';
import { saveUriToLibrary } from '@/services/files/media-save.service';
import { useMediaViewerStore } from '@/stores/media-viewer.store';
import { useThemeColors } from '@/theme';

/**
 * Global full-screen media viewer, mounted once at the app root. Dispatches on
 * the store target: a single image (profile avatar/banner) renders one zoomable
 * lightbox; a conversation target renders the swipeable media pager. Everything
 * else just calls `mediaViewer.open(uri)` / `mediaViewer.openConversation(...)`.
 */
export function MediaViewer() {
  const target = useMediaViewerStore((s) => s.target);
  const sessionId = useMediaViewerStore((s) => s.sessionId);
  if (!target) return null;
  const close = () => {
    const store = useMediaViewerStore.getState();
    if (store.sessionId === sessionId) store.close();
  };
  if (target.mode === 'conversation') {
    return (
      <MediaPager
        key={sessionId}
        preview={target.preview}
        conversationKey={target.conversationKey}
        focusMessageId={target.focusMessageId}
        focusOrderAt={target.focusOrderAt}
        focusUrl={target.focusUrl}
        showGrid={!target.fromGallery}
        onClose={close}
      />
    );
  }
  // Remount per open so a pending dismissal cannot hide a reopened image.
  return (
    <SingleImageLightbox
      key={sessionId}
      uri={target.uri}
      onClose={close}
    />
  );
}

/** Reusable single-image layer for the root viewer and an existing native Modal. */
export function SingleImageLightbox({ uri, onClose }: { uri: string; onClose: () => void }) {
  const { t } = useTranslation();
  const c = useThemeColors();
  const [saving, setSaving] = useState(false);
  const imageRef = useRef<ZoomableImageHandle>(null);
  const [imageScale, setImageScale] = useState(1);

  const backdrop = useSharedValue(1);
  const { animatedStyle, contentStyle, isClosing, requestClose } = useMediaViewerTransition(onClose, backdrop);

  async function save() {
    if (saving) return;
    setSaving(true);
    const result = await saveUriToLibrary(uri);
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

  return (
    <View
      style={[
        StyleSheet.absoluteFill,
        {
          zIndex: 50,
          elevation: 50,
          // Clip like the pager's FlatList does, so a zoomed/dragged image
          // can't paint over the desktop window title bar.
          overflow: 'hidden',
        },
      ]}
    >
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: c.lightboxBackdrop }, animatedStyle]} />
      <Animated.View style={[StyleSheet.absoluteFill, contentStyle]} pointerEvents={isClosing ? 'none' : 'auto'}>
        <ZoomableImage
          ref={imageRef}
          onScaleChange={setImageScale}
          uri={uri}
          onRequestClose={() => requestClose()}
          onDragProgress={(p) => {
            // eslint-disable-next-line react-hooks/immutability -- Reanimated shared values are mutable.
            backdrop.value = 1 - p * 0.6;
          }}
        />
      </Animated.View>
      <Animated.View style={[StyleSheet.absoluteFill, animatedStyle]} pointerEvents={isClosing ? 'none' : 'box-none'}>
        <MediaViewerTopBar
          onClose={() => requestClose()}
          onSave={save}
          disabled={saving}
          imageZoom={{
            scale: imageScale,
            zoomIn: () => imageRef.current?.zoomIn(),
            zoomOut: () => imageRef.current?.zoomOut(),
          }}
        />
      </Animated.View>
    </View>
  );
}
