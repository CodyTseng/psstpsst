import { and, eq, notInArray, sql } from 'drizzle-orm';
import { db, type Database } from '@/db/client';
import { exploreEntries as entries, exploreHistory as history } from '@/db/schema';
import { canReceiveForAccount } from '@/services/account/account-receive-guard';
import { markPrivateListDirty, readPrivateListState } from '@/services/relay/private-list-sync.service';
import { notifyExploreVisit } from './visits';
import { favoriteReference, parseFavoriteReference, KIND_APP_FAVORITES, FAVORITES_D } from './favorites-protocol';
import { knownFavoriteSnapshot, readFavoriteSnapshot } from './favorites-snapshot';
import { queueFavoritesPublication } from './favorites';
import { cacheApplicationEvent, parseApplicationEvent, readApplicationCache, withApplicationMetadata } from './application-cache';
import { websiteEntry, type ExploreEntry } from './model';

/** Membership/order comes from the encrypted favorite event, never a second relation table. */
export async function readEntries(account: string, sourceId?: string): Promise<ExploreEntry[]> {
  const [favorites, rows] = await Promise.all([
    readFavoriteSnapshot(account),
    db.select({ entry: entries, lastUsed: history.lastUsedAt }).from(entries)
      .leftJoin(history, and(eq(history.accountPubkey, entries.accountPubkey), eq(history.sourceId, entries.sourceId)))
      .where(and(eq(entries.accountPubkey, account), sourceId ? eq(entries.sourceId, sourceId) : undefined)).limit(sourceId ? 1 : 1024),
  ]);
  const positions = new Map(favorites.map((favorite, index) => [favorite.entry.key, index]));
  const candidates = new Map(favorites.filter(item => !sourceId || item.entry.key === sourceId).map(item => [item.entry.key, item.entry]));
  const recency = new Map<string, number | null>();
  for (const { entry, lastUsed } of rows) {
    recency.set(entry.sourceId, lastUsed);
    try {
      let app = candidates.get(entry.sourceId);
      if (entry.manifest) {
        app = parseApplicationEvent(JSON.parse(entry.manifest));
        if (app.key !== entry.sourceId) continue;
        // One-time promotion of legacy account-local manifests into the shared cache.
        await cacheApplicationEvent(app);
        await db.update(entries).set({ manifest: null }).where(and(eq(entries.accountPubkey, account), eq(entries.sourceId, entry.sourceId)));
      } else if (entry.kind === 'website') app = { ...websiteEntry(entry.address), title: entry.title };
      else if (!app) app = { ...parseFavoriteReference(favoriteReference({ address: entry.address, kind: entry.kind as ExploreEntry['kind'] })).entry, title: entry.title };
      if (!app) continue;
      if (entry.servers && !app.servers.length) app = { ...app, servers: JSON.parse(entry.servers) };
      candidates.set(app.key, app);
    } catch { /* Corrupt legacy metadata does not discard a saved reference. */ }
  }
  const cached = await readApplicationCache([...candidates.values()]);
  return [...candidates.values()].map(app => ({ ...withApplicationMetadata(app, cached.get(app.key) ?? app),
    desktopPosition: positions.get(app.key) ?? null, lastUsedAt: recency.get(app.key) ?? null }));
}

async function storeEntry(tx: Database, account: string, app: ExploreEntry) {
  const metadata = { address: app.address, title: app.title, kind: app.kind, servers: JSON.stringify(app.servers), manifest: null };
  await tx.insert(entries).values({ accountPubkey: account, sourceId: app.key, ...metadata })
    .onConflictDoUpdate({ target: [entries.accountPubkey, entries.sourceId], set: metadata });
}

async function pruneEntries(tx: Database, account: string, favoriteKeys: string[]) {
  await tx.delete(entries).where(and(eq(entries.accountPubkey, account),
    notInArray(entries.sourceId, tx.select({ id: history.sourceId }).from(history).where(eq(history.accountPubkey, account))),
    favoriteKeys.length ? notInArray(entries.sourceId, favoriteKeys) : undefined));
}

export async function visit(account: string, app: ExploreEntry) {
  await cacheApplicationEvent(app);
  const favorites = knownFavoriteSnapshot(await readPrivateListState(account, FAVORITES_D, db, KIND_APP_FAVORITES));
  await db.transaction(async tx => {
    if (!await canReceiveForAccount(account, tx)) throw new Error('account-unavailable');
    await storeEntry(tx, account, app);
    await tx.insert(history).values({ accountPubkey: account, sourceId: app.key, lastUsedAt: Date.now() })
      .onConflictDoUpdate({ target: [history.accountPubkey, history.sourceId], set: { lastUsedAt: Date.now() } });
    await tx.run(sql`DELETE FROM explore_history WHERE account_pubkey=${account} AND source_id NOT IN
      (SELECT source_id FROM explore_history WHERE account_pubkey=${account} ORDER BY last_used_at DESC,source_id ASC LIMIT 512)`);
    await pruneEntries(tx, account, favorites.map(item => item.entry.key));
  });
  notifyExploreVisit({ accountPubkey: account, key: app.key });
}

export async function forget(account: string, key: string) {
  await db.delete(history).where(and(eq(history.accountPubkey, account), eq(history.sourceId, key)));
}

export async function reorder(account: string, keys: string[], app?: ExploreEntry) {
  if (keys.length > 512 || new Set(keys).size !== keys.length) throw new Error('quota-exceeded');
  const state = await readPrivateListState(account, FAVORITES_D, db, KIND_APP_FAVORITES);
  const current = knownFavoriteSnapshot(state);
  const references = new Map(current.map(item => [item.entry.key, item.tag]));
  if (app && !references.has(app.key)) references.set(app.key, favoriteReference(app));
  const tags = keys.map(key => { const reference = references.get(key); if (!reference) throw new Error('invalid-favorite'); return reference; });
  if (JSON.stringify(tags) === JSON.stringify(current.map(item => item.tag))) return;
  await db.transaction(async tx => {
    if (!await canReceiveForAccount(account, tx)) throw new Error('account-unavailable');
    const latest = await readPrivateListState(account, FAVORITES_D, tx, KIND_APP_FAVORITES);
    if ((latest?.revision ?? 0) !== (state?.revision ?? 0) || latest?.eventId !== state?.eventId) throw new Error('favorites-changed');
    await markPrivateListDirty(account, FAVORITES_D, tx, KIND_APP_FAVORITES, tags);
    if (app && keys.includes(app.key)) await storeEntry(tx, account, app);
    await pruneEntries(tx, account, keys);
  });
  if (app) void cacheApplicationEvent(app, { retain: true }).catch(() => {});
  queueFavoritesPublication(account);
}

export { queueFavoritesPublication } from './favorites';

/** Refresh public metadata without changing the favorite event, order or recency. */
export async function cacheFavoriteMetadata(account: string, app: ExploreEntry) {
  await cacheApplicationEvent(app);
  await db.update(entries).set({ address: app.address, title: app.title, kind: app.kind, servers: JSON.stringify(app.servers), manifest: null })
    .where(and(eq(entries.accountPubkey, account), eq(entries.sourceId, app.key)));
}
