import { memo, type ComponentProps } from 'react';
import { View } from 'react-native';
import { Avatar } from '@/components/common/Avatar';
import { AppText } from '@/components/common/AppText';
import { ListRow } from '@/components/common/ListRow';
import { useDisplayName } from '@/hooks/use-display-name';
import type { ApplicationListEntry } from '@/services/explore/model';
import { spacing } from '@/theme';
import { RunningApplicationIcon } from './RunningApplicationIcon';

const APPLICATION_ICON_SIZE = spacing['2xl'] + spacing.sm;

/** Discovery and application handoffs share one recognizable application row. */
export const ApplicationListRow = memo(function ApplicationListRow({ application, onPress, ...interactions }: {
  application: ApplicationListEntry; onPress(): void;
} & Pick<ComponentProps<typeof ListRow>, 'onLongPress' | 'accessibilityActions' | 'onAccessibilityAction'>) {
  const { name, profile } = useDisplayName(application.publisher ?? '');
  const description = application.description?.trim().replace(/\s+/g, ' ');
  return <ListRow {...interactions} variant="list" title={application.title} subtitleMultiline
    iconWidth={APPLICATION_ICON_SIZE} iconAlign="start" verticalPadding="md"
    subtitleContent={description || application.publisher ? <View style={{ gap: spacing.xs }}>
      {description ? <AppText variant="caption" tone="muted" numberOfLines={1} selectable={false} style={{ userSelect: 'none' }}>{description}</AppText> : null}
      {application.publisher ? <View testID="discovery-publisher" style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
        <Avatar pubkey={application.publisher} picture={profile?.picture} size={spacing.lg}/>
        <AppText variant="caption" tone="muted" numberOfLines={1} selectable={false} style={{ flexShrink: 1, userSelect: 'none' }}>{name}</AppText>
      </View> : null}
    </View> : undefined}
    icon={<RunningApplicationIcon sourceId={application.key} release={application} size={APPLICATION_ICON_SIZE}/>}
    onPress={onPress}/>;
});
