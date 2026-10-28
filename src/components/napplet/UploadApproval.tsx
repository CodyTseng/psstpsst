import type { ComponentProps } from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { AppText } from '@/components/common/AppText';
import { AppCard } from '@/components/common/AppCard';
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
    <UploadText>{t('applications.signing_effect_upload')}</UploadText>
    <AppCard variant="muted" style={{ gap: spacing.sm }}>
      <UploadText variant="subtitle">{upload.filename || t('message_detail.attachment')}</UploadText>
      <UploadText variant="caption" tone="muted">{upload.mimeType} · {formatFileSize(upload.size)}</UploadText>
      <UploadText variant="caption" tone="muted">{t('applications.upload_destinations')}</UploadText>
      {upload.servers.map((server) => <UploadText key={server}>{new URL(server).host}</UploadText>)}
    </AppCard>
    {!hideActions ? <ActionRow layout="horizontal" confirm={{ label: t('applications.allow'), onPress: () => nappletService.answer(prompt.requestId, 'allow') }}
      dismiss={{ label: t('common.cancel'), onPress: () => nappletService.answer(prompt.requestId, false) }} /> : null}
  </View>;
}

function UploadText({ style, ...props }: ComponentProps<typeof AppText>) {
  return <AppText {...props} selectable={false} style={[style, { userSelect: 'none' }]} />;
}
