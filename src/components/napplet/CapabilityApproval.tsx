import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { NappletInfo } from './NappletInfo';
import { AppText } from '@/components/common/AppText';
import { ActionRow } from '@/components/common/ActionRow';
import type { QueuedPrompt } from '@/services/napplet/prompt-queue';
import { nappletService } from '@/services/napplet/service';
import { spacing } from '@/theme';

export function CapabilityApproval({ prompt, onPublisher }: { prompt: QueuedPrompt; onPublisher(): void }) {
  const { t } = useTranslation();
  return <View style={{ gap: spacing.lg }}>
    {prompt.app ? <NappletInfo release={prompt.app} onPublisher={onPublisher} /> : null}
    <AppText variant="caption" tone="muted">{t('napplets.capabilities_signing_notice')}</AppText>
    <ActionRow layout="horizontal"
      confirm={{ label: t('napplets.allow'), onPress: () => nappletService.answer(prompt.requestId, 'domains:[]') }}
      dismiss={{ label: t('common.cancel'), onPress: () => nappletService.answer(prompt.requestId, false) }} />
  </View>;
}
