import { and, eq } from 'drizzle-orm';
import type { Event } from 'nostr-tools';
import { db } from '@/db/client';
import { privateListSyncState, replaceableEvents } from '@/db/schema';
import { registerNappletLifecycle } from '@/services/napplet/lifecycle';
import { buildSigner } from '@/services/account/account-access';
import { canReceiveForAccount } from '@/services/account/account-receive-guard';
import { canApplyConfigurationEvent } from '@/services/relay/configuration-publish.service';
import { readPrivateListState } from '@/services/relay/private-list-sync.service';
import { parseFavoriteSnapshot, MY_APPS_D, KIND_APP_FAVORITES, type FavoriteReference } from './favorites-protocol';
import { notifyFavoritesChanged } from './favorites-events';
import type { Signer } from '@/services/signer/signer.interface';

const snapshots = new Map<string, { id: string; items: FavoriteReference[] }>();
const decoding = new Map<string, Promise<void>>();
registerNappletLifecycle(account => { if (account) snapshots.delete(account); else snapshots.clear(); });
export const favoriteCoordinate = (account: string) => ({ pubkey: account, kind: KIND_APP_FAVORITES, dTag: MY_APPS_D });
export const favoriteStateWhere = (account: string) => and(eq(privateListSyncState.accountPubkey, account),
  eq(privateListSyncState.kind, KIND_APP_FAVORITES), eq(privateListSyncState.dTag, MY_APPS_D));
export function knownFavoriteSnapshot(state: { dirty: boolean; draft: string[][] | null; snapshot: { eventId: string; tags: string[][] } | null } | undefined): FavoriteReference[] {
  return state?.dirty && state.draft ? parseTags(state.draft) : state?.snapshot ? parseTags(state.snapshot.tags) : [];
}
const parseTags = (tags: string[][]) => parseFavoriteSnapshot(JSON.stringify(tags));

/** List navigation reads committed plaintext only; synchronization owns decryption. */
export async function readLocalFavoriteSnapshot(account: string): Promise<FavoriteReference[]> {
  return knownFavoriteSnapshot(await readPrivateListState(account, MY_APPS_D, db, KIND_APP_FAVORITES));
}

/** The snapshot is a derived cache; local drafts and newer events always take precedence. */
export async function cacheFavoriteSnapshot(account: string, event: Event | null, signer?: Signer): Promise<void> {
  if (!event || event.pubkey !== account || event.kind !== KIND_APP_FAVORITES ||
      event.content.length > 2 * 1024 * 1024 || event.tags.find(tag => tag[0] === 'd')?.[1] !== MY_APPS_D) return;
  const key = JSON.stringify([account, event.id]);
  if (decoding.has(key)) return decoding.get(key);
  const work = (async () => {
    if (!await canApplyConfigurationEvent(account, KIND_APP_FAVORITES, MY_APPS_D, event)) return;
    const state = await readPrivateListState(account, MY_APPS_D, db, KIND_APP_FAVORITES);
    if (!state?.dirty && state?.snapshot?.eventId === event.id) return;
    const owner = signer ?? await buildSigner(account);
    if (!owner.nip44Decrypt) throw new Error('favorites-decryption-unavailable');
    const items = parseFavoriteSnapshot(await owner.nip44Decrypt(account, event.content));
    const tags = items.map(item => item.tag);
    const applied = await db.transaction(async tx => {
      if (!await canReceiveForAccount(account, tx) || !await canApplyConfigurationEvent(account, KIND_APP_FAVORITES, MY_APPS_D, event, tx)) return false;
      await tx.insert(privateListSyncState).values({ accountPubkey: account, kind: KIND_APP_FAVORITES, dTag: MY_APPS_D,
        eventId: event.id, snapshot: { eventId: event.id, tags } }).onConflictDoUpdate({
        target: [privateListSyncState.accountPubkey, privateListSyncState.kind, privateListSyncState.dTag],
        set: { eventId: event.id, dirty: false, draft: null, snapshot: { eventId: event.id, tags } },
      });
      return true;
    });
    if (applied) {
      if (snapshots.size >= 8 && !snapshots.has(account)) snapshots.delete(snapshots.keys().next().value!);
      snapshots.set(account, { id: event.id, items });
      notifyFavoritesChanged(account);
    }
  })().finally(() => decoding.delete(key));
  decoding.set(key, work);
  return work;
}

/** Events own membership/order. A pending local draft overlays only an unfinished edit. */
export async function readFavoriteSnapshot(account: string): Promise<FavoriteReference[]> {
  const [state, rows] = await Promise.all([
    readPrivateListState(account, MY_APPS_D, db, KIND_APP_FAVORITES),
    db.select({ event: replaceableEvents.event }).from(replaceableEvents).where(and(
      eq(replaceableEvents.pubkey, account), eq(replaceableEvents.kind, KIND_APP_FAVORITES),
      eq(replaceableEvents.dTag, MY_APPS_D))).limit(1),
  ]);
  if (state?.dirty && state.draft) return parseTags(state.draft);
  const event = rows[0]?.event;
  if (!event) return state?.snapshot ? parseTags(state.snapshot.tags) : [];
  const cached = snapshots.get(account);
  if (cached?.id === event.id) return cached.items;
  if (state?.snapshot) {
    if (state.snapshot.eventId !== event.id) void cacheFavoriteSnapshot(account, event).catch(() => {});
    return parseTags(state.snapshot.tags);
  }
  await cacheFavoriteSnapshot(account, event);
  const current = await readPrivateListState(account, MY_APPS_D, db, KIND_APP_FAVORITES);
  return current?.dirty && current.draft ? parseTags(current.draft) : current?.snapshot ? parseTags(current.snapshot.tags) : [];
}
