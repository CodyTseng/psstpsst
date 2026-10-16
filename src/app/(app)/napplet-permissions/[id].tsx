import { ActivityIndicator, ScrollView, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { AppScreen } from '@/components/common/AppScreen';
import { AppText } from '@/components/common/AppText';
import { ListGroup } from '@/components/common/ListGroup';
import { ListRow } from '@/components/common/ListRow';
import { ScreenHeader, useScreenHeaderClearance } from '@/components/common/ScreenHeader';
import { SigningRequester } from '@/components/napplet/SigningRequestDetails';
import { NappletSettings } from '@/components/napplet/NappletPanel';
import { useNappletRelease } from '@/hooks/use-napplet-release';
import { spacing, useThemeColors } from '@/theme';

export default function NappletPermissionsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { release, installed, accountPubkey, error } = useNappletRelease(id);
  const { t } = useTranslation();
  const c = useThemeColors();
  const clearance = useScreenHeaderClearance();
  const app = installed ?? release;
  return <AppScreen edges={[]}>
    <ScreenHeader title={t('napplets.permissions_manage')} />
    <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingTop: clearance + spacing.lg, gap: spacing.xl }}>
      {error ? <AppText tone="danger">{t(error)}</AppText> : null}
      {!app ? (!error ? <ActivityIndicator color={c.accent} /> : null) : <>
        <SigningRequester app={app} />
        {installed && accountPubkey ? <NappletSettings key={`${accountPubkey}:${installed.key}:${installed.hash}`}
          release={installed} accountPubkey={accountPubkey} /> : <View style={{ gap: spacing.md }}>
          <AppText variant="subtitle">{t('napplets.permissions')}</AppText>
          <ListGroup>{[...new Set([...app.required, ...app.optional])].filter((domain) => domain !== 'shell').map((domain) =>
            <ListRow key={domain} title={t(`napplets.capability_${domain}`, { defaultValue: domain })}
              value={t(app.required.includes(domain) ? 'napplets.capabilities_required' : 'napplets.capabilities_optional')} />)}</ListGroup>
          {!app.required.length && !app.optional.length ? <AppText tone="muted">{t('napplets.none')}</AppText> : null}
        </View>}
      </>}
    </ScrollView>
  </AppScreen>;
}
