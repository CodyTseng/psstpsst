import { useEvent } from 'expo';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { Image } from 'expo-image';
import { useVideoPlayer, VideoView, type VideoSource } from 'expo-video';
import { Clapperboard as Film } from '@solar-icons/react-native/category/video/Linear/Clapperboard';
import { GalleryRemove as ImageOff } from '@solar-icons/react-native/category/video/Linear/GalleryRemove';
import { Pause } from '@solar-icons/react-native/category/video/Linear/Pause';
import { Play } from '@solar-icons/react-native/category/video/Linear/Play';
import { DangerTriangle as AlertTriangle } from '@solar-icons/react-native/category/ui/Linear/DangerTriangle';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { InteractivePressable as Pressable } from '@/components/common/InteractivePressable';

import { AppText } from '@/components/common/AppText';
import type { EmbeddedMedia } from '@/lib/nostr/embedded-media';
import { ensureEmbeddedMediaIndexed } from '@/services/files/media-index.service';
import { useActiveAccount } from '@/stores/active-account.store';
import { mediaViewer } from '@/stores/media-viewer.store';
import { platform } from '@/platform';
import { radius, spacing, useThemeColors } from '@/theme';

import {
  ATTACHMENT_ACTION_SIZE,
  ATTACHMENT_IMAGE_DEFAULT_ASPECT,
  ATTACHMENT_VIDEO_DEFAULT_ASPECT,
  ATTACHMENT_VOICE_ACTION_INSET_VERTICAL,
  ATTACHMENT_VOICE_WAVEFORM_HEIGHT,
  ATTACHMENT_VOICE_WIDTH,
  fitAttachmentMediaBox,
} from './attachment-layout';
import { MessageCardFooter } from './MessageCardFooter';
import { MessageMetaOverlay } from './MessageMetaOverlay';
import { AudioClock } from './audio-clock';
import { VoiceWaveform } from './VoiceWaveform';
import { BUBBLE_PADDING_HORIZONTAL, BUBBLE_PADDING_VERTICAL } from './bubble-layout';

const FLAT_BARS = Array.from({ length: 24 }, () => 16);

type Props = {
  media: EmbeddedMedia;
  isSelf: boolean;
  /** False while a newly pushed real chat is still cache-only: preserve media
   * geometry without contacting the URL, indexing it, or creating a player. */
  loadRemote?: boolean;
  /** A media block inside an outer mixed-content bubble reuses that bubble's
   * background and metadata instead of drawing another complete audio bubble. */
  nested?: boolean;
  overlayMetaSlot?: React.ReactNode;
  audioMetaSlot?: React.ReactNode;
  conversationKey?: string;
  messageId?: string;
  createdAt?: number;
  orderAt?: number;
};

function openUrl(url: string): void {
  void platform.urlOpener.openExternalUrl(url).catch(() => {});
}

function mediaPlaceholder(media: EmbeddedMedia) {
  if (media.thumbhash) return { thumbhash: media.thumbhash };
  if (media.blurhash) return { blurhash: media.blurhash };
  return undefined;
}

function mediaBox(media: EmbeddedMedia) {
  const taggedAspect =
    media.width && media.height ? media.width / media.height : undefined;
  const fallback =
    media.kind === 'image'
      ? ATTACHMENT_IMAGE_DEFAULT_ASPECT
      : ATTACHMENT_VIDEO_DEFAULT_ASPECT;
  return fitAttachmentMediaBox(taggedAspect ?? fallback);
}

export function EmbeddedMediaBlock(props: Props) {
  if (props.loadRemote === false) {
    return <HeldEmbeddedMediaBlock {...props} />;
  }
  return <InteractiveEmbeddedMediaBlock {...props} />;
}

