import { DocumentText } from '@solar-icons/react-native/category/notes/Linear/DocumentText';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { AppButton } from '@/components/common/AppButton';
import { AppText } from '@/components/common/AppText';
import { spacing, useThemeColors } from '@/theme';

export function LicenseState({ title, retry }: { title: string; retry?: () => void }) {
  const c = useThemeColors();
  const { t } = useTranslation();
  return (
    <View style={{ alignItems: 'center', padding: spacing.xl, gap: spacing.md }}>
      <DocumentText size={32} color={c.textMuted} />
      <AppText tone="muted" align="center">{title}</AppText>
      {retry ? <AppButton variant="secondary" label={t('common.retry')} onPress={retry} /> : null}
    </View>
  );
}
