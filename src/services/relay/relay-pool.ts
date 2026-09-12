import {
  getEventHash,
  verifyEvent as verifyNostrEvent,
  verifiedSymbol,
  type Event,
  type EventTemplate,
  type Filter,
} from 'nostr-tools';
import type { AbstractSimplePool } from 'nostr-tools/abstract-pool';

import { normalizeRelayUrl } from '@/lib/nostr/relay-url';
import { createPerfSpan } from '@/lib/perf/profiler';
import { verifyAcceleratedSchnorr } from '@/services/crypto/crypto-accelerator';

import type { Signer } from '../signer/signer.interface';
import { RelayQueryError } from './relay-query-error';
import {
  ManagedRelayPool,
  type QueryObservers,
  type ManagedSubscribeOptions,
  type QueryRelayResult,
  type QueryStatus,
  type SignAuth,
} from './managed-relay-pool';

export type PublishOutcome = { ok: true } | { ok: false; reason: string };

export type RelayPublishResult = { url: string; outcome: PublishOutcome };

export type PublishEventOpts = {
  relays: string[];
  event: Event;
  /** Identity signer used for NIP-42 auth-required responses. */
  signer?: Signer;
  /** Lower-level alternative to signer. Takes precedence when both are given. */
  signAuth?: SignAuth;
  timeoutMs?: number;
  abort?: AbortSignal;
  /** Streams each per-relay result for delivery progress UI. */
  onRelay?: (url: string, outcome: PublishOutcome) => void;
};

export type SubscribeOpts = ManagedSubscribeOptions;

export type QueryCompletion = {
  /** All relays settled and at least one completed via EOSE, CLOSED, or deadline. */
  eosed: boolean;
  status: QueryStatus;
  relays: QueryRelayResult[];
};

type QueryBase = QueryObservers & {
  /** Dev-only profiling label. Keep low-cardinality. */
  label?: string;
  relays: string[];
  timeoutMs?: number;
  /** Streams verified events so batched callers retain data received before EOSE. */
  onEvent?: (event: Event) => void;
  onReceived?: (relayUrl: string, id: string) => void;
  signAuth?: SignAuth;
  /** Cancels this bounded query without closing shared relay connections. */
  abort?: AbortSignal;
  /** Reports completion before returning events or throwing a network error. */
  onComplete?: (info: QueryCompletion) => void;
};

export type QueryOpts = QueryBase &
  ({ filter: Filter; filters?: never } | { filter?: never; filters: Filter[] });

class RelayPool {
  private readonly managed = new ManagedRelayPool({ verifyEvent: verifyEventNativeFirst });

  /** Compatibility adapter for nostr-tools' NIP-46 BunkerSigner. */
  get underlyingPool(): AbstractSimplePool {
    return this.managed.underlyingPool;
  }

  /** Register a durable subscription that survives relay reconnects. */
  subscribe(opts: SubscribeOpts): () => void {
    return this.managed.subscribe(opts);
  }

  hasHealthySubscription(label: string): boolean {
    return this.managed.hasHealthySubscription(label);
  }

