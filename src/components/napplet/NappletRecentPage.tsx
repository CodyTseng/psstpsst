import { ActivityIndicator, FlatList, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Widget } from '@solar-icons/react-native/category/settings/Linear/Widget';
import { AppScreen } from '@/components/common/AppScreen';
import { AppText } from '@/components/common/AppText';
import { AppButton } from '@/components/common/AppButton';
import { ScreenHeader, useScreenHeaderClearance } from '@/components/common/ScreenHeader';
import { useScrolled } from '@/hooks/use-scrolled';
import { useLanguageDirection } from '@/i18n/direction';
import type { GridApp } from '@/services/explore/model';
import { spacing, useThemeColors } from '@/theme';
import { NappletRecentRow } from './NappletRecentRow';

import { type RecentAppActions } from './NappletRecentTile';

type Props<T extends GridApp> = Omit<RecentAppActions<T>, 'onOpen'> & {
  recent: T[];
  favoritePositions?: ReadonlyMap<string, number | null>;
  loaded?: boolean;
  error?: string | null;
  onBack?: () => void;
  loadingMore?: boolean;
  onLoadMore?: () => void;
};

export function NappletRecentPage<T extends GridApp>({ recent, favoritePositions, loaded = true, error, onBack, loadingMore, onLoadMore, onAdd, onUnfavorite, onRemove, onDetails, onPermissions, onShare }: Props<T>) {
  const { t } = useTranslation();
  const c = useThemeColors();
  const direction = useLanguageDirection();
  const clearance = useScreenHeaderClearance();
  const insets = useSafeAreaInsets();
  const { scrolled, scrollProps } = useScrolled();
  return <AppScreen edges={[]}>
    <ScreenHeader title={t('napplets.recent')} bordered={scrolled} onBack={onBack} />
    <View testID="napplet-recent-page" style={{ flex: 1, paddingTop: clearance }}>
      {error ? <View style={{ alignItems: 'center', padding: spacing.md, gap: spacing.sm }}>
        <AppText align="center" style={{ color: c.danger }}>{t(error)}</AppText>
        {onLoadMore ? <AppButton variant="secondary" label={t('common.retry')} onPress={onLoadMore} /> : null}
      </View> : null}
      {!loaded && !error ? <ActivityIndicator color={c.textMuted} style={{ padding: spacing.lg }} /> : <FlatList
      data={recent} keyExtractor={(app) => app.key}
      initialNumToRender={20} {...scrollProps}
      onEndReached={error ? undefined : onLoadMore} onEndReachedThreshold={0.25}
      ListFooterComponent={loadingMore ? <ActivityIndicator color={c.textMuted} style={{ padding: spacing.lg }} /> : null}
      contentContainerStyle={{ direction,
        paddingBottom: Math.max(insets.bottom, spacing.xl), flexGrow: 1 }}
      ListEmptyComponent={error ? null : <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, gap: spacing.lg }}>
        <Widget size={spacing['3xl']} color={c.textMuted} />
        <AppText variant="title" align="center">{t('napplets.empty_title')}</AppText>
        <AppText tone="muted" align="center">{t('napplets.empty_description')}</AppText>
      </View>}
      renderItem={({ item }) => <NappletRecentRow app={item} testID={`all-recent-app-${item.key}`}
        desktopPosition={favoritePositions ? favoritePositions.get(item.key) ?? null : undefined}
        onAdd={onAdd} onUnfavorite={onUnfavorite} onRemove={onRemove} onDetails={onDetails} onPermissions={onPermissions} onShare={onShare} />}

      />}
    </View>
  </AppScreen>;
}
