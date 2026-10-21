import { useMemo } from 'react';
import { router } from 'expo-router';
import { NappletRecentPage } from '@/components/napplet/NappletRecentPage';
import { exploreService } from '@/services/explore/service';
import { useExplore } from '@/stores/explore.store';
import { useApplicationFavorite } from '@/hooks/use-application-favorite';
import { useExploreShare } from '@/hooks/use-explore-share';
import { showToast } from '@/stores/toast.store';
import { useTranslation } from 'react-i18next';
export default function ExploreRecentScreen() {
  const state = useExplore();
  const share = useExploreShare(state.account);
  const setFavorite = useApplicationFavorite(state.account, 'detail');
  const { t } = useTranslation();
  const recent = useMemo(() => state.entries.filter(a => a.lastUsedAt !== null).sort((a, b) => b.lastUsedAt! - a.lastUsedAt!), [state.entries]);
  const failed = () => showToast(t('napplets.request_failed'));
  return <NappletRecentPage recent={recent} loaded={state.loaded} onShare={share} onUnfavorite={app => { void setFavorite(app, false); }} onAdd={app => { void setFavorite(app, true); }} onRemove={app => { if (state.account)
    void exploreService.forget(app, state.account).catch(failed); }} onDetails={app => router.push(`/explore-details?key=${encodeURIComponent(app.key)}`)} onPermissions={app => router.push(app.release ? `/napplet-permissions/${app.release.event.id}` : `/explore-details?key=${encodeURIComponent(app.key)}&permissions=1`)}/>;
}
