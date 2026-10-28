import { showToast } from '@/stores/toast.store';
import { tryOpenApplicationWindow } from '@/services/explore/windows';
import { SegmentedControl } from '@/components/common/SegmentedControl';
import { ExploreDiscovery } from '@/components/napplet/ExploreDiscovery';
import { exploreService } from '@/services/explore/service';
import { useExplore } from '@/stores/explore.store';
import { websiteEntry, needsFavoriteMetadata, type ExploreEntry } from '@/services/explore/model';
import { resolveApplicationAddress } from '@/services/explore/address-search';
import { cacheApplicationAddress, discoveryStore } from '@/services/explore/discovery';
import { useApplicationFavorite } from '@/hooks/use-application-favorite';
import { useExploreShare } from '@/hooks/use-explore-share';
import { useCallback, useEffect, useEffectEvent, useMemo, useState } from 'react';
import { BackHandler, Keyboard, ScrollView, View } from 'react-native';
import { DelayedActivityIndicator } from '@/components/common/DelayedActivityIndicator';
import RotateCcwClock from 'lucide-react-native/icons/rotate-ccw-clock';
import { iconStrokeWidth } from '@/theme/icons';
import { Widget } from '@solar-icons/react-native/category/settings/Linear/Widget';
import { useLocalSearchParams, useNavigation } from 'expo-router';
import { usePrimaryPaneFocused } from '@/hooks/use-primary-pane-focused';
import { useExploreSearchHandoffStore } from '@/stores/explore-search-handoff.store';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getBottomChromeInset } from '@/lib/layout/bottom-chrome';
import { AppScreen } from '@/components/common/AppScreen';
import { AppButton } from '@/components/common/AppButton';
import { AppText } from '@/components/common/AppText';
import { SearchBar, SEARCH_BAR_SCREEN_GUTTER } from '@/components/search/SearchBar';
import { SearchTransition } from '@/components/search/SearchTransition';
import { SEARCH_ACTIVATION_SHORTCUT_LABEL } from '@/components/search/search-shortcut';
import { IconButton } from '@/components/common/IconButton';
import { QrScanButton } from '@/components/common/QrScanButton';
import { parseApplicationAddressQuery } from '@/services/explore/address-query';
import { ScreenHeader, useScreenHeaderClearance } from '@/components/common/ScreenHeader';
import { NappletGrid } from '@/components/napplet/NappletGrid';
import { nappletService } from '@/services/napplet/service';
import { useActiveAccount } from '@/stores/active-account.store';
import { usePrimaryPaneNavigation } from '@/components/navigation/primary-pane-navigation';
import { bottomBarHeight, spacing, uiDensity, useThemeColors } from '@/theme';

const SEARCH_HEIGHT = uiDensity.searchBarHeight + spacing.sm;
type ExploreMode = 'my-apps' | 'discover';

