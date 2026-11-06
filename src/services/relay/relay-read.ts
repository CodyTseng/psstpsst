import type { QueryRelayResult } from './managed-relay-pool';

export const DEFAULT_EOSE_TIMEOUT_MS = 25_000;

/** A deadline ends the initial read, just like nostr-tools' fallback EOSE.
 * Keep closure, connection, and authentication failures distinct from completion. */
export function isEffectiveEose(result: QueryRelayResult): boolean {
  return result.status === 'eose' &&
    (result.reason == null || result.reason === 'query timed out');
}
