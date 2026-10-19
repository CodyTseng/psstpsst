import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { AppText } from '@/components/common/AppText';
import { ListGroup } from '@/components/common/ListGroup';
import { ListRow } from '@/components/common/ListRow';
import type { NappletRelease } from '@/services/napplet/protocol';
import { spacing } from '@/theme';

export function NappletRequiredAccess({ release, showHeading = true }: { release: Pick<NappletRelease, 'required'>; showHeading?: boolean }) {
  const { t } = useTranslation();
  const required = [...new Set(release.required)].filter((domain) => domain !== 'shell');
  if (!required.length) return null;
  return <View style={{ gap: spacing.md }}>
    {showHeading ? <AppText variant="subtitle">{t('napplets.capabilities_required')}</AppText> : null}
    <ListGroup>{required.map((domain) => <ListRow key={domain}
      title={t(`napplets.capability_${({network:'resource',common:'relay'} as Record<string,string>)[domain] ?? domain}`, { defaultValue: domain })} />)}</ListGroup>
  </View>;
}
