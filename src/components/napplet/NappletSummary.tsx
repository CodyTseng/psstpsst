import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { AppText } from '@/components/common/AppText';
import { Avatar } from '@/components/common/Avatar';
import { DirectionalChevron } from '@/components/common/DirectionalChevron';
import { ListRow } from '@/components/common/ListRow';
import { useDisplayName } from '@/hooks/use-display-name';
import type { NappletRelease } from '@/services/napplet/protocol';
import { spacing, useThemeColors } from '@/theme';
import { NappletIcon } from './NappletIcon';

export function NappletSummary({ release, onPublisher }: { release: NappletRelease; onPublisher(): void }) {
  const { t } = useTranslation();
  const c = useThemeColors();
  const { name, profile } = useDisplayName(release.event.pubkey);
  return <View style={{ gap: spacing.lg }}>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.lg }}>
      <NappletIcon release={release} size={spacing['3xl']} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <AppText variant="title" numberOfLines={2}>{release.title}</AppText>
      </View>
    </View>
    <ListRow variant="inline" title={t('napplets.publisher')} titleTone="muted"
      value={name} valueTone="default"
      valueLeading={<Avatar pubkey={release.event.pubkey} picture={profile?.picture} size={spacing.xl} />}
      trailing={<DirectionalChevron size={spacing.lg} color={c.textMuted} />}
      onPress={onPublisher} />
    {release.description.trim() ? <AppText>{release.description}</AppText> : null}
  </View>;
}
