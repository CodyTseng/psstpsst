import { and, asc, count, desc, eq, isNotNull } from 'drizzle-orm';
import { db } from '@/db/client';
import { nappletData, nappletInstallations, nappletUsage } from '@/db/schema';
import { canReceiveForAccount } from '@/services/account/account-receive-guard';
import { parseManifest, type NappletInstallation, type NappletRelease } from './protocol';

export type AppScope = { accountPubkey: string; appKey: string; artifactHash: string };
const byteLength = (value: string) => new TextEncoder().encode(value).length;
const verifiedReleases = new Map<string, NappletRelease>();
let cachedReleaseBytes = 0;
const scopeWhere = (scope: AppScope, bucket: string) =>
  and(
    eq(nappletData.accountPubkey, scope.accountPubkey),
    eq(nappletData.appKey, scope.appKey),
    eq(nappletData.artifactHash, scope.artifactHash),
    eq(nappletData.bucket, bucket),
  );
export async function installations(
  accountPubkey: string,
  recent = false,
): Promise<NappletInstallation[]> {
  const rows = await db
    .select()
    .from(nappletInstallations)
    .where(
      and(
        eq(nappletInstallations.accountPubkey, accountPubkey),
        recent ? isNotNull(nappletInstallations.lastUsedAt) : undefined,
      ),
    )
    .orderBy(recent ? desc(nappletInstallations.lastUsedAt) : asc(nappletInstallations.desktopPosition), asc(nappletInstallations.appKey))
    .limit(recent ? 24 : 512);
  const result: NappletInstallation[] = [];
  let verified = 0;
  for (const row of rows) {
    try {
      let release = verifiedReleases.get(row.manifest);
      if (!release) {
        if (++verified % 4 === 0) await new Promise<void>((resolve) => setTimeout(resolve, 0));
        release = parseManifest(JSON.parse(row.manifest));
        while (
          verifiedReleases.size >= 512 ||
          cachedReleaseBytes + row.manifest.length > 8 * 1024 * 1024
        ) {
          const oldest = verifiedReleases.keys().next().value;
          if (!oldest) break;
          cachedReleaseBytes -= oldest.length;
          verifiedReleases.delete(oldest);
        }
        verifiedReleases.set(row.manifest, release);
        cachedReleaseBytes += row.manifest.length;
      }
      if (release.key !== row.appKey || release.hash !== row.artifactHash) continue;
      result.push({
        ...release,
        lastUsedAt: row.lastUsedAt,
        desktopPosition: row.desktopPosition,
        previousManifest: row.previousManifest,
      });
    } catch {
      /* Invalid stored manifests never enter an account's library. */
    }
  }
  return result;
}
export async function saveInstallation(
  accountPubkey: string,
  release: NappletRelease,
): Promise<void> {
  await db.transaction(async (tx) => {
    if (!(await canReceiveForAccount(accountPubkey, tx))) throw new Error('account-unavailable');
    const old = await tx
      .select()
      .from(nappletInstallations)
      .where(
        and(
          eq(nappletInstallations.accountPubkey, accountPubkey),
          eq(nappletInstallations.appKey, release.key),
        ),
      )
      .get();
    if (!old) {
      const size = await tx
        .select({ total: count() })
        .from(nappletInstallations)
        .where(eq(nappletInstallations.accountPubkey, accountPubkey))
        .get();
      if ((size?.total ?? 0) >= 512) throw new Error('quota-exceeded');
    }
    await tx
      .insert(nappletInstallations)
      .values({
        accountPubkey,
        appKey: release.key,
        manifest: JSON.stringify(release.event),
        artifactHash: release.hash,
      })
      .onConflictDoUpdate({
        target: [nappletInstallations.accountPubkey, nappletInstallations.appKey],
        set: {
          manifest: JSON.stringify(release.event),
          artifactHash: release.hash,
          previousManifest:
            old?.artifactHash !== release.hash ? (old?.manifest ?? null) : old?.previousManifest,
        },
      });
  });
}
export async function markRecent(accountPubkey: string, appKey: string): Promise<void> {
  await db
    .update(nappletInstallations)
    .set({ lastUsedAt: Date.now() })
    .where(
      and(
        eq(nappletInstallations.accountPubkey, accountPubkey),
        eq(nappletInstallations.appKey, appKey),
      ),
    );
}
/** Forget recent usage without changing desktop membership or application state. */
export async function clearRecent(accountPubkey: string, appKey: string): Promise<void> {
  await db.update(nappletInstallations).set({ lastUsedAt: null })
    .where(and(eq(nappletInstallations.accountPubkey, accountPubkey), eq(nappletInstallations.appKey, appKey)));
}
/** Persist only changed slots; desktop membership never changes usage or app data. */
export async function saveDesktopOrder(accountPubkey: string, keys: readonly string[]): Promise<void> {
  if (keys.length > 512 || new Set(keys).size !== keys.length) throw new Error('invalid-desktop-order');
  await db.transaction(async (tx) => {
    if (!(await canReceiveForAccount(accountPubkey, tx))) throw new Error('account-unavailable');
    const rows = await tx.select({ key: nappletInstallations.appKey, position: nappletInstallations.desktopPosition })
      .from(nappletInstallations).where(eq(nappletInstallations.accountPubkey, accountPubkey)).limit(512);
    const positions = new Map(keys.map((key, index) => [key, index]));
    const known = new Set(rows.map((row) => row.key));
    if (keys.some((key) => !known.has(key))) throw new Error('app-not-installed');
    for (const row of rows) {
      const position = positions.get(row.key) ?? null;
      if (position === row.position) continue;
      await tx.update(nappletInstallations).set({ desktopPosition: position })
        .where(and(eq(nappletInstallations.accountPubkey, accountPubkey), eq(nappletInstallations.appKey, row.key)));
    }
  });
}
export async function getData(
  scope: AppScope,
  bucket: string,
  key: string,
): Promise<string | null> {
  const row = await db
    .select({ value: nappletData.value })
    .from(nappletData)
    .where(and(scopeWhere(scope, bucket), eq(nappletData.key, key)))
    .get();
  return row?.value ?? null;
}
export async function dataKeys(scope: AppScope, bucket: string): Promise<string[]> {
  const rows = await db
    .select({ key: nappletData.key })
    .from(nappletData)
    .where(scopeWhere(scope, bucket))
    .limit(256);
  return rows.map((row) => row.key);
}
export async function dataEntries(scope: AppScope, bucket: string): Promise<Map<string, string>> {
  const rows = await db
    .select({ key: nappletData.key, value: nappletData.value })
    .from(nappletData)
    .where(scopeWhere(scope, bucket))
    .limit(256);
  return new Map(rows.map((row) => [row.key, row.value]));
}
/** Usage counters and values change atomically; no full namespace scan per write. */
export async function setData(
  scope: AppScope,
  bucket: string,
  key: string,
  value: string | null,
): Promise<void> {
  if (key.length > 256 || (value != null && value.length > 1024 * 1024))
    throw new Error('quota-exceeded');
  await db.transaction(async (tx) => {
    if (!(await canReceiveForAccount(scope.accountPubkey, tx)))
      throw new Error('account-unavailable');
    const where = and(scopeWhere(scope, bucket), eq(nappletData.key, key));
    const old = await tx.select({ bytes: nappletData.bytes }).from(nappletData).where(where).get();
    const usageWhere = and(
      eq(nappletUsage.accountPubkey, scope.accountPubkey),
      eq(nappletUsage.appKey, scope.appKey),
      eq(nappletUsage.artifactHash, scope.artifactHash),
      eq(nappletUsage.bucket, bucket),
    );
    const usage = await tx.select().from(nappletUsage).where(usageWhere).get();
    const bytes = value == null ? 0 : byteLength(key) + byteLength(value);
    const total = (usage?.bytes ?? 0) - (old?.bytes ?? 0) + bytes;
    const count = (usage?.count ?? 0) + (value == null ? (old ? -1 : 0) : old ? 0 : 1);
    if (total > 1024 * 1024 || count > 256) throw new Error('quota-exceeded');
    if (value == null) await tx.delete(nappletData).where(where);
    else
      await tx
        .insert(nappletData)
        .values({ ...scope, bucket, key, value, bytes })
        .onConflictDoUpdate({
          target: [
            nappletData.accountPubkey,
            nappletData.appKey,
            nappletData.artifactHash,
            nappletData.bucket,
            nappletData.key,
          ],
          set: { value, bytes },
        });
    await tx
      .insert(nappletUsage)
      .values({ ...scope, bucket, bytes: total, count })
      .onConflictDoUpdate({
        target: [
          nappletUsage.accountPubkey,
          nappletUsage.appKey,
          nappletUsage.artifactHash,
          nappletUsage.bucket,
        ],
        set: { bytes: total, count },
      });
  });
}

