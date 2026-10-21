import { platform } from '@/platform';
import { openApplicationWindow } from '@/services/explore/windows';
import { SegmentedControl } from '@/components/common/SegmentedControl';
import { ExploreDiscovery } from '@/components/napplet/ExploreDiscovery';
import { exploreService } from '@/services/explore/service';
import { useExplore } from '@/stores/explore.store';
import type { ExploreEntry } from '@/services/explore/model';
import { needsFavoriteMetadata } from '@/services/explore/favorite-metadata';
import { useApplicationFavorite } from '@/hooks/use-application-favorite';
import { useExploreShare } from '@/hooks/use-explore-share';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import RotateCcwClock from 'lucide-react-native/icons/rotate-ccw-clock';
import { iconStrokeWidth } from '@/theme/icons';
import { Widget } from '@solar-icons/react-native/category/settings/Linear/Widget';
import { useLocalSearchParams } from 'expo-router';
import { useExploreSearchHandoffStore } from '@/stores/explore-search-handoff.store';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getBottomChromeInset } from '@/lib/layout/bottom-chrome';
import { AppScreen } from '@/components/common/AppScreen';
import { AppButton } from '@/components/common/AppButton';
import { AppText } from '@/components/common/AppText';
import { SearchBar, SEARCH_BAR_SCREEN_GUTTER } from '@/components/search/SearchBar';
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
type ExploreMode = 'favorites' | 'discover';

