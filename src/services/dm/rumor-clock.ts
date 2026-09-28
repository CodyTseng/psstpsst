/**
 * Monotonic millisecond clock for outgoing rumors.
 *
 * Nostr `created_at` is second-resolution. PsstPsst adds an authenticated `ms` tag
 * containing the `0..999` millisecond component, with the smaller event id as
 * the final deterministic tie-breaker for legacy and non-PsstPsst messages.
 *
 * All outgoing paths share this counter. When several messages are authored in
 * one wall-clock millisecond, their logical milliseconds increment by one. The
 * Nostr second is derived from that logical value, so even an extreme burst that
 * crosses a second boundary remains internally consistent.
 *
 * In-memory only. After a restart the next value normally comes from the wall
 * clock. A restart inside the tiny logical lead created by a very large burst
 * can still collide, in which case the event id keeps the order deterministic.
 */
let lastMs = 0;

export type RumorTimestamp = {
  /** NIP-01 timestamp in seconds. */
  createdAt: number;
  /** Millisecond component carried by the rumor's `ms` tag (`0..999`). */
  millisecond: number;
  /** Full local ordering key derived from `createdAt` + `millisecond`. */
  orderAt: number;
};

export function nextRumorTimestamp(): RumorTimestamp {
  lastMs = Math.max(Date.now(), lastMs + 1);
  return {
    createdAt: Math.floor(lastMs / 1000),
    millisecond: lastMs % 1000,
    orderAt: lastMs,
  };
}

/** Rebuild the authenticated timestamp reserved by a durable pending send. */
export function rumorTimestampFromOrderAt(orderAt: number): RumorTimestamp {
  return {
    createdAt: Math.floor(orderAt / 1000),
    millisecond: orderAt % 1000,
    orderAt,
  };
}
