import { fromNapplet } from '@/services/explore/model';
import { useCallback, useEffect } from 'react';
import { router, useFocusEffect, useLocalSearchParams, useNavigation } from 'expo-router';
import { useIsFocused, usePreventRemove } from 'expo-router/react-navigation';
import { ForwardTargetScreen } from '@/components/share/ForwardTargetScreen';
import { isPrimaryPaneResetAction } from '@/components/navigation/responsive-stack-router';
import { useFocusedOverlayDismiss } from '@/components/common/use-focused-overlay-dismiss';
import { ApplicationRuntimePage } from '@/components/napplet/ApplicationRuntimePage';
import { NappletSurface } from '@/platform/napplet-surface';
import { nappletService } from '@/services/napplet/service';
import { useNapplets } from '@/stores/napplet.store';

export default function NappletRunScreen() {
  const { running, launching, launch, runId, prompt, configuration, panel, overlayActive, sharing, accountPubkey } = useNapplets();
  const params = useLocalSearchParams<{ runId?: string }>();
  const ownerRunId = params.runId === undefined ? runId : Number(params.runId);
  const ownsRun = ownerRunId === runId;
  const focused = useIsFocused();
  const navigation = useNavigation();
  const closeShare = useCallback(() => { if (accountPubkey && running) nappletService.closeShare(accountPubkey, running.containerId); }, [accountPubkey, running]);
  const close = useCallback(() => nappletService.stop(ownerRunId), [ownerRunId]);
  const backToApp = useCallback(() => {
    if (!running) { close(); return; }
    void nappletService.goBack().catch((error) => console.warn('[napplet] Back navigation failed', error));
  }, [running, close]);
  useFocusedOverlayDismiss(ownsRun && (!!running || launching || !!launch?.error) && !sharing && !prompt && !configuration && !panel && !overlayActive, backToApp);
  usePreventRemove(focused && ownsRun && !!running, ({ data }) => {
    // A primary-pane selection replaces the host page, not the app's history.
    if (isPrimaryPaneResetAction(data.action)) navigation.dispatch(data.action);
    else backToApp();
  });
  useFocusEffect(useCallback(() => () => nappletService.stop(ownerRunId), [ownerRunId]));
  useEffect(() => {
    if (!focused || !ownsRun || !launch?.pending) return;
    // Let the container commit before starting downloads, authorization or crypto.
    const timer = setTimeout(() => nappletService.startPreparedOpen(ownerRunId), 0);
    return () => clearTimeout(timer);
  }, [focused, ownsRun, launch?.pending, ownerRunId]);
  useEffect(() => {
    if (focused && ownsRun && !running && !launching && !panel && !launch?.error) router.back();
  }, [running, launching, launch?.error, panel, focused, ownsRun]);
  const release=running?.release??launch?.release??panel?.release;
  const updateRelease = running?.release;
  return <ApplicationRuntimePage containerId={ownsRun ? running?.containerId : undefined} active={focused} title={release?.title} application={release}
    update={ownsRun && updateRelease?.event && accountPubkey ? { entry: fromNapplet(updateRelease), account: accountPubkey,
      blocked: sharing || !!prompt || !!configuration || !!panel || overlayActive, restart: entry => entry.release ? nappletService.restartOpen(ownerRunId, entry.release) : undefined } : undefined}
    hidden={sharing} menuEnabled={!!running} onClose={close} onMore={()=>nappletService.openPanel('about')}
    loading={ownsRun&&launch?.showLoading&&!launch.error} error={ownsRun?launch?.error:undefined}
    download={ownsRun ? launch?.download : undefined}
    onRetry={()=>nappletService.retryOpen(ownerRunId)}
    overlay={sharing?<ForwardTargetScreen onClose={closeShare} stayInSource/>:null}>
    {ownsRun&&running?<NappletSurface id={running.containerId} visible={focused&&!sharing} obscured={!!prompt||!!configuration||!!panel||overlayActive}/>:null}
  </ApplicationRuntimePage>;
}
