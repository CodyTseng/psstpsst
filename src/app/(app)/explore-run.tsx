import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams, useNavigation } from 'expo-router';
import { useIsFocused, usePreventRemove } from 'expo-router/react-navigation';
import { useFocusedOverlayDismiss } from '@/components/common/use-focused-overlay-dismiss';
import { isPrimaryPaneResetAction } from '@/components/navigation/responsive-stack-router';
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
  const navigation = useNavigation();
  const { runId } = useLocalSearchParams<{
    runId: string;
  }>();
  const id = Number(runId);
  const { prompt, configuration, overlayActive } = useNapplets();
  const owns = state.runId === id;
  const back = useCallback(() => { void exploreService.goBack(id).catch(error => console.warn('[explore] Back navigation failed', error)); }, [id]);
  useFocusedOverlayDismiss(owns && !!state.containerId && !panel && !prompt && !configuration && !overlayActive, back);
  usePreventRemove(focused && owns && !!state.containerId, ({ data }) => {
    if (isPrimaryPaneResetAction(data.action)) navigation.dispatch(data.action);
    else back();
  });
  useFocusEffect(useCallback(() => () => exploreService.stop(id), [id]));
  useEffect(() => { if (owns && focused && state.loading && !state.containerId) {
    const timer = setTimeout(() => { void exploreService.start(id); }, 0);
    return () => clearTimeout(timer);
  } }, [id, owns, focused, state.loading, state.containerId]);
  useEffect(() => { if (owns && focused && !state.entry)
    router.back(); }, [owns, focused, state.entry]);
  return <ApplicationRuntimePage title={state.entry?.title}
    application={state.entry?applicationPresentation(state.entry):undefined}
    menuEnabled={!!state.containerId&&owns} onClose={()=>exploreService.close(id)} onMore={()=>setPanel('about')}
    loading={owns&&state.loading} error={owns?state.error:undefined} onRetry={()=>exploreService.retry(id)}
    overlay={owns&&state.entry&&state.account?<ExploreApplicationSheet key={`${id}:${state.entry.key}`} entry={state.entry} account={state.account} runId={id} page={panel} onPageChange={setPanel}/>:null}>
    {owns ? state.surfaces.map(surfaceId => <View key={surfaceId} style={[StyleSheet.absoluteFill, { opacity: surfaceId === state.containerId ? 1 : 0 }]}
      pointerEvents={surfaceId === state.containerId ? 'auto' : 'none'}>
      <NappletSurface id={surfaceId} visible={focused && surfaceId === state.containerId} obscured={!!prompt||overlayActive}/>
    </View>) : null}
  </ApplicationRuntimePage>;
}
