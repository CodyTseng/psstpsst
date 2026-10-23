import { useLayoutEffect,useSyncExternalStore } from 'react';
import { overlayPresentation } from '@/services/presentation/overlays';

export function useOverlayPresentation(presented: boolean) {
  useLayoutEffect(()=>presented?overlayPresentation.register():undefined,[presented]);
}
export function useHasPresentedOverlay() {
  return useSyncExternalStore(overlayPresentation.subscribe,overlayPresentation.getSnapshot,overlayPresentation.getSnapshot);
}
