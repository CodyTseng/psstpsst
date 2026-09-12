import { Image } from 'expo-image';
import Download from 'lucide-react-native/icons/download';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { InteractivePressable as Pressable } from '@/components/common/InteractivePressable';

import { AttachmentFrame } from '@/components/chat/AttachmentFrame';
import { AppText } from '@/components/common/AppText';
import { useAttachment } from '@/hooks/use-attachment';
import { revealOrRetry } from '@/lib/attachments/failure';
import type { FileAttachmentMeta } from '@/lib/nostr/file-tags';
import type { NearbyAttachmentFetchContext } from '@/services/files/file-attachment.service';
import { useActiveAccount } from '@/stores/active-account.store';
import { useAttachmentTransfer } from '@/stores/attachment-transfer.store';
import { mediaViewer } from '@/stores/media-viewer.store';
import { iconStrokeWidth } from '@/theme/icons';
import { radius, shadow, spacing, useThemeColors } from '@/theme';

import {
  ATTACHMENT_IMAGE_DEFAULT_ASPECT,
  fitAttachmentMediaBox,
} from './attachment-layout';
import { AttachmentTransferProgress } from './AttachmentTransferProgress';

type Props = {
  meta: FileAttachmentMeta;
  isSelf?: boolean;
  overlay?: React.ReactNode;
  /** This message's conversation + id + time. When present, tapping opens the
   * swipeable conversation media pager anchored/focused here; absent (e.g. the
   * long-press lifted copy), it falls back to the single-image lightbox. */
  conversationKey?: string;
  messageId?: string;
  orderAt?: number;
  /** Resolve local state but wait for a tap before downloading remote bytes. */
  autoDownload?: boolean;
  /** Show the explicit request-only affordance that starts a deferred download. */
  showLoadPrompt?: boolean;
  nearby?: NearbyAttachmentFetchContext;
};

const PAUSED_DOWNLOAD_SIZE = 56;
const PAUSED_DOWNLOAD_ICON_SIZE = 22;

function parseDim(dim?: string): { w: number; h: number } | null {
  if (!dim) return null;
  const m = dim.match(/^(\d+)x(\d+)$/);
  if (!m) return null;
  const w = Number(m[1]);
  const h = Number(m[2]);
  if (!w || !h) return null;
  return { w, h };
}

