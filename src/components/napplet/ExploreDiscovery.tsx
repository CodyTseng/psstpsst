import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, View } from 'react-native';
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

export function ExploreDiscovery({ account, onDetails, onFavorite, onPermissions, onShare, bottomInset, onScrollChange, query = '', scope = 'discover', favorites = EMPTY_ENTRIES }: {
  account: string; onDetails: (app: ExploreEntry) => void;
  onFavorite: (app: ExploreEntry) => void; onPermissions: (app: ExploreEntry) => void; onShare: (app: ExploreEntry) => void;
  bottomInset: number; onScrollChange: (scrolled: boolean) => void; query?: string; scope?: 'favorites' | 'discover'; favorites?: ExploreEntry[];
}) {
  const state = useDiscovery();
  const favoriteKeys = useMemo(() => new Set(favorites.map(app => app.key)), [favorites]);
  const searchKey = useMemo(() => ({ query, scope }), [query, scope]);
  const [searchWindow, setSearchWindow] = useState({ key: searchKey, count: 20 });
  const searchCount = searchWindow.key === searchKey ? searchWindow.count : 20;
  const entries = scope === 'favorites' ? favorites : state.entries;
  const list = useRef<FlatList<ExploreEntry>>(null);
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
  const refresh = () => { if (address.active) address.retry(); else if (scope === 'discover') void discoverApplications(account, true); };
  const error = address.active ? address.error : scope === 'discover' && state.error ? 'napplets.request_failed' : undefined;
  return <FlatList ref={list} data={data} keyExtractor={app => app.key}
    initialNumToRender={20} refreshing={scope === 'discover' && !address.active && state.loaded && state.loading} onRefresh={address.active || scope === 'discover' ? refresh : undefined}
    onEndReached={() => {
      if (address.active) return;
      if (searching || scope === 'favorites') {
        if (searchCount < matches.length) setSearchWindow({ key: searchKey, count: searchCount + 20 });
        return;
      }
      if (state.hasMore && !state.loading && !state.loadingMore && !state.error) void loadMoreApplications(account);
    }} onEndReachedThreshold={0.3}
    keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag"
    ListFooterComponent={scope === 'discover' && !searching && state.loadingMore ? <ActivityIndicator color={c.accent} style={{ padding: spacing.lg }} /> : null}
    onScroll={event => onScrollChange(event.nativeEvent.contentOffset.y > 0)} scrollEventThrottle={16}
    contentContainerStyle={{ paddingBottom: bottomInset, flexGrow: 1 }}
    ListHeaderComponent={error ? <View style={{ padding: spacing.lg, gap: spacing.sm }}>
      <AppText tone="muted" align="center">{t(error)}</AppText>
      <AppButton variant="secondary" label={t('common.retry')} onPress={refresh} />
    </View> : null}
    ListEmptyComponent={address.active ? address.loading ? <ActivityIndicator color={c.accent} style={{ padding: spacing.lg }} /> : null : scope === 'discover' && !state.loaded && !state.error
      ? <ActivityIndicator color={c.accent} style={{ padding: spacing.lg }} />
      : searching || scope === 'favorites' || !state.error && !state.loading && !state.hasMore ? <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, gap: spacing.lg }}>
        <Compass size={spacing['3xl']} color={c.textMuted} />
        <AppText variant="title" align="center">{t(searching || scope === 'favorites' ? 'search.empty' : 'napplets.discovery_empty')}</AppText>
        {!searching && scope === 'discover' ? <AppButton variant="secondary" label={t('common.retry')} onPress={refresh} /> : null}
      </View> : null}
    renderItem={({ item }) => <ApplicationContextRow app={item} favorite={favoriteKeys.has(item.key)}
      onDetails={onDetails} onFavorite={onFavorite} onPermissions={onPermissions} onShare={onShare} />} />;
}