/** Network- and player-free form used only while the native route animates. */
function HeldEmbeddedMediaBlock(props: Props) {
  if (props.media.kind === 'image') {
    return (
      <EmbeddedImage
        media={props.media}
        metaSlot={props.overlayMetaSlot}
        loadRemote={false}
        onOpen={async () => {}}
      />
    );
  }
  if (props.media.kind === 'video') return <EmbeddedVideo {...props} />;
  return <EmbeddedAudio {...props} />;
}

function InteractiveEmbeddedMediaBlock(props: Props) {
  const accountPubkey = useActiveAccount((state) => state.activePubkey);
  const canIndex =
    !!accountPubkey &&
    !!props.conversationKey &&
    !!props.messageId &&
    props.createdAt != null &&
    props.orderAt != null;

  // Self-heal messages stored before direct-media indexing existed. Defer the
  // async SQLite request until after the row has painted.
  useEffect(() => {
    if (!canIndex) return;
    const timer = setTimeout(() => {
      void ensureEmbeddedMediaIndexed({
        accountPubkey: accountPubkey!,
        conversationKey: props.conversationKey!,
        messageId: props.messageId!,
        createdAt: props.createdAt!,
        orderAt: props.orderAt!,
        media: props.media,
      }).catch(() => {
        // Best-effort repair; opening the media retries the same index write.
      });
    }, 0);
    return () => clearTimeout(timer);
  }, [
    accountPubkey,
    canIndex,
    props.conversationKey,
    props.createdAt,
    props.media,
    props.messageId,
    props.orderAt,
  ]);

  async function openImage(): Promise<void> {
    if (!canIndex) {
      mediaViewer.open(props.media.url);
      return;
    }
    try {
      await ensureEmbeddedMediaIndexed({
        accountPubkey: accountPubkey!,
        conversationKey: props.conversationKey!,
        messageId: props.messageId!,
        createdAt: props.createdAt!,
        orderAt: props.orderAt!,
        media: props.media,
      });
      mediaViewer.openConversation({
        conversationKey: props.conversationKey!,
        focusMessageId: props.messageId!,
        focusOrderAt: props.orderAt!,
        focusUrl: props.media.url,
        preview: { uri: props.media.url, cacheKey: props.media.sha256 ?? props.media.url },
      });
    } catch {
      mediaViewer.open(props.media.url);
    }
  }

  if (props.media.kind === 'image') {
    return (
      <EmbeddedImage
        media={props.media}
        metaSlot={props.overlayMetaSlot}
        onOpen={openImage}
      />
    );
  }
  if (props.media.kind === 'video') return <EmbeddedVideo {...props} />;
  return <EmbeddedAudio {...props} />;
}

