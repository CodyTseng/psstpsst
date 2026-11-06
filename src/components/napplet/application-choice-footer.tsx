import type { TFunction } from 'i18next';
import { ActivityIndicator, View } from 'react-native';
import type { useApplicationChoices } from '@/hooks/use-application-choices';
import { spacing } from '@/theme';
import { AppButton } from '@/components/common/AppButton';
import { AppText } from '@/components/common/AppText';

/** Both handoff and settings pickers keep discovery progress in the scrolling list. */
export function applicationChoiceFooter(choices: ReturnType<typeof useApplicationChoices>, t: TFunction, color: string, { disabled = false }: { disabled?: boolean } = {}) {
  return <View style={choices.canDiscover || choices.error || choices.manualLoading
    ? { padding: spacing.lg }
    : { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.lg, minHeight: spacing.xl + spacing.sm + spacing.lg, justifyContent: 'center' }}>
    {choices.canDiscover || choices.error || choices.manualLoading ?
      <AppButton variant="secondary"
        loading={choices.loading} disabled={disabled}
        label={t(choices.footerAction === 'retry' ? 'common.retry' : 'applications.view_other_apps')}
        onPress={choices[choices.footerAction]} />
      : choices.loading ? <ActivityIndicator size="small" color={color} />
        : !choices.hasMore && choices.choices.length > 0 ?
          <AppText variant="caption" tone="muted" align="center">{t('applications.no_more_apps')}</AppText> : null}
  </View>;
}
