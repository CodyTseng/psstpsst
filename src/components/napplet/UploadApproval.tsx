import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { ApprovalDetails, ApprovalField, ApprovalText } from './ApprovalDetails';
import { ActionRow } from '@/components/common/ActionRow';
import { formatFileSize } from '@/lib/nostr/file-tags';
import type { QueuedPrompt } from '@/services/napplet/prompt-queue';
import { nappletService } from '@/services/napplet/service';
import { spacing } from '@/theme';

/** File metadata shares the same duration controls as the signer authorization. */
export function UploadApproval({ prompt, hideActions = false }: { prompt: QueuedPrompt; hideActions?: boolean }) {
  const { t } = useTranslation();
  const upload = prompt.upload!;
  return <View style={{ gap: spacing.lg }}>
    <ApprovalDetails>
      <ApprovalField label={t('attach.file')}>
        <ApprovalText>{upload.filename || t('message_detail.attachment')}</ApprovalText>
      </ApprovalField>
      <ApprovalField label={t('message_detail.file_size')}>
        <ApprovalText>{formatFileSize(upload.size)}</ApprovalText>
      </ApprovalField>
      <ApprovalField label={t('applications.upload_destinations')}>
        {upload.servers.map((server) => <ApprovalText key={server}>{server}</ApprovalText>)}
      </ApprovalField>
    </ApprovalDetails>
    <ApprovalText tone="muted">{t('applications.signing_effect_upload')}</ApprovalText>
    {!hideActions ? <ActionRow layout="horizontal" confirm={{ label: t('applications.allow'), onPress: () => nappletService.answer(prompt.requestId, 'allow') }}
      dismiss={{ label: t('common.cancel'), onPress: () => nappletService.answer(prompt.requestId, false) }} /> : null}
  </View>;
}
