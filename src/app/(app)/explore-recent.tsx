import { useMemo } from 'react';
import { router } from 'expo-router';
import { NappletRecentPage } from '@/components/napplet/NappletRecentPage';
import { exploreService } from '@/services/explore/service';
import { nappletService } from '@/services/napplet/service';
import { useExplore } from '@/stores/explore.store';
import { useExploreShare } from '@/hooks/use-explore-share';
import type { ExploreEntry } from '@/services/explore/model';
import { showToast } from '@/stores/toast.store';
import { useTranslation } from 'react-i18next';
export default function ExploreRecentScreen() {
  const state = useExplore();
  const share = useExploreShare(state.account);
  const { t } = useTranslation();
  const recent = useMemo(() => state.entries.filter(a => a.lastUsedAt !== null).sort((a, b) => b.lastUsedAt! - a.lastUsedAt!), [state.entries]);
  const failed = () => showToast(t('napplets.request_failed'));
  const open = (app: ExploreEntry) => {
    if (!state.account)
      return;
    if (app.release) {
      const runId = nappletService.prepareOpen(app.release, state.account);
      router.push({ pathname: '/napplet-run', params: { runId } });
    }
    else {
      const runId = exploreService.prepare(app, state.account);
      router.push({ pathname: '/explore-run', params: { runId } });
    }
  };
  return <NappletRecentPage recent={recent} loaded={state.loaded} onOpen={open} onShare={share} onAdd={app => { if (state.account)
    void exploreService.move(app, state.entries.filter(a => a.desktopPosition !== null).length, state.account).catch(failed); }} onRemove={app => { if (state.account)
    void exploreService.forget(app, state.account).catch(failed); }} onDetails={app => router.push(app.release ? `/napplet/${app.release.event.id}` : `/explore-details?key=${encodeURIComponent(app.key)}`)} onPermissions={app => router.push(app.release ? `/napplet-permissions/${app.release.event.id}` : `/explore-details?key=${encodeURIComponent(app.key)}&permissions=1`)}/>;
}
