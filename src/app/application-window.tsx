import { useEffect, useState } from 'react';
import { useIsFocused } from 'expo-router/react-navigation';
import { platform } from '@/platform';
import { useExplore } from '@/stores/explore.store';
import { useNapplets } from '@/stores/napplet.store';
import { exploreService } from '@/services/explore/service';
import { nappletService } from '@/services/napplet/service';
import { applicationPresentation, fromNapplet } from '@/services/explore/model';
import { ApplicationRuntimePage } from '@/components/napplet/ApplicationRuntimePage';
import { ExploreApplicationSheet } from '@/components/napplet/ExploreApplicationSheet';
import { NappletSurface } from '@/platform/napplet-surface';

export default function ApplicationWindowScreen() {
  const explore = useExplore(), napplet = useNapplets(), focused = useIsFocused();
  const [panel, setPanel] = useState<'about'|'settings'|null>(null);
  const release = napplet.running?.release ?? napplet.launch?.release;
  const app = release ?? explore.entry;
  const containerId = napplet.running?.containerId ?? explore.containerId;
  useEffect(() => {
    if (napplet.launch?.pending) { const timer = setTimeout(() => nappletService.startPreparedOpen(napplet.runId), 0); return () => clearTimeout(timer); }
    if (explore.entry && explore.loading && !explore.containerId) { const timer = setTimeout(() => { void exploreService.start(explore.runId); }, 0); return () => clearTimeout(timer); }
  }, [napplet.launch?.pending, napplet.runId, explore.entry, explore.loading, explore.containerId, explore.runId]);
  useEffect(() => {
    if (!app && !napplet.launching && !napplet.panel) void platform.napplet.windows?.close();
  }, [app, napplet.launching, napplet.panel]);
  const close = () => { exploreService.stop(); nappletService.stop(); void platform.napplet.windows?.close(); };
  return <ApplicationRuntimePage windowed active={focused} title={app?.title} application={app ? applicationPresentation(app) : undefined}
    update={app && explore.account ? { entry: release ? fromNapplet(release) : explore.entry!, account: explore.account,
      blocked: !!panel || !!napplet.prompt || !!napplet.configuration || !!napplet.panel || napplet.overlayActive,
      restart: entry => entry.release ? nappletService.restartOpen(napplet.runId, entry.release) : exploreService.restart(explore.runId, entry) } : undefined}
    loading={release ? napplet.launch?.showLoading : explore.loading} error={release ? napplet.launch?.error : explore.error}
    download={release ? napplet.launch?.download : explore.download}
    menuEnabled={!!containerId} onClose={close}
    onMore={() => { if (release) nappletService.openPanel('about'); else setPanel('about'); }}
    onRetry={() => { if (release) nappletService.retryOpen(napplet.runId); else exploreService.retry(explore.runId); }}
    overlay={explore.entry && explore.account ? <ExploreApplicationSheet entry={explore.entry} account={explore.account} runId={explore.runId} page={panel} onPageChange={setPanel} /> : undefined}>
    {containerId ? <NappletSurface id={containerId} visible={focused} obscured={!!napplet.prompt || !!napplet.configuration || !!napplet.panel || napplet.overlayActive} /> : null}
  </ApplicationRuntimePage>;
}
