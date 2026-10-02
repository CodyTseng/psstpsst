import { useCallback, useEffect, useRef, useState } from 'react';

import { dmService } from '@/services/dm/dm.service';
import { onPeerEncryptionKeyChanged } from '@/services/dm/peer-encryption-key.service';

export type DmSupportStatus = 'local' | 'checking' | 'ready' | 'unsupported';

export type DmSupport = {
  status: DmSupportStatus;
  /** Once checked: no authenticated encryption key is known for the peer. */
  missingEncryptionKey: boolean;
  /** Once checked: the peer published no DM inbox relay (kind 10050). */
  missingRelays: boolean;
  /** Re-run the check, bypassing caches (re-queries relays). */
  recheck: () => void;
};

type DmSupportState = Omit<DmSupport, 'recheck'>;

const LOCAL: DmSupportState = {
  status: 'local',
  missingEncryptionKey: false,
  missingRelays: false,
};

const CHECKING: DmSupportState = { ...LOCAL, status: 'checking' };

/** A cached verdict this fresh is trusted as-is — no background revalidation on
 * open (the peer's key/relays change rarely, and an open chat still picks up
 * authenticated key evidence and relay updates). */
const DM_SUPPORT_TTL_MS = 60 * 60 * 1000;

/**
 * Fold the per-peer cached verdicts into a `DmSupportState` plus
 * whether the whole set is still `fresh` (every member checked within the TTL).
 * `null` if any counterparty hasn't been checked yet (→ we can't answer without
 * a relay round-trip). A group is supported
 * only if *every* member is, and only as fresh as its **oldest** check.
 */
async function readCache(
  accountPubkey: string,
  counterparties: string[],
): Promise<{ state: DmSupportState; fresh: boolean } | null> {
  if (counterparties.length === 0) return null;
  const verdicts = await Promise.all(
    counterparties.map((p) => dmService.getCachedDmSupport(accountPubkey, p)),
  );
  if (verdicts.some((v) => v == null)) return null;
  const known = verdicts as { encryptionKey: boolean; relays: boolean; at: number }[];
  const missingEncryptionKey = known.some((v) => !v.encryptionKey);
  const missingRelays = known.some((v) => !v.relays);
  const oldest = Math.min(...known.map((v) => v.at));
  return {
    state: {
      status: missingEncryptionKey || missingRelays ? 'unsupported' : 'ready',
      missingEncryptionKey,
      missingRelays,
    },
    fresh: Date.now() - oldest < DM_SUPPORT_TTL_MS,
  };
}

/**
 * Resolve whether every counterparty of a conversation can receive our DMs
 * (encryption key + DM relays published). A 1:1 chat has a single counterparty;
 * a group is reachable only if *all* members are.
 *
 * A row checked within
 * {@link DM_SUPPORT_TTL_MS} (1 h) is trusted as-is — no relay round-trip on open.
 * An **unreachable** peer has no row, so it's re-checked on **every** open
 * (`local` → `checking` → `unsupported`) — that's deliberate: it catches the peer the
 * instant they provide the missing key/relays. A stale (>TTL) reachable peer is
 * shown optimistically then revalidated; `recheck()` forces a fresh query
 * regardless. A request-id guard means a slow stale check can't clobber a newer one.
 */
export function useDmSupport(
  accountPubkey: string,
  counterparties: string[],
  enabled = true,
): DmSupport {
  const peerKey = counterparties.join(',');
  const key = `${accountPubkey}\u0000${peerKey}`;
  const [result, setResult] = useState<{ key: string; state: DmSupportState }>(() => ({
    key,
    state: { ...LOCAL },
  }));
  // Route params can change before the effect for the new peer runs. Never
  // expose the previous peer's verdict during that render.
  const state = result.key === key ? result.state : LOCAL;
  const reqId = useRef(0);

  const run = useCallback(
    (force: boolean) => {
      const id = ++reqId.current;
      void (async () => {
        if (!accountPubkey || counterparties.length === 0) return;
        const cached = force ? null : await readCache(accountPubkey, counterparties);
        if (id !== reqId.current) return;
        if (cached) {
          setResult({ key, state: cached.state });
          if (cached.fresh) return;
        }
        let relayQueryStarted = false;
        const onRelayQuery =
          force || !cached
            ? () => {
                if (relayQueryStarted || id !== reqId.current) return;
                relayQueryStarted = true;
                setResult({ key, state: { ...CHECKING } });
              }
            : undefined;
        const results = await Promise.all(
          counterparties.map((p) =>
            dmService.checkDmSupport(accountPubkey, p, {
              force,
              // A database miss can still be satisfied by the service's warm
              // memory caches. Only expose progress once the service confirms
              // it is leaving local state and querying relays.
              onRelayQuery,
            }),
          ),
        );
        if (id !== reqId.current) return;
        const missingEncryptionKey = results.some((r) => !r.encryptionKey);
        const missingRelays = results.some((r) => !r.relays);
        setResult({
          key,
          state: {
            status: missingEncryptionKey || missingRelays ? 'unsupported' : 'ready',
            missingEncryptionKey,
            missingRelays,
          },
        });
      })();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key],
  );

  useEffect(() => {
    if (!enabled) return;
    run(false);
  }, [enabled, run]);

  useEffect(() => {
    if (!enabled || !accountPubkey || !peerKey) return;
    const relevant = new Set(peerKey.split(','));
    return onPeerEncryptionKeyChanged((identity) => {
      if (relevant.has(identity)) run(false);
    });
  }, [accountPubkey, enabled, peerKey, run]);

  const recheck = useCallback(() => run(true), [run]);

  return { ...state, recheck };
}