function EmbeddedImage({
  media,
  metaSlot,
  loadRemote = true,
  onOpen,
}: {
  media: EmbeddedMedia;
  metaSlot?: React.ReactNode;
  loadRemote?: boolean;
  onOpen: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const c = useThemeColors();
  const [decodeFailed, setDecodeFailed] = useState(false);
  const [loading, setLoading] = useState(loadRemote);
  const box = mediaBox(media);

  return (
    <Pressable
      hoverFeedback={false}
      onPress={() => {
        if (decodeFailed) openUrl(media.url);
        else void onOpen();
      }}
      accessibilityRole="imagebutton"
      accessibilityLabel={media.alt || t('conversations.attachment_image_preview')}
      style={{
        width: box.width,
        height: box.height,
        borderRadius: radius.md,
        backgroundColor: c.surfaceMuted,
        overflow: 'hidden',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {decodeFailed ? (
        <View style={{ alignItems: 'center', gap: spacing.sm, padding: spacing.md }}>
          <ImageOff size={22} color={c.textMuted} />
          <AppText variant="caption" tone="subtle" align="center">
            {t('attach.tap_to_open')}
          </AppText>
        </View>
      ) : (
        <Image
          source={
            loadRemote
              ? { uri: media.url, cacheKey: media.sha256 ?? media.url }
              : undefined
          }
          placeholder={mediaPlaceholder(media)}
          placeholderContentFit="cover"
          contentFit="cover"
          transition={loadRemote ? 150 : 0}
          cachePolicy="memory-disk"
          recyclingKey={media.sha256 ?? media.url}
          accessibilityLabel={media.alt}
          onLoadStart={() => setLoading(true)}
          onLoadEnd={() => setLoading(false)}
          onError={() => {
            setLoading(false);
            setDecodeFailed(true);
          }}
          style={StyleSheet.absoluteFill}
        />
      )}
      {loading && !decodeFailed && !mediaPlaceholder(media) ? (
        <ActivityIndicator color={c.textMuted} />
      ) : null}
      <MessageMetaOverlay>{metaSlot}</MessageMetaOverlay>
    </Pressable>
  );
}

function EmbeddedVideo(props: Props) {
  const { media, overlayMetaSlot } = props;
  const c = useThemeColors();
  const [started, setStarted] = useState(false);
  const box = mediaBox(media);

  if (started) return <EmbeddedContainerPlayer {...props} sourceUrl={media.url} />;

  return (
    <View
      style={{
        width: box.width,
        height: box.height,
        borderRadius: radius.md,
        backgroundColor: c.surfaceMuted,
        overflow: 'hidden',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Pressable
        hoverFeedback={false}
        onPress={() => setStarted(true)}
        accessibilityRole="button"
        accessibilityLabel={media.alt}
        style={StyleSheet.absoluteFill}
      >
        {mediaPlaceholder(media) ? (
          <Image
            placeholder={mediaPlaceholder(media)}
            placeholderContentFit="cover"
            contentFit="cover"
            style={StyleSheet.absoluteFill}
          />
        ) : null}
        <View
          style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]}
        >
          <View
            style={{
              width: 52,
              height: 52,
              borderRadius: radius.full,
              backgroundColor: c.overlay,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Play size={24} color={c.onOverlay} fill={c.onOverlay} />
          </View>
        </View>
      </Pressable>
      <MessageMetaOverlay>{overlayMetaSlot}</MessageMetaOverlay>
    </View>
  );
}

/** A container suffix such as .mp4 does not identify its tracks. The video
 * player inspects the loaded container and reuses that same player for the
 * audio UI when the source has audio tracks but no video track. */
function EmbeddedContainerPlayer({
  media,
  isSelf,
  nested,
  overlayMetaSlot,
  audioMetaSlot,
  sourceUrl,
}: Props & { sourceUrl: string }) {
  const { t } = useTranslation();
  const c = useThemeColors();
  const box = mediaBox(media);
  const source = useMemo<VideoSource>(
    () => ({
      uri: sourceUrl,
      // expo-video owns the persistent, LRU-evicted cache for ordinary URLs.
      // HLS caching is unsupported on iOS, so leave streams uncached.
      useCaching: !media.streaming,
    }),
    [media.streaming, sourceUrl],
  );
  const player = useVideoPlayer(
    source,
    (instance) => {
      instance.loop = false;
      instance.timeUpdateEventInterval = 0.25;
      instance.play();
    },
  );
  const { status } = useEvent(player, 'statusChange', { status: player.status });
  const { isPlaying } = useEvent(player, 'playingChange', { isPlaying: player.playing });
  const sourceLoad = useEvent(player, 'sourceLoad', null);
  const timeUpdate = useEvent(player, 'timeUpdate', null);
  const duration = sourceLoad?.duration || player.duration || media.durationSec || 0;
  const currentTime = timeUpdate?.currentTime ?? player.currentTime;
  const progress = duration > 0 ? Math.min(1, currentTime / duration) : 0;
  const hasTrackMetadata = sourceLoad !== null || status === 'readyToPlay';
  const videoTracks = sourceLoad?.availableVideoTracks ?? player.availableVideoTracks;
  const audioTracks = sourceLoad?.availableAudioTracks ?? player.availableAudioTracks;
  const isAudioOnly =
    hasTrackMetadata && videoTracks.length === 0 && audioTracks.length > 0;

  function seekAudio(seconds: number): void {
    player.seekBy(seconds - player.currentTime);
  }

  function toggleAudio(): void {
    if (status === 'error') {
      openUrl(media.url);
      return;
    }
    if (isPlaying) {
      player.pause();
      return;
    }
    if (progress >= 0.999) seekAudio(0);
    player.play();
  }

  if (isAudioOnly) {
    return (
      <EmbeddedAudioFrame
        isSelf={isSelf}
        nested={nested}
        duration={isPlaying || currentTime > 0 ? currentTime : duration}
        totalDuration={duration}
        progress={progress}
        playing={isPlaying}
        loading={status === 'loading'}
        failed={status === 'error'}
        onPress={toggleAudio}
        onSeek={duration > 0 ? (fraction) => seekAudio(fraction * duration) : undefined}
        metaSlot={audioMetaSlot}
      />
    );
  }

  return (
    <View
      style={{
        width: box.width,
        height: box.height,
        borderRadius: radius.md,
        backgroundColor: c.surfaceMuted,
        overflow: 'hidden',
      }}
    >
      {status === 'error' ? (
        <Pressable
          hoverFeedback={false}
          onPress={() => openUrl(media.url)}
          style={[
            StyleSheet.absoluteFill,
            { alignItems: 'center', justifyContent: 'center', padding: spacing.md },
          ]}
        >
          <View style={{ alignItems: 'center', gap: spacing.sm }}>
            <Film size={22} color={c.textMuted} />
            <AppText variant="caption" tone="subtle" align="center">
              {t('attach.video_unsupported')}
            </AppText>
            <AppText variant="caption" tone="subtle" align="center">
              {t('attach.open_external')}
            </AppText>
          </View>
        </Pressable>
      ) : (
        <VideoView
          player={player}
          style={StyleSheet.absoluteFill}
          contentFit="contain"
          nativeControls
          fullscreenOptions={{ enable: true }}
        />
      )}
      {status === 'loading' ? (
        <View
          style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }]}
        >
          <ActivityIndicator color={c.textMuted} />
        </View>
      ) : null}
      <MessageMetaOverlay>{overlayMetaSlot}</MessageMetaOverlay>
    </View>
  );
}

function EmbeddedAudio({ media, isSelf, nested, audioMetaSlot }: Props) {
  const [started, setStarted] = useState(false);
  if (started) {
    return (
      <EmbeddedAudioPlayer
        media={media}
        isSelf={isSelf}
        nested={nested}
        audioMetaSlot={audioMetaSlot}
        sourceUri={media.url}
      />
    );
  }
  return (
    <EmbeddedAudioFrame
      isSelf={isSelf}
      nested={nested}
      duration={media.durationSec ?? 0}
      totalDuration={media.durationSec ?? 0}
      progress={0}
      playing={false}
      loading={false}
      onPress={() => setStarted(true)}
      metaSlot={audioMetaSlot}
    />
  );
}

function EmbeddedAudioPlayer({
  media,
  isSelf,
  nested,
  audioMetaSlot,
  sourceUri,
}: Props & { sourceUri: string }) {
  const player = useAudioPlayer(sourceUri, {
    updateInterval: 250,
    // expo-audio stages remote files in its OS-evictable tmp directory. This
    // keeps playback smooth without promoting ordinary URLs to app attachments.
    downloadFirst: true,
  });
  const status = useAudioPlayerStatus(player);
  const shouldAutoPlay = useRef(true);
  const duration = status.duration > 0 ? status.duration : (media.durationSec ?? 0);
  const progress = duration > 0 ? Math.min(1, status.currentTime / duration) : 0;

  useEffect(() => {
    if (shouldAutoPlay.current && status.isLoaded) {
      shouldAutoPlay.current = false;
      player.play();
    }
  }, [player, status.isLoaded]);

  async function toggle(): Promise<void> {
    if (status.error) {
      openUrl(media.url);
      return;
    }
    if (status.playing) {
      player.pause();
      return;
    }
    if (progress >= 0.999) await player.seekTo(0);
    player.play();
  }

  return (
    <EmbeddedAudioFrame
      isSelf={isSelf}
      nested={nested}
      duration={status.playing || status.currentTime > 0 ? status.currentTime : duration}
      totalDuration={duration}
      progress={progress}
      playing={status.playing}
      loading={!status.error && (!status.isLoaded || status.isBuffering)}
      failed={!!status.error}
      onPress={() => void toggle()}
      onSeek={
        status.isLoaded && duration > 0
          ? (fraction) => void player.seekTo(fraction * duration)
          : undefined
      }
      metaSlot={audioMetaSlot}
    />
  );
}

function EmbeddedAudioFrame({
  isSelf,
  nested,
  duration,
  totalDuration,
  progress,
  playing,
  loading,
  failed,
  onPress,
  onSeek,
  metaSlot,
}: {
  isSelf: boolean;
  nested?: boolean;
  duration: number;
  totalDuration: number;
  progress: number;
  playing: boolean;
  loading: boolean;
  failed?: boolean;
  onPress: () => void;
  onSeek?: (fraction: number) => void;
  metaSlot?: React.ReactNode;
}) {
  const { t } = useTranslation();
  const c = useThemeColors();
  const palette = isSelf
    ? {
        background: c.accent,
        button: c.accentSoft,
        icon: c.accentForeground,
        played: c.accentForeground,
        track: c.accentSoft,
        time: c.accentForeground,
      }
    : {
        background: c.surface,
        button: c.accentSoft,
        icon: c.accent,
        played: c.accent,
        track: c.textMuted,
        time: c.textMuted,
      };

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.md,
        width: ATTACHMENT_VOICE_WIDTH,
        paddingVertical: nested ? 0 : BUBBLE_PADDING_VERTICAL,
        paddingHorizontal: nested ? 0 : BUBBLE_PADDING_HORIZONTAL,
        borderRadius: nested ? 0 : radius.lg,
        backgroundColor: nested ? undefined : palette.background,
      }}
    >
      <Pressable
        onPress={onPress}
        hitSlop={spacing.sm}
        accessibilityRole="button"
        accessibilityLabel={t(playing ? 'voice.pause' : 'voice.play')}
        style={{
          width: ATTACHMENT_ACTION_SIZE,
          height: ATTACHMENT_ACTION_SIZE,
          marginVertical: ATTACHMENT_VOICE_ACTION_INSET_VERTICAL,
          borderRadius: radius.full,
          backgroundColor: palette.button,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {loading ? (
          <ActivityIndicator color={palette.icon} />
        ) : failed ? (
          <AlertTriangle size={18} color={c.danger} />
        ) : playing ? (
          <Pause size={18} color={palette.icon} fill={palette.icon} />
        ) : (
          <Play size={18} color={palette.icon} fill={palette.icon} />
        )}
      </Pressable>

      <View style={{ flex: 1 }}>
        {failed ? (
          <AppText variant="caption" tone="danger" numberOfLines={1}>
            {t('attach.tap_to_open')}
          </AppText>
        ) : (
          <View style={{ flexDirection: 'row' }}>
            <VoiceWaveform
              bars={FLAT_BARS}
              height={ATTACHMENT_VOICE_WAVEFORM_HEIGHT}
              progress={progress}
              playedColor={palette.played}
              trackColor={palette.track}
              onSeek={onSeek}
            />
          </View>
        )}
        <MessageCardFooter
          leading={
            !failed ? (
              <AudioClock
                seconds={duration}
                totalSeconds={totalDuration}
                color={palette.time}
              />
            ) : undefined
          }
          metaSlot={metaSlot}
        />
      </View>
    </View>
  );
}
