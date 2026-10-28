import { and, eq, inArray, isNotNull, count, getTableColumns, sql } from 'drizzle-orm';
import { db } from '@/db/client';
import { localApplications, exploreEntries, exploreHistory, nappletData, nappletUsage, signingAuthorizations, browserAuthorizations } from '@/db/schema';
import { platform } from '@/platform';
import { assertNotAborted } from '@/platform/abort';
import { canReceiveForAccount } from '@/services/account/account-receive-guard';
import type { ExploreEntry } from './model';
import { localInstallPath } from './local-path';
import { setData } from '@/services/napplet/data-repository';
import { invalidateSigning } from '@/services/signing/changes';

export const localAppId = (value: string) => /^local~[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value);
const where = (account: string, id: string) => and(eq(localApplications.accountPubkey, account), eq(localApplications.appId, id));
const fileHashes = new WeakMap<ExploreEntry, Set<string>>();
const documents = new Map<string, Set<(entry: ExploreEntry) => void>>();
const documentKey = (account: string, id: string) => JSON.stringify([account, id]);

export async function localApplicationDirectory(account: string, id?: string, version?: string): Promise<string> {
  if (id !== undefined && !localAppId(id) || version !== undefined && !/^[a-f0-9]{64}$/.test(version)) throw new Error('invalid-local-application');
  const root = await platform.fileSystem.documentDirectoryUri();
  if (!root) throw new Error('storage-unavailable');
  const accountHash = await platform.deviceCrypto.sha256Hex(new TextEncoder().encode(account));
  const appHash = id === undefined ? undefined : await platform.deviceCrypto.sha256Hex(new TextEncoder().encode(id));
  return `${root.replace(/\/$/, '')}/local-applications/${accountHash}${appHash ? `/${appHash}` : ''}${version ? `/${version}` : ''}`;
}

export async function readLocalApplication(account: string, id: string): Promise<ExploreEntry | undefined> {
  if (!localAppId(id)) return;
  const row = await db.select().from(localApplications).where(where(account, id)).get();
  if (!row) return;
  return decodeLocalApplication(row);
}
function decodeLocalApplication(row: typeof localApplications.$inferSelect, reference = false): ExploreEntry {
  const id = row.appId, entry = JSON.parse(row.entry) as ExploreEntry;
  if (entry.key !== id || entry.address !== id || entry.kind !== 'napp' || entry.manifest ||
    entry.localIcon && (entry.localIcon.account !== row.accountPubkey || entry.localIcon.appId !== id || entry.localIcon.version !== row.version || entry.localIcon.hash !== entry.icon?.hash) ||
    entry.local?.version !== row.version || entry.local.installer !== row.installer || !reference && (!Array.isArray(entry.files) || entry.files.length > 5000 ||
    !entry.files.every(file => localInstallPath(file.path) === file.path && /^[a-f0-9]{64}$/.test(file.hash)))) throw new Error('invalid-local-application');
  return { ...entry, desktopPosition: row.desktopPosition };
}
export async function readLocalApplications(account: string, ids?: string[], favorites = false, references = false): Promise<ExploreEntry[]> {
  if (ids && !ids.length) return [];
  const rows = await db.select({ ...getTableColumns(localApplications), entry: references
    ? sql<string>`json_remove(${localApplications.entry}, '$.files')` : localApplications.entry }).from(localApplications).where(and(eq(localApplications.accountPubkey, account),
    ids ? inArray(localApplications.appId, ids) : undefined, favorites ? isNotNull(localApplications.desktopPosition) : undefined)).limit(512);
  return rows.map(row => decodeLocalApplication(row, references));
}

/** Compare-and-swap prevents concurrent installers from committing against a stale review. */
export async function commitLocalApplication(account: string, entry: ExploreEntry, previousVersion: string | undefined, check: () => void) {
  if (!entry.local || !localAppId(entry.key)) throw new Error('invalid-local-application');
  await db.transaction(async tx => {
    check();
    if (!await canReceiveForAccount(account, tx)) throw new Error('account-unavailable');
    const previous = await tx.select().from(localApplications).where(where(account, entry.key)).get();
    check();
    if (previous?.version !== previousVersion) throw new Error('installation-changed');
    if (!previous && (await tx.select({ total: count() }).from(localApplications).where(eq(localApplications.accountPubkey, account)).get())!.total >= 512)
      throw new Error('installation-quota-exceeded');
    if (previous) {
      await tx.delete(signingAuthorizations).where(and(eq(signingAuthorizations.accountPubkey, account), eq(signingAuthorizations.sourceId, entry.key)));
      await tx.delete(browserAuthorizations).where(and(eq(browserAuthorizations.accountPubkey, account), eq(browserAuthorizations.sourceId, entry.key)));
    }
    await tx.insert(localApplications).values({ accountPubkey: account, appId: entry.key, version: entry.local!.version,
      installer: entry.local!.installer, entry: JSON.stringify(entry) }).onConflictDoUpdate({
      target: [localApplications.accountPubkey, localApplications.appId],
      set: { version: entry.local!.version, installer: entry.local!.installer, entry: JSON.stringify(entry) },
    });
    await setData({ accountPubkey: account, appKey: entry.key }, 'permissions', 'domains', JSON.stringify(entry.required), tx);
    check();
  });
  // Observers cannot turn a committed transition into an apparent installation failure.
  for (const changed of [...(documents.get(documentKey(account, entry.key)) ?? [])]) {
    try { changed(entry); } catch { /* The version is durable even if a document cannot reload. */ }
  }
  if (previousVersion !== undefined) {
    try { invalidateSigning({ accountPubkey: account, sourceId: entry.key }); }
    catch { /* Durable version checks still reject writes from released documents. */ }
  }
}

