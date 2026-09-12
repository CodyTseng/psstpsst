import { type ReactNode, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { IconButton } from '@/components/common/IconButton';
import { ExclamationIcon } from '@/components/common/ExclamationIcon';
import {
  attachmentFailureCopy,
  promptRevealUnverified,
  type RevealAction,
} from '@/lib/attachments/failure';
import { platform } from '@/platform';
import type { AttachmentErrorKind } from '@/services/files/file-attachment.service';
import { spacing, useThemeColors } from '@/theme';

import {
  ATTACHMENT_FAILURE_TARGET_SIZE,
  ATTACHMENT_SIDE_ACTION_SIZE,
  ATTACHMENT_SIDE_ACTION_HIT_SLOP,
} from './attachment-layout';

/** Reserve a stable, inward-facing action slot outside the attachment's clip.
 * Keeping it in the row also keeps native hit testing inside parent bounds. */
export function AttachmentFrame({
  children,
  isSelf = false,
  failure,
  action,
  onRetry,
  overlay,
}: {
  children: ReactNode;
  isSelf?: boolean;
  failure: AttachmentErrorKind | null;
  action: RevealAction;
  onRetry: (allowIntegrityMismatch: boolean) => void;
  /** Media metadata stays anchored to the media, excluding the action slot. */
  overlay?: ReactNode;
}) {
  const { t } = useTranslation();
  const c = useThemeColors();
  const dialogOpen = useRef(false);
  const copy = failure ? attachmentFailureCopy(failure, action) : null;

  async function showFailure() {
    if (!failure || dialogOpen.current) return;
    dialogOpen.current = true;
    try {
      const integrity = failure === 'integrity';
      const retry = integrity
        ? await promptRevealUnverified(t, action)
        : await platform.confirmationDialog.confirm({
            title: t('attach.download_failed'),
            message: t('attach.tap_retry'),
            cancelLabel: t('common.close'),
            confirmLabel: t('common.retry'),
          });
      if (retry) onRetry(integrity);
    } finally {
      dialogOpen.current = false;
    }
  }

  return (
    <View
      style={{
        flexDirection: isSelf ? 'row-reverse' : 'row',
        alignSelf: isSelf ? 'flex-end' : 'flex-start',
        alignItems: 'center',
        minHeight: ATTACHMENT_FAILURE_TARGET_SIZE,
      }}
    >
      <View>
        {children}
        {overlay}
      </View>
      <View
        style={{
          width: ATTACHMENT_FAILURE_TARGET_SIZE,
          height: ATTACHMENT_FAILURE_TARGET_SIZE,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {copy ? (
          <IconButton
            size={ATTACHMENT_SIDE_ACTION_SIZE}
            variant="warningSoft"
            hitSlop={ATTACHMENT_SIDE_ACTION_HIT_SLOP}
            icon={<ExclamationIcon size={spacing.lg} color={c.warning} />}
            accessibilityLabel={t(copy.reasonKey)}
            onPress={() => void showFailure()}
          />
        ) : null}
      </View>
    </View>
  );
}