export default function NappletsScreen() {
  const account = useActiveAccount((s) => s.activePubkey);
  const [mode, setMode] = useState<{ account: string | null; value: ExploreMode }>({ account, value: 'favorites' });
  const { searchHandoff } = useLocalSearchParams<{ searchHandoff?: string }>();
  const pending = useExploreSearchHandoffStore(state => state.pending);
  const id = typeof searchHandoff === 'string' ? Number(searchHandoff) : NaN;
  const input = pending?.id === id && pending.account === account ? pending.value : undefined;
  useEffect(() => {
    if (input !== undefined && account) useExploreSearchHandoffStore.getState().consume(id, account);
  }, [input, account, id]);
  return <AccountNapplets key={`${account ?? 'signed-out'}:${searchHandoff ?? ''}`} account={account} initialAddress={input}
    tab={mode.account === account ? mode.value : 'favorites'} onTabChange={value => setMode({ account, value })} />;
}
function AccountNapplets({ account, initialAddress, tab, onTabChange }: { account: string | null; initialAddress?: string; tab: ExploreMode; onTabChange(value: ExploreMode): void }) {
  const c = useThemeColors();
  const { t } = useTranslation();
  const state = useExplore();
  const share = useExploreShare(account);
  const setFavorite = useApplicationFavorite(account, 'primary');
  const navigation = usePrimaryPaneNavigation();
  const desktop = useMemo(() => state.entries.filter(a=>a.desktopPosition!==null).sort((a,b)=>a.desktopPosition!-b.desktopPosition!), [state.entries]);
  const [query, setQuery] = useState(initialAddress ?? '');
  const [scanRevision, setScanRevision] = useState(0);
  const [scrolled, setScrolled] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const changeQuery = useCallback((value: string) => { setQuery(value); setScrolled(false); }, []);
  const clearance = useScreenHeaderClearance(SEARCH_HEIGHT);
  const bottomInset = bottomBarHeight + getBottomChromeInset(useSafeAreaInsets().bottom);
  useEffect(() => {
    if (account)
      void exploreService.activate(account).catch(() => setError('napplets.request_failed'));
  }, [account]);
  const open = useCallback(
    async (app: ExploreEntry) => {
      setError(null);
      try {
        if (needsFavoriteMetadata(app)) app = await exploreService.resolveFavorite(app, account ?? '');
        if (platform.napplet.windows || platform.napplet.tasks) {
          void openApplicationWindow(app, account ?? '').catch(() => setError('napplets.request_failed'));
          return;
        }
        if(app.release) {
          const runId=nappletService.prepareOpen(app.release,account??'');
          navigation.open(`/napplet-run?runId=${runId}`);
        } else {
          const runId=exploreService.prepare(app,account??'');navigation.open(`/explore-run?runId=${runId}`);
        }
      } catch {
        setError('napplets.request_failed');
      }
    },
    [account, navigation],
  );
  const showSearchDetails = useCallback((app: ExploreEntry) => {
    navigation.open(`/explore-details?key=${encodeURIComponent(app.key)}&catalog=1`);
  }, [navigation]);
  const action = useCallback(
    (app: ExploreEntry, index: number | null) => {
      setError(null);
      if (index === null) return setFavorite(app, false);
      return exploreService
        .move(app, index, account ?? '')
        .catch(() => setError('napplets.request_failed'));
    },
    [account, setFavorite],
  );
  const toggleFavorite = useCallback((app: ExploreEntry) => {
    void setFavorite(app, !desktop.some(item => item.key === app.key));
  }, [setFavorite, desktop]);
  const showPermissions = useCallback((app: ExploreEntry) => {
    navigation.open(app.release ? `/napplet-permissions/${app.release.event.id}` : `/explore-details?key=${encodeURIComponent(app.key)}&permissions=1`);
  }, [navigation]);
  return (
    <AppScreen edges={[]}>
      <ScreenHeader
        back={false}
        left={<IconButton variant="plain" size={uiDensity.headerActionSize}
          icon={<RotateCcwClock size={uiDensity.headerActionIconSize} strokeWidth={iconStrokeWidth.default} color={c.text} />}
          accessibilityLabel={t('napplets.recent')} onPress={() => navigation.open('/explore-recent')} />}
        bordered={scrolled}
        titleControl={<SegmentedControl compact value={tab}
          options={[{ value: 'favorites', label: t('napplets.favorites') }, { value: 'discover', label: t('napplets.discover') }]}
          onChange={value => { onTabChange(value); setScrolled(false); setError(null); }} />}
        belowHeight={SEARCH_HEIGHT}
        below={
          <View style={{ paddingHorizontal: SEARCH_BAR_SCREEN_GUTTER, paddingBottom: spacing.sm }}>
            <SearchBar value={query} onChangeText={changeQuery} placeholder={t('napplets.search_placeholder')} />
          </View>
        }
        right={
          <QrScanButton variant="plain" size={uiDensity.headerActionSize} iconSize={uiDensity.headerActionIconSize}
            onScanned={data => {
              const value = data.trim();
              const address = parseApplicationAddressQuery(value);
              if (!address || address.type === 'invalid') { setError('napplets.invalid_manifest'); return; }
              setError(null);
              setQuery(value);
              setScanRevision(revision => revision + 1);
              setScrolled(false);
            }}
          />
        }
      />
      <View style={{ flex: 1, paddingTop: clearance }}>
        {error ? (
          <AppText align="center" style={{ color: c.danger, padding: spacing.md }}>
            {t(error.startsWith('napplets.') ? error : 'napplets.request_failed')}
          </AppText>
        ) : null}
        {!state.loaded || state.account !== account ? (
          <ActivityIndicator color={c.accent} style={{ padding: spacing.lg }} />
        ) : account && (tab==='discover' || query.trim()) ? <ExploreDiscovery key={scanRevision} query={query} scope={tab} favorites={desktop} account={account} bottomInset={bottomInset} onScrollChange={setScrolled}
          onDetails={showSearchDetails} onShare={share}
          onFavorite={toggleFavorite} onPermissions={showPermissions} /> : desktop.length ? (
          <NappletGrid onPermissions={(app) => navigation.open(app.release?`/napplet-permissions/${app.release.event.id}`:`/explore-details?key=${encodeURIComponent(app.key)}&permissions=1`)} onShare={share}
    onDetails={(app) => navigation.open(`/explore-details?key=${encodeURIComponent(app.key)}`)}
            items={desktop} onOpen={open} onMove={action} bottomInset={bottomInset} onScrollChange={setScrolled} />
        ) : <Empty onDiscover={() => { setError(null); onTabChange('discover'); setScrolled(false); }} />}
      </View>
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