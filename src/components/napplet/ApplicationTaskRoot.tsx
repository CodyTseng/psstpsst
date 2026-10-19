import 'react-native-get-random-values';
import '@/i18n';
import { useEffect, useRef } from 'react';
import { BackHandler, View } from 'react-native';
import { useStore } from 'zustand';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { applicationTasks, applicationTaskStore } from '@/services/explore/application-tasks';
import { applicationPresentation } from '@/services/explore/model';
import { useNapplets } from '@/stores/napplet.store';
import { NappletSurface } from '@/platform/napplet-surface';
import { SystemColorSchemeProvider } from '@/theme';
import { useLanguageDirection } from '@/i18n/direction';
import { ApplicationRuntimePage } from './ApplicationRuntimePage';
import { ApplicationTaskContext, useOwnsApplicationTaskOverlays } from './ApplicationTaskContext';
import { NappletOverlays } from './NappletOverlays';

/** A leaf React surface shares the host's account services without mounting another router. */
export function ApplicationTaskRoot({ taskId }: { taskId: string }) {
  return <ApplicationTaskContext.Provider value={taskId}>
    <SystemColorSchemeProvider><GestureHandlerRootView style={{ flex: 1 }}>
      <KeyboardProvider><SafeAreaProvider><ApplicationTaskContent id={taskId} /></SafeAreaProvider></KeyboardProvider>
    </GestureHandlerRootView></SystemColorSchemeProvider>
  </ApplicationTaskContext.Provider>;
}
function ApplicationTaskContent({ id }: { id: string }) {
  const state = useStore(applicationTaskStore, value => value.sessions.get(id));
  const foreground = useOwnsApplicationTaskOverlays();
  const { prompt, configuration, panel, overlayActive } = useNapplets();
  const obscured = !!prompt || !!configuration || !!panel || overlayActive;
  const direction = useLanguageDirection();
  const backPending = useRef(false);
  useEffect(() => {
    const timer = setTimeout(() => { void applicationTasks.start(id); }, 0);
    return () => clearTimeout(timer);
  }, [id]);
  useEffect(() => {
    if (!foreground || obscured) return;
    const listener = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!backPending.current) {
        backPending.current = true;
        void applicationTasks.back(id).catch(error => console.warn('[explore] Task back navigation failed', error))
          .finally(() => { backPending.current = false; });
      }
      return true;
    });
    return () => listener.remove();
  }, [foreground, obscured, id]);
  return <View style={{ flex: 1, direction }}>
    <ApplicationRuntimePage title={state?.entry.title} application={state ? applicationPresentation(state.entry) : undefined}
      loading={state?.loading} error={state?.error} menuEnabled={false}
      onClose={() => { void applicationTasks.close(id); }} onMore={() => {}}
      onRetry={() => { void applicationTasks.retry(id); }}>
      {state?.containerId ? <NappletSurface id={state.containerId} visible={foreground} obscured={obscured} /> : null}
    </ApplicationRuntimePage>
    <NappletOverlays />
  </View>;
}
