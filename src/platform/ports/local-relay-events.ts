import type { Event } from 'nostr-tools';

export type LocalRelayEvent = { origin: string; event: Event };

/** Committed public additions shared between trusted host runtimes on this device. */
export interface LocalRelayEventsPort {
  publish(message: LocalRelayEvent): Promise<void>;
  subscribe(listener: (message: LocalRelayEvent) => void): () => void;
}
