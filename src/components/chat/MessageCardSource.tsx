import { useWindowDimensions, View } from 'react-native';
import { AppText } from '@/components/common/AppText';
import { Avatar } from '@/components/common/Avatar';
import { useDisplayName } from '@/hooks/use-display-name';
import { spacing, typography } from '@/theme';

function SourceIdentity({ pubkey, loadRemote }: { pubkey: string; loadRemote: boolean }) {
  const { name, profile } = useDisplayName(pubkey, loadRemote);
  return <>
    <Avatar pubkey={pubkey} picture={loadRemote ? profile?.picture : undefined} size={spacing.lg} />
    <AppText variant="caption" tone="muted" numberOfLines={1}
      style={{ flexShrink: 1, includeFontPadding: false }}>{name}</AppText>
  </>;
}

/** Author credit occupies a stable line directly below the card title. */
export function MessageCardSource({ pubkey, loadRemote = true }: { pubkey?: string; loadRemote?: boolean }) {
  const { fontScale } = useWindowDimensions();
  return <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs, minWidth: 0,
    minHeight: Math.max(spacing.lg, typography.caption.lineHeight * fontScale) }}>
    {pubkey ? <SourceIdentity pubkey={pubkey} loadRemote={loadRemote} /> : null}
  </View>;
}
