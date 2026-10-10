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
import { pauseAttachmentDownload } from '@/services/files/attachment-download-task';
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
  const { state, load, pause, resume, retry, reveal } = useAttachment(meta, {
    autoLoad: autoDownload,
    nearby,
  });
  const accountPubkey = useActiveAccount((s) => s.activePubkey);
  const transfer = useAttachmentTransfer(accountPubkey, undefined, meta.url);
  const sharedActive = !!transfer && !transfer.paused && state.status !== 'ready';
  const isDownloading = !transfer?.paused && (state.status === 'loading' || sharedActive);
  const isPaused = !isDownloading && state.status !== 'ready' && (state.status === 'paused' || !!transfer?.paused);
  const canPromptLoad = !autoDownload && showLoadPrompt && state.status === 'idle';
  // Cache-warmed route and long-press copies must not show the placeholder again.
  const localUri = state.status === 'ready' ? state.localUri : undefined;
  const [displayedUri, setDisplayedUri] = useState(localUri);

  const dim = parseDim(meta.dim);
  const aspect = dim ? dim.w / dim.h : ATTACHMENT_IMAGE_DEFAULT_ASPECT;
  const box = fitAttachmentMediaBox(aspect);

  // Prefer ThumbHash, then BlurHash, while downloading and decoding the image.
  // Hash aspect ratios are approximate. Render the preview in its own fill-fit
  // view: iOS overrides hash placeholderContentFit with that view's contentFit.
  // The full image keeps contain-fit and replaces the preview only on display.
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
            if (isDownloading) {
              if (sharedActive) pauseAttachmentDownload(accountPubkey, meta.url);
              pause();
              return;
            }
            if (isPaused) { resume(); return; }
            if (state.status === 'error') {
              void revealOrRetry(state.kind, t, 'show', (allow) =>
                allow ? reveal() : retry(),
              );
              return;
            }
            if (state.status === 'idle') {
              if (canPromptLoad) load();
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
          disabled={state.status === 'idle' && !canPromptLoad && !isDownloading && !isPaused}
          style={{ width: '100%', height: '100%' }}
          accessibilityRole={
            state.status === 'error' ||
            state.status === 'ready' ||
            isDownloading ||
            isPaused ||
            canPromptLoad
              ? 'button'
              : undefined
          }
          accessibilityLabel={
            isDownloading
              ? t('common.pause')
              : isPaused
                ? t('common.resume')
                : canPromptLoad
                  ? t('attach.tap_to_load')
                  : undefined
          }
        >
          {placeholder && (!localUri || displayedUri !== localUri) ? (
            <Image
              placeholder={placeholder}
              placeholderContentFit="fill"
              contentFit="fill"
              style={StyleSheet.absoluteFill}
              pointerEvents="none"
            />
          ) : null}
          <Image
            source={localUri ? { uri: localUri } : undefined}
            style={{ width: '100%', height: '100%' }}
            contentFit="contain"
            transition={0}
            onDisplay={() => {
              if (localUri) setDisplayedUri(localUri);
            }}
            // Keep the decoded bitmap in memory (default is disk-only). A
            // long-press lifts a fresh `BubbleBody` copy over the backdrop, which
            // re-mounts this `Image`; without the memory cache it re-decodes from
            // disk. Cache-warmed copies render directly without a placeholder.
            // Also spares a re-decode when a row is recycled while scrolling.
            cachePolicy="memory-disk"
            recyclingKey={localUri}
          />
          {isDownloading ? (
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
                url={meta.url}
                fallbackPercent={0}
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
          {isPaused ? (
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
