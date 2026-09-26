import { createStore } from 'zustand/vanilla';

export type RelayDeliveryStatus = 'pending' | 'ok' | 'failed';

export type RelayDelivery = {
  url: string;
  status: RelayDeliveryStatus;
  error?: string;
};

export type DeliveryCopy = {
  recipient: string;
  self: boolean;
  relays: RelayDelivery[];
};

export type DeliveryPhase =
  | 'signing'
  | 'queued'
  | 'sending'
  | 'awaiting_ack'
  | 'sent'
  | 'failed';

export type MessageDelivery = {
  rumorId: string;
  phase: DeliveryPhase;
  transport?: 'relay' | 'proximity';
  error?: string;
  copies: DeliveryCopy[];
};

type DeliveryStatusState = {
  /** Nearby transfer phases are session-only. Relay delivery lives in SQLite. */
  byId: Record<string, MessageDelivery>;
  setProximityPhase: (
    rumorId: string,
    phase: 'queued' | 'sending' | 'awaiting_ack' | 'sent' | 'failed',
  ) => void;
};

export const deliveryStatusStore = createStore<DeliveryStatusState>()((set) => ({
  byId: {},
  setProximityPhase: (rumorId, phase) =>
    set((state) => ({
      byId: {
        ...state.byId,
        [rumorId]: { rumorId, phase, transport: 'proximity', copies: [] },
      },
    })),
}));

/**
 * Hide self/sync copies from ordinary delivery detail. A note-to-self has no
 * recipient copy, so its self copy remains the visible fallback.
 */
export function surfacedCopies<T extends { self: boolean }>(copies: T[]): T[] {
  const recipients = copies.filter((copy) => !copy.self);
  return recipients.length > 0 ? recipients : copies;
}

export function surfacedRelays(delivery: MessageDelivery): RelayDelivery[] {
  return surfacedCopies(delivery.copies).flatMap((copy) => copy.relays);
}

/**
 * Failed relay URLs remain retryable even after the message-level majority has
 * reached `sent`. Pending work suppresses another retry until it settles.
 */
export function retryableRelayUrls(delivery: MessageDelivery): string[] | null {
  if (delivery.phase !== 'sent' && delivery.phase !== 'failed') return null;
  const recipientCopies = delivery.copies.filter((copy) => !copy.self);
  const relays = recipientCopies.flatMap((copy) => copy.relays);
  if (relays.some((relay) => relay.status === 'pending')) return null;
  const failed = Array.from(
    new Set(
      relays
        .filter((relay) => relay.status === 'failed')
        .map((relay) => relay.url),
    ),
  );
  if (failed.length > 0) return failed;
  if (delivery.copies.length > 0) return null;
  return delivery.phase === 'failed' ? [] : null;
}

export function deliveryCounts(delivery: MessageDelivery): { ok: number; total: number } {
  const relays = surfacedRelays(delivery);
  return {
    ok: relays.filter((relay) => relay.status === 'ok').length,
    total: relays.length,
  };
}

/** At least one acknowledgement and at least half of all surfaced targets. */
export function relayDeliveryVerdict(okCount: number, total: number): 'sent' | 'failed' {
  return okCount > 0 && okCount * 2 >= total ? 'sent' : 'failed';
}

/** Start selected targets while preserving acknowledgements as terminal. */
export function beginRelayTargets(
  previous: RelayDelivery[],
  targetUrls: string[],
): RelayDelivery[] {
  const byUrl = new Map(previous.map((relay) => [relay.url, relay]));
  for (const url of targetUrls) {
    if (byUrl.get(url)?.status !== 'ok') byUrl.set(url, { url, status: 'pending' });
  }
  return Array.from(byUrl.values());
}

/** Settle from the relay protocol's boolean OK field; an OK never regresses. */
export function settleRelayTarget(
  previous: RelayDelivery[],
  url: string,
  ok: boolean,
  error?: string,
): RelayDelivery[] {
  let found = false;
  const next = previous.map((relay): RelayDelivery => {
    if (relay.url !== url) return relay;
    found = true;
    if (relay.status === 'ok') return relay;
    return ok ? { url, status: 'ok' } : { url, status: 'failed', error };
  });
  if (!found) next.push(ok ? { url, status: 'ok' } : { url, status: 'failed', error });
  return next;
}
