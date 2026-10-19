import { platform } from '@/platform';
import { openApplicationWindow } from '@/services/explore/windows';
import { SegmentedControl } from '@/components/common/SegmentedControl';
import { ExploreDiscovery } from '@/components/napplet/ExploreDiscovery';
import { exploreService } from '@/services/explore/service';
import { useExplore } from '@/stores/explore.store';
import type { ExploreEntry } from '@/services/explore/model';
import { useExploreShare } from '@/hooks/use-explore-share';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { Widget } from '@solar-icons/react-native/category/settings/Linear/Widget';
import Plus from 'lucide-react-native/icons/plus';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getBottomChromeInset } from '@/lib/layout/bottom-chrome';
import { AppScreen } from '@/components/common/AppScreen';
import { AppButton } from '@/components/common/AppButton';
import { AppText } from '@/components/common/AppText';
import { IconButton } from '@/components/common/IconButton';
import { ScreenHeader, useScreenHeaderClearance } from '@/components/common/ScreenHeader';
import { NappletGrid } from '@/components/napplet/NappletGrid';
import { nappletService } from '@/services/napplet/service';
import { useActiveAccount } from '@/stores/active-account.store';
import { usePrimaryPaneNavigation } from '@/components/navigation/primary-pane-navigation';
import { iconStrokeWidth } from '@/theme/icons';
import { bottomBarHeight, spacing, uiDensity, useThemeColors } from '@/theme';

const TABS_HEIGHT = uiDensity.segmentedControlHeight + spacing.sm;

export default function NappletsScreen() {
  const account = useActiveAccount((s) => s.activePubkey);
  return <AccountNapplets key={account ?? 'signed-out'} account={account} />;
}
function AccountNapplets({ account }: { account: string | null }) {
  const c = useThemeColors();
  const { t } = useTranslation();
  const state = useExplore();
  const share = useExploreShare(account);
  const navigation = usePrimaryPaneNavigation();
  const desktop = useMemo(() => state.entries.filter(a=>a.desktopPosition!==null).sort((a,b)=>a.desktopPosition!-b.desktopPosition!), [state.entries]);
  const recent = useMemo(() => state.entries.filter(a=>a.lastUsedAt!==null).sort((a,b)=>b.lastUsedAt!-a.lastUsedAt!), [state.entries]);
  const [tab, setTab] = useState<'favorites'|'discover'>('favorites');
  const [scrolled, setScrolled] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const clearance = useScreenHeaderClearance(TABS_HEIGHT);
  const bottomInset = bottomBarHeight + getBottomChromeInset(useSafeAreaInsets().bottom);
  useEffect(() => {
    if (account)
      void exploreService.activate(account).catch(() => setError('napplets.request_failed'));
  }, [account]);
  const open = useCallback(
    (app: ExploreEntry) => {
      setError(null);
      try {
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
  const action = useCallback(
    (app: ExploreEntry, index: number | null) => {
      setError(null);
      return exploreService
        .move(app, index, account ?? '')
        .catch(() => setError('napplets.request_failed'));
    },
    [account],
  );
  return (
    <AppScreen edges={[]}>
      <ScreenHeader
        back={false}
        bordered={scrolled}
        title={t('napplets.title')}
        belowHeight={TABS_HEIGHT}
        below={
          <View style={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.sm }}>
            <SegmentedControl value={tab}
              options={[{ value: 'favorites', label: t('napplets.favorites') }, { value: 'discover', label: t('napplets.discover') }]}
              onChange={value => { setTab(value); setScrolled(false); }} />
          </View>
        }
        right={
          <IconButton variant="plain" size={uiDensity.headerActionSize}
            icon={<Plus strokeWidth={iconStrokeWidth.default} size={uiDensity.headerActionIconSize} color={c.text} />}
            accessibilityLabel={t('napplets.install_link')}
            onPress={() => navigation.open('/napplet-install')}
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
        ) : tab==='discover' && account ? <ExploreDiscovery account={account} bottomInset={bottomInset} onScrollChange={setScrolled}
          onDetails={app=>navigation.open(`/explore-details?key=${encodeURIComponent(app.key)}&catalog=1`)} /> : desktop.length || recent.length ? (
          <NappletGrid onPermissions={(app) => navigation.open(app.release?`/napplet-permissions/${app.release.event.id}`:`/explore-details?key=${encodeURIComponent(app.key)}&permissions=1`)} onShare={share}
    onDetails={(app) => navigation.open(`/explore-details?key=${encodeURIComponent(app.key)}`)}
            onRemoveRecent={(app) => { void exploreService.forget(app, account ?? '').catch(() => setError('napplets.request_failed')); }}
            onShowRecent={() => navigation.open('/explore-recent')} items={desktop} recent={recent} onOpen={open} onMove={action} bottomInset={bottomInset} onScrollChange={setScrolled} />
        ) : <Empty onAdd={() => navigation.open('/napplet-install')} />}
      </View>
    </AppScreen>
  );
}
function Empty({ onAdd }: { onAdd: () => void }) {
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
      <View><AppButton fullWidth={false} label={t('napplets.install_link')} onPress={onAdd} /></View>
    </View>
  );
}