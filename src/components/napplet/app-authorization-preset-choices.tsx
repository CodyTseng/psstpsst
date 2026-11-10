import { APP_AUTHORIZATION_PRESETS, type AppAuthorizationPreset } from '@/services/app-authorization/model';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { AppText } from '@/components/common/AppText';
import { ListGroup } from '@/components/common/ListGroup';
import { ListRow } from '@/components/common/ListRow';
import { RadioIndicator } from '@/components/common/radio-indicator';

import { spacing } from '@/theme';

export function AppAuthorizationPresetChoices({ value, onChange, disabled = false }: {
  value: AppAuthorizationPreset; onChange(value: AppAuthorizationPreset): void; disabled?: boolean;
}) {
  const { t } = useTranslation();
  return <View style={{ gap: spacing.lg }}>
    <AppText>{t('applications.app_authorization_level_intro')}</AppText>
    <View accessibilityRole="radiogroup"><ListGroup>{APP_AUTHORIZATION_PRESETS.map(level => <ListRow key={level}
      title={t(`applications.app_authorization_level_${level}`)}
      subtitle={t(`applications.app_authorization_level_${level}_description`)} subtitleMultiline
      selectionMode="single" active={value === level} disabled={disabled}
      trailing={<RadioIndicator selected={value === level} />} onPress={() => onChange(level)} />)}</ListGroup></View>
    <AppText tone="muted">{t('applications.app_authorization_level_boundaries')}</AppText>
  </View>;
}