  /** Wait for every relay to settle; reject if none reaches effective EOSE. */
  async query(opts: QueryOpts): Promise<Event[]> {
    const timeout = opts.timeoutMs ?? 6_000;
    const filters = opts.filters ?? (opts.filter ? [opts.filter] : []);
    const span = createPerfSpan('relay.query', {
      label: opts.label ?? 'unknown',
      relays: opts.relays.length,
      kinds: summarizeFilterKinds(filters),
      timeoutMs: timeout,
    });
    const startedAt = perfNow();
    const result = await this.managed.query({
      relays: opts.relays,
      filters,
      timeoutMs: timeout,
      onEvent: opts.onEvent,
      onReceived: opts.onReceived,
      onclose: opts.onclose,
      onerror: opts.onerror,
      oneosed: opts.oneosed,
      signAuth: opts.signAuth,
      abort: opts.abort,
    }, (subscription) => this.subscribe(subscription));
    const elapsed = perfNow() - startedAt;
    if (opts.abort?.aborted) {
      span?.end({ result: 'cancelled' });
      const error = new Error('Relay query was cancelled.');
      error.name = 'AbortError';
      throw error;
    }
    const receivedByRelay = new Map(
      result.relays.map((relay) => [relay.url, relay.received] as const),
    );
    const completion: QueryCompletion = {
      eosed: result.status === 'complete',
      status: result.status,
      relays: result.relays,
    };
    opts.onComplete?.(completion);
    span?.mark('wait', elapsed);
    span?.end({
      result: result.status,
      eosed: completion.eosed,
      events: result.events.length,
      received: sumMapValues(receivedByRelay),
      timeoutDelayMs: result.relays.some((relay) => relay.reason === 'query timed out')
        ? Math.max(0, elapsed - timeout).toFixed(1)
        : 0,
      relayReceipts: formatRelayCounts(receivedByRelay),
      relayOutcomes: result.relays.map((relay) => `${shortRelayUrl(relay.url)}:${relay.status}`).join(','),
    });
    if (result.status === 'failed') throw new RelayQueryError(result.relays);
    return result.events;
  }

  /** Publish one event to every target with precise per-relay outcomes. */
  async publishEvent(opts: PublishEventOpts): Promise<RelayPublishResult[]> {
    const urls = Array.from(new Set(opts.relays.map(normalizeRelayUrl)));
    const signAuth =
      opts.signAuth ??
      (opts.signer
        ? (authEvent: EventTemplate) => opts.signer!.signEvent(authEvent)
        : undefined);
    return Promise.all(
      urls.map(async (url): Promise<RelayPublishResult> => {
        const result = await this.managed.publishToRelay({
          url,
          event: opts.event,
          signAuth,
          timeoutMs: opts.timeoutMs,
          abort: opts.abort,
        });
        const outcome: PublishOutcome = result.ok
          ? { ok: true }
          : { ok: false, reason: result.reason };
        opts.onRelay?.(url, outcome);
        return { url, outcome };
      }),
    );
  }

  /** Tear down the authenticated account session, including durable demand. */
  destroy(): void {
    this.managed.destroy();
  }
}

function verifyEventNativeFirst(event: Event, _relayUrl: string): boolean {
  const cached = event[verifiedSymbol];
  if (typeof cached === 'boolean') return cached;

  // Verify every kind before relay deduplication admits its ID. Downstream
  // consumers, including gift wrap decryption, reuse the verifiedSymbol cache.
  try {
    const hash = getEventHash(event);
    if (hash !== event.id) {
      event[verifiedSymbol] = false;
      return false;
    }

    const acceleratedResult = verifyAcceleratedSchnorr(event.sig, hash, event.pubkey);
    if (acceleratedResult != null) {
      event[verifiedSymbol] = acceleratedResult;
      return acceleratedResult;
    }

    const fallback = verifyNostrEvent(event);
    event[verifiedSymbol] = fallback;
    return fallback;
  } catch {
    event[verifiedSymbol] = false;
    return false;
  }
}

function perfNow(): number {
  return globalThis.performance?.now?.() ?? Date.now();
}

/** Aggregates every filter's kinds into one low-cardinality span label. */
function summarizeFilterKinds(filters: Filter[]): string {
  const kinds = new Set<number>();
  for (const filter of filters) {
    for (const kind of filter.kinds ?? []) kinds.add(kind);
  }
  return kinds.size > 0 ? [...kinds].join(',') : 'any';
}

function sumMapValues(values: Map<string, number>): number {
  let total = 0;
  values.forEach((value) => {
    total += value;
  });
  return total;
}

function formatRelayCounts(values: Map<string, number>): string {
  if (values.size === 0) return 'none';
  return [...values.entries()]
    .map(([url, count]) => `${shortRelayUrl(url)}:${count}`)
    .join(',');
}

function shortRelayUrl(url: string): string {
  return url.replace(/^wss?:\/\//, '').replace(/\/$/, '');
}

export const relayPool = new RelayPool();
