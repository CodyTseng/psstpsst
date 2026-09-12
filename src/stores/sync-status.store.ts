import { useStore } from 'zustand';

import { syncPhaseOf, syncStatusStore } from '@/services/dm/sync-status';
import type { SyncPhase } from '@/services/dm/sync-status';

/**
 * React binding over the service-owned sync state
 * (`services/dm/sync-status.ts`) — `dmService` drives the vanilla store;
 * components subscribe through here.
 */
export type { SyncPhase } from '@/services/dm/sync-status';

/** Subscribe a component to the derived phase only (no re-render on raw flags). */
export function useSyncPhase(): SyncPhase {
  return useStore(syncStatusStore, (s) => syncPhaseOf(s.connected, s.backfilling));
}
