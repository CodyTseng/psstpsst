import { notifyExploreVisit } from './visits';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { markPrivateListDirty } from '@/services/relay/private-list-sync.service';
import { favoriteReference, parseFavoriteReference, KIND_APP_FAVORITES, FAVORITES_D } from './favorites-protocol';
import { queueFavoritesPublication } from './favorites';
import { db } from '@/db/client';
import { exploreEntries as entries, exploreHistory as history, exploreShortcuts as shortcuts } from '@/db/schema';
import { canReceiveForAccount } from '@/services/account/account-receive-guard';
import { parseManifest } from '@/services/napplet/protocol';
import { fromNapplet, parseSite, type ExploreEntry } from './model';
export async function readEntries(account: string, sourceId?: string): Promise<ExploreEntry[]> {
  const rows = await db.select({ entry: entries, position: shortcuts.position, reference: shortcuts.reference, lastUsed: history.lastUsedAt }).from(entries)
    .leftJoin(shortcuts, and(eq(shortcuts.accountPubkey, entries.accountPubkey), eq(shortcuts.sourceId, entries.sourceId)))
    .leftJoin(history, and(eq(history.accountPubkey, entries.accountPubkey), eq(history.sourceId, entries.sourceId)))
    .where(and(eq(entries.accountPubkey, account), sourceId ? eq(entries.sourceId, sourceId) : undefined)).limit(sourceId ? 1 : 1024);
  const result: ExploreEntry[] = [];
  for (const { entry, position, reference, lastUsed } of rows) {
    try {
      const app: ExploreEntry = entry.manifest ? entry.kind === 'napplet' ? fromNapplet(parseManifest(JSON.parse(entry.manifest))) : parseSite(JSON.parse(entry.manifest))
        : entry.kind !== 'website' ? { ...parseFavoriteReference(reference ?? favoriteReference({ address: entry.address, kind: entry.kind as ExploreEntry['kind'] })).entry, title: entry.title } : { key: entry.sourceId, address: entry.address, title: entry.title, kind: 'website', description: '', servers: [], required: [], desktopPosition: null, lastUsedAt: null };
      if (app.key !== entry.sourceId)
        continue;
      if (entry.servers && !app.servers.length)
        app.servers = JSON.parse(entry.servers);
      result.push({ ...app, desktopPosition: position, lastUsedAt: lastUsed });
      if (result.length % 4 === 0)
        await new Promise<void>((r) => setTimeout(r, 0));
    }
    catch { /* Unverified cached manifests never reach the launcher. */ }
  }
  return result;
}
export async function visit(account: string, app: ExploreEntry) {
  await db.transaction(async (tx) => {
    if (!await canReceiveForAccount(account, tx))
      throw new Error('account-unavailable');
    await tx.insert(entries).values({ accountPubkey: account, sourceId: app.key, address: app.address, title: app.title, kind: app.kind, servers: JSON.stringify(app.servers), manifest: app.manifest ? JSON.stringify(app.manifest) : null })
      .onConflictDoUpdate({ target: [entries.accountPubkey, entries.sourceId], set: { address: app.address, title: app.title, servers: JSON.stringify(app.servers), manifest: app.manifest ? JSON.stringify(app.manifest) : null } });
    await tx.insert(history).values({ accountPubkey: account, sourceId: app.key, lastUsedAt: Date.now() }).onConflictDoUpdate({ target: [history.accountPubkey, history.sourceId], set: { lastUsedAt: Date.now() } });
    await tx.run(sql `DELETE FROM explore_history WHERE account_pubkey=${account} AND source_id NOT IN (SELECT source_id FROM explore_history WHERE account_pubkey=${account} ORDER BY last_used_at DESC,source_id ASC LIMIT 512)`);
    await tx.run(sql `DELETE FROM explore_entries WHERE account_pubkey=${account} AND source_id NOT IN (SELECT source_id FROM explore_shortcuts WHERE account_pubkey=${account} UNION SELECT source_id FROM explore_history WHERE account_pubkey=${account})`);
  });
  notifyExploreVisit({ accountPubkey: account, key: app.key });
}
export async function forget(account: string, key: string) {
  await db.delete(history).where(and(eq(history.accountPubkey, account), eq(history.sourceId, key)));
}
export async function reorder(account: string, keys: string[], app?: ExploreEntry) {
  if (keys.length > 512 || new Set(keys).size !== keys.length)
    throw new Error('quota-exceeded');
  await db.transaction(async (tx) => {
    if (!await canReceiveForAccount(account, tx))
      throw new Error('account-unavailable');
    if (app && keys.includes(app.key)) await tx.insert(entries).values({ accountPubkey: account, sourceId: app.key, address: app.address, title: app.title, kind: app.kind, servers: JSON.stringify(app.servers), manifest: app.manifest ? JSON.stringify(app.manifest) : null }).onConflictDoNothing();
    const rows = await tx.select().from(shortcuts).where(eq(shortcuts.accountPubkey, account)).orderBy(asc(shortcuts.position));
    const previous = new Map(rows.map(row => [row.sourceId, row.position]));
    const positions = new Map(keys.map((key, index) => [key, index]));
    const removed = rows.filter(row => !positions.has(row.sourceId)).map(row => row.sourceId);
    const changed = [...positions].filter(([key, position]) => previous.get(key) !== position);
    if (!removed.length && !changed.length) return;
    await markPrivateListDirty(account, FAVORITES_D, tx, KIND_APP_FAVORITES);
    if (removed.length) await tx.delete(shortcuts).where(and(eq(shortcuts.accountPubkey, account), inArray(shortcuts.sourceId, removed)));
    for (let offset = 0; offset < changed.length; offset += 64) {
      await tx.insert(shortcuts).values(changed.slice(offset, offset + 64).map(([sourceId, position]) => ({
        accountPubkey: account, sourceId, position, ...(app?.key === sourceId ? { reference: favoriteReference(app) } : {}),
      }))).onConflictDoUpdate({ target: [shortcuts.accountPubkey, shortcuts.sourceId], set: { position: sql`excluded.position` } });
    }
    await tx.run(sql`DELETE FROM explore_entries WHERE account_pubkey=${account} AND source_id NOT IN (SELECT source_id FROM explore_shortcuts WHERE account_pubkey=${account} UNION SELECT source_id FROM explore_history WHERE account_pubkey=${account})`);
  });
  queueFavoritesPublication(account);
}

export { queueFavoritesPublication } from './favorites';

/** Metadata refresh never changes favorite membership, order, or recency. */
export async function cacheFavoriteMetadata(account: string, app: ExploreEntry) {
  await db.update(entries).set({ address: app.address, title: app.title, kind: app.kind, servers: JSON.stringify(app.servers), manifest: app.manifest ? JSON.stringify(app.manifest) : null })
    .where(and(eq(entries.accountPubkey, account), eq(entries.sourceId, app.key)));
}
