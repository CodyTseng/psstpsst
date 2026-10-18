import { useState } from 'react';
import { ActivityIndicator, FlatList, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Widget } from '@solar-icons/react-native/category/settings/Linear/Widget';
import { AppScreen } from '@/components/common/AppScreen';
import { AppText } from '@/components/common/AppText';
import { ScreenHeader, useScreenHeaderClearance } from '@/components/common/ScreenHeader';
import { useScrolled } from '@/hooks/use-scrolled';
import { useLanguageDirection } from '@/i18n/direction';
import type { GridApp } from '@/services/explore/model';
import { spacing, useThemeColors } from '@/theme';
import { useNappletGridMetrics } from './NappletTile';

import { NappletRecentTile, type RecentAppActions } from './NappletRecentTile';

type Props<T extends GridApp> = RecentAppActions<T> & {
  recent: T[];
  loaded?: boolean;
  error?: string | null;
  onBack?: () => void;
};

export function NappletRecentPage<T extends GridApp>({ recent, loaded = true, error, onBack, onOpen, onAdd, onRemove, onDetails, onPermissions, onShare }: Props<T>) {
  const { t } = useTranslation();
  const c = useThemeColors();
  const direction = useLanguageDirection();
  const [width, setWidth] = useState(0);
  const clearance = useScreenHeaderClearance();
  const insets = useSafeAreaInsets();
  const { columns, iconSize, cellHeight, cellWidth, columnGap, gridInset } = useNappletGridMetrics(Math.max(0, width - spacing.lg * 2));
  const { scrolled, scrollProps } = useScrolled({ resetKey: columns });
  return <AppScreen edges={[]}>
    <ScreenHeader title={t('napplets.recent')} bordered={scrolled} onBack={onBack} />
    <View testID="napplet-recent-page" style={{ flex: 1, paddingTop: clearance }}
      onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
      {error ? <AppText align="center" style={{ color: c.danger, padding: spacing.md }}>{t(error)}</AppText> : null}
      {!loaded ? <ActivityIndicator color={c.accent} style={{ padding: spacing.lg }} /> : width > 0 ? <FlatList
      key={columns} data={recent} numColumns={columns} keyExtractor={(app) => app.key}
      initialNumToRender={24} {...scrollProps}
      columnWrapperStyle={columns > 1 ? { gap: columnGap } : undefined}
      contentContainerStyle={{ direction, paddingHorizontal: gridInset, paddingTop: spacing.sm,
        paddingBottom: Math.max(insets.bottom, spacing.xl), flexGrow: 1 }}
      getItemLayout={(_data, index) => ({ length: cellHeight, offset: spacing.sm + cellHeight * index, index })}
      ListEmptyComponent={<View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, gap: spacing.lg }}>
        <Widget size={spacing['3xl']} color={c.textMuted} />
        <AppText variant="title" align="center">{t('napplets.empty_title')}</AppText>
        <AppText tone="muted" align="center">{t('napplets.empty_description')}</AppText>
      </View>}
      renderItem={({ item }) => <NappletRecentTile app={item} testID={`all-recent-app-${item.key}`}
        width={cellWidth} height={cellHeight} iconSize={iconSize}
        onOpen={onOpen} onAdd={onAdd} onRemove={onRemove} onDetails={onDetails} onPermissions={onPermissions} onShare={onShare} />}

      /> : null}
    </View>
  </AppScreen>;
}
