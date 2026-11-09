import { verifyEvent } from 'nostr-tools';

import { ManagedRelayPool } from '../relay/managed-relay-pool';

/** Pairing and account signers share transport, but own their subscriptions and credentials. */
export const nip46RelayPool = new ManagedRelayPool({ verifyEvent: event => verifyEvent(event) });
