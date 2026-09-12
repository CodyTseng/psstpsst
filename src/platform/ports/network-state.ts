/**
 * Port for the OS network-reachability hint — used by the managed relay pool
 * (`services/relay/managed-relay-pool.ts`) to suspend connections while
 * offline and wake them on return. It is only a hint: the socket remains the
 * source of truth, so an adapter that cannot determine reachability leaves
 * the fields undefined and the pool stays optimistic.
 *
 * `getState` is async-first — see the module note in `secure-storage.ts`.
 * `addStateListener` is a subscription registration, so it stays synchronous
 * like the other ports' listener registrations.
 */
export type NetworkStateSnapshot = {
  /** OS-reported connection type (`wifi`, `cellular`, …), when known. */
  type?: string;
  /** False means definitely not connected; undefined means unknown. */
  isConnected?: boolean;
  /** False means definitely no internet route; undefined means unknown. */
  isInternetReachable?: boolean;
};

export interface NetworkStatePort {
  /** Current snapshot. Rejects when the OS hint is unavailable. */
  getState(): Promise<NetworkStateSnapshot>;
  /** Subscribe to snapshot changes. */
  addStateListener(listener: (state: NetworkStateSnapshot) => void): void;
}
