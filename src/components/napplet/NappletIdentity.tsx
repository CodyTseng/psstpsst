import { View } from 'react-native';
import type { ReactNode } from 'react';
import { AppText } from '@/components/common/AppText';
import type { ApplicationIconSource } from '@/services/explore/icons';
import { spacing } from '@/theme';
import { NappletIcon } from './NappletIcon';

/** App identity shared by information surfaces and compact permission contexts. */
export function NappletIdentity({ release, compact = false, iconSize, titleVariant, action, subtitle }: { release: ApplicationIconSource & { title: string }; compact?: boolean; iconSize?: number; titleVariant?: 'body' | 'subtitle' | 'title'; action?: ReactNode; subtitle?: string }) {
  return <View testID="napplet-identity" style={{ flexDirection: 'row', alignItems: 'center', gap: compact ? spacing.md : spacing.lg }}>
    <NappletIcon release={release} size={iconSize ?? (compact ? spacing['2xl'] : spacing['3xl'])} />
    <View style={{ flex: 1, minWidth: 0, gap: spacing.xs }}>
      <AppText variant={titleVariant ?? (compact ? 'subtitle' : 'title')} numberOfLines={compact ? 1 : 2}
        selectable={false} style={{ minWidth: 0, userSelect: 'none' }}>{release.title}</AppText>
      {subtitle ? <AppText variant="caption" tone="muted">{subtitle}</AppText> : null}
    </View>
    {action ? <View style={{ flexShrink: 0 }}>{action}</View> : null}
  </View>;
}
