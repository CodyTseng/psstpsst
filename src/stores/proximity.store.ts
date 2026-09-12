import { useStore } from 'zustand';

import { proximitySessionStore } from '@/services/proximity/proximity-session';
import type { ProximitySessionState } from '@/services/proximity/proximity-session';

/**
 * React binding over the service-owned proximity session state
 * (`services/proximity/proximity-session.ts`) — `proximity.service` drives the
 * vanilla store; components subscribe through here. The binding keeps the full
 * store shape (selector hook + `getState`/`subscribe`) so call sites read like
 * a regular zustand store.
 */
export type {
  NearbyChatRequest,
  NearbyConnectionStatus,
  NearbyConnectionFailure,
  NearbyDeviceStatus,
  NearbyDiscovery,
  NearbyPeer,
} from '@/services/proximity/proximity-session';

export const useProximityStore = Object.assign(
  <T,>(selector: (state: ProximitySessionState) => T): T =>
    useStore(proximitySessionStore, selector),
  {
    getState: proximitySessionStore.getState,
    subscribe: proximitySessionStore.subscribe,
  },
);
