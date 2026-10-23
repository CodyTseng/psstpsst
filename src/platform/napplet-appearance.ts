import { useSyncExternalStore } from 'react';
import { nativeSurface } from './expo/napplet';

export function useNappletAppearance(id?: string | null) {
  return useSyncExternalStore(nativeSurface.subscribe, () => id ? nativeSurface.get(id)?.appearance : undefined);
}
