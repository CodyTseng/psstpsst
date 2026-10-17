import { useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { AppScreen } from '@/components/common/AppScreen';
import { AppText } from '@/components/common/AppText';
import { AppButton } from '@/components/common/AppButton';
import { ScreenHeader, useScreenHeaderClearance } from '@/components/common/ScreenHeader';
import { NappletInfo } from '@/components/napplet/NappletInfo';
import { useNappletAccess } from '@/hooks/use-napplet-access';
import { useNappletRelease } from '@/hooks/use-napplet-release';
import { NAP_DOMAINS } from '@/services/napplet/protocol';
import { nappletService } from '@/services/napplet/service';
import { spacing, useThemeColors } from '@/theme';

export default function NappletDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { release, accountPubkey, error: loadError } = useNappletRelease(id);
  const access = useNappletAccess(release, accountPubkey);
  const { t } = useTranslation();
  const c = useThemeColors();
  const clearance = useScreenHeaderClearance();
  const [error, setError] = useState<string>();
  const unsupported = release?.required.some((domain) => !(NAP_DOMAINS as readonly string[]).includes(domain));
  const message = error ?? loadError ?? access.error;
  return <AppScreen edges={['bottom']}>
    <ScreenHeader title={release?.title ?? t('napplets.app_title')} />
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: spacing.lg, paddingTop: clearance + spacing.lg, gap: spacing.xl }}>
      {message ? <AppText tone="danger">{t(message)}</AppText> : null}
      {!release ? (!message ? <ActivityIndicator color={c.accent} /> : null) : <>
        <NappletInfo release={release} onPublisher={() => router.push(`/profile/${release.event.pubkey}`)}
          notice={unsupported ? <AppText tone="danger">{t('napplets.unsupported')}</AppText> : undefined} />
      </>}
    </ScrollView>
    {release ? <View style={{ padding: spacing.lg, backgroundColor: c.background,
      borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border }}>
      {access.loaded && !access.approved ? <AppText variant="caption" tone="muted" style={{ paddingBottom: spacing.md }}>{t('napplets.capabilities_signing_notice')}</AppText> : null}
      <AppButton label={t(access.loaded && !access.approved ? 'napplets.allow_and_open' : 'napplets.open')} disabled={unsupported || !access.loaded}
        onPress={() => {
          try {
            const runId = nappletService.prepareOpen(release, accountPubkey ?? '', access.approved ? undefined : [...new Set(['shell', ...release.required])]);
            router.push({ pathname: '/napplet-run', params: { runId } });
          } catch { setError('napplets.request_failed'); }
        }} />
    </View> : null}
  </AppScreen>;
}
