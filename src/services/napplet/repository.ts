import { visit } from '@/services/explore/repository';
import { fromNapplet } from '@/services/explore/model';
import { notifyNappletVisit } from './lifecycle';
import { and, asc, count, desc, eq, isNotNull } from 'drizzle-orm';
import { db } from '@/db/client';
import { nappletInstallations } from '@/db/schema';
import { canReceiveForAccount } from '@/services/account/account-receive-guard';
import { parseManifest, type NappletInstallation, type NappletRelease } from './protocol';

const verifiedReleases = new Map<string, NappletRelease>();
let cachedReleaseBytes = 0;
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
          previousManifest: null,
        },
      });
  });
}
export async function markRecent(accountPubkey: string, appKey: string, release?: NappletRelease): Promise<void> {
  await db
    .update(nappletInstallations)
    .set({ lastUsedAt: Date.now() })
    .where(
      and(
        eq(nappletInstallations.accountPubkey, accountPubkey),
        eq(nappletInstallations.appKey, appKey),
      ),
    );
  if (release) {
    await visit(accountPubkey, fromNapplet(release));
    notifyNappletVisit(accountPubkey, release);
  }
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

export { getData, setData, dataKeys, dataEntries } from './data-repository';
export type { AppScope } from './data-repository';
