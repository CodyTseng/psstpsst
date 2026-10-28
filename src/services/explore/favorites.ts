import type { Event } from 'nostr-tools';
import { queuePrivateListPublication } from '@/services/relay/private-list-sync.service';
import { storeReplaceableEvent } from '@/services/relay/replaceable-events.service';
import type { Signer } from '@/services/signer/signer.interface';
import { parseFavoriteSnapshot, KIND_APP_FAVORITES, MY_APPS_D } from './favorites-protocol';
import { cacheFavoriteSnapshot } from './favorites-snapshot';
import { notifyFavoritesChanged } from './favorites-events';

export function queueFavoritesPublication(accountPubkey: string, signer?: Signer) {
  queuePrivateListPublication({ accountPubkey, kind: KIND_APP_FAVORITES, dTag: MY_APPS_D, signer,
    validateTags: tags => parseFavoriteSnapshot(JSON.stringify(tags)).map(item => item.tag),
    onCommitted: () => notifyFavoritesChanged(accountPubkey) });
}

/** Missing/invalid events cannot clear a list; the decoder protects pending local revisions. */
export async function applyFavoritesEvent(account: string, event: Event | null, signer: Signer) {
  if (!event || event.pubkey !== account || event.kind !== KIND_APP_FAVORITES ||
      event.content.length > 2 * 1024 * 1024 || event.tags.find(tag => tag[0] === 'd')?.[1] !== MY_APPS_D) return;
  await storeReplaceableEvent(event);
  try { await cacheFavoriteSnapshot(account, event, signer); } catch { /* Keep the last usable decrypted snapshot. */ }
}
