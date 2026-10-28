import { and, asc, desc, eq, gt, inArray, lt, notInArray, or, sql } from 'drizzle-orm';
import { db, type Database } from '@/db/client';
import { exploreEntries as entries, exploreHistory as history, localApplications } from '@/db/schema';
import { canReceiveForAccount } from '@/services/account/account-receive-guard';
import { markPrivateListDirty, readPrivateListState } from '@/services/relay/private-list-sync.service';
import { notifyExploreVisit } from './visits';
import { favoriteReference, parseFavoriteReference, KIND_APP_FAVORITES, MY_APPS_D } from './favorites-protocol';
import { knownFavoriteSnapshot, readLocalFavoriteSnapshot } from './favorites-snapshot';
import { queueFavoritesPublication } from './favorites';
import { cacheApplicationEvent, parseApplicationEvent, readApplicationCache, withApplicationMetadata } from './application-cache';
import { FAVORITES_PAGE_SIZE, websiteEntry, type ExploreEntry } from './model';
import { parseApplicationEvents } from './application-event';
import { broadcastFavoriteChange } from './favorites-events';
import { createPerfSpan, profileAsync } from '@/lib/perf/profiler';
import { readLocalApplications } from './local-applications';

/** The encrypted list owns references and order; application metadata is read separately. */
export async function readFavoriteReferences(account: string): Promise<ExploreEntry[]> {
  const result = (await readLocalFavoriteSnapshot(account)).map(({ entry }) => entry);
  const locals = (await readLocalApplications(account, undefined, true, true)).sort((a, b) => a.desktopPosition! - b.desktopPosition! || a.key.localeCompare(b.key));
  for (const local of locals) result.splice(Math.min(local.desktopPosition!, result.length), 0, local);
  return result.map((entry, index) => ({ ...entry, desktopPosition: index }));
}

/** Read one requested metadata page without membership, history, writes or networking. */
export async function readFavoriteMetadata(account: string, page: ExploreEntry[]): Promise<ExploreEntry[]> {
  if (page.length > FAVORITES_PAGE_SIZE) throw new Error('favorite-page-too-large');
  if (!page.length) return [];
  const [cached, rows] = await Promise.all([
    readApplicationCache(page),
    db.select().from(entries).where(and(eq(entries.accountPubkey, account), inArray(entries.sourceId, page.map(entry => entry.key)))),
  ]);
  for (const local of await readLocalApplications(account, page.filter(app => app.key.startsWith('local~')).map(app => app.key), false, true)) cached.set(local.key, local);
  const local = new Map(rows.map(row => [row.sourceId, row]));
  const legacy = rows.flatMap(row => {
    try { return row.manifest ? [JSON.parse(row.manifest)] : []; } catch { return []; }
  });
  for (const app of await parseApplicationEvents(legacy)) if (app && !cached.has(app.key)) cached.set(app.key, app);
  return page.map(entry => {
    const row = local.get(entry.key);
    let fallback = row ? { ...entry, title: row.title } : entry;
    if (row?.servers && !fallback.servers.length) {
      try { fallback = { ...fallback, servers: JSON.parse(row.servers) }; } catch { /* Keep the saved reference usable. */ }
    }
    return withApplicationMetadata(fallback, cached.get(entry.key) ?? fallback);
  });
}

/** Paint saved titles before parsing signed application manifests. */
export async function readFavoriteEntries(account: string): Promise<ExploreEntry[]> {
  const span = createPerfSpan('explore.favorites');
  try {
    const references = await profileAsync(span, 'membership', () => readFavoriteReferences(account));
    const page = references.slice(0, FAVORITES_PAGE_SIZE);
    if (!page.length) return references;
    const rows = await profileAsync(span, 'saved-titles', () => db.select({ key: entries.sourceId, title: entries.title }).from(entries)
      .where(and(eq(entries.accountPubkey, account), inArray(entries.sourceId, page.map(entry => entry.key)))));
    const titles = new Map(rows.map(row => [row.key, row.title]));
    return references.map((entry, index) => index < FAVORITES_PAGE_SIZE && titles.has(entry.key) ? { ...entry, title: titles.get(entry.key)! } : entry);
  } finally { span?.end(); }
}

export type HistoryCursor = { lastUsedAt: number; key: string };
export type HistoryPage = { entries: ExploreEntry[]; cursor?: HistoryCursor; hasMore: boolean };

