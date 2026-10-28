import X from 'lucide-react-native/icons/x';
import { iconStrokeWidth } from '@/theme/icons';
import { useErrorToast } from '@/hooks/use-error-toast';
import { useDeferredValue, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, View } from 'react-native';
import Animated, { useAnimatedReaction, useAnimatedScrollHandler, useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { useDiscovery } from '@/stores/explore-discovery.store';
import { useTranslation } from 'react-i18next';
import { Compass } from '@solar-icons/react-native/category/map/Linear/Compass';
import { AppText } from '@/components/common/AppText';
import { AppButton } from '@/components/common/AppButton';
import { useApplicationAddressSearch } from '@/hooks/use-application-address-search';
import { useProfilesMap } from '@/hooks/use-profile';
import { useContactsMap } from '@/hooks/use-contacts';
import { resolveDisplayName } from '@/lib/nostr/display-name';
import { discoverApplications, loadMoreApplications } from '@/services/explore/discovery';
import { type ExploreEntry } from '@/services/explore/model';
import { spacing, useThemeColors } from '@/theme';
import { supportsApplicationAction, type ApplicationActionFilter } from '@/services/explore/action-matching';
import { ApplicationContextRow } from './ApplicationContextRow';

const EMPTY_ENTRIES: ExploreEntry[] = [];

export function ExploreDiscovery({ account, onDetails, onFavorite, onPermissions, onShare, bottomInset, onScrollChange, query = '', actionFilter, onClearAction, header, headerHeight = 0, onScrollBeginDrag, scope = 'discover', favorites = EMPTY_ENTRIES }: {
  actionFilter?: ApplicationActionFilter; onClearAction?: () => void;
  header?: ReactNode; headerHeight?: number; onScrollBeginDrag?: () => void;
  account: string; onDetails: (app: ExploreEntry) => void;
  onFavorite: (app: ExploreEntry) => void | Promise<void>; onPermissions: (app: ExploreEntry) => void; onShare: (app: ExploreEntry) => void;
  bottomInset: number; onScrollChange: (scrolled: boolean) => void; query?: string; scope?: 'my-apps' | 'discover'; favorites?: ExploreEntry[];
}) {
  const discoveryScope = actionFilter ? 'napps' : 'all';
  const state = useDiscovery(discoveryScope);
  const favoriteKeys = useMemo(() => new Set(favorites.map(app => app.key)), [favorites]);
  const searchKey = useMemo(() => ({ query, scope, actionFilter }), [query, scope, actionFilter]);
  const refreshPending = useRef(false);
  const [pullRefreshing, setPullRefreshing] = useState(false);
  const [searchWindow, setSearchWindow] = useState({ key: searchKey, count: 20 });
  const searchCount = searchWindow.key === searchKey ? searchWindow.count : 20;
  const catalogueReady = scope === 'my-apps' || state.loaded;
  const entries = useMemo(() => {
    const source = scope === 'my-apps' ? favorites : catalogueReady ? state.entries : EMPTY_ENTRIES;
    return actionFilter ? source.filter(app => supportsApplicationAction(app, actionFilter)) : source;
  }, [scope, favorites, catalogueReady, state.entries, actionFilter]);
  const list = useRef<FlatList<ExploreEntry>>(null);
  const scrollOffset = useSharedValue(0);
  const scroll = useAnimatedScrollHandler(event => { scrollOffset.set(event.contentOffset.y); });
  useAnimatedReaction(() => scrollOffset.get() > 0, (next, previous) => {
    if (next !== previous) scheduleOnRN(onScrollChange, next);
  });
  // The search field lives above the native refresh viewport. It collapses
  // during positive scrolling, but bounce never moves or resizes it.
  const headerContainerStyle = useAnimatedStyle(() => ({
    height: Math.max(0, headerHeight - Math.max(0, scrollOffset.get())),
  }));
  const headerStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: -Math.min(headerHeight, Math.max(0, scrollOffset.get())) }],
  }));
  useEffect(() => { list.current?.scrollToOffset({ offset: 0, animated: false }); }, [query, scope, actionFilter]);
  const address = useApplicationAddressSearch(account, query, state.entries, state.addressCache);
  const deferredQuery = useDeferredValue(query);
  const terms = useMemo(() => deferredQuery.trim().toLowerCase().split(/\s+/).filter(Boolean), [deferredQuery]);
  const searching = query.trim().length > 0;
  const publishers = useMemo(() => [...new Set(entries.map(app => app.manifest?.pubkey ?? app.release?.event.pubkey).filter((key): key is string => !!key))], [entries]);
  const profiles = useProfilesMap(publishers);
  const contacts = useContactsMap(account, publishers);
  const authorNames = useMemo(() => {
    const names = new Map<string, string>();
    for (const pubkey of publishers) {
      const profile = profiles[pubkey];
      const name = resolveDisplayName(pubkey, { petname: contacts[pubkey]?.petname, displayName: profile?.displayName, name: profile?.name });
      names.set(pubkey, [name, profile?.displayName, profile?.name].filter(Boolean).join('\n').toLowerCase());
    }
    return names;
  }, [publishers, profiles, contacts]);
  const index = useMemo(() => entries.map(app => ({ app, text: `${app.title}\n${app.description}`.toLowerCase() })), [entries]);
  const matches = useMemo(() => address.active || !catalogueReady ? EMPTY_ENTRIES : terms.length ? index.filter(item => {
    const author = authorNames.get(item.app.manifest?.pubkey ?? item.app.release?.event.pubkey ?? '') ?? '';
    return terms.every(term => item.text.includes(term) || author.includes(term));
  }).map(item => item.app) : entries, [address.active, catalogueReady, index, terms, authorNames, entries]);
  const data = useMemo(() => {
    if (address.active) return address.entry && (!actionFilter || supportsApplicationAction(address.entry, actionFilter)) ? [address.entry] : [];
    return searching || actionFilter || scope === 'my-apps' ? matches.slice(0, searchCount) : state.visibleEntries;
  }, [address.active, address.entry, searching, scope, matches, searchCount, state.visibleEntries, actionFilter]);
  const c = useThemeColors();
  const { t } = useTranslation();
  const filterLabel = actionFilter ? t(actionFilter.auxiliary ? 'applications.auxiliary_action_filter' : 'applications.action_filter', { action: actionFilter.name }) : '';
  useEffect(() => { if (scope === 'discover' && !address.active) void discoverApplications(account, false, discoveryScope); }, [account, address.active, scope, discoveryScope]);
  useEffect(() => {
    if (actionFilter && scope === 'discover' && !address.active && state.loaded && state.hasMore &&
      !state.loading && !state.loadingMore && !state.error && matches.length < searchCount) void loadMoreApplications(account, discoveryScope);
  }, [actionFilter, scope, address.active, state.loaded, state.hasMore, state.loading, state.loadingMore, state.error, matches.length, searchCount, account, discoveryScope]);
  const refresh = async () => {
    if ((searching && !actionFilter) || scope !== 'discover' || refreshPending.current) return;
    refreshPending.current = true;
    setPullRefreshing(true);
    try { await discoverApplications(account, true, discoveryScope); }
    finally { refreshPending.current = false; setPullRefreshing(false); }
  };
  const canRefresh = !searching && !address.active && scope === 'discover';
  const refreshing = canRefresh && pullRefreshing;
  const cataloguePending = !address.active && scope === 'discover' && !state.loaded && !state.error;
  const error = scope === 'discover' && !address.active && state.error && (actionFilter || (!data.length && !searching))
    ? 'applications.request_failed' : undefined;
  const filteredPending = !!actionFilter && !address.active && scope === 'discover' && !state.error &&
    (state.loading || state.loadingMore || state.hasMore);
  useErrorToast(error, 'primary');
  return <View style={{ flex: 1 }}>
    {header ? <Animated.View testID="explore-search-header" style={[{ overflow: 'hidden' }, headerContainerStyle]}>
      <Animated.View style={headerStyle}>{header}</Animated.View>
    </Animated.View> : null}
    <Animated.FlatList ref={list} data={data} keyExtractor={app => app.key}
    initialNumToRender={20} removeClippedSubviews={false} refreshing={refreshing} onRefresh={canRefresh ? refresh : undefined}
    refreshControl={canRefresh ? <RefreshControl refreshing={refreshing} onRefresh={refresh}
      tintColor={c.textMuted} colors={[c.textMuted]} /> : undefined}
    onEndReached={() => {
      if (address.active) return;
      if (searching || actionFilter || scope === 'my-apps') {
        if (searchCount < matches.length || actionFilter && scope === 'discover' && matches.length >= searchCount && state.hasMore && !state.error) setSearchWindow({ key: searchKey, count: searchCount + 20 });
        return;
      }
      if (state.hasMore && !state.loading && !state.loadingMore && !state.error) void loadMoreApplications(account, discoveryScope);
    }} onEndReachedThreshold={0.3}
    onScrollBeginDrag={onScrollBeginDrag}
    keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag"
    ListFooterComponent={scope === 'discover' && (!searching || actionFilter) && state.loadingMore && (!actionFilter || data.length > 0) ? <ActivityIndicator size="small" color={c.textMuted} style={{ padding: spacing.lg }} /> : null}
    onScroll={scroll} scrollEventThrottle={1}
    contentContainerStyle={{ paddingBottom: bottomInset, flexGrow: 1 }}
    ListHeaderComponent={actionFilter || error ? <>{actionFilter ? <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.xs, alignItems: 'flex-start' }}>
      <AppButton variant="secondary" size="sm" fullWidth={false} corner="full" labelVariant="caption"
        label={filterLabel}
        accessibilityLabel={`${filterLabel}. ${t('applications.show_all_apps')}`}
        iconRight={<X size={spacing.lg} strokeWidth={iconStrokeWidth.compact} color={c.textMuted} />}
        onPress={onClearAction} />
    </View> : null}{error ? <View style={{ padding: spacing.lg, gap: spacing.sm }}>
      <AppButton variant="secondary" label={t('common.retry')} onPress={refresh} />
    </View> : null}</> : null}
    ListEmptyComponent={filteredPending || address.active && address.loading || cataloguePending && (searching || !pullRefreshing)
      ? <ActivityIndicator size="small" color={c.textMuted} style={{ padding: spacing.lg }} />
      : !error && (searching || scope === 'my-apps' || !state.error && !state.loading && !state.hasMore) ? <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, gap: spacing.lg }}>
        <Compass size={spacing['3xl']} color={c.textMuted} />
        <AppText variant="title" align="center">{t(searching || scope === 'my-apps' ? 'search.empty' : actionFilter ? 'applications.no_compatible_apps' : 'applications.discovery_empty')}</AppText>
        {!searching && scope === 'discover' ? <AppButton variant="secondary" label={t('common.retry')} onPress={refresh} /> : null}
      </View> : null}
    renderItem={({ item }) => <ApplicationContextRow app={item} favorite={favoriteKeys.has(item.key)}
      onDetails={onDetails} onFavorite={onFavorite} onPermissions={onPermissions} onShare={onShare} />} />

  </View>;
}
