import { Image } from 'expo-image';
import { useVideoPlayer, VideoView } from 'expo-video';
import { FileText } from '@solar-icons/react-native/category/files/Linear/FileText';
import { Clapperboard as Film } from '@solar-icons/react-native/category/video/Linear/Clapperboard';
import { Play } from '@solar-icons/react-native/category/video/Linear/Play';
import { DangerTriangle as AlertTriangle } from '@solar-icons/react-native/category/ui/Linear/DangerTriangle';
import X from 'lucide-react-native/icons/x';
import Upload from 'lucide-react-native/icons/upload';
import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { InteractivePressable as Pressable } from '@/components/common/InteractivePressable';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-reanimated';

import { AppText } from '@/components/common/AppText';
import { IconButton } from '@/components/common/IconButton';
import { impact } from '@/lib/haptics';
import { formatFileSize } from '@/lib/nostr/file-tags';
import {
  desktopContextMenuPoint,
  IS_ELECTRON,
  type DesktopContextMenuEvent,
  type DesktopPointerPoint,
} from '@/lib/platform';
import { platform } from '@/platform';
import {
  PENDING_UPLOAD_INTERRUPTED,
  type PendingAttachment,
} from '@/stores/pending-attachments.store';
import { iconStrokeWidth } from '@/theme/icons';
import { radius, spacing, typography, useThemeColors } from '@/theme';

import {
  ATTACHMENT_FILE_WIDTH,
  ATTACHMENT_FAILURE_TARGET_SIZE,
  ATTACHMENT_SIDE_ACTION_SIZE,
  ATTACHMENT_SIDE_ACTION_HIT_SLOP,
  ATTACHMENT_ACTION_SIZE,
  ATTACHMENT_FILE_ICON_SIZE,
  ATTACHMENT_IMAGE_DEFAULT_ASPECT,
  ATTACHMENT_MEDIA_ICON_SIZE,
  ATTACHMENT_MEDIA_TRANSFER_ACTION_SIZE,
  ATTACHMENT_VIDEO_DEFAULT_ASPECT,
  ATTACHMENT_VOICE_ACTION_INSET_VERTICAL,
  ATTACHMENT_VOICE_ICON_SIZE,
  ATTACHMENT_VOICE_WAVEFORM_HEIGHT,
  ATTACHMENT_VOICE_WIDTH,
  fitAttachmentMediaBox,
} from './attachment-layout';
import {
  BUBBLE_GAP,
  BUBBLE_GROUP_GAP,
  BUBBLE_MAX_WIDTH,
  BUBBLE_PADDING_HORIZONTAL,
  BUBBLE_PADDING_VERTICAL,
  BUBBLE_ROW_PADDING_HORIZONTAL,
} from './bubble-layout';
import type { BubbleRect, MessageBubbleReplyPreview } from './MessageBubble';
import { QuotedReply } from './QuotedReply';
import { AudioClock } from './audio-clock';
import { VoiceWaveform } from './VoiceWaveform';
import { AttachmentTransferProgress } from './AttachmentTransferProgress';
import { MessageCardFooter } from './MessageCardFooter';

type Props = {
  pending: PendingAttachment;
  onStop: (tempId: string) => void;
  onRetry: (tempId: string) => void;
  onCancel: (tempId: string) => void;
  groupStart?: boolean;
  replyTo?: MessageBubbleReplyPreview | null;
  onPressReply?: () => void;
  onLongPress?: (rect: BubbleRect) => void;
  /** Render only the measured bubble body inside the lifted context-menu copy. */
  lifted?: boolean;
  /** Override the row canvas when reused in a non-chat preview. */
  rowBackground?: string;
};

function PendingVideoPreview({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri, (instance) => {
    instance.muted = true;
  });
  return (
    <VideoView
      player={player}
      nativeControls={false}
      contentFit="cover"
      pointerEvents="none"
      style={{ position: 'absolute', inset: 0 }}
    />
  );
}

