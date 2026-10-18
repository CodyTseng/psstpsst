import { memo, useEffect } from 'react';
import { ActivityIndicator, FlatList, View } from 'react-native';
import { useDiscovery } from '@/stores/explore-discovery.store';
import { useTranslation } from 'react-i18next';
import { Compass } from '@solar-icons/react-native/category/map/Linear/Compass';
import { AppText } from '@/components/common/AppText';
import { Avatar } from '@/components/common/Avatar';
import { AppButton } from '@/components/common/AppButton';
import { ListRow } from '@/components/common/ListRow';
import { discoverApplications } from '@/services/explore/discovery';
import type { ExploreEntry } from '@/services/explore/model';
import { useDisplayName } from '@/hooks/use-display-name';
import { applicationFormatColors, radius, spacing, useEffectiveColorScheme, useThemeColors } from '@/theme';
import { NappletIcon } from './NappletIcon';

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
    initialNumToRender={12} refreshing={state.loading} onRefresh={refresh}
    onScroll={event => onScrollChange(event.nativeEvent.contentOffset.y > 0)} scrollEventThrottle={16}
    contentContainerStyle={{ paddingBottom: bottomInset, flexGrow: 1 }}
    ListHeaderComponent={state.error ? <View style={{ padding: spacing.lg, gap: spacing.sm }}>
      <AppText tone="muted" align="center">{t('napplets.request_failed')}</AppText>
      <AppButton variant="secondary" label={t('common.retry')} onPress={refresh} />
    </View> : null}
    ListEmptyComponent={!state.error ? <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, gap: spacing.lg }}>
      <Compass size={spacing['3xl']} color={c.textMuted} />
      <AppText variant="title" align="center">{t('napplets.discovery_empty')}</AppText>
      <AppButton variant="secondary" label={t('common.retry')} onPress={refresh} />
    </View> : null}
    renderItem={({ item }) => <DiscoveryRow app={item} onDetails={onDetails} />} />;
}

const DiscoveryRow = memo(function DiscoveryRow({ app, onDetails }: {
  app: ExploreEntry; onDetails: (app: ExploreEntry) => void;
}) {
  const { t } = useTranslation();
  const colors = applicationFormatColors[app.kind][useEffectiveColorScheme()];
  const pubkey = app.manifest?.pubkey;
  const { name, profile } = useDisplayName(pubkey ?? '');
  return <ListRow variant="list" title={app.title} subtitleContent={pubkey ?
    <View testID="discovery-publisher" style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
      <Avatar pubkey={pubkey} picture={profile?.picture} size={spacing.lg} />
      <AppText variant="caption" tone="muted" numberOfLines={1} style={{ flexShrink: 1 }}>{name}</AppText>
    </View> : undefined}
    trailing={<AppText variant="caption" style={{ color: colors.text, backgroundColor: colors.background,
      borderRadius: radius.sm, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs }}>
      {t(`napplets.formats.${app.kind}`)}
    </AppText>}
    icon={<NappletIcon release={app} size={spacing.xl} />}
    onPress={() => onDetails(app)} />;
});
