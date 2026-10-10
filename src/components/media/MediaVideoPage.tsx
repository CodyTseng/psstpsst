import { Image } from 'expo-image';
import { useEvent } from 'expo';
import * as Sharing from 'expo-sharing';
import { useVideoPlayer, VideoView, type VideoSource } from 'expo-video';
import { Play } from '@solar-icons/react-native/category/video/Linear/Play';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { InteractivePressable as Pressable } from '@/components/common/InteractivePressable';
import Download from 'lucide-react-native/icons/download';
import { AttachmentTransferProgress } from '@/components/chat/AttachmentTransferProgress';
import { iconStrokeWidth } from '@/theme/icons';
import { AttachmentFailure } from '@/components/chat/AttachmentFailure';
import { AppText } from '@/components/common/AppText';
import { AppButton } from '@/components/common/AppButton';
import { useAttachment } from '@/hooks/use-attachment';
import type { ConversationMediaItem } from '@/hooks/use-conversation-media';
import { revealOrRetry } from '@/lib/attachments/failure';
import type { EmbeddedMedia } from '@/lib/nostr/embedded-media';
import type { FileAttachmentMeta } from '@/lib/nostr/file-tags';
import { copyForShare } from '@/services/files/file-attachment.service';
import { IS_ELECTRON } from '@/lib/platform';
import { platform } from '@/platform';
import { spacing, useThemeColors } from '@/theme';
import { MediaPlaybackControls } from './MediaPlaybackControls';

type Props = {
  item: ConversationMediaItem;
  /** Only the selected viewer page may download or allocate a playback player. */
  active: boolean;
};

export function MediaVideoPage({ item, active }: Props) {
  if (!active) return <VideoPlaceholder thumbhash={item.meta.thumbhash} />;
  return item.source === 'attachment' ? (
    <AttachmentMediaVideoPage meta={item.meta} />
  ) : (
    <RemoteMediaVideoPage media={item.meta} />
  );
}

function VideoPlaceholder({ thumbhash }: { thumbhash?: string }) {
  const c = useThemeColors();
  return (
    <View style={{ flex: 1, backgroundColor: c.lightboxBackdrop }}>
      {thumbhash ? (
        <Image placeholder={{ thumbhash }} placeholderContentFit="contain" style={StyleSheet.absoluteFill} />
      ) : null}
    </View>
  );
}

/** Opening or selecting this page is the explicit intent to download and play. */
function AttachmentMediaVideoPage({ meta }: { meta: FileAttachmentMeta }) {
  const { t } = useTranslation();
  const c = useThemeColors();
  const attachment = useAttachment(meta, { autoLoad: true });
  const { state } = attachment;
  const [playbackFailed, setPlaybackFailed] = useState(false);
  const onPlaybackError = useCallback(() => setPlaybackFailed(true), []);

  function onTap() {
    if (state.status === 'loading') { attachment.pause(); return; }
    if (state.status === 'checking') return;
    if (state.status === 'paused') attachment.resume();
    else void revealOrRetry(state.status === 'error' ? state.kind : null, t, 'play', (allow) => {
      if (allow) attachment.reveal();
      else attachment.retry();
    });
  }

  if (state.status === 'ready') {
    return playbackFailed
      ? <UnsupportedVideo uri={state.localUri} mime={meta.mime} name={meta.name} />
      : <AutoplayVideo source={state.localUri} onError={onPlaybackError} />;
  }

  return (
    <Pressable
      onPress={onTap}
      accessibilityLabel={state.status === 'loading' ? t('common.pause') : state.status === 'paused' ? t('common.resume') : undefined}
      style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}
    >
      {meta.thumbhash ? (
        <Image placeholder={{ thumbhash: meta.thumbhash }} placeholderContentFit="contain" style={StyleSheet.absoluteFill} />
      ) : null}
      {state.status === 'loading' ? (
        <AttachmentTransferProgress url={meta.url} size="media" tone="media" fallbackPercent={0} />
      ) : state.status === 'checking' ? (
        <ActivityIndicator color={c.onOverlay} />
      ) : state.status === 'paused' ? (
        <Download strokeWidth={iconStrokeWidth.default} size={28} color={c.onOverlay} />
      ) : state.status === 'error' ? (
        <AttachmentFailure kind={state.kind} action="play" iconSize={28} />
      ) : (
        <View
          style={{
            width: 72,
            height: 72,
            borderRadius: 36,
            backgroundColor: c.overlay,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Play size={32} color={c.onOverlay} fill={c.onOverlay} />
        </View>
      )}
    </Pressable>
  );
}

function RemoteMediaVideoPage({ media }: { media: EmbeddedMedia }) {
  const source = useMemo(() => ({ uri: media.url, useCaching: !media.streaming }), [media.url, media.streaming]);
  const [playbackFailed, setPlaybackFailed] = useState(false);
  const onPlaybackError = useCallback(() => setPlaybackFailed(true), []);
  return playbackFailed ? <UnsupportedVideo /> : <AutoplayVideo source={source} onError={onPlaybackError} />;
}

function UnsupportedVideo({ uri, mime, name }: { uri?: string; mime?: string; name?: string }) {
  const { t } = useTranslation();
  const c = useThemeColors();
  const [sharing, setSharing] = useState(false);
  async function openExternally() {
    if (!uri || sharing) return;
    setSharing(true);
    try {
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(await copyForShare(uri, name), { mimeType: mime });
      }
    } catch {
      void platform.confirmationDialog.notify({ title: t('attach.open_failed'), okLabel: t('common.ok') });
    } finally {
      setSharing(false);
    }
  }
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.lg, gap: spacing.md }}>
      <AppText variant="caption" style={{ color: c.onOverlay }} align="center">
        {t(IS_ELECTRON ? 'attach.video_unsupported_desktop' : 'attach.video_unsupported')}
      </AppText>
      {!IS_ELECTRON && uri ? (
        <AppButton variant="secondary" label={t('attach.open_external')} loading={sharing} onPress={() => void openExternally()} />
      ) : null}
    </View>
  );
}

/** An inactive page unmounts this player, including when a download finishes late. */
function AutoplayVideo({ source, onError }: { source: VideoSource; onError: () => void }) {
  const player = useVideoPlayer(null, (instance) => {
    instance.loop = false;
    instance.timeUpdateEventInterval = IS_ELECTRON ? 0 : 0.5;
  });
  const { status } = useEvent(player, 'statusChange', { status: player.status });
  useEffect(() => {
    if (status === 'error') onError();
  }, [status, onError]);
  useEffect(() => {
    let cancelled = false;
    void player.replaceAsync(source).then(() => {
      if (!cancelled) player.play();
    }).catch(() => { if (!cancelled) onError(); });
    return () => {
      cancelled = true;
      // useVideoPlayer owns release; its native cleanup runs before this one.
    };
  }, [player, source, onError]);
  return (
    <>
      <VideoView
        player={player}
        // On web, VideoView is a replaced <video> element: insets alone do not
        // constrain its intrinsic dimensions. Explicit bounds make contain work.
        style={[StyleSheet.absoluteFill, { width: '100%', height: '100%' }]}
        contentFit="contain"
        // The viewer translates and fades this surface during drag dismissal.
        surfaceType="textureView"
        nativeControls={IS_ELECTRON}
        fullscreenOptions={{ enable: IS_ELECTRON }}
      />
      {!IS_ELECTRON ? <MediaPlaybackControls player={player} /> : null}
    </>
  );
}
