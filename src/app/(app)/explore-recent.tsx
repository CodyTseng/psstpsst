import { tryOpenApplicationWindow } from '@/services/explore/windows';
import { exploreService } from '@/services/explore/service';
import { useCallback, useMemo } from 'react';
import { router } from 'expo-router';
import { ApplicationRecentPage } from '@/components/napplet/ApplicationRecentPage';
import { useExploreHistory } from '@/hooks/use-explore-history';
import { useActiveAccount } from '@/stores/active-account.store';
import { cacheApplicationAddress } from '@/services/explore/discovery';
import { useExplore } from '@/stores/explore.store';
import { useApplicationFavorite } from '@/hooks/use-application-favorite';
import { useExploreShare } from '@/hooks/use-explore-share';
import { showToast } from '@/stores/toast.store';
import { useTranslation } from 'react-i18next';
import type { ExploreEntry } from '@/services/explore/model';
export default function ExploreRecentScreen() {
  const state = useExplore();
  const account = useActiveAccount(state => state.activePubkey);
  const history = useExploreHistory(account);
  const removeHistory = history.remove;
  const share = useExploreShare(account);
  const setFavorite = useApplicationFavorite(account, 'detail');
  const { t } = useTranslation();
  const positions = useMemo(() => new Map((state.account === account ? state.entries : [])
    .map(app => [app.key, app.desktopPosition])), [state.entries, state.account, account]);
  const add = useCallback((app: ExploreEntry) => { void setFavorite(app, true); }, [setFavorite]);
  const unfavorite = useCallback((app: ExploreEntry) => { void setFavorite(app, false); }, [setFavorite]);
  const remove = useCallback((app: ExploreEntry) => {
    void removeHistory(app).catch(() => showToast(t('applications.request_failed'), { variant: 'error' }));
  }, [removeHistory, t]);
  const details = useCallback((app: ExploreEntry) => {
    if (account) cacheApplicationAddress(account, app);
    router.push(`/explore-details?key=${encodeURIComponent(app.key)}&catalog=1`);
  }, [account]);
  const openWebsite = useCallback((app: ExploreEntry) => {
    if (!account) return;
    void (async () => {
      if (await tryOpenApplicationWindow(app, account)) return;
      const runId = exploreService.prepare(app, account);
      router.push(`/explore-run?runId=${runId}`);
    })().catch(() => showToast(t('applications.request_failed'), { variant: 'error' }));
  }, [account, t]);
  const permissions = useCallback((app: ExploreEntry) => {
    if (account) cacheApplicationAddress(account, app);
    router.push(app.release ? `/napplet-permissions/${app.release.event.id}` : `/explore-details?key=${encodeURIComponent(app.key)}&catalog=1&permissions=1`);
  }, [account]);
  return <ApplicationRecentPage recent={history.entries} favoritePositions={positions} loaded={history.loaded} error={history.error} loadingMore={history.loaded && history.loading}
    onLoadMore={history.loadMore} onShare={share} onUnfavorite={unfavorite} onAdd={add}
    onRemove={remove} onOpenWebsite={openWebsite} onDetails={details} onPermissions={permissions} />;
}
