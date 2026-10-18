import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { ApplicationInfo, NappletInfo } from './NappletInfo';
import { SigningIdentity } from './SigningRequestDetails';
import { AppText } from '@/components/common/AppText';
import { ActionRow } from '@/components/common/ActionRow';
import type { QueuedPrompt } from '@/services/napplet/prompt-queue';
import { nappletService } from '@/services/napplet/service';
import { spacing } from '@/theme';

export function CapabilityApproval({ prompt, onPublisher }: { prompt: QueuedPrompt; onPublisher(): void }) {
  const { t } = useTranslation();
  return <View style={{ gap: spacing.lg }}>
    {prompt.application ? <ApplicationInfo release={{...prompt.application,origin:prompt.application.origin??prompt.requester?.origin}} onPublisher={onPublisher} />
      : prompt.app ? <NappletInfo release={prompt.app} onPublisher={onPublisher} /> : null}
    {prompt.accountPubkey ? <SigningIdentity pubkey={prompt.accountPubkey} label={t('napplets.signing_account')} /> : null}
    <AppText variant="caption" tone="muted">{t('napplets.capabilities_signing_notice')}</AppText>
    <ActionRow layout="horizontal"
      confirm={{ label: t('napplets.allow'), onPress: () => nappletService.answer(prompt.requestId, prompt.capabilities ? 'domains:[]' : 'allow') }}
      dismiss={{ label: t('common.cancel'), onPress: () => nappletService.answer(prompt.requestId, false) }} />
  </View>;
}