/** Files are immutable, account-owned and checked against the committed file map. */
export async function loadLocalApplicationFile(account: string, entry: ExploreEntry, hash: string, signal?: AbortSignal): Promise<Uint8Array> {
  assertNotAborted(signal);
  let hashes = fileHashes.get(entry);
  if (!hashes) { hashes = new Set(entry.files?.map(file => file.hash)); fileHashes.set(entry, hashes); }
  if (!/^[a-f0-9]{64}$/.test(hash) || !entry.local || !hashes.has(hash)) throw new Error('local-file-unavailable');
  return loadLocalFile(account, entry.key, entry.local.version, hash, signal);
}

export async function loadLocalFile(account: string, id: string, version: string, hash: string, signal?: AbortSignal, maxBytes = 32 * 1024 * 1024) {
  if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error('local-file-unavailable');
  assertNotAborted(signal);
  const path = `${await localApplicationDirectory(account, id, version)}/${hash}.blob`;
  const stat = await platform.fileSystem.stat(path);
  if (!stat.exists || stat.size == null || stat.size > maxBytes) throw new Error('local-file-unavailable');
  const bytes = await platform.fileSystem.readBytes(path);
  assertNotAborted(signal);
  await new Promise<void>(resolve => setTimeout(resolve, 0));
  if (await platform.deviceCrypto.sha256Hex(bytes) !== hash) throw new Error('local-file-corrupt');
  assertNotAborted(signal);
  return bytes;
}

export async function removeLocalApplication(account: string, id: string) {
  if (!localAppId(id)) throw new Error('invalid-local-application');
  // Keep the installation discoverable for retry if the platform cannot erase its profile.
  await platform.napplet.clearPageData?.(`${account}:${id}`);
  await db.transaction(async tx => {
    await tx.delete(localApplications).where(where(account, id));
    await tx.delete(exploreHistory).where(and(eq(exploreHistory.accountPubkey, account), eq(exploreHistory.sourceId, id)));
    await tx.delete(exploreEntries).where(and(eq(exploreEntries.accountPubkey, account), eq(exploreEntries.sourceId, id)));
    await tx.delete(nappletData).where(and(eq(nappletData.accountPubkey, account), eq(nappletData.appKey, id)));
    await tx.delete(nappletUsage).where(and(eq(nappletUsage.accountPubkey, account), eq(nappletUsage.appKey, id)));
  });
  await platform.fileSystem.delete(await localApplicationDirectory(account, id), { idempotent: true });
}

/** Change callbacks read account-owned rows; no local metadata is broadcast across accounts. */
export function watchLocalApplication(account: string, entry: ExploreEntry, changed: (entry?: ExploreEntry) => void) {
  let stopped = false, pending = false, dirty = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopDatabase: (() => void) | undefined;
  const key = documentKey(account, entry.key);
  const stop = () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    stopDatabase?.();
    const listeners = documents.get(key);
    listeners?.delete(transition);
    if (!listeners?.size) documents.delete(key);
  };
  const transition = (latest?: ExploreEntry) => {
    if (stopped || latest?.local?.version === entry.local?.version) return;
    stop(); changed(latest);
  };
  const listeners = documents.get(key) ?? new Set();
  listeners.add(transition); documents.set(key, listeners);
  const read = async () => {
    if (pending) { dirty = true; return; }
    pending = true;
    try {
      do {
        dirty = false;
        const row = await db.select({ version: localApplications.version }).from(localApplications).where(where(account, entry.key)).get();
        if (!stopped && row?.version !== entry.local?.version) {
          const latest = row ? await readLocalApplication(account, entry.key) : undefined;
          transition(latest);
        }
      } while (dirty && !stopped);
    } catch { transition(); }
    finally { pending = false; }
  };
  stopDatabase = platform.database?.addChangeListener?.(event => {
    if ((!event.tableName || event.tableName === 'local_applications') && !timer && !stopped)
      timer = setTimeout(() => { timer = undefined; void read(); }, 8);
  });
  void read();
  return stop;
}

export async function removeAccountLocalApplications(account: string) {
  for (const app of await readLocalApplications(account, undefined, false, true)) await platform.napplet.clearPageData?.(`${account}:${app.key}`);
  await platform.fileSystem.delete(await localApplicationDirectory(account), { idempotent: true });
}

/** Recover abandoned staging and old immutable versions without touching fresh readers. */
export async function reapLocalApplicationStorage(account: string, entry?: ExploreEntry) {
  const root = await localApplicationDirectory(account, entry?.key);
  const stat = await platform.fileSystem.stat(root);
  if (!stat.exists) return;
  for (const item of await platform.fileSystem.listDirectory(root)) {
    const eligible = entry ? /^[a-f0-9]{64}$/.test(item.name) && item.name !== entry.local?.version : /^staging-[a-f0-9]{32}$/.test(item.name);
    if (!item.isDirectory || !eligible) continue;
    const child = `${root}/${item.name}`;
    const info = await platform.fileSystem.stat(child);
    const timestamp = info.modificationTime ?? info.creationTime;
    if (timestamp != null && Date.now() - timestamp > 24 * 60 * 60 * 1000) await platform.fileSystem.delete(child, { idempotent: true });
  }
}
