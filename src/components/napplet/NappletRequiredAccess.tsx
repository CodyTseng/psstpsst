import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { AppText } from '@/components/common/AppText';
import { ListGroup } from '@/components/common/ListGroup';
import { ListRow } from '@/components/common/ListRow';
import type { NappletRelease } from '@/services/napplet/protocol';
import { spacing } from '@/theme';

export function NappletRequiredAccess({ release, showHeading = true, unsupported = [] }: { release: Pick<NappletRelease, 'required'>; showHeading?: boolean; unsupported?: readonly string[] }) {
  const { t } = useTranslation();
  const required = [...new Set(release.required)].filter((domain) => domain !== 'shell');
  if (!required.length) return null;
  return <View style={{ gap: spacing.md }}>
    {showHeading ? <AppText variant="subtitle">{t('napplets.capabilities_required')}</AppText> : null}
    {unsupported.length ? <AppText variant="caption" tone="danger">{t('napplets.unsupported')}</AppText> : null}
    <ListGroup>{required.map((domain) => {
      const name=t(`napplets.capability_${({network:'resource',common:'relay'} as Record<string,string>)[domain] ?? domain}`, { defaultValue: domain });
      const unavailable=unsupported.includes(domain);
      return <ListRow key={domain} titleTone={unavailable ? 'danger' : 'default'}
        title={unavailable ? t('napplets.capability_unsupported', { name }) : name} />;
    })}</ListGroup>
  </View>;
}
