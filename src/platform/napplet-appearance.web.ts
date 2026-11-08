import { useSyncExternalStore } from 'react';
import { electronPageAppearance } from './electron/napplet-appearance';

export function useNappletAppearance(id?: string | null) {
  return useSyncExternalStore(electronPageAppearance.subscribe, () => id ? electronPageAppearance.get(id) : undefined);
}
