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
const retired = new WeakSet<Uint8Array>();
const MAX_PEERS = 256;

export function clearConversationKeys(privkey: Uint8Array): void {
  retired.add(privkey);
  for (const key of cache.get(privkey)?.values() ?? []) key.fill(0);
  cache.delete(privkey);
  asyncCache.delete(privkey);
}

function checkKey(privkey: Uint8Array): void {
  if (retired.has(privkey)) throw new Error('Encryption session has ended');
}

function remember(byPeer: Map<string, Uint8Array>, peer: string, key: Uint8Array): void {
  if (byPeer.size >= MAX_PEERS && !byPeer.has(peer)) {
    // Evicted keys may still be used by an in-flight caller; do not zero them here.
    byPeer.delete(byPeer.keys().next().value!);
  }
  byPeer.set(peer, key);
}

const cache = new WeakMap<Uint8Array, Map<string, Uint8Array>>();
const asyncCache = new WeakMap<Uint8Array, Map<string, Promise<Uint8Array>>>();

export function getCachedConversationKey(
  privkey: Uint8Array,
  pubkeyHex: string,
): Uint8Array {
  checkKey(privkey);
  let byPeer = cache.get(privkey);
  if (!byPeer) {
    byPeer = new Map();
    cache.set(privkey, byPeer);
  }
  let convKey = byPeer.get(pubkeyHex);
  if (!convKey) {
    convKey = nip44.v2.utils.getConversationKey(privkey, pubkeyHex);
    remember(byPeer, pubkeyHex, convKey);
  }
  return convKey;
}

export async function getConversationKeyAsync(
  privkey: Uint8Array,
  pubkeyHex: string,
  opts: { cache?: boolean } = {},
): Promise<Uint8Array> {
  checkKey(privkey);
  if (!opts.cache) {
    return (await getAcceleratedNip44ConversationKey(privkey, pubkeyHex))
      ?? nip44.v2.utils.getConversationKey(privkey, pubkeyHex);
  }

  checkKey(privkey);
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
      if (retired.has(privkey)) {
        convKey.fill(0);
        throw new Error('Encryption session has ended');
      }
      byPeer = cache.get(privkey);
      if (!byPeer) {
        byPeer = new Map();
        cache.set(privkey, byPeer);
      }
      remember(byPeer, pubkeyHex, convKey);
      asyncByPeer?.delete(pubkeyHex);
      return convKey;
    })();
    asyncByPeer.set(pubkeyHex, pending);
    void pending.finally(() => {
      if (asyncByPeer?.get(pubkeyHex) === pending) asyncByPeer.delete(pubkeyHex);
    }).catch(() => {});
  }

  return pending;
}
