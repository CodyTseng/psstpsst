import { createStore } from 'zustand/vanilla';

/**
 * Live per-message delivery status, keyed by rumor id.
 *
 * A sent message is published as **multiple** gift-wrapped copies — one per
 * recipient, plus one to the sender's own account (multi-device sync). Each copy
 * goes to that target's own relays and settles independently, so we track them
 * **per copy** (`recipient` + `self`), not as one merged relay list — two
 * recipients sharing a relay no longer collide, and a group send can show who
 * received it. The self copy is recorded too, but it's never *surfaced*: whether
 * the message reached the other party (the recipient copies) is all a user sees.
 *
 * Intentionally **session-scoped, in-memory only**: delivery is a "right now"
 * concern. The persisted `message_deliveries` row (and the DB `outbox` row for
 * retry bookkeeping) survive a restart; this store powers the live send UI.
 *
 * Owned by the **service layer**: the send pipeline (`dm.service`,
 * `proximity.service`) drives this vanilla store as its working state machine;
 * the React binding for components lives in `stores/delivery-status.store.ts`,
 * keeping the dependency direction UI → services, never the reverse.
 *
 * Lifecycle per rumor:
 *   begin → phase 'signing'  (resolving keys + signing gift wraps; no relays yet)
 *   startSending → phase 'sending', each copy's relays initialised as 'pending'
 *   markRelay(...) … live updates as each relay settles
 *   finish → phase 'sent' (recipient majority ok) | 'failed'
 */
export type RelayDeliveryStatus = 'pending' | 'ok' | 'failed';

export type RelayDelivery = {
  url: string;
  status: RelayDeliveryStatus;
  error?: string;
};

/** One gift-wrapped copy of a message and its per-relay outcome. */
export type DeliveryCopy = {
  /** Pubkey this copy was addressed to (a recipient, or our own for `self`). */
  recipient: string;
  /** The self/sync copy — recorded, but never surfaced as "delivered to the
   * other party". */
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
  /** Empty during 'signing', then one entry per copy (recipients + self). */
  copies: DeliveryCopy[];
};

/** Seed for a copy entering the sending phase. */
export type CopyInit = { recipient: string; self: boolean; urls: string[] };

export type DeliveryStatusState = {
  byId: Record<string, MessageDelivery>;
  begin: (rumorId: string) => void;
  startSending: (rumorId: string, copies: CopyInit[]) => void;
  markRelay: (
    rumorId: string,
    recipient: string,
    self: boolean,
    url: string,
    status: 'ok' | 'failed',
    error?: string,
  ) => void;
  finish: (rumorId: string, phase: 'sent' | 'failed') => void;
  setProximityPhase: (
    rumorId: string,
    phase: 'queued' | 'sending' | 'awaiting_ack' | 'sent' | 'failed',
  ) => void;
  /** Seed/replace the entry for a resend: keep the known copies, flip the
   * selected relays back to 'pending', and re-enter the 'sending' phase. */
  beginResend: (
    rumorId: string,
    copies: DeliveryCopy[],
    retryUrls: string[],
  ) => void;
};

export const deliveryStatusStore = createStore<DeliveryStatusState>()((set) => ({
  byId: {},
  begin: (rumorId) =>
    set((s) => ({
      byId: { ...s.byId, [rumorId]: { rumorId, phase: 'signing', copies: [] } },
    })),
  startSending: (rumorId, copies) =>
    set((s) => ({
      byId: {
        ...s.byId,
        [rumorId]: {
          rumorId,
          phase: 'sending',
          copies: copies.map((c) => ({
            recipient: c.recipient,
            self: c.self,
            relays: c.urls.map((url) => ({ url, status: 'pending' as const })),
          })),
        },
      },
    })),
  markRelay: (rumorId, recipient, self, url, status, error) =>
    set((s) => {
      const entry = s.byId[rumorId];
      if (!entry) return s;
      return {
        byId: {
          ...s.byId,
          [rumorId]: {
            ...entry,
            copies: entry.copies.map((cp) =>
              cp.recipient === recipient && cp.self === self
                ? {
                    ...cp,
                    relays: cp.relays.map((r) =>
                      r.url === url ? { ...r, status, error } : r,
                    ),
                  }
                : cp,
            ),
          },
        },
      };
    }),
  finish: (rumorId, phase) =>
    set((s) => {
      const entry = s.byId[rumorId];
      if (!entry) return s;
      return { byId: { ...s.byId, [rumorId]: { ...entry, phase } } };
    }),
  setProximityPhase: (rumorId, phase) =>
    set((s) => ({
      byId: {
        ...s.byId,
        [rumorId]: { rumorId, phase, transport: 'proximity', copies: [] },
      },
    })),
  beginResend: (rumorId, copies, retryUrls) =>
    set((s) => ({
      byId: {
        ...s.byId,
        [rumorId]: {
          rumorId,
          phase: 'sending',
          copies: copies.map((cp) => ({
            ...cp,
            relays: cp.relays.map((r) =>
              retryUrls.includes(r.url)
                ? { ...r, status: 'pending' as const, error: undefined }
                : r,
            ),
          })),
        },
      },
    })),
}));

/**
 * The copies whose delivery a user should see. Normally that's the **recipient
 * (non-self)** copies — "did the other party get it" — and the self/sync copy is
 * hidden. But a **note-to-self** has no other party: its only copy IS the self
 * copy, so fall back to showing it (otherwise the message would read as failed /
 * undelivered). Generic over the live (`DeliveryCopy`) and persisted
 * (`DeliveryCopyRecord`) shapes — both carry `self`. */
export function surfacedCopies<T extends { self: boolean }>(copies: T[]): T[] {
  const others = copies.filter((c) => !c.self);
  return others.length > 0 ? others : copies;
}

/** Relays of the surfaced copies — see {@link surfacedCopies}. */
export function surfacedRelays(d: MessageDelivery): RelayDelivery[] {
  return surfacedCopies(d.copies).flatMap((c) => c.relays);
}

/** succeeded / total recipient relay attempts for the headline `n/m`. */
export function deliveryCounts(d: MessageDelivery): { ok: number; total: number } {
  const relays = surfacedRelays(d);
  return {
    ok: relays.filter((r) => r.status === 'ok').length,
    total: relays.length,
  };
}
