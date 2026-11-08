import { APP_AUTHORIZATION_LEVELS, type AppAuthorizationLevel } from '@/services/app-authorization/model';
import { useState } from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { AppButton } from '@/components/common/AppButton';
import { AppText } from '@/components/common/AppText';
import { BottomSheet } from '@/components/common/BottomSheet';
import { ListGroup } from '@/components/common/ListGroup';
import { ListRow } from '@/components/common/ListRow';
import { RadioIndicator } from '@/components/common/radio-indicator';
import { showToast } from '@/stores/toast.store';

import { spacing } from '@/theme';

export function AppAuthorizationLevelChoices({ value, onChange, disabled = false }: {
  value: AppAuthorizationLevel; onChange(value: AppAuthorizationLevel): void; disabled?: boolean;
}) {
  const { t } = useTranslation();
  return <View style={{ gap: spacing.lg }}>
    <AppText>{t('applications.app_authorization_level_intro')}</AppText>
    <View accessibilityRole="radiogroup"><ListGroup>{APP_AUTHORIZATION_LEVELS.map(level => <ListRow key={level}
      title={t(`applications.app_authorization_level_${level}`)}
      subtitle={t(`applications.app_authorization_level_${level}_description`)} subtitleMultiline
      selectionMode="single" active={value === level} disabled={disabled}
      trailing={<RadioIndicator selected={value === level} />} onPress={() => onChange(level)} />)}</ListGroup></View>
    <AppText tone="muted">{t('applications.app_authorization_level_boundaries')}</AppText>
  </View>;
}

export function AppAuthorizationLevelEditor({ level, visible, onSave, onClose, onClosed }: {
  level?: AppAuthorizationLevel; visible: boolean; onSave(level: AppAuthorizationLevel): Promise<void>;
  onClose(): void; onClosed(): void;
}) {
  const { t } = useTranslation();
  const [value, setValue] = useState<AppAuthorizationLevel>(level ?? 'routine');
  const [busy, setBusy] = useState(false);
  async function save() {
    if (busy) return;
    setBusy(true);
    try { await onSave(value); onClose(); }
    catch { showToast(t('applications.request_failed'), { variant: 'error' }); }
    finally { setBusy(false); }
  }
  return <BottomSheet visible={visible} title={t('applications.app_authorization_level_title')}
    onClose={() => { if (!busy) onClose(); }} onClosed={onClosed}
    fixedFooter={<AppButton label={t('common.save')} disabled={value === level} loading={busy}
      onPress={() => { void save(); }} />}>
    <AppAuthorizationLevelChoices value={value} onChange={setValue} disabled={busy} />
  </BottomSheet>;
}
