import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { Pause } from '@solar-icons/react-native/category/video/Linear/Pause';
import { Play } from '@solar-icons/react-native/category/video/Linear/Play';
import Download from 'lucide-react-native/icons/download';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, View } from 'react-native';

import { InteractivePressable as Pressable } from '@/components/common/InteractivePressable';

import { revealOrRetry } from '@/lib/attachments/failure';
import { isAbortError } from '@/lib/async/abort';
import type { FileAttachmentMeta } from '@/lib/nostr/file-tags';
import {
  type AttachmentErrorKind,
  type NearbyAttachmentFetchContext,
  attachmentErrorKind,
  fetchAndDecryptAttachment,
  getCachedAttachmentUri,
  getSessionCachedUri,
} from '@/services/files/file-attachment.service';
import { useActiveAccount } from '@/stores/active-account.store';
import { useAttachmentTransfer } from '@/stores/attachment-transfer.store';
import { iconStrokeWidth } from '@/theme/icons';
import { radius, spacing, useThemeColors } from '@/theme';

import {
  ATTACHMENT_ACTION_SIZE,
  ATTACHMENT_VOICE_ACTION_INSET_VERTICAL,
  ATTACHMENT_VOICE_ICON_SIZE,
  ATTACHMENT_VOICE_WAVEFORM_HEIGHT,
  ATTACHMENT_VOICE_WIDTH,
} from './attachment-layout';
import { MessageCardFooter } from './MessageCardFooter';
import { AttachmentFrame } from './AttachmentFrame';
import { AttachmentTransferProgress } from './AttachmentTransferProgress';
import { AudioClock } from './audio-clock';
import { VoiceWaveform } from './VoiceWaveform';
import { BUBBLE_PADDING_HORIZONTAL, BUBBLE_PADDING_VERTICAL } from './bubble-layout';

// A flat placeholder when a clip arrived without a `waveform` tag.
const FLAT_BARS = Array.from({ length: 24 }, () => 16);

/**
 * Voice-message bubble: a play/pause button, a scrubbable waveform, and the
 * clock. Accepted small audio normally prefetches; request or declared-large
 * audio waits for an explicit tap, then decrypts to a local file and plays with
 * `expo-audio`. The sender's own clip plays instantly from the session cache.
 * Dragging the waveform seeks. Styled like the chat bubble it belongs to: the
 * accent bubble for our own messages, the surface bubble for a peer's
 * (DESIGN §8).
 */
