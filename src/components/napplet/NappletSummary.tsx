import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { AppText } from '@/components/common/AppText';
import { AppButton } from '@/components/common/AppButton';
import { Avatar } from '@/components/common/Avatar';
import { useDisplayName } from '@/hooks/use-display-name';
import type { NappletRelease } from '@/services/napplet/protocol';
import { spacing } from '@/theme';
import { NappletIcon } from './NappletIcon';

export function NappletSummary({ release, onPublisher }: { release: NappletRelease; onPublisher(): void }) {
  const { t } = useTranslation();
  const { name, profile } = useDisplayName(release.event.pubkey);
  return <View style={{ gap: spacing.lg }}>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.lg }}>
      <NappletIcon release={release} />
      <View style={{ flex: 1, minWidth: 0, gap: spacing.sm, alignItems: 'flex-start' }}>
        <AppText variant="title" numberOfLines={2}>{release.title}</AppText>
        <AppButton variant="text" compact compactAxis="none" fullWidth={false}
          label={name} labelVariant="caption" labelNumberOfLines={1}
          accessibilityLabel={`${t('napplets.publisher')}: ${name}`}
          iconLeft={<Avatar pubkey={release.event.pubkey} picture={profile?.picture} size={spacing.xl} />}
          onPress={onPublisher} />
      </View>
    </View>
    {release.description.trim() ? <AppText tone="muted">{release.description}</AppText> : null}
  </View>;
}
