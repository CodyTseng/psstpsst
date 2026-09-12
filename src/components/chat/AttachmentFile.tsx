import * as Sharing from 'expo-sharing';
import { FileText } from '@solar-icons/react-native/category/files/Linear/FileText';
import Download from 'lucide-react-native/icons/download';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, View } from 'react-native';

import { InteractivePressable as Pressable } from '@/components/common/InteractivePressable';

import { AppText } from '@/components/common/AppText';
import { revealOrRetry } from '@/lib/attachments/failure';
import { isAbortError } from '@/lib/async/abort';
import { formatFileSize } from '@/lib/nostr/file-tags';
import type { FileAttachmentMeta } from '@/lib/nostr/file-tags';
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
  ATTACHMENT_ACTION_SIZE,
  ATTACHMENT_FILE_ICON_SIZE,
  ATTACHMENT_FILE_WIDTH,
} from './attachment-layout';
import { MessageCardFooter } from './MessageCardFooter';
import { AttachmentFrame } from './AttachmentFrame';
import { AttachmentTransferProgress } from './AttachmentTransferProgress';

/**
 * Generic file attachment bubble — a card with the filename + size. The blob is
 * downloaded + decrypted only on tap, then handed to the system share/open
 * sheet (`expo-sharing`). Used for any non-image / non-video attachment.
 *
 * We don't auto-download files (they can be large) — but we do resolve whether
 * the blob is already in the local store, so the left circle shows a **download**
 * glyph when it isn't here yet (tap = fetch) and the **file** glyph once it is
 * (tap = open).
 */
export function AttachmentFile({
  meta,
  isSelf,
  metaSlot,
  nearby,
  messageId,
}: {
  meta: FileAttachmentMeta;
  isSelf?: boolean;
  nearby?: NearbyAttachmentFetchContext;
  messageId?: string;
  /** The message's time + delivery row, rendered inside the card on the size
   * line (like a text/voice bubble) — see {@link BubbleBody}. */
  metaSlot?: React.ReactNode;
}) {
  const { t } = useTranslation();
  const c = useThemeColors();
  const accountPubkey = useActiveAccount((s) => s.activePubkey);
  const activeTransfer = useAttachmentTransfer(accountPubkey, messageId);
  const [busy, setBusy] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [paused, setPaused] = useState(false);
  const downloadController = useRef<AbortController | null>(null);
  const pausedAllowIntegrityMismatch = useRef(false);
  // Whether the decrypted blob is already on disk (drives download-vs-file glyph).
  const [local, setLocal] = useState<boolean>(() => !!getSessionCachedUri(meta));
  const [cacheChecked, setCacheChecked] = useState(() => !!getSessionCachedUri(meta));
  const [failKind, setFailKind] = useState<AttachmentErrorKind | null>(null);

  const name = meta.name || t('attach.file');
  const size = formatFileSize(meta.plainSize ?? meta.size);

  // Check the local store on mount (no network) so a blob saved on a previous
  // run shows the "open" glyph instead of "download".
  useEffect(() => {
    if (local) return;
    let cancelled = false;
    getCachedAttachmentUri(meta)
      .then((uri) => {
        if (!cancelled) {
          if (uri) setLocal(true);
          setCacheChecked(true);
        }
      })
      .catch(() => { if (!cancelled) setCacheChecked(true); });
    return () => {
      cancelled = true;
    };
  }, [meta.cipherSha256Hex]); // eslint-disable-line react-hooks/exhaustive-deps

  async function open(allowIntegrityMismatch = false) {
    if (busy) return;
    pausedAllowIntegrityMismatch.current = allowIntegrityMismatch;
    const controller = new AbortController();
    downloadController.current = controller;
    setBusy(true);
    setDownloading(true);
    setPaused(false);
    setFailKind(null);
    let uri: string;
    try {
      uri =
        getSessionCachedUri(meta) ??
        (await fetchAndDecryptAttachment(meta, {
          accountPubkey,
          allowIntegrityMismatch,
          nearby,
          signal: controller.signal,
        }));
      if (downloadController.current !== controller) return;
      setLocal(true);
      setDownloading(false);
    } catch (err) {
      if (downloadController.current !== controller) return;
      // A fetch/integrity failure becomes the bubble's persistent state (retry
      // or confirm-to-reveal); a later share-sheet error is a one-off alert.
      if (isAbortError(err)) setPaused(true);
      else setFailKind(attachmentErrorKind(err));
      if (downloadController.current === controller) {
        downloadController.current = null;
        setBusy(false);
        setDownloading(false);
      }
      return;
    }
    try {
      if (await Sharing.isAvailableAsync()) {
        // Hand the share sheet the file under its original name (the on-disk copy
        // is content-hash named), so the target app sees `report.sketch`.
        const shareUri = await copyForShare(uri, meta.name);
        await Sharing.shareAsync(shareUri, { mimeType: meta.mime });
      }
    } catch {
      void platform.confirmationDialog.notify({
        title: t('attach.open_failed'),
        okLabel: t('common.ok'),
      });
    } finally {
      if (downloadController.current === controller) {
        downloadController.current = null;
        setBusy(false);
        setDownloading(false);
      }
    }
  }

  function pauseDownload() {
    downloadController.current?.abort();
    setPaused(true);
    setBusy(false);
    setDownloading(false);
  }

  // Tap the card: open / retry a failed download / confirm-then-open past an
  // integrity failure.
  function onTap() {
    if (downloading && activeTransfer) {
      pauseDownload();
      return;
    }
    if (busy) return;
    if (paused) {
      void open(pausedAllowIntegrityMismatch.current);
      return;
    }
    void revealOrRetry(failKind, t, 'open', (allow) => void open(allow));
  }

  return (
    <AttachmentFrame
      isSelf={isSelf}
      failure={failKind}
      action="open"
      onRetry={(allow) => void open(allow)}
    >
      <Pressable
        onPress={onTap}
        accessibilityLabel={
          downloading && activeTransfer
            ? t('common.pause')
            : paused
              ? t('common.resume')
              : undefined
        }
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
        {/* Left circle doubles as the action/state slot (like the voice bubble's
            play button): a spinner while fetching, a download glyph when the blob
            isn't local yet (tap to fetch), the file glyph once it's here. */}
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
          {busy ? (
            <AttachmentTransferProgress
              messageId={messageId}
              fallback={<ActivityIndicator color={c.accent} />}
            />
          ) : local ? (
            <FileText size={ATTACHMENT_FILE_ICON_SIZE} color={c.accent} />
          ) : cacheChecked ? (
            <Download strokeWidth={iconStrokeWidth.default} size={ATTACHMENT_FILE_ICON_SIZE} color={c.accent} />
          ) : null}
        </View>
        <View style={{ flex: 1 }}>
          <AppText variant="body" numberOfLines={1}>
            {name}
          </AppText>
          <MessageCardFooter
            leading={
              <AppText variant="caption" tone="muted" numberOfLines={1}>
                {size ?? t('attach.tap_to_open')}
              </AppText>
            }
            metaSlot={metaSlot}
          />
        </View>
      </Pressable>
    </AttachmentFrame>
  );
}
