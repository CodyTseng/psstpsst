import { createStore } from 'zustand/vanilla';

/**
 * Coarse sync state for the active account's DM stream, surfaced in the Chats
 * title so the user can see what the app is doing:
 *   - `connecting`: relays haven't answered the live subscription yet.
 *   - `syncing`: connected, backfilling history in the background.
 *   - `idle`: connected and caught up — nothing to show.
 *
 * Driven by `dmService`: the managed relay pool reports whether at least one
 * physical incoming subscription is active, while backfill toggles the separate
 * `backfilling` flag. A full disconnect therefore returns to `connecting` and a
 * recovered subscription clears it without restarting the app.
 *
 * Owned by the **service layer**; the React binding for components lives in
 * `stores/sync-status.store.ts` (dependency direction: UI → services).
 */
export type SyncPhase = 'idle' | 'connecting' | 'syncing';

export type SyncStatusState = {
  connected: boolean;
  backfilling: boolean;
  setConnected: (connected: boolean) => void;
  setBackfilling: (backfilling: boolean) => void;
  /** Back to square one — on (re)init / account switch / teardown. */
  reset: () => void;
};

export const syncStatusStore = createStore<SyncStatusState>()((set) => ({
  connected: false,
  backfilling: false,
  setConnected: (connected) => set({ connected }),
  setBackfilling: (backfilling) => set({ backfilling }),
  reset: () => set({ connected: false, backfilling: false }),
}));

export function syncPhaseOf(connected: boolean, backfilling: boolean): SyncPhase {
  if (!connected) return 'connecting';
  if (backfilling) return 'syncing';
  return 'idle';
}
