import { nip44 } from 'nostr-tools';

import { getAcceleratedNip44ConversationKey } from './crypto-accelerator';

/**
 * Memoize NIP-44 conversation keys.
 *
 * `nip44.v2.utils.getConversationKey` is a secp256k1 ECDH — the most expensive
 * part of NIP-44 — yet it depends only on (our privkey, peer pubkey) and never
 * changes for a given pair. Recomputing it per message wastes real CPU on the
 * single JS thread, most visibly when backfilling a large history dominated by
 * a few peers (each of their messages would otherwise re-derive the same key).
 *
 * Keyed by the privkey *object* via a `WeakMap`, so a rotated-out encryption key
 * and its cached conversation keys are garbage-collected together; the inner map
 * is keyed by peer pubkey hex.
 *
 * Use this ONLY for stable pubkeys (a peer's long-lived encryption key). Do NOT
 * route per-message ephemeral keys (the gift-wrap one-shot sender/recipient
 * keys) through it — they never repeat, so caching them only bloats the map.
 */
const cache = new WeakMap<Uint8Array, Map<string, Uint8Array>>();
const asyncCache = new WeakMap<Uint8Array, Map<string, Promise<Uint8Array>>>();

export function getCachedConversationKey(
  privkey: Uint8Array,
  pubkeyHex: string,
): Uint8Array {
  let byPeer = cache.get(privkey);
  if (!byPeer) {
    byPeer = new Map();
    cache.set(privkey, byPeer);
  }
  let convKey = byPeer.get(pubkeyHex);
  if (!convKey) {
    convKey = nip44.v2.utils.getConversationKey(privkey, pubkeyHex);
    byPeer.set(pubkeyHex, convKey);
  }
  return convKey;
}

export async function getConversationKeyAsync(
  privkey: Uint8Array,
  pubkeyHex: string,
  opts: { cache?: boolean } = {},
): Promise<Uint8Array> {
  if (!opts.cache) {
    return (await getAcceleratedNip44ConversationKey(privkey, pubkeyHex))
      ?? nip44.v2.utils.getConversationKey(privkey, pubkeyHex);
  }

  let byPeer = cache.get(privkey);
  const existing = byPeer?.get(pubkeyHex);
  if (existing) return existing;

  let asyncByPeer = asyncCache.get(privkey);
  if (!asyncByPeer) {
    asyncByPeer = new Map();
    asyncCache.set(privkey, asyncByPeer);
  }

  let pending = asyncByPeer.get(pubkeyHex);
  if (!pending) {
    pending = (async () => {
      const convKey =
        (await getAcceleratedNip44ConversationKey(privkey, pubkeyHex))
        ?? nip44.v2.utils.getConversationKey(privkey, pubkeyHex);
      byPeer = cache.get(privkey);
      if (!byPeer) {
        byPeer = new Map();
        cache.set(privkey, byPeer);
      }
      byPeer.set(pubkeyHex, convKey);
      asyncByPeer?.delete(pubkeyHex);
      return convKey;
    })();
    asyncByPeer.set(pubkeyHex, pending);
  }

  return pending;
}
