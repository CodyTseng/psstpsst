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
import { ApplicationContextRow } from './ApplicationContextRow';

const EMPTY_ENTRIES: ExploreEntry[] = [];

export function ExploreDiscovery({ account, onDetails, onFavorite, onPermissions, onShare, bottomInset, onScrollChange, query = '', header, headerHeight = 0, onScrollBeginDrag, scope = 'discover', favorites = EMPTY_ENTRIES }: {
  header?: ReactNode; headerHeight?: number; onScrollBeginDrag?: () => void;
  account: string; onDetails: (app: ExploreEntry) => void;
  onFavorite: (app: ExploreEntry) => void; onPermissions: (app: ExploreEntry) => void; onShare: (app: ExploreEntry) => void;
  bottomInset: number; onScrollChange: (scrolled: boolean) => void; query?: string; scope?: 'favorites' | 'discover'; favorites?: ExploreEntry[];
}) {
  const state = useDiscovery();
  const favoriteKeys = useMemo(() => new Set(favorites.map(app => app.key)), [favorites]);
  const searchKey = useMemo(() => ({ query, scope }), [query, scope]);
  const refreshPending = useRef(false);
  const [pullRefreshing, setPullRefreshing] = useState(false);
  const [searchWindow, setSearchWindow] = useState({ key: searchKey, count: 20 });
  const searchCount = searchWindow.key === searchKey ? searchWindow.count : 20;
  const entries = scope === 'favorites' ? favorites : state.entries;
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
  useEffect(() => { list.current?.scrollToOffset({ offset: 0, animated: false }); }, [query, scope]);
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
  const matches = useMemo(() => address.active ? [] : terms.length ? index.filter(item => {
    const author = authorNames.get(item.app.manifest?.pubkey ?? item.app.release?.event.pubkey ?? '') ?? '';
    return terms.every(term => item.text.includes(term) || author.includes(term));
  }).map(item => item.app) : entries, [address.active, index, terms, authorNames, entries]);
  const data = useMemo(() => address.active ? address.entry ? [address.entry] : [] : searching || scope === 'favorites' ? matches.slice(0, searchCount) : state.visibleEntries, [address.active, address.entry, searching, scope, matches, searchCount, state.visibleEntries]);
  const c = useThemeColors();
  const { t } = useTranslation();
  useEffect(() => { if (scope === 'discover' && !address.active) void discoverApplications(account); }, [account, address.active, scope]);
  const refresh = async () => {
    if (address.active) { address.retry(); return; }
    if (scope !== 'discover' || refreshPending.current) return;
    refreshPending.current = true;
    setPullRefreshing(true);
    try { await discoverApplications(account, true); }
    finally { refreshPending.current = false; setPullRefreshing(false); }
  };
  const canRefresh = address.active || scope === 'discover';
  const refreshing = scope === 'discover' && !address.active && pullRefreshing;
  const error = data.length ? undefined : address.active ? address.error
    : scope === 'discover' && !searching && state.error ? 'napplets.request_failed' : undefined;
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
      if (searching || scope === 'favorites') {
        if (searchCount < matches.length) setSearchWindow({ key: searchKey, count: searchCount + 20 });
        return;
      }
      if (state.hasMore && !state.loading && !state.loadingMore && !state.error) void loadMoreApplications(account);
    }} onEndReachedThreshold={0.3}
    onScrollBeginDrag={onScrollBeginDrag}
    keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag"
    ListFooterComponent={scope === 'discover' && !searching && state.loadingMore ? <ActivityIndicator size="small" color={c.textMuted} style={{ padding: spacing.lg }} /> : null}
    onScroll={scroll} scrollEventThrottle={1}
    contentContainerStyle={{ paddingBottom: bottomInset, flexGrow: 1 }}
    ListHeaderComponent={error ? <View style={{ padding: spacing.lg, gap: spacing.sm }}>
      <AppButton variant="secondary" label={t('common.retry')} onPress={refresh} />
    </View> : null}
    ListEmptyComponent={address.active ? address.loading ? <ActivityIndicator size="small" color={c.textMuted} style={{ padding: spacing.lg }} /> : null : scope === 'discover' && !state.loaded && !state.error && !pullRefreshing
      ? <ActivityIndicator size="small" color={c.textMuted} style={{ padding: spacing.lg }} />
      : searching || scope === 'favorites' || !state.error && !state.loading && !state.hasMore ? <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, gap: spacing.lg }}>
        <Compass size={spacing['3xl']} color={c.textMuted} />
        <AppText variant="title" align="center">{t(searching || scope === 'favorites' ? 'search.empty' : 'napplets.discovery_empty')}</AppText>
        {!searching && scope === 'discover' ? <AppButton variant="secondary" label={t('common.retry')} onPress={refresh} /> : null}
      </View> : null}
    renderItem={({ item }) => <ApplicationContextRow app={item} favorite={favoriteKeys.has(item.key)}
      onDetails={onDetails} onFavorite={onFavorite} onPermissions={onPermissions} onShare={onShare} />} />

  </View>;
}
