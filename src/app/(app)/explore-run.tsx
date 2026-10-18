import { openApplicationWindowForKey } from '@/services/explore/windows';
import { showToast } from '@/stores/toast.store';
import { useTranslation } from 'react-i18next';
import { useEffect, useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { useIsFocused } from 'expo-router/react-navigation';
import { NappletSurface } from '@/platform/napplet-surface';
import { exploreService } from '@/services/explore/service';
import { useExplore } from '@/stores/explore.store';
import { useNapplets } from '@/stores/napplet.store';
import { ApplicationRuntimePage } from '@/components/napplet/ApplicationRuntimePage';
import { applicationPresentation } from '@/services/explore/model';
import { ExploreApplicationSheet } from '@/components/napplet/ExploreApplicationSheet';
export default function ExploreRunScreen() {
  const [panel, setPanel] = useState<'about'|'settings'|null>(null);
  const state = useExplore();
  const focused = useIsFocused();
  const { runId } = useLocalSearchParams<{
    runId: string;
  }>();
  const id = Number(runId);
  const { prompt, overlayActive } = useNapplets();
  const owns = state.runId === id;
  useEffect(() => () => exploreService.stop(id), [id]);
  useEffect(() => { if (owns && focused && state.loading && !state.containerId) {
    const timer = setTimeout(() => { void exploreService.start(id); }, 0);
    return () => clearTimeout(timer);
  } }, [id, owns, focused, state.loading, state.containerId]);
  useEffect(() => { if (owns && focused && !state.entry)
    router.back(); }, [owns, focused, state.entry]);
  const { t } = useTranslation();
  const openWindow = () => { const key = state.entry?.key; if (key) void openApplicationWindowForKey(key).catch(() => showToast(t('napplets.request_failed'))); };
  return <ApplicationRuntimePage onOpenWindow={openWindow} title={state.entry?.title}
    application={state.entry?applicationPresentation(state.entry):undefined}
    menuEnabled={!!state.containerId&&owns} onClose={()=>exploreService.stop(id)} onMore={()=>setPanel('about')}
    loading={owns&&state.loading} error={owns?state.error:undefined} onRetry={()=>exploreService.retry(id)}
    overlay={owns&&state.entry&&state.account?<ExploreApplicationSheet key={`${id}:${state.entry.key}`} entry={state.entry} account={state.account} runId={id} page={panel} onPageChange={setPanel}/>:null}>
    {owns&&state.containerId?<NappletSurface id={state.containerId} visible={focused} obscured={!!prompt||overlayActive}/>:null}
  </ApplicationRuntimePage>;
}
