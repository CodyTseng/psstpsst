import { View } from 'react-native';
import { AppText } from '@/components/common/AppText';
import type { NappletRelease } from '@/services/napplet/protocol';
import { spacing } from '@/theme';
import { NappletIcon } from './NappletIcon';

/** App identity shared by information surfaces and compact permission contexts. */
export function NappletIdentity({ release, compact = false }: { release: NappletRelease; compact?: boolean }) {
  return <View testID="napplet-identity" style={{ flexDirection: 'row', alignItems: 'center', gap: compact ? spacing.md : spacing.lg }}>
    <NappletIcon release={release} size={compact ? spacing['2xl'] : spacing['3xl']} />
    <AppText variant={compact ? 'subtitle' : 'title'} numberOfLines={compact ? 1 : 2}
      selectable={false} style={{ flex: 1, minWidth: 0, userSelect: 'none' }}>{release.title}</AppText>
  </View>;
}