export default function NappletsScreen() {
  const account = useActiveAccount((s) => s.activePubkey);
  const [mode, setMode] = useState<{ account: string | null; value: ExploreMode; handoff?: number }>({ account, value: 'my-apps' });
  const { searchHandoff } = useLocalSearchParams<{ searchHandoff?: string }>();
  const pending = useExploreSearchHandoffStore(state => state.pending);
  const id = typeof searchHandoff === 'string' ? Number(searchHandoff) : NaN;
  const handoff = pending?.id === id && pending.account === account ? pending : undefined;
  const input = handoff?.value;
  if (handoff?.action && mode.handoff !== id) setMode({ account, value: 'discover', handoff: id });
  useEffect(() => {
    if (input !== undefined && account) {
      useExploreSearchHandoffStore.getState().consume(id, account);
    }
  }, [input, account, id, handoff]);
  return <AccountNapplets key={`${account ?? 'signed-out'}:${searchHandoff ?? ''}`} account={account} initialAddress={input} initialAction={handoff?.action}
    tab={mode.account === account ? mode.value : 'my-apps'} onTabChange={value => setMode(current => ({ ...current, account, value }))} />;
}
function AccountNapplets({ account, initialAddress, initialAction, tab, onTabChange }: { account: string | null; initialAddress?: string; initialAction?: { name: string; auxiliary: boolean }; tab: ExploreMode; onTabChange(value: ExploreMode): void }) {
  const [actionFilter, setActionFilter] = useState(initialAction);
  const c = useThemeColors();
  const { t } = useTranslation();
  const state = useExplore();
  const share = useExploreShare(account);
  const setFavorite = useApplicationFavorite(account, 'primary');
  const navigation = usePrimaryPaneNavigation();
  const desktop = useMemo(() => state.entries.filter(a=>a.desktopPosition!==null).sort((a,b)=>a.desktopPosition!-b.desktopPosition!), [state.entries]);
  const [query, setQuery] = useState('');
  const [searchActive, setSearchActive] = useState(false);
  const focused = usePrimaryPaneFocused();
  const tabsNavigation = useNavigation();
  const openSearch = useCallback(() => setSearchActive(true), []);
  const closeSearch = useCallback(() => {
    setQuery('');
    setSearchActive(false);
    Keyboard.dismiss();
  }, []);
  const searching = query.trim().length > 0;
  const [scan, setScan] = useState<{ value: string } | null>(() => initialAddress ? { value: initialAddress } : null);
  const [settledScan, setSettledScan] = useState<typeof scan>(null);
  const scanLoading = scan !== null && scan !== settledScan;
  const [scrolled, setScrolled] = useState(false);
  const [searchScrolled, setSearchScrolled] = useState(false);
  const showError = useCallback((key: string) => {
    showToast(t(key.startsWith('napplets.') ? key : 'napplets.request_failed'), { variant: 'error', target: 'primary' });
  }, [t]);
  const reportBackgroundError = useEffectEvent((error: unknown) => {
    console.warn('[explore] My apps load failed', error);
    showError('napplets.request_failed');
  });
  const changeQuery = useCallback((value: string) => { setScan(null); setQuery(value); setSearchScrolled(false); }, []);
  const clearance = useScreenHeaderClearance();
  const bottomInset = bottomBarHeight + getBottomChromeInset(useSafeAreaInsets().bottom);
  const needsFavorites = tab === 'my-apps' || scan !== null;
  useEffect(() => {
    if (account && focused && needsFavorites)
      void exploreService.activate(account, { refresh: true }).catch(error => reportBackgroundError(error));
  }, [account, focused, needsFavorites]);
  useEffect(() => {
    if (account && focused && searching && tab === 'my-apps' && state.loaded && state.account === account)
      void exploreService.loadFavoriteSearchMetadata(account).catch(error => reportBackgroundError(error));
  }, [account, focused, searching, tab, state.loaded, state.account]);
  const loadMoreFavorites = useCallback(() => {
    if (account) void exploreService.loadMoreFavorites(account).catch(() => showError('napplets.request_failed'));
  }, [account, showError]);
  const open = useCallback(
    async (app: ExploreEntry) => {
      let stage = 'resolve-metadata';
      try {
        if (needsFavoriteMetadata(app)) app = await exploreService.resolveFavorite(app, account ?? '');
        stage = 'open-window';
        if (await tryOpenApplicationWindow(app, account ?? '')) return;
        stage = 'prepare-inline';
        if(app.release) {
          await nappletService.activateAccount(account ?? '');
          const runId=nappletService.prepareOpen(app.release,account??'');
          navigation.open(`/napplet-run?runId=${runId}`);
        } else {
          const runId=exploreService.prepare(app,account??'');navigation.open(`/explore-run?runId=${runId}`);
        }
      } catch (error) {
        console.warn('[explore] Application launch failed', { stage, kind: app.kind }, error);
        showError('napplets.request_failed');
      }
    },
    [account, navigation, showError],
  );
  const showSearchDetails = useCallback((app: ExploreEntry) => {
    navigation.open(`/explore-details?key=${encodeURIComponent(app.key)}&catalog=1${actionFilter ? '&discovery=napps' : ''}`);
  }, [navigation, actionFilter]);
  const showFavoriteDetails = useCallback((app: ExploreEntry) => {
    navigation.open(`/explore-details?key=${encodeURIComponent(app.key)}`);
  }, [navigation]);
  const resolveScan = useEffectEvent(async (request: { value: string }, signal: AbortSignal) => {
    const address = parseApplicationAddressQuery(request.value);
    if (!account || !address || address.type === 'invalid') {
      showError('napplets.invalid_manifest');
      setSettledScan(request);
      return;
    }
    try {
      if (address.type === 'website') {
        await open(websiteEntry(address.key));
      } else {
        const discovery = discoveryStore.getState();
        const entries = [...state.entries, ...discovery.entries,
          ...(discovery.addressCache.account === account ? discovery.addressCache.entries : [])];
        const app = await resolveApplicationAddress(account, address, entries, signal);
        if (signal.aborted) return;
        cacheApplicationAddress(account, app);
        showSearchDetails(app);
      }
    } catch (error) {
      if (!signal.aborted) showError(error instanceof Error && ['napplets.not_found', 'napplets.invalid_manifest'].includes(error.message)
        ? error.message : 'napplets.request_failed');
    } finally {
      if (!signal.aborted) setSettledScan(request);
    }
  });
  useEffect(() => {
    if (!scan || !account || !state.loaded || state.account !== account) return;
    const controller = new AbortController();
    // Let the scanner close and loading feedback paint before resolving a manifest.
    const timer = setTimeout(() => { void resolveScan(scan, controller.signal); }, 0);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [scan, account, state.loaded, state.account]);
  useEffect(() => {
    if (!focused || !searchActive) return;
    const back = BackHandler.addEventListener('hardwareBackPress', () => { closeSearch(); return true; });
    return () => back.remove();
  }, [focused, searchActive, closeSearch]);
  useEffect(() => tabsNavigation.addListener('tabPress' as never, () => {
    const state = tabsNavigation.getState();
    if (state?.routes[state.index]?.name === 'napplets' && searchActive) closeSearch();
  }), [tabsNavigation, searchActive, closeSearch]);
  const action = useCallback(
    (app: ExploreEntry, index: number | null) => {
      if (index === null) return setFavorite(app, false);
      return exploreService
        .move(app, index, account ?? '')
        .catch(() => showError('napplets.request_failed'));
    },
    [account, setFavorite, showError],
  );
  const toggleFavorite = useCallback((app: ExploreEntry) => {
    return setFavorite(app, !desktop.some(item => item.key === app.key));
  }, [setFavorite, desktop]);
  const showPermissions = useCallback((app: ExploreEntry) => {
    navigation.open(app.release ? `/napplet-permissions/${app.release.event.id}` : `/explore-details?key=${encodeURIComponent(app.key)}&permissions=1${actionFilter ? '&discovery=napps' : ''}`);
  }, [navigation, actionFilter]);
  const restingSearch = <View style={{ paddingHorizontal: SEARCH_BAR_SCREEN_GUTTER, paddingBottom: spacing.sm }}>
    <SearchBar value="" onChangeText={() => {}} placeholder={t('napplets.search_placeholder')}
      shortcutHint={SEARCH_ACTIVATION_SHORTCUT_LABEL} onPress={openSearch} />
  </View>;
  const stopEmptySearch = () => { if (searchActive && !searching) closeSearch(); };
  return (
    <AppScreen edges={[]}>
      <ScreenHeader
        back={false}
        left={<IconButton variant="plain" size={uiDensity.headerActionSize}
          icon={<RotateCcwClock size={uiDensity.headerActionIconSize} strokeWidth={iconStrokeWidth.default} color={c.text} />}
          accessibilityLabel={t('napplets.recent')} onPress={() => navigation.open('/explore-recent')} />}
        bordered={searching ? searchScrolled : scrolled}
        titleControl={<SegmentedControl compact value={tab}
          options={[{ value: 'my-apps', label: t('napplets.my_apps') }, { value: 'discover', label: t('napplets.discover') }]}
          onChange={value => { onTabChange(value); setScrolled(false); }} />}
        right={
          <QrScanButton variant="plain" size={uiDensity.headerActionSize} iconSize={uiDensity.headerActionIconSize}
            onScanned={data => {
              closeSearch();
              const value = data.trim();
              const address = parseApplicationAddressQuery(value);
              if (!address || address.type === 'invalid') { setScan(null); showError('napplets.invalid_manifest'); return; }
              setScan({ value });
            }}
          />
        }
      />
      <SearchTransition active={searchActive} contentActive={searching} focused={focused}
        onActivate={openSearch} onCancel={closeSearch}
        activeChrome={<View style={{ paddingTop: clearance, paddingHorizontal: SEARCH_BAR_SCREEN_GUTTER, paddingBottom: spacing.sm }}>
          <SearchBar value={query} onChangeText={changeQuery} placeholder={t('napplets.search_placeholder')}
            shortcutHint={SEARCH_ACTIVATION_SHORTCUT_LABEL} autoFocus />
        </View>}
        activeContent={<View style={{ flex: 1, paddingTop: clearance + SEARCH_HEIGHT }}>
          {account ? <ExploreDiscovery actionFilter={actionFilter} onClearAction={() => setActionFilter(undefined)} query={query} scope={tab} favorites={desktop} account={account}
            bottomInset={bottomInset} onScrollChange={setSearchScrolled} onDetails={showSearchDetails}
            onShare={share} onFavorite={toggleFavorite} onPermissions={showPermissions} /> : null}
        </View>}>
        <View style={{ flex: 1, paddingTop: clearance }}>
          {scanLoading || tab === 'my-apps' && (!state.loaded || state.account !== account) ? <View>
            {restingSearch}
            <DelayedActivityIndicator size="small" color={c.textMuted} style={{ padding: spacing.lg }} />
          </View> : account && tab === 'discover' ? <ExploreDiscovery actionFilter={actionFilter} onClearAction={() => setActionFilter(undefined)} scope={tab} favorites={desktop} account={account}
            header={restingSearch} headerHeight={SEARCH_HEIGHT} onScrollBeginDrag={stopEmptySearch}
            bottomInset={bottomInset} onScrollChange={setScrolled} onDetails={showSearchDetails}
            onShare={share} onFavorite={toggleFavorite} onPermissions={showPermissions} /> : desktop.length ? (
            <NappletGrid header={restingSearch} onScrollBeginDrag={stopEmptySearch}
              visibleCount={state.favoriteVisibleCount} loadingMore={state.favoritesLoadingMore} onLoadMore={loadMoreFavorites}
              onPermissions={showPermissions} onShare={share}
              onDetails={showFavoriteDetails}
              items={desktop} onOpen={open} onMove={action} bottomInset={bottomInset} onScrollChange={setScrolled} />
          ) : <ScrollView onScroll={event => setScrolled(event.nativeEvent.contentOffset.y > 0)} scrollEventThrottle={16}
            onScrollBeginDrag={stopEmptySearch} keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ flexGrow: 1, paddingBottom: bottomInset }}>
            {restingSearch}
            <Empty onDiscover={() => { onTabChange('discover'); setScrolled(false); }} />
          </ScrollView>}
        </View>
      </SearchTransition>
    </AppScreen>
  );
}
function Empty({ onDiscover }: { onDiscover: () => void }) {
  const c = useThemeColors();
  const { t } = useTranslation();
  return (
    <View
      style={{
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        padding: spacing.xl,
        gap: spacing.lg,
      }}
    >
      <Widget size={spacing['3xl']} color={c.textMuted} />
      <AppText variant="title" align="center">
        {t('napplets.empty_title')}
      </AppText>
      <AppText tone="muted" align="center">
        {t('napplets.empty_description')}
      </AppText>
      <View><AppButton fullWidth={false} label={t('napplets.discover')} onPress={onDiscover} /></View>
    </View>
  );
}
