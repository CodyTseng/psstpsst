import type { QueryRelayResult } from './managed-relay-pool';

/** A failed network lookup must not be cached as a confirmed empty result. */
export class RelayQueryError extends Error {
  constructor(readonly relayResults: QueryRelayResult[]) {
    super('No relay completed the query. Check the network connection.');
    this.name = 'RelayQueryError';
  }
}