/** Keyset pagination remains stable when an earlier history row is removed. */
export async function readHistoryPage(account: string, cursor?: HistoryCursor): Promise<HistoryPage> {
  const rows = await db.select({ entry: entries, lastUsedAt: history.lastUsedAt }).from(history)
    .innerJoin(entries, and(eq(entries.accountPubkey, history.accountPubkey), eq(entries.sourceId, history.sourceId)))
    .where(and(eq(history.accountPubkey, account), cursor ? or(lt(history.lastUsedAt, cursor.lastUsedAt),
      and(eq(history.lastUsedAt, cursor.lastUsedAt), gt(history.sourceId, cursor.key))) : undefined))
    .orderBy(desc(history.lastUsedAt), asc(history.sourceId)).limit(FAVORITES_PAGE_SIZE + 1);
  const page = rows.slice(0, FAVORITES_PAGE_SIZE);
  const locals = new Map((await readLocalApplications(account, page.map(item => item.entry.sourceId).filter(key => key.startsWith('local~')), false, true)).map(app => [app.key, app]));
  const candidates = page.flatMap(({ entry, lastUsedAt }) => {
    const local = locals.get(entry.sourceId);
    if (entry.sourceId.startsWith('local~') && !local) return [];
    const reference = local ?? (entry.kind === 'website' ? websiteEntry(entry.address)
      : parseFavoriteReference(favoriteReference({ address: entry.address, kind: entry.kind as ExploreEntry['kind'] })).entry);
    let servers: string[] = reference.servers;
    try { if (!servers.length) servers = JSON.parse(entry.servers); } catch { /* Keep the saved reference usable. */ }
    return [{ ...reference, title: local?.title || entry.title, servers, lastUsedAt, desktopPosition: null }];
  });
  const cached = await readApplicationCache(candidates);
  const legacy = page.flatMap(({ entry }) => {
    try { return entry.manifest ? [JSON.parse(entry.manifest)] : []; } catch { return []; }
  });
  for (const app of await parseApplicationEvents(legacy)) if (app && !cached.has(app.key)) cached.set(app.key, app);
  const last = page.at(-1);
  return { entries: candidates.map(app => withApplicationMetadata(app, cached.get(app.key) ?? app)),
    cursor: last ? { lastUsedAt: last.lastUsedAt, key: last.entry.sourceId } : cursor, hasMore: rows.length > FAVORITES_PAGE_SIZE };
}

/** Membership/order comes from the encrypted favorite event, never a second relation table. */
export async function readEntries(account: string, sourceId?: string): Promise<ExploreEntry[]> {
  const [favorites, rows] = await Promise.all([
    readFavoriteReferences(account).then(apps => apps.map(entry => ({ entry }))),
    db.select({ entry: entries, lastUsed: history.lastUsedAt }).from(entries)
      .leftJoin(history, and(eq(history.accountPubkey, entries.accountPubkey), eq(history.sourceId, entries.sourceId)))
      .where(and(eq(entries.accountPubkey, account), sourceId ? eq(entries.sourceId, sourceId) : undefined)).limit(sourceId ? 1 : 1024),
  ]);
  const locals = new Map((await readLocalApplications(account, sourceId ? [sourceId] : undefined, false, true)).map(app => [app.key, app]));
  const positions = new Map(favorites.map((favorite, index) => [favorite.entry.key, index]));
  const candidates = new Map(favorites.filter(item => !sourceId || item.entry.key === sourceId).map(item => [item.entry.key, item.entry]));
  const recency = new Map<string, number | null>();
  for (const { entry, lastUsed } of rows) {
    recency.set(entry.sourceId, lastUsed);
    try {
      let app = candidates.get(entry.sourceId);
      if (locals.has(entry.sourceId)) app = locals.get(entry.sourceId);
      else if (entry.manifest) {
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
  for (const local of locals.values()) if (local.desktopPosition !== null) {
    candidates.set(local.key, local);
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
    notInArray(entries.sourceId, tx.select({ id: localApplications.appId }).from(localApplications).where(eq(localApplications.accountPubkey, account))),
    favoriteKeys.length ? notInArray(entries.sourceId, favoriteKeys) : undefined));
}

export async function visit(account: string, app: ExploreEntry) {
  await cacheApplicationEvent(app);
  const favorites = knownFavoriteSnapshot(await readPrivateListState(account, MY_APPS_D, db, KIND_APP_FAVORITES));
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
  const state = await readPrivateListState(account, MY_APPS_D, db, KIND_APP_FAVORITES);
  const current = knownFavoriteSnapshot(state);
  const references = new Map(current.map(item => [item.entry.key, item.tag]));
  const locals = await readLocalApplications(account, undefined, false, true);
  const localKeys = new Set(locals.map(app => app.key));
  if (app && !app.local && !references.has(app.key)) references.set(app.key, favoriteReference(app));
  const tags = keys.filter(key => !localKeys.has(key)).map(key => { const reference = references.get(key); if (!reference) throw new Error('invalid-favorite'); return reference; });
  const signedChanged = JSON.stringify(tags) !== JSON.stringify(current.map(item => item.tag));
  await db.transaction(async tx => {
    if (!await canReceiveForAccount(account, tx)) throw new Error('account-unavailable');
    const latest = await readPrivateListState(account, MY_APPS_D, tx, KIND_APP_FAVORITES);
    if ((latest?.revision ?? 0) !== (state?.revision ?? 0) || latest?.eventId !== state?.eventId) throw new Error('favorites-changed');
    if (signedChanged) await markPrivateListDirty(account, MY_APPS_D, tx, KIND_APP_FAVORITES, tags);
    for (const local of locals) {
      const index = keys.indexOf(local.key), position = index < 0 ? null : index;
      if (local.desktopPosition !== position) await tx.update(localApplications).set({ desktopPosition: position })
        .where(and(eq(localApplications.accountPubkey, account), eq(localApplications.appId, local.key)));
    }
    if (app && keys.includes(app.key)) await storeEntry(tx, account, app);
    await pruneEntries(tx, account, keys);
  });
  if (app) void cacheApplicationEvent(app, { retain: true }).catch(() => {});
  broadcastFavoriteChange(account);
  if (signedChanged) queueFavoritesPublication(account);
}

export { queueFavoritesPublication } from './favorites';

/** Refresh public metadata without changing the favorite event, order or recency. */
export async function cacheFavoriteMetadata(account: string, app: ExploreEntry) {
  await cacheApplicationEvent(app);
  await db.update(entries).set({ address: app.address, title: app.title, kind: app.kind, servers: JSON.stringify(app.servers), manifest: null })
    .where(and(eq(entries.accountPubkey, account), eq(entries.sourceId, app.key)));
}
