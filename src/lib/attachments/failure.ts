import type { TFunction } from 'i18next';

import { platform } from '@/platform';
import type { AttachmentErrorKind } from '@/services/files/file-attachment.service';

/**
 * The verb shown when revealing a file that failed its integrity check — one per
 * medium so the prompt and the bubble's tap action read naturally ("Show" for an
 * image, "Play" for media, "Open" for a file).
 */
export type RevealAction = 'show' | 'play' | 'open';

/**
 * The i18n keys + danger flag for an attachment failure, keyed on its kind — the
 * single source of the attachment failure vocabulary, so every bubble reads
 * the same reason/action copy and no call site re-encodes the mapping. The
 * caller picks the icon/colour to fit its own layout (knob, card, box).
 */
export function attachmentFailureCopy(kind: AttachmentErrorKind, action: RevealAction) {
  const integrity = kind === 'integrity';
  return {
    integrity,
    reasonKey: integrity ? 'attach.verify_failed' : 'attach.download_failed',
    actionKey: integrity ? `attach.verify_failed_${action}` : 'attach.tap_retry',
  } as const;
}

/**
 * Ask the user whether to proceed with a file whose content hash didn't match —
 * it may be corrupt or have been tampered with on the (untrusted) media server.
 * Resolves `true` only if they explicitly confirm; cancelling or dismissing
 * resolves `false`. The caller then re-fetches with `allowIntegrityMismatch`.
 */
export function promptRevealUnverified(t: TFunction, action: RevealAction): Promise<boolean> {
  return platform.confirmationDialog.confirm({
    title: t('attach.verify_failed'),
    message: t('attach.verify_failed_message'),
    cancelLabel: t('common.cancel'),
    confirmLabel: t(`attach.verify_failed_${action}`),
    destructive: true,
  });
}

/**
 * Dispatch a tap on a (possibly failed) attachment: an integrity failure
 * confirms before loading past the mismatch; everything else (first load, a
 * download retry) just loads. `load(allowIntegrityMismatch)` does the medium's
 * own fetch — playing, opening, or revealing the bytes.
 */
export async function revealOrRetry(
  kind: AttachmentErrorKind | null,
  t: TFunction,
  action: RevealAction,
  load: (allowIntegrityMismatch: boolean) => void,
): Promise<void> {
  if (kind === 'integrity') {
    if (await promptRevealUnverified(t, action)) load(true);
    return;
  }
  load(false);
}