export function AttachmentAudio({
  meta,
  isSelf,
  metaSlot,
  autoDownload = true,
  showLoadPrompt = false,
  nearby,
  messageId,
}: {
  meta: FileAttachmentMeta;
  isSelf: boolean;
  /** Resolve session state immediately but defer a remote fetch until play. */
  autoDownload?: boolean;
  /** Show a download glyph when policy requires explicit remote-byte loading. */
  showLoadPrompt?: boolean;
  nearby?: NearbyAttachmentFetchContext;
  messageId?: string;
  /** The message's time + delivery row, rendered bottom-right inside the bubble
   * (like a text bubble) — see {@link BubbleBody}. */
  metaSlot?: React.ReactNode;
}) {
  const { t } = useTranslation();
  const c = useThemeColors();
  const accountPubkey = useActiveAccount((s) => s.activePubkey);
  const activeTransfer = useAttachmentTransfer(accountPubkey, messageId);
  const [uri, setUri] = useState<string | null>(() => getSessionCachedUri(meta));
  const [loading, setLoading] = useState(false);
  const [cacheChecked, setCacheChecked] = useState(() => !!getSessionCachedUri(meta));
  const [paused, setPaused] = useState(false);
  const [failKind, setFailKind] = useState<AttachmentErrorKind | null>(null);
  const downloadController = useRef<AbortController | null>(null);
  const pausedAllowIntegrityMismatch = useRef(false);
  // Set when the user taps play before the blob is ready; an effect starts
  // playback once the freshly-fetched source has loaded.
  const [wantPlay, setWantPlay] = useState(false);

  const player = useAudioPlayer(uri, { updateInterval: 50 });
  const status = useAudioPlayerStatus(player);

  const bars = meta.waveform && meta.waveform.length > 0 ? meta.waveform : FLAT_BARS;
  const duration = status.duration > 0 ? status.duration : (meta.durationSec ?? 0);
  const progress = duration > 0 ? Math.min(1, status.currentTime / duration) : 0;
  const playing = status.playing;

  // Colours track the bubble: white-on-accent for our own, accent-on-surface
  // for a peer's — so the voice bubble matches the text bubbles around it.
  const palette = isSelf
    ? {
        bg: c.accent,
        knobBg: c.accentForegroundSoft,
        icon: c.accentForeground,
        played: c.accentForeground,
        track: c.accentForegroundSoft,
        time: c.accentForegroundMuted,
      }
    : {
        bg: c.surface,
        // A soft accent-tinted play button (not a loud solid blue) — a received
        // message should stay quieter than our own sent bubble.
        knobBg: c.accent + '22',
        icon: c.accent,
        played: c.accent,
        track: c.textMuted,
        time: c.textMuted,
      };

  useEffect(() => {
    if (wantPlay && uri && status.isLoaded) {
      player.play();
      setWantPlay(false);
    }
  }, [wantPlay, uri, status.isLoaded, player]);

  async function ensureLoaded(allowIntegrityMismatch = false) {
    if (uri || loading) return;
    pausedAllowIntegrityMismatch.current = allowIntegrityMismatch;
    const controller = new AbortController();
    downloadController.current = controller;
    setLoading(true);
    setPaused(false);
    setFailKind(null);
    try {
      const fetched = await fetchAndDecryptAttachment(meta, {
        accountPubkey,
        allowIntegrityMismatch,
        nearby,
        signal: controller.signal,
      });
      if (downloadController.current !== controller) return;
      setUri(fetched);
    } catch (err) {
      if (downloadController.current !== controller) return;
      if (isAbortError(err)) setPaused(true);
      else setFailKind(attachmentErrorKind(err));
      setWantPlay(false);
    } finally {
      if (downloadController.current === controller) {
        downloadController.current = null;
        setLoading(false);
      }
    }
  }

  function pauseDownload() {
    downloadController.current?.abort();
    setWantPlay(false);
    setPaused(true);
    setLoading(false);
  }

  // Voice notes normally fetch + decrypt eagerly on mount. Message requests
  // override that policy so the first play tap is the explicit download intent.
  useEffect(() => {
    if (uri || !autoDownload) return;
    void ensureLoaded();
  }, [meta.cipherSha256Hex, accountPubkey, autoDownload]); // eslint-disable-line react-hooks/exhaustive-deps

  // A request still gets the cheap local-store lookup: a clip downloaded in a
  // previous session should remain instantly playable without any network I/O.
  useEffect(() => {
    if (uri || autoDownload) return;
    let cancelled = false;
    getCachedAttachmentUri(meta)
      .then((cached) => {
        if (!cancelled) {
          if (cached) setUri(cached);
          setCacheChecked(true);
        }
      })
      .catch(() => { if (!cancelled) setCacheChecked(true); });
    return () => {
      cancelled = true;
    };
  }, [meta.cipherSha256Hex, autoDownload]); // eslint-disable-line react-hooks/exhaustive-deps

  async function onToggle() {
    if (loading && activeTransfer) {
      pauseDownload();
      return;
    }
    if (loading) return;
    // A failed clip: retry a download, or confirm before fetching past an
    // integrity mismatch — then (either way) play once loaded.
    if (failKind) {
      await revealOrRetry(failKind, t, 'play', (allow) => {
        setWantPlay(true);
        void ensureLoaded(allow);
      });
      return;
    }
    if (paused) {
      setWantPlay(true);
      void ensureLoaded(pausedAllowIntegrityMismatch.current);
      return;
    }
    if (!uri) {
      setWantPlay(true);
      void ensureLoaded();
      return;
    }
    if (playing) {
      player.pause();
    } else {
      // Replaying from the end: the seek is async, so await it before play() —
      // calling play() while still parked at the end finishes instantly and
      // bounces straight back to paused.
      if (progress >= 0.999) await player.seekTo(0);
      player.play();
    }
  }

  const seekable = !!uri && duration > 0;
  const onSeek = seekable
    ? (f: number) => {
        void player.seekTo(f * duration);
      }
    : undefined;

  const displayedTime = playing || status.currentTime > 0 ? status.currentTime : duration;
  const waitingForExplicitLoad =
    cacheChecked && showLoadPrompt && !uri && !loading && !paused && !failKind;

  return (
    <AttachmentFrame
      isSelf={isSelf}
      failure={failKind}
      action="play"
      onRetry={(allow) => {
        setWantPlay(true);
        void ensureLoaded(allow);
      }}
    >
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: spacing.sm,
          width: ATTACHMENT_VOICE_WIDTH,
          paddingVertical: BUBBLE_PADDING_VERTICAL,
          paddingHorizontal: BUBBLE_PADDING_HORIZONTAL,
          borderRadius: radius.lg,
          backgroundColor: palette.bg,
        }}
      >
        <Pressable
          onPress={() => void onToggle()}
          accessibilityLabel={
            loading && activeTransfer
              ? t('common.pause')
              : paused
                ? t('common.resume')
                : waitingForExplicitLoad
                  ? t('attach.tap_to_load')
                  : playing
                    ? t('voice.pause')
                    : t('voice.play')
          }
          hitSlop={6}
          style={{
            width: ATTACHMENT_ACTION_SIZE,
            height: ATTACHMENT_ACTION_SIZE,
            marginVertical: ATTACHMENT_VOICE_ACTION_INSET_VERTICAL,
            borderRadius: radius.full,
            backgroundColor: palette.knobBg,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {loading ? (
            <AttachmentTransferProgress
              messageId={messageId}
              tone={isSelf ? 'onAccent' : 'neutral'}
              fallback={<ActivityIndicator color={palette.icon} />}
            />
          ) : paused || waitingForExplicitLoad ? (
            <Download strokeWidth={iconStrokeWidth.default} size={ATTACHMENT_VOICE_ICON_SIZE} color={palette.icon} />
          ) : playing ? (
            <Pause size={ATTACHMENT_VOICE_ICON_SIZE} color={palette.icon} fill={palette.icon} />
          ) : (
            <Play size={ATTACHMENT_VOICE_ICON_SIZE} color={palette.icon} fill={palette.icon} />
          )}
        </Pressable>

        <View style={{ flex: 1 }}>
          {/* Keep the waveform and clock visible in every transfer state. */}
          <View style={{ flexDirection: 'row' }}>
            <VoiceWaveform
              bars={bars}
              height={ATTACHMENT_VOICE_WAVEFORM_HEIGHT}
              progress={progress}
              playedColor={palette.played}
              trackColor={palette.track}
              onSeek={onSeek}
            />
          </View>
          <MessageCardFooter
            leading={
              <AudioClock
                seconds={displayedTime}
                totalSeconds={duration}
                color={palette.time}
              />
            }
            metaSlot={metaSlot}
          />
        </View>
      </View>
    </AttachmentFrame>
  );
}
