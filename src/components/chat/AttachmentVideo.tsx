import { useEvent } from 'expo';
import { Image } from 'expo-image';
import * as Sharing from 'expo-sharing';
import { useVideoPlayer, VideoView } from 'expo-video';
import { Clapperboard as Film } from '@solar-icons/react-native/category/video/Linear/Clapperboard';
import { Play } from '@solar-icons/react-native/category/video/Linear/Play';
import Download from 'lucide-react-native/icons/download';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, View } from 'react-native';

import { InteractivePressable as Pressable } from '@/components/common/InteractivePressable';

import { AttachmentFrame } from '@/components/chat/AttachmentFrame';
import { AppText } from '@/components/common/AppText';
import { isAbortError } from '@/lib/async/abort';
import { revealOrRetry } from '@/lib/attachments/failure';
import type { FileAttachmentMeta } from '@/lib/nostr/file-tags';
import { IS_ELECTRON } from '@/lib/platform';
import { platform } from '@/platform';
import {
  type AttachmentErrorKind,
  type NearbyAttachmentFetchContext,
  attachmentErrorKind,
  copyForShare,
  fetchAndDecryptAttachment,
  getCachedAttachmentUri,
  getSessionCachedUri,
} from '@/services/files/file-attachment.service';
import { useActiveAccount } from '@/stores/active-account.store';
import { useAttachmentTransfer } from '@/stores/attachment-transfer.store';
import { iconStrokeWidth } from '@/theme/icons';
import { radius, spacing, useThemeColors } from '@/theme';

import {
  ATTACHMENT_MEDIA_ICON_SIZE,
  ATTACHMENT_VIDEO_ACTION_SIZE,
  ATTACHMENT_VIDEO_DEFAULT_ASPECT,
  fitAttachmentMediaBox,
} from './attachment-layout';
import { AttachmentTransferProgress } from './AttachmentTransferProgress';

function parseDim(dim?: string): { w: number; h: number } | null {
  const m = dim?.match(/^(\d+)x(\d+)$/);
  if (!m) return null;
  const w = Number(m[1]);
  const h = Number(m[2]);
  return w && h ? { w, h } : null;
}

/**
 * Video attachment bubble. The (possibly large) file isn't fetched until the
 * user taps play — then it's downloaded + decrypted to a local file and played
 * inline with native controls (`expo-video`).
 *
 * Crucially the on-disk file is handed to the player **only once the user starts
 * playback** (`started`), never on mount. `localUri` (resolved on mount) just
 * records that a copy is already downloaded so the tap skips the fetch — it is
 * NOT fed to `useVideoPlayer` until `started`. Otherwise the player would parse
 * every cached video the moment the conversation opens (wasted work across a
 * media-heavy thread, and a stream of AVFoundation track-load warnings for a
 * format it can't decode — all before the user even taps).
 *
 * Format is never pre-judged from the mime (codec support differs across
 * iOS/Android and grows over time): we let the player try, and only when it
 * reports `status: 'error'` do we fall back to a card that opens the
 * already-downloaded blob in another app via the system share sheet.
 */
