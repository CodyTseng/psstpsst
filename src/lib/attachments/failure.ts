import type { TFunction } from 'i18next';

import { platform } from '@/platform';
import type { AttachmentErrorKind } from '@/services/files/file-attachment.service';

/** Distinguish a retryable download failure from a rejected file. */
export function attachmentFailureCopy(kind: AttachmentErrorKind) {
  const integrity = kind === 'integrity';
  return {
    integrity,
    reasonKey: integrity ? 'attach.verify_failed' : 'attach.download_failed',
    actionKey: integrity ? null : 'attach.tap_retry',
  } as const;
}

let integrityNotice: Promise<void> | null = null;

/** Explain the verification error without offering to open or fetch the file. */
export function showAttachmentIntegrityFailure(t: TFunction): Promise<void> {
  return (integrityNotice ??= platform.confirmationDialog.notify({
    title: t('attach.verify_failed'),
    message: t('attach.verify_failed_message'),
    okLabel: t('common.close'),
  }).finally(() => { integrityNotice = null; }));
}

/** Only operational failures can be retried from the attachment control. */
export function retryOrShowIntegrityFailure(
  kind: AttachmentErrorKind | null,
  t: TFunction,
  load: () => void,
): void {
  if (kind === 'integrity') {
    void showAttachmentIntegrityFailure(t);
    return;
  }
  load();
}