/** Explicit migration copies only shared application KV, never grants or host settings. */
export async function migrateStorage(from: AppScope, to: AppScope): Promise<void> {
  if (
    from.accountPubkey !== to.accountPubkey ||
    from.appKey !== to.appKey ||
    from.artifactHash === to.artifactHash
  )
    throw new Error('invalid-migration');
  await db.transaction(async (tx) => {
    if (!(await canReceiveForAccount(to.accountPubkey, tx))) throw new Error('account-unavailable');
    const existing = await tx
      .select({ key: nappletData.key })
      .from(nappletData)
      .where(scopeWhere(to, 'storage'))
      .limit(1);
    if (existing.length) throw new Error('napplets.migration_not_empty');
    const rows = await tx.select().from(nappletData).where(scopeWhere(from, 'storage')).limit(257);
    const total = rows.reduce((sum, row) => sum + row.bytes, 0);
    if (rows.length > 256 || total > 1024 * 1024) throw new Error('quota-exceeded');
    for (let offset = 0; offset < rows.length; offset += 64)
      await tx
        .insert(nappletData)
        .values(rows.slice(offset, offset + 64).map((row) => ({ ...row, ...to })));
    await tx
      .insert(nappletUsage)
      .values({ ...to, bucket: 'storage', bytes: total, count: rows.length })
      .onConflictDoUpdate({
        target: [
          nappletUsage.accountPubkey,
          nappletUsage.appKey,
          nappletUsage.artifactHash,
          nappletUsage.bucket,
        ],
        set: { bytes: total, count: rows.length },
      });
  });
}
