import { and, eq } from 'drizzle-orm';
import { db, type Database } from '@/db/client';
import { nappletData, nappletUsage } from '@/db/schema';
import { canReceiveForAccount } from '@/services/account/account-receive-guard';

export type AppScope = { accountPubkey: string; appKey: string };
const byteLength = (value: string) => new TextEncoder().encode(value).length;
const scopeWhere = (scope: AppScope, bucket: string) =>
  and(
    eq(nappletData.accountPubkey, scope.accountPubkey),
    eq(nappletData.appKey, scope.appKey),
    eq(nappletData.bucket, bucket),
  );
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
  transaction?: Database,
): Promise<void> {
  if (key.length > 256 || (value != null && value.length > 1024 * 1024))
    throw new Error('quota-exceeded');
  const write = async (tx: Database) => {
    if (!(await canReceiveForAccount(scope.accountPubkey, tx)))
      throw new Error('account-unavailable');
    const where = and(scopeWhere(scope, bucket), eq(nappletData.key, key));
    const old = await tx.select({ bytes: nappletData.bytes }).from(nappletData).where(where).get();
    const usageWhere = and(
      eq(nappletUsage.accountPubkey, scope.accountPubkey),
      eq(nappletUsage.appKey, scope.appKey),
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
          nappletUsage.bucket,
        ],
        set: { bytes: total, count },
      });
  };
  if (transaction) await write(transaction);
  else await db.transaction(write);
}