export function AttachmentImage({
  meta,
  isSelf,
  overlay,
  conversationKey,
  messageId,
  orderAt,
  autoDownload = true,
  showLoadPrompt = false,
  nearby,
}: Props) {
  const { t } = useTranslation();
  const c = useThemeColors();
  const accountPubkey = useActiveAccount((state) => state.activePubkey);
  const activeTransfer = useAttachmentTransfer(accountPubkey, messageId);
  const { state, load, pause, resume, retry, reveal } = useAttachment(meta, {
    autoLoad: autoDownload,
    nearby,
  });
  const canPromptLoad = !autoDownload && showLoadPrompt && state.status === 'idle';
  // A transition is useful only when this mounted instance actually waits for
  // download/decryption. The route preview warms both our URI session cache and
  // expo-image's bitmap cache; the full message row therefore starts ready and
  // must not cross-dissolve the same bitmap in a second time during handoff.
  const [readyOnMount] = useState(() => state.status === 'ready');

  const dim = parseDim(meta.dim);
  const aspect = dim ? dim.w / dim.h : ATTACHMENT_IMAGE_DEFAULT_ASPECT;
  const box = fitAttachmentMediaBox(aspect);

  // Blurred placeholder shown while the real (encrypted) blob downloads +
  // decrypts, then the image cross-fades in over it (`expo-image` decodes both
  // natively). Prefer ThumbHash (richer, carries colour + aspect); fall back to
  // a BlurHash if that's all the sender provided; neither → the spinner below.
  // `placeholderContentFit` matches `contentFit` so the blur doesn't jump when
  // the image replaces it.
  const placeholder = meta.thumbhash
    ? { thumbhash: meta.thumbhash }
    : meta.blurhash
      ? { blurhash: meta.blurhash }
      : undefined;

  return (
    <AttachmentFrame
      isSelf={isSelf}
      failure={state.status === 'error' ? state.kind : null}
      action="show"
      onRetry={(allow) => allow ? reveal() : retry()}
      overlay={overlay}
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
        <Pressable
          hoverFeedback={false}
          onPress={() => {
            if (state.status === 'error') {
              void revealOrRetry(state.kind, t, 'show', (allow) =>
                allow ? reveal() : retry(),
              );
              return;
            }
            if (state.status === 'loading') {
              if (activeTransfer) pause();
              return;
            }
            if (state.status === 'idle') {
              if (canPromptLoad) load();
              return;
            }
            if (state.status === 'paused') {
              resume();
              return;
            }
            if (state.status !== 'ready') return;
            if (conversationKey && messageId && orderAt != null) {
              mediaViewer.openConversation({
                conversationKey,
                focusMessageId: messageId,
                focusOrderAt: orderAt,
                focusUrl: meta.url,
                preview: { uri: state.localUri },
              });
            } else {
              mediaViewer.open(state.localUri);
            }
          }}
          disabled={
            (state.status === 'loading' && !activeTransfer) ||
            (state.status === 'idle' && !canPromptLoad)
          }
          style={{ width: '100%', height: '100%' }}
          accessibilityRole={
            state.status === 'error' ||
            state.status === 'ready' ||
            (state.status === 'loading' && !!activeTransfer) ||
            state.status === 'paused' ||
            canPromptLoad
              ? 'button'
              : undefined
          }
          accessibilityLabel={
            state.status === 'loading' && activeTransfer
              ? t('common.pause')
              : state.status === 'paused'
                ? t('common.resume')
                : canPromptLoad
                  ? t('attach.tap_to_load')
                  : undefined
          }
        >
          <Image
            source={state.status === 'ready' ? { uri: state.localUri } : undefined}
            // A cache-warmed local image must never paint its ThumbHash again.
            // Even with a zero-duration transition, a newly mounted native
            // image view may draw the supplied placeholder for one frame.
            placeholder={readyOnMount ? undefined : placeholder}
            placeholderContentFit="cover"
            style={{ width: '100%', height: '100%' }}
            contentFit="cover"
            transition={readyOnMount ? 0 : 150}
            // Keep the decoded bitmap in memory (default is disk-only). A
            // long-press lifts a fresh `BubbleBody` copy over the backdrop, which
            // re-mounts this `Image`; without the memory cache it re-decodes from
            // disk and flashes the blur placeholder. A ready-on-mount instance
            // also skips the transition above, so cached route/long-press copies
            // render directly instead of fading in again. Also spares a re-decode
            // when a row is recycled while scrolling.
            cachePolicy="memory-disk"
            recyclingKey={state.status === 'ready' ? state.localUri : undefined}
          />
          {state.status === 'loading' ? (
            <View
              style={[
                StyleSheet.absoluteFill,
                {
                  alignItems: 'center',
                  justifyContent: 'center',
                  pointerEvents: 'none',
                },
              ]}
            >
              <AttachmentTransferProgress
                messageId={messageId}
                size="media"
                tone="media"
                fallback={!placeholder ? <ActivityIndicator color={c.textMuted} /> : null}
              />
            </View>
          ) : null}
          {state.status === 'error' ? (
            <View
              style={[
                StyleSheet.absoluteFill,
                {
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: c.overlay,
                  pointerEvents: 'none',
                },
              ]}
            />
          ) : null}
          {state.status === 'paused' ? (
            <View
              style={[
                StyleSheet.absoluteFill,
                { alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' },
              ]}
            >
              <View
                style={{
                  width: PAUSED_DOWNLOAD_SIZE,
                  height: PAUSED_DOWNLOAD_SIZE,
                  borderRadius: PAUSED_DOWNLOAD_SIZE / 2,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: c.overlay,
                }}
              >
                <Download strokeWidth={iconStrokeWidth.default} size={PAUSED_DOWNLOAD_ICON_SIZE} color={c.onOverlay} />
              </View>
            </View>
          ) : null}
          {canPromptLoad ? (
            <View
              style={[
                StyleSheet.absoluteFill,
                { alignItems: 'center', justifyContent: 'center' },
                { pointerEvents: 'none' },
              ]}
            >
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: spacing.xs,
                  paddingHorizontal: spacing.sm,
                  paddingVertical: spacing.xs,
                  borderRadius: radius.full,
                  backgroundColor: c.overlay,
                }}
              >
                <Download strokeWidth={iconStrokeWidth.default} size={spacing.lg} color={c.onOverlay} />
                <AppText
                  variant="caption"
                  weight="semibold"
                  style={[{ color: c.onOverlay }, shadow.mediaText]}
                >
                  {t('attach.tap_to_load')}
                </AppText>
              </View>
            </View>
          ) : null}
        </Pressable>
      </View>
    </AttachmentFrame>
  );
}
