import { useErrorToast } from '@/hooks/use-error-toast';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Widget } from '@solar-icons/react-native/category/settings/Linear/Widget';
import { AppScreen } from '@/components/common/AppScreen';
import { AppText } from '@/components/common/AppText';
import { AppButton } from '@/components/common/AppButton';
import { ScreenHeader, useScreenHeaderClearance } from '@/components/common/ScreenHeader';
import { SectionLabel } from '@/components/common/SectionLabel';
import { Avatar } from '@/components/common/Avatar';
import { ApplicationListRow } from '@/components/napplet/ApplicationListRow';
import { useDisplayName } from '@/hooks/use-display-name';
import { useActiveAccount } from '@/stores/active-account.store';
import { usePublisherApplications } from '@/stores/explore-publisher.store';
import { isPublisher } from '@/services/explore/publishers';
import { applicationListEntry, type ExploreEntry } from '@/services/explore/model';
import { spacing, useThemeColors } from '@/theme';

export default function PublisherApplicationsScreen() {
  const { pubkey } = useLocalSearchParams<{ pubkey?: string | string[] }>();
  if (!isPublisher(pubkey)) return <InvalidPublisher />;
  return <PublisherApplications pubkey={pubkey} />;
}

function InvalidPublisher() {
  useErrorToast('new_chat.invalid_npub');
  const { t } = useTranslation();
  const clearance = useScreenHeaderClearance();
  return <AppScreen edges={['bottom']}>
    <ScreenHeader title={t('applications.publisher')} />
    <View style={{ padding: spacing.lg, paddingTop: clearance + spacing.lg }}>
    </View>
  </AppScreen>;
}

function PublisherApplications({ pubkey }: { pubkey: string }) {
  const account = useActiveAccount(state => state.activePubkey);
  const state = usePublisherApplications(pubkey);
  useErrorToast(state.error && 'applications.request_failed');
  const { name, profile } = useDisplayName(pubkey);
  const { t } = useTranslation();
  const colors = useThemeColors();
  const clearance = useScreenHeaderClearance();
  const [scrolled, setScrolled] = useState(false);
  const load = state.load;
  useEffect(() => { if (account) void load?.(account); }, [account, load]);
  const refresh = () => { if (account) void load?.(account, true); };
  return <AppScreen edges={['bottom']}>
    <ScreenHeader title={t('applications.publisher_apps')} bordered={scrolled} />
    <FlatList data={state.entries} keyExtractor={entry => entry.key}
      initialNumToRender={12} refreshing={state.loading} onRefresh={refresh}
      onScroll={event => setScrolled(event.nativeEvent.contentOffset.y > 0)} scrollEventThrottle={16}
      contentContainerStyle={{ paddingTop: clearance, paddingBottom: spacing.lg, flexGrow: 1 }}
      ListHeaderComponent={<View>
        <View style={{ padding: spacing.lg, paddingBottom: spacing.xl, gap: spacing.lg }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
            <Avatar pubkey={pubkey} picture={profile?.picture} size={spacing['3xl']} />
            <AppText variant="title" numberOfLines={1} style={{ flex: 1 }}>{name}</AppText>
          </View>
          {profile?.about?.trim() ? <AppText tone="muted" selectable>{profile.about.trim()}</AppText> : null}
        </View>
        <View style={{ borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border,
          paddingHorizontal: spacing.lg, paddingVertical: spacing.lg, gap: spacing.lg }}>
          <SectionLabel>{t('applications.publisher_apps')}</SectionLabel>
          {state.error ? <View style={{ gap: spacing.sm }}>
            <AppButton variant="secondary" label={t('common.retry')} onPress={refresh} />
          </View> : null}
        </View>
      </View>}
      ListEmptyComponent={!state.loaded && !state.error
        ? <ActivityIndicator color={colors.accent} style={{ padding: spacing.lg }} />
        : !state.error ? <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, gap: spacing.lg }}>
          <Widget size={spacing['3xl']} color={colors.textMuted} />
          <AppText variant="title" align="center">{t('applications.discovery_empty')}</AppText>
          <AppButton variant="secondary" label={t('common.retry')} onPress={refresh} />
        </View> : null}
      renderItem={({ item }) => <PublisherApplicationRow entry={item} pubkey={pubkey} />} />
  </AppScreen>;
}

const PublisherApplicationRow = memo(function PublisherApplicationRow({ entry, pubkey }: { entry: ExploreEntry; pubkey: string }) {
  const application = useMemo(() => applicationListEntry(entry), [entry]);
  const open = useCallback(() => router.push({ pathname: '/explore-details',
    params: { key: entry.key, publisher: pubkey, catalog: '1' } }), [entry.key, pubkey]);
  return <ApplicationListRow application={application} onPress={open} />;
});
