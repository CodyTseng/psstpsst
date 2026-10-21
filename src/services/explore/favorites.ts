import { and, asc, eq, sql } from 'drizzle-orm';
import type { Event } from 'nostr-tools';
import { db, type Database } from '@/db/client';
import { exploreEntries, exploreShortcuts, privateListSyncState } from '@/db/schema';
import { canReceiveForAccount } from '@/services/account/account-receive-guard';
import { canApplyConfigurationEvent } from '@/services/relay/configuration-publish.service';
import { queuePrivateListPublication } from '@/services/relay/private-list-sync.service';
import type { Signer } from '@/services/signer/signer.interface';
import { favoriteReference, parseFavoriteSnapshot, KIND_APP_FAVORITES, FAVORITES_D } from './favorites-protocol';
import { notifyFavoritesChanged } from './favorites-events';
import { type ExploreEntry } from './model';

export function queueFavoritesPublication(accountPubkey: string, signer?: Signer) {
  queuePrivateListPublication({ accountPubkey, kind: KIND_APP_FAVORITES, dTag: FAVORITES_D, signer,
    readTags: async (tx: Database) => {
      const rows = await tx.select({ reference: exploreShortcuts.reference, entry: exploreEntries }).from(exploreShortcuts)
        .innerJoin(exploreEntries, and(eq(exploreEntries.accountPubkey, exploreShortcuts.accountPubkey), eq(exploreEntries.sourceId, exploreShortcuts.sourceId)))
        .where(eq(exploreShortcuts.accountPubkey, accountPubkey)).orderBy(asc(exploreShortcuts.position));
      return rows.map(({ reference, entry }) => reference ?? favoriteReference({ address: entry.address, kind: entry.kind as ExploreEntry['kind'] }));
    },
  });
}

/** Membership/order is an encrypted snapshot; recency and grants remain device-local. */
export async function applyFavoritesEvent(account: string, event: Event | null, signer: Signer) {
  if (!event || event.pubkey !== account || event.kind !== KIND_APP_FAVORITES ||
      event.content.length > 2 * 1024 * 1024 ||
      event.tags.find(tag => tag[0] === 'd')?.[1] !== FAVORITES_D || !signer.nip44Decrypt) return;
  if (!await canApplyConfigurationEvent(account, KIND_APP_FAVORITES, FAVORITES_D, event)) return;
  let items: ReturnType<typeof parseFavoriteSnapshot>;
  try { items = parseFavoriteSnapshot(await signer.nip44Decrypt(account, event.content)); } catch { return; }
  const applied = await db.transaction(async tx => {
    if (!await canReceiveForAccount(account, tx) || !await canApplyConfigurationEvent(account, KIND_APP_FAVORITES, FAVORITES_D, event, tx)) return false;
    const [sync] = await tx.select().from(privateListSyncState).where(and(eq(privateListSyncState.accountPubkey, account), eq(privateListSyncState.kind, KIND_APP_FAVORITES), eq(privateListSyncState.dTag, FAVORITES_D))).limit(1);
    if (sync?.eventId === event.id) return false;
    await tx.delete(exploreShortcuts).where(eq(exploreShortcuts.accountPubkey, account));
    for (let offset = 0; offset < items.length; offset += 64) {
      const chunk = items.slice(offset, offset + 64);
      await tx.insert(exploreEntries).values(chunk.map(({ entry }) => ({ accountPubkey: account, sourceId: entry.key,
        address: entry.address, title: entry.title, kind: entry.kind }))).onConflictDoNothing();
      await tx.insert(exploreShortcuts).values(chunk.map(({ entry, tag }, index) => ({ accountPubkey: account,
        sourceId: entry.key, position: offset + index, reference: tag })));
    }
    await tx.run(sql`DELETE FROM explore_entries WHERE account_pubkey=${account} AND source_id NOT IN (SELECT source_id FROM explore_shortcuts WHERE account_pubkey=${account} UNION SELECT source_id FROM explore_history WHERE account_pubkey=${account})`);
    await tx.insert(privateListSyncState).values({ accountPubkey: account, kind: KIND_APP_FAVORITES, dTag: FAVORITES_D, eventId: event.id })
      .onConflictDoUpdate({ target: [privateListSyncState.accountPubkey, privateListSyncState.kind, privateListSyncState.dTag], set: { eventId: event.id, dirty: false } });
    return true;
  });
  if (applied) notifyFavoritesChanged(account);
}
