import { notifyExploreVisit } from './visits';
import { and, asc, eq, sql } from 'drizzle-orm';
import { db } from '@/db/client';
import { exploreEntries as entries, exploreHistory as history, exploreShortcuts as shortcuts } from '@/db/schema';
import { canReceiveForAccount } from '@/services/account/account-receive-guard';
import { parseManifest } from '@/services/napplet/protocol';
import { fromNapplet, parseSite, type ExploreEntry } from './model';
export async function readEntries(account: string, sourceId?: string): Promise<ExploreEntry[]> {
  const rows = await db.select({ entry: entries, position: shortcuts.position, lastUsed: history.lastUsedAt }).from(entries)
    .leftJoin(shortcuts, and(eq(shortcuts.accountPubkey, entries.accountPubkey), eq(shortcuts.sourceId, entries.sourceId)))
    .leftJoin(history, and(eq(history.accountPubkey, entries.accountPubkey), eq(history.sourceId, entries.sourceId)))
    .where(and(eq(entries.accountPubkey, account), sourceId ? eq(entries.sourceId, sourceId) : undefined)).limit(sourceId ? 1 : 1024);
  const result: ExploreEntry[] = [];
  for (const { entry, position, lastUsed } of rows) {
    try {
      const app: ExploreEntry = entry.manifest ? entry.kind === 'napplet' ? fromNapplet(parseManifest(JSON.parse(entry.manifest))) : parseSite(JSON.parse(entry.manifest))
        : { key: entry.sourceId, address: entry.address, title: entry.title, kind: 'website', description: '', servers: [], required: [], desktopPosition: null, lastUsedAt: null };
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
    const previous = new Map(rows.map(r => [r.sourceId, r.position]));
    const positions = new Map(keys.map((key, index) => [key, index]));
    for (const row of rows)
      if (!positions.has(row.sourceId))
        await tx.delete(shortcuts).where(and(eq(shortcuts.accountPubkey, account), eq(shortcuts.sourceId, row.sourceId)));
    for (const [sourceId, position] of positions) {
      if (previous.get(sourceId) === position)
        continue;
      await tx.insert(shortcuts).values({ accountPubkey: account, sourceId, position }).onConflictDoUpdate({ target: [shortcuts.accountPubkey, shortcuts.sourceId], set: { position } });
    }
  });
}
