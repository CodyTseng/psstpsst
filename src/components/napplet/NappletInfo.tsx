import type { ReactNode } from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { AppText } from '@/components/common/AppText';
import { Avatar } from '@/components/common/Avatar';
import { DirectionalChevron } from '@/components/common/DirectionalChevron';
import { ListRow } from '@/components/common/ListRow';
import { useDisplayName } from '@/hooks/use-display-name';
import type { NappletRelease } from '@/services/napplet/protocol';
import { spacing, useThemeColors } from '@/theme';
import { NappletIdentity } from './NappletIdentity';
import { NappletRequiredAccess } from './NappletRequiredAccess';

/** One information layout for details, runtime information and launch consent. */
export function NappletInfo({ release, onPublisher, notice }: { release: NappletRelease; onPublisher(): void; notice?: ReactNode }) {
  const { t } = useTranslation();
  const c = useThemeColors();
  const { name, profile } = useDisplayName(release.event.pubkey);
  return <View testID="napplet-info" style={{ gap: spacing.lg }}>
    <NappletIdentity release={release} />
    <ListRow variant="inline" compact title={t('napplets.publisher')} titleTone="muted"
      value={name} valueTone="default"
      valueLeading={<Avatar pubkey={release.event.pubkey} picture={profile?.picture} size={spacing.xl} />}
      trailing={<DirectionalChevron size={spacing.lg} color={c.textMuted} />}
      onPress={onPublisher} />
    {release.description.trim() ? <AppText>{release.description}</AppText> : null}
    {notice}
    <NappletRequiredAccess release={release} />
  </View>;
}
