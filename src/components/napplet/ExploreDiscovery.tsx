import { memo, useCallback, useEffect, useMemo } from 'react';
import { ActivityIndicator, FlatList, View } from 'react-native';
import { useDiscovery } from '@/stores/explore-discovery.store';
import { useTranslation } from 'react-i18next';
import { Compass } from '@solar-icons/react-native/category/map/Linear/Compass';
import { AppText } from '@/components/common/AppText';
import { AppButton } from '@/components/common/AppButton';
import { discoverApplications, loadMoreApplications } from '@/services/explore/discovery';
import { applicationListEntry, type ExploreEntry } from '@/services/explore/model';
import { spacing, useThemeColors } from '@/theme';
import { ApplicationListRow } from './ApplicationListRow';

export function ExploreDiscovery({ account, onDetails, bottomInset, onScrollChange }: {
  account: string; onDetails: (app: ExploreEntry) => void;
  bottomInset: number; onScrollChange: (scrolled: boolean) => void;
}) {
  const state = useDiscovery();
  const c = useThemeColors();
  const { t } = useTranslation();
  useEffect(() => { void discoverApplications(account); }, [account]);
  const refresh = () => { void discoverApplications(account, true); };
  if (!state.loaded && !state.error) return <ActivityIndicator color={c.accent} style={{ padding: spacing.lg }} />;
  return <FlatList data={state.entries} keyExtractor={app => app.key}
    initialNumToRender={20} refreshing={state.loading} onRefresh={refresh}
    onEndReached={() => {
      if (state.hasMore && !state.loading && !state.loadingMore && !state.error) void loadMoreApplications(account);
    }} onEndReachedThreshold={0.3}
    ListFooterComponent={state.loadingMore ? <ActivityIndicator color={c.accent} style={{ padding: spacing.lg }} /> : null}
    onScroll={event => onScrollChange(event.nativeEvent.contentOffset.y > 0)} scrollEventThrottle={16}
    contentContainerStyle={{ paddingBottom: bottomInset, flexGrow: 1 }}
    ListHeaderComponent={state.error ? <View style={{ padding: spacing.lg, gap: spacing.sm }}>
      <AppText tone="muted" align="center">{t('napplets.request_failed')}</AppText>
      <AppButton variant="secondary" label={t('common.retry')} onPress={refresh} />
    </View> : null}
    ListEmptyComponent={!state.error && !state.loading && !state.loadingMore && !state.hasMore ? <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, gap: spacing.lg }}>
      <Compass size={spacing['3xl']} color={c.textMuted} />
      <AppText variant="title" align="center">{t('napplets.discovery_empty')}</AppText>
      <AppButton variant="secondary" label={t('common.retry')} onPress={refresh} />
    </View> : null}
    renderItem={({ item }) => <DiscoveryRow app={item} onDetails={onDetails} />} />;
}

const DiscoveryRow = memo(function DiscoveryRow({ app, onDetails }: {
  app: ExploreEntry; onDetails: (app: ExploreEntry) => void;
}) {
  const application = useMemo(() => applicationListEntry(app), [app]);
  const open = useCallback(() => onDetails(app), [app, onDetails]);
  return <ApplicationListRow application={application} onPress={open}/>;
});