function displayUploadError(
  error: string | undefined,
  unknown: string,
  accountNotReady: string,
  interrupted: string,
): string {
  const raw = error?.trim();
  if (!raw) return unknown;
  if (raw === 'Encryption keypair not found' || raw.includes('DM service not initialized')) {
    return accountNotReady;
  }
  if (raw === PENDING_UPLOAD_INTERRUPTED) return interrupted;
  // The transport name is an implementation detail. Keep the per-server URL,
  // status, and response because those are the useful diagnostic details.
  return raw.replace(/^Blossom upload failed:\s*/i, '').trim() || unknown;
}

/**
 * Bubble shown for an attachment that is mid-send (or failed). Always
 * right-aligned because only the sender produces these.
 */
export function PendingAttachmentBubble({
  pending,
  onStop,
  onRetry,
  onCancel,
  groupStart,
  replyTo,
  onPressReply,
  onLongPress,
  lifted = false,
  rowBackground,
}: Props) {
  const { t } = useTranslation();
  const c = useThemeColors();
  const failed = pending.status === 'failed';
  const paused = pending.status === 'paused';
  const pausable =
    pending.status === 'preparing' ||
    pending.status === 'encrypting' ||
    pending.status === 'uploading';
  const isAudio = pending.mime.startsWith('audio/');
  const isImage = pending.mime.startsWith('image/');
  const isVideo = pending.mime.startsWith('video/');
  const aspect =
    pending.width && pending.height
      ? pending.width / pending.height
      : isVideo
        ? ATTACHMENT_VIDEO_DEFAULT_ASPECT
        : ATTACHMENT_IMAGE_DEFAULT_ASPECT;
  const box = fitAttachmentMediaBox(aspect);
  // Generic document (PDF, etc.): render the SAME compact card as the stored
  // AttachmentFile bubble so the in-flight → sent handoff has no visual jump —
  // just the trailing accessory tells the state (progress / alert / resume).
  const isFile = !isAudio && !isImage && !isVideo;
  const bubbleRef = useRef<View>(null);
  function emitLongPress(withImpact: boolean, pointer?: DesktopPointerPoint) {
    const node = bubbleRef.current;
    if (!node || !onLongPress) return;
    if (withImpact) impact('medium');
    node.measureInWindow((x, y, width, height) =>
      onLongPress({ x, y, width, height, pointer }),
    );
  }
  function handleContextMenu(event: DesktopContextMenuEvent) {
    event.preventDefault?.();
    event.stopPropagation?.();
    if (!lifted) emitLongPress(false, desktopContextMenuPoint(event));
  }
  const longPress = Gesture.LongPress()
    // Electron opens the menu only from `contextmenu`; holding the primary
    // mouse button must never act like a touch long-press.
    .enabled(!IS_ELECTRON && !!onLongPress && !lifted)
    .minDuration(300)
    .onStart(() => runOnJS(emitLongPress)(true));
  // 'sent' = upload done, waiting for the DB bubble to take over: show the
  // bare image (no overlay) so the handoff is invisible.
  const showOverlay = pending.status !== 'sent';
  const publishing = pending.status === 'publishing';
  const progressFallback =
    pending.status === 'preparing'
      ? 5
      : pending.status === 'encrypting'
        ? 15
        : pending.status === 'uploading'
          ? 20
          : publishing
            ? 99
            : undefined;

  async function showFailureDetails() {
    const retry = await platform.confirmationDialog.confirm({
      title: t('attach.upload_failure_title'),
      message: displayUploadError(
        pending.error,
        t('attach.upload_failure_unknown'),
        t('attach.upload_failure_account_not_ready'),
        t('attach.upload_failure_interrupted'),
      ),
      cancelLabel: t('common.close'),
      confirmLabel: t('common.retry'),
    });
    if (retry) onRetry(pending.tempId);
  }
  const transferInteractive = failed || pausable || paused;
  const handleTransferPress = failed
    ? () => void showFailureDetails()
    : pausable
      ? () => onStop(pending.tempId)
      : paused
        ? () => onRetry(pending.tempId)
        : undefined;
  const transferAccessibilityLabel = failed
    ? t('attach.upload_failure_title')
    : pausable
      ? t('common.pause')
      : paused
        ? t('common.resume')
        : undefined;

  return (
    <View
      style={{
        width: lifted ? '100%' : undefined,
        paddingHorizontal: lifted ? 0 : BUBBLE_ROW_PADDING_HORIZONTAL,
        marginTop: lifted ? 0 : groupStart ? BUBBLE_GROUP_GAP : BUBBLE_GAP,
        backgroundColor: lifted ? 'transparent' : (rowBackground ?? 'transparent'),
      }}
    >
      <View
        style={{
          width: '100%',
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'flex-end',
          minHeight: lifted ? undefined : ATTACHMENT_FAILURE_TARGET_SIZE,
        }}
      >
        {!lifted && (pausable || paused || failed) ? (
          <View
            style={{
              width: ATTACHMENT_FAILURE_TARGET_SIZE,
              height: ATTACHMENT_FAILURE_TARGET_SIZE,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <IconButton
              key="pending-action"
              variant="dangerSoft"
              size={ATTACHMENT_SIDE_ACTION_SIZE}
              hitSlop={ATTACHMENT_SIDE_ACTION_HIT_SLOP}
              icon={<X size={spacing.md} strokeWidth={1.75} color={c.danger} />}
              onPress={() => onCancel(pending.tempId)}
              accessibilityLabel={t('attach.discard_upload')}
            />
          </View>
        ) : null}
        <GestureDetector key="pending-bubble" gesture={longPress}>
        <View
          ref={bubbleRef}
          collapsable={false}
          {...(IS_ELECTRON ? { onContextMenu: handleContextMenu } : {})}
          style={{
            width: lifted ? '100%' : undefined,
            alignSelf: lifted ? 'stretch' : 'flex-end',
            maxWidth: lifted ? undefined : BUBBLE_MAX_WIDTH,
          }}
        >
        <View style={{ gap: spacing.sm }}>
          {replyTo ? (
            <QuotedReply
              senderName={replyTo.senderDisplayName ?? 'Unknown'}
              contentPreview={replyTo.contentPreview}
              onPress={onPressReply}
            />
          ) : null}

          {isAudio ? (
          // Voice note in flight: the accent voice card matching our own sent
          // bubble, with the play slot showing upload progress (or a failed
          // glyph) — so the handoff to the live bubble is seamless.
          <Pressable
            onPress={handleTransferPress}
            disabled={!transferInteractive}
            accessibilityRole={transferInteractive ? 'button' : undefined}
            accessibilityLabel={transferAccessibilityLabel}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: spacing.sm,
              width: ATTACHMENT_VOICE_WIDTH,
              paddingVertical: BUBBLE_PADDING_VERTICAL,
              paddingHorizontal: BUBBLE_PADDING_HORIZONTAL,
              borderRadius: radius.lg,
              backgroundColor: c.accent,
            }}
          >
            <View
              style={{
                width: ATTACHMENT_ACTION_SIZE,
                height: ATTACHMENT_ACTION_SIZE,
                marginVertical: ATTACHMENT_VOICE_ACTION_INSET_VERTICAL,
                borderRadius: radius.full,
                backgroundColor: c.accentForegroundSoft,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {failed ? (
                <AlertTriangle size={ATTACHMENT_VOICE_ICON_SIZE} color={c.danger} />
              ) : pausable || publishing ? (
                <AttachmentTransferProgress
                  messageId={pending.tempId}
                  tone="onAccent"
                  fallbackPercent={progressFallback}
                  pauseAvailable={pausable}
                />
              ) : paused ? (
                <Upload strokeWidth={iconStrokeWidth.default} size={ATTACHMENT_VOICE_ICON_SIZE} color={c.accentForeground} />
              ) : (
                <Play
                  size={ATTACHMENT_VOICE_ICON_SIZE}
                  color={c.accentForeground}
                  fill={c.accentForeground}
                />
              )}
            </View>
            {/* Match the stored bubble's waveform and clock footer so settling
                the upload does not change the card height. */}
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: 'row' }}>
                <VoiceWaveform
                  bars={
                    pending.waveform && pending.waveform.length > 0 ? pending.waveform : [0]
                  }
                  progress={0}
                  height={ATTACHMENT_VOICE_WAVEFORM_HEIGHT}
                  playedColor={c.accentForeground}
                  trackColor={c.accentForegroundSoft}
                />
              </View>
              <MessageCardFooter
                leading={
                  <AudioClock
                    seconds={pending.durationSec ?? 0}
                    color={c.accentForegroundMuted}
                  />
                }
                metaSlot={<View style={{ height: typography.micro.lineHeight }} />}
              />
            </View>
          </Pressable>
        ) : isFile ? (
          // Same card as AttachmentFile; the left circle carries the in-flight
          // state (progress / failed glyph) where the stored bubble shows the
          // file glyph, so the handoff is seamless. No send time yet, so the
          // size line stands alone (it gains the meta once stored).
          <Pressable
            onPress={handleTransferPress}
            disabled={!transferInteractive}
            accessibilityRole={transferInteractive ? 'button' : undefined}
            accessibilityLabel={transferAccessibilityLabel}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: spacing.md,
              width: ATTACHMENT_FILE_WIDTH,
              paddingTop: spacing.md,
              paddingHorizontal: spacing.md,
              paddingBottom: spacing.sm,
              borderRadius: radius.md,
              backgroundColor: c.surfaceMuted,
            }}
          >
            <View
              style={{
                width: ATTACHMENT_ACTION_SIZE,
                height: ATTACHMENT_ACTION_SIZE,
                borderRadius: radius.full,
                backgroundColor: c.surface,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {failed ? (
                <AlertTriangle size={ATTACHMENT_FILE_ICON_SIZE} color={c.danger} />
              ) : pausable || publishing ? (
                <AttachmentTransferProgress
                  messageId={pending.tempId}
                  fallbackPercent={progressFallback}
                  pauseAvailable={pausable}
                />
              ) : paused ? (
                <Upload strokeWidth={iconStrokeWidth.default} size={ATTACHMENT_FILE_ICON_SIZE} color={c.accent} />
              ) : (
                <FileText size={ATTACHMENT_FILE_ICON_SIZE} color={c.accent} />
              )}
            </View>
            <View style={{ flex: 1 }}>
              <AppText variant="body" numberOfLines={1}>
                {pending.name || t('attach.file')}
              </AppText>
              <MessageCardFooter
                leading={
                  <AppText variant="caption" tone="muted" numberOfLines={1}>
                    {formatFileSize(pending.size) ?? t('attach.file')}
                  </AppText>
                }
              />
            </View>
          </Pressable>
        ) : (
          <Pressable
            hoverFeedback={false}
            onPress={handleTransferPress}
            disabled={!transferInteractive}
            accessibilityRole={transferInteractive ? 'button' : undefined}
            accessibilityLabel={transferAccessibilityLabel}
            style={{
              width: box.width,
              height: box.height,
              borderRadius: radius.md,
              overflow: 'hidden',
              backgroundColor: c.surfaceMuted,
            }}
          >
            {isImage ? (
              <Image
                source={{ uri: pending.localUri }}
                style={{ width: '100%', height: '100%' }}
                contentFit="cover"
              />
            ) : (
              <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
                <Film size={spacing['2xl']} color={c.textMuted} />
                <PendingVideoPreview uri={pending.localUri} />
              </View>
            )}
            {showOverlay ? (
              <View
                style={{
                  position: 'absolute',
                  inset: 0,
                  backgroundColor: c.overlay,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {failed ? (
                  <AlertTriangle size={ATTACHMENT_MEDIA_ICON_SIZE} color={c.danger} />
                ) : pausable || publishing ? (
                  <AttachmentTransferProgress
                    messageId={pending.tempId}
                    size="media"
                    tone="media"
                    fallbackPercent={progressFallback}
                    pauseAvailable={pausable}
                  />
                ) : paused ? (
                  <View
                    style={{
                      width: ATTACHMENT_MEDIA_TRANSFER_ACTION_SIZE,
                      height: ATTACHMENT_MEDIA_TRANSFER_ACTION_SIZE,
                      borderRadius: radius.full,
                      backgroundColor: c.overlay,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Upload strokeWidth={iconStrokeWidth.default} size={ATTACHMENT_MEDIA_ICON_SIZE} color={c.onOverlay} />
                  </View>
                ) : (
                  <X strokeWidth={iconStrokeWidth.default} size={ATTACHMENT_MEDIA_ICON_SIZE} color={c.onOverlay} />
                )}
              </View>
            ) : null}
          </Pressable>
          )}
        </View>
        </View>
        </GestureDetector>
      </View>
    </View>
  );
}