export function AttachmentVideo({
  meta,
  isSelf,
  overlay,
  messageId,
  nearby,
}: {
  meta: FileAttachmentMeta;
  isSelf?: boolean;
  overlay?: React.ReactNode;
  messageId?: string;
  nearby?: NearbyAttachmentFetchContext;
}) {
  const { t } = useTranslation();
  const c = useThemeColors();
  const accountPubkey = useActiveAccount((s) => s.activePubkey);
  const activeTransfer = useAttachmentTransfer(accountPubkey, messageId);
  // The on-disk path once available (session cache or resolved on mount). Knowing
  // it lets a tap skip the download — but it is NOT the player's source.
  const [localUri, setLocalUri] = useState<string | null>(() => getSessionCachedUri(meta));
  // The player gets a source only after the user taps play. Until then it's null,
  // so nothing loads/parses on conversation open.
  const [started, setStarted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [paused, setPaused] = useState(false);
  const [failKind, setFailKind] = useState<AttachmentErrorKind | null>(null);
  const [sharing, setSharing] = useState(false);
  const downloadController = useRef<AbortController | null>(null);
  const pausedAllowIntegrityMismatch = useRef(false);

  const source = started ? localUri : null;
  const player = useVideoPlayer(source, (p) => {
    p.loop = false;
  });
  // Watch the player's own verdict: 'error' means it couldn't decode the file we
  // handed it — the signal (not the mime) that triggers plan B. Only meaningful
  // once `started`, since the source is null before that.
  const { status } = useEvent(player, 'statusChange', { status: player.status });
  const playbackFailed = started && status === 'error';

  // Start playback once the source is attached after a tap. Never on mount (the
  // source is null until `started`), so a cached video doesn't auto-play.
  const autoPlayRef = useRef(false);
  useEffect(() => {
    if (source && autoPlayRef.current && !playbackFailed) {
      autoPlayRef.current = false;
      player.play();
    }
  }, [source, player, playbackFailed]);

  // Resolve whether the blob is already downloaded (no network) so a tap can skip
  // the fetch. Records availability only — it does not start the player.
  useEffect(() => {
    if (localUri) return;
    let cancelled = false;
    getCachedAttachmentUri(meta)
      .then((cached) => {
        if (!cancelled && cached) setLocalUri(cached);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [meta.cipherSha256Hex]); // eslint-disable-line react-hooks/exhaustive-deps

  async function load(allowIntegrityMismatch = false) {
    if (loading || started) return;
    pausedAllowIntegrityMismatch.current = allowIntegrityMismatch;
    autoPlayRef.current = true;
    // Already on disk → just attach it to the player.
    if (localUri) {
      setPaused(false);
      setStarted(true);
      return;
    }
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
      setLocalUri(fetched);
      setStarted(true);
    } catch (err) {
      if (downloadController.current !== controller) return;
      autoPlayRef.current = false;
      if (isAbortError(err)) setPaused(true);
      else setFailKind(attachmentErrorKind(err));
    } finally {
      if (downloadController.current === controller) {
        downloadController.current = null;
        setLoading(false);
      }
    }
  }

  function pauseDownload() {
    downloadController.current?.abort();
    autoPlayRef.current = false;
    setPaused(true);
    setLoading(false);
  }

  // Tap the poster: first play / retry a download / confirm-then-play past an
  // integrity failure.
  function onTap() {
    if (loading && activeTransfer) {
      pauseDownload();
      return;
    }
    if (loading) return;
    if (paused) {
      void load(pausedAllowIntegrityMismatch.current);
      return;
    }
    void revealOrRetry(failKind, t, 'play', (allow) => void load(allow));
  }

  // Plan B (player couldn't decode it): hand the already-downloaded blob to the
  // system open/share sheet so another app (VLC, Files, …) can play it. No
  // re-fetch — the file is on disk; `copyForShare` gives it its original name.
  async function openExternally() {
    if (sharing || !localUri) return;
    setSharing(true);
    try {
      if (await Sharing.isAvailableAsync()) {
        const shareUri = await copyForShare(localUri, meta.name);
        await Sharing.shareAsync(shareUri, { mimeType: meta.mime });
      }
    } catch {
      void platform.confirmationDialog.notify({
        title: t('attach.open_failed'),
        okLabel: t('common.ok'),
      });
    } finally {
      setSharing(false);
    }
  }

  const dim = parseDim(meta.dim);
  const box = fitAttachmentMediaBox(
    dim ? dim.w / dim.h : ATTACHMENT_VIDEO_DEFAULT_ASPECT,
  );

  return (
    <AttachmentFrame
      isSelf={isSelf}
      failure={failKind}
      action="play"
      onRetry={(allow) => void load(allow)}
      // Native playback controls share the video's bottom edge with message
      // metadata. Keep the timestamp on the poster, then remove it for the
      // lifetime of the inline player so those controls remain unobstructed.
      overlay={started && !playbackFailed ? undefined : overlay}
    >
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
        {playbackFailed && IS_ELECTRON ? (
          <View
            style={{
              width: '100%',
              height: '100%',
              alignItems: 'center',
              justifyContent: 'center',
              padding: spacing.md,
              gap: spacing.sm,
            }}
          >
            <Film size={ATTACHMENT_MEDIA_ICON_SIZE} color={c.textMuted} />
            <AppText variant="caption" tone="subtle" align="center">
              {t('attach.video_unsupported_desktop')}
            </AppText>
          </View>
        ) : playbackFailed ? (
          // Mobile can still hand an unsupported format to another installed app.
          <Pressable
            hoverFeedback={false}
            onPress={() => void openExternally()}
            style={{
              width: '100%',
              height: '100%',
              alignItems: 'center',
              justifyContent: 'center',
              padding: spacing.md,
            }}
          >
            {sharing ? (
              <ActivityIndicator color={c.textMuted} />
            ) : (
              <View style={{ alignItems: 'center', gap: spacing.sm }}>
                <Film size={ATTACHMENT_MEDIA_ICON_SIZE} color={c.textMuted} />
                <AppText variant="caption" tone="subtle" align="center">
                  {t('attach.video_unsupported')}
                </AppText>
                <AppText variant="caption" tone="subtle" align="center">
                  {t('attach.open_external')}
                </AppText>
              </View>
            )}
          </Pressable>
        ) : started ? (
          <VideoView
            player={player}
            style={{ width: '100%', height: '100%' }}
            contentFit="contain"
            nativeControls
          />
        ) : (
          <Pressable
            hoverFeedback={false}
            onPress={onTap}
            accessibilityLabel={
              loading && activeTransfer
                ? t('common.pause')
                : paused
                  ? t('common.resume')
                  : t('voice.play')
            }
            style={{ width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center' }}
          >
            {meta.thumbhash ? (
              <Image
                placeholder={{ thumbhash: meta.thumbhash }}
                placeholderContentFit="cover"
                style={{ position: 'absolute', inset: 0 }}
              />
            ) : null}
            {loading ? (
              <AttachmentTransferProgress
                messageId={messageId}
                size="media"
                tone="media"
                fallback={<ActivityIndicator color={c.textMuted} />}
              />
            ) : failKind ? (
              <View
                style={{
                  position: 'absolute',
                  inset: 0,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: meta.thumbhash ? c.overlay : undefined,
                }}
              />
            ) : paused ? (
              <View
                style={{
                  width: ATTACHMENT_VIDEO_ACTION_SIZE,
                  height: ATTACHMENT_VIDEO_ACTION_SIZE,
                  borderRadius: radius.full,
                  backgroundColor: c.overlay,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Download strokeWidth={iconStrokeWidth.default} size={ATTACHMENT_MEDIA_ICON_SIZE} color={c.onOverlay} />
              </View>
            ) : (
              <View
                style={{
                  width: ATTACHMENT_VIDEO_ACTION_SIZE,
                  height: ATTACHMENT_VIDEO_ACTION_SIZE,
                  borderRadius: radius.full,
                  backgroundColor: c.overlay,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Play
                  size={ATTACHMENT_MEDIA_ICON_SIZE}
                  color={c.onOverlay}
                  fill={c.onOverlay}
                />
              </View>
            )}
          </Pressable>
        )}
      </View>
    </AttachmentFrame>
  );
}
