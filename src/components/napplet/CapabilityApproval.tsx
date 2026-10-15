import { useState } from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { AppButton } from '@/components/common/AppButton';
import { AppText } from '@/components/common/AppText';
import { ActionRow } from '@/components/common/ActionRow';
import type { QueuedPrompt } from '@/services/napplet/prompt-queue';
import { nappletService } from '@/services/napplet/service';
import { spacing } from '@/theme';

export function CapabilityApproval({ prompt }: { prompt: QueuedPrompt }) {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<string[]>([]);
  const { required, optional } = prompt.capabilities!;
  return <View style={{ gap: spacing.md }}>
    <AppText variant="subtitle">{t('napplets.capabilities_required')}</AppText>
    {required.map((domain) => <AppText key={domain}>{t(`napplets.capability_${domain}`)}</AppText>)}
    {optional.length ? <>
      <AppText variant="subtitle">{t('napplets.capabilities_optional')}</AppText>
      {optional.map((domain) => <AppButton key={domain} variant="secondary"
        label={t(`napplets.capability_${domain}`)} selected={selected.includes(domain)}
        accessibilityRole="checkbox" accessibilityState={{ checked: selected.includes(domain) }}
        onPress={() => setSelected((old) => old.includes(domain) ? old.filter((entry) => entry !== domain) : [...old, domain])} />)}
    </> : null}
    <AppText variant="caption" tone="muted">{t('napplets.capabilities_signing_notice')}</AppText>
    <ActionRow layout="vertical"
      confirm={{ label: t('napplets.allow'), onPress: () => nappletService.answer(prompt.requestId, `domains:${JSON.stringify(selected)}`) }}
      dismiss={{ label: t('common.cancel'), onPress: () => nappletService.answer(prompt.requestId, false) }} />
  </View>;
}
