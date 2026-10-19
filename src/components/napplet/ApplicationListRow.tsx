import { memo } from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Avatar } from '@/components/common/Avatar';
import { AppText } from '@/components/common/AppText';
import { ListRow } from '@/components/common/ListRow';
import { useDisplayName } from '@/hooks/use-display-name';
import type { ApplicationListEntry } from '@/services/explore/model';
import { applicationFormatColors, radius, spacing, useEffectiveColorScheme } from '@/theme';
import { RunningApplicationIcon } from './RunningApplicationIcon';

/** Discovery and application handoffs share one recognizable application row. */
export const ApplicationListRow = memo(function ApplicationListRow({ application, onPress }: {
  application: ApplicationListEntry; onPress(): void;
}) {
  const { t } = useTranslation();
  const colors = applicationFormatColors[application.kind][useEffectiveColorScheme()];
  const { name, profile } = useDisplayName(application.publisher ?? '');
  return <ListRow variant="list" title={application.title} subtitleContent={application.publisher ?
    <View testID="discovery-publisher" style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
      <Avatar pubkey={application.publisher} picture={profile?.picture} size={spacing.lg}/>
      <AppText variant="caption" tone="muted" numberOfLines={1} style={{ flexShrink: 1 }}>{name}</AppText>
    </View> : undefined}
    trailing={<AppText variant="caption" style={{ color: colors.text, backgroundColor: colors.background,
      borderRadius: radius.sm, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs }}>
      {t(`napplets.formats.${application.kind}`)}
    </AppText>}
    icon={<RunningApplicationIcon sourceId={application.key} release={application} size={spacing.xl}/>}
    onPress={onPress}/>;
});
