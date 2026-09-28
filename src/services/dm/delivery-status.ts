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
  error?: string;
};

export type DeliveryPhase =
  | 'signing'
  | 'queued'
  | 'sending'
  | 'awaiting_ack'
  | 'sent'
  | 'partial'
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

export function surfacedCopies<T extends { self: boolean }>(copies: T[]): T[] {
  return copies;
}

export function surfacedRelays(delivery: MessageDelivery): RelayDelivery[] {
  return surfacedCopies(delivery.copies).flatMap((copy) => copy.relays);
}

/**
 * Failed relay URLs remain retryable even after the message-level majority has
 * reached `sent`. Pending work suppresses another retry until it settles.
 */
export function retryableRelayUrls(delivery: MessageDelivery): string[] | null {
  const retryable = delivery.copies.flatMap((copy) => retryableCopyRelayUrls(copy) ?? []);
  return retryable.length ? [...new Set(retryable)] : null;
}

export function retryableCopyRelayUrls(copy: DeliveryCopy): string[] | null {
  if (copy.relays.some((relay) => relay.status === 'pending')) return null;
  const failed = copy.relays
    .filter((relay) => relay.status === 'failed')
    .map((relay) => relay.url);
  if (failed.length > 0) return [...new Set(failed)];
  return copy.error ? [] : null;
}

export function deliveryCounts(delivery: MessageDelivery): { ok: number; total: number } {
  return {
    ok: delivery.copies.filter((copy) => deliveryCopyVerdict(copy) === 'delivered').length,
    total: delivery.copies.length,
  };
}

/** At least one acknowledgement and at least half of all surfaced targets. */
export function relayDeliveryVerdict(okCount: number, total: number): 'sent' | 'failed' {
  return okCount > 0 && okCount * 2 >= total ? 'sent' : 'failed';
}

export function deliveryCopyVerdict(
  copy: Pick<DeliveryCopy, 'relays' | 'error'>,
): 'delivered' | 'pending' | 'failed' {
  const ok = copy.relays.filter((relay) => relay.status === 'ok').length;
  if (relayDeliveryVerdict(ok, copy.relays.length) === 'sent') return 'delivered';
  if (copy.relays.some((relay) => relay.status === 'pending')) return 'pending';
  return 'failed';
}

export function messageDeliveryVerdict(
  copies: readonly Pick<DeliveryCopy, 'relays' | 'error'>[],
  hasUnfinishedJob: boolean,
): 'queued' | 'sent' | 'partial' | 'failed' {
  if (copies.length === 0) return hasUnfinishedJob ? 'queued' : 'failed';
  const verdicts = copies.map(deliveryCopyVerdict);
  if (verdicts.includes('pending')) return 'queued';
  const delivered = verdicts.filter((verdict) => verdict === 'delivered').length;
  if (delivered === verdicts.length) return 'sent';
  if (delivered > 0) return 'partial';
  return hasUnfinishedJob ? 'queued' : 'failed';
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
