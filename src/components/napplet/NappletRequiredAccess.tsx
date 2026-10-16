import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { AppText } from '@/components/common/AppText';
import { ListGroup } from '@/components/common/ListGroup';
import { ListRow } from '@/components/common/ListRow';
import type { NappletRelease } from '@/services/napplet/protocol';
import { spacing } from '@/theme';

export function NappletRequiredAccess({ release }: { release: NappletRelease }) {
  const { t } = useTranslation();
  const required = [...new Set(release.required)].filter((domain) => domain !== 'shell');
  if (!required.length) return null;
  return <View style={{ gap: spacing.md }}>
    <AppText variant="subtitle">{t('napplets.capabilities_required')}</AppText>
    <ListGroup>{required.map((domain) => <ListRow key={domain}
      title={t(`napplets.capability_${domain}`, { defaultValue: domain })} />)}</ListGroup>
  </View>;
}
