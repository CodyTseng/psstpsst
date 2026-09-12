/**
 * Port for the app's foreground/background lifecycle — used by the
 * notification service (post only while backgrounded) and the managed relay
 * pool (recover connections on re-activation).
 *
 * Both members stay synchronous by exception: `currentState` is a cached
 * in-memory OS read, not I/O, and `addChangeListener` is a subscription
 * registration (see the note in `network-state.ts`).
 */

/** Mirrors React Native's `AppStateStatus`. */
export type AppStateStatus = 'active' | 'background' | 'inactive' | 'unknown' | 'extension';

export interface AppStatePort {
  /** The current lifecycle state. */
  currentState(): AppStateStatus;
  /** Subscribe to lifecycle changes. */
  addChangeListener(listener: (state: AppStateStatus) => void): () => void;
}
