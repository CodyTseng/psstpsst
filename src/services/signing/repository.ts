import { and, count, desc, eq, sql } from 'drizzle-orm';
import { db } from '@/db/client';
import { signingAuthorizations, signingActivity } from '@/db/schema';
import { canReceiveForAccount } from '@/services/account/account-receive-guard';
import type { SigningActivity, SigningRule, SigningSnapshot } from './model';
import { invalidateSigning, invalidateSigningAccount } from './changes';

export type SigningAccountScope = { accountPubkey: string; sourceId: string };
const whereSource = (scope: SigningAccountScope) => and(eq(signingAuthorizations.accountPubkey, scope.accountPubkey), eq(signingAuthorizations.sourceId, scope.sourceId));
const dTag = (rule: Pick<SigningRule, 'scope'>) => rule.scope.kind >= 30000 && rule.scope.kind < 40000 ? rule.scope.identifier ?? '' : '';

export async function readSigningSnapshot(scope: SigningAccountScope): Promise<SigningSnapshot> {
  const [rules, activity] = await Promise.all([
    db.select().from(signingAuthorizations).where(whereSource(scope)).limit(64),
    db.select().from(signingActivity).where(and(eq(signingActivity.accountPubkey, scope.accountPubkey), eq(signingActivity.sourceId, scope.sourceId))).orderBy(desc(signingActivity.id)).limit(32),
  ]);
  return {
    rules: rules.filter((row) => row.expiresAt === null || row.expiresAt > Date.now()).map((row) => {
      const canonical = { operation: 'publish' as const, kind: row.kind, relays: [] as string[],
        ...(row.kind >= 30000 && row.kind < 40000 ? { identifier: row.dTag } : {}) };
      return { key: JSON.stringify(canonical), scope: canonical, decision: row.decision,
        duration: row.expiresAt === null ? 'always' as const : 'timed' as const,
        createdAt: row.createdAt, ...(row.expiresAt !== null ? { expiresAt: row.expiresAt } : {}) };
    }),
    activity: activity.reverse().map((row) => ({ scope: { operation: row.operation as SigningActivity['scope']['operation'], kind: row.kind }, at: row.at, decision: row.decision })),
  };
}

/** Write one rule atomically; callers can invalidate an in-flight request before commit. */
export async function saveSigningRule(scope: SigningAccountScope, rule: SigningRule, guard?: () => void): Promise<number> {
  if (rule.duration === 'session') throw new Error('invalid-signing-permissions');
  await db.transaction(async (tx) => {
    guard?.();
    if (!await canReceiveForAccount(scope.accountPubkey, tx)) throw new Error('account-unavailable');
    await tx.delete(signingAuthorizations).where(and(whereSource(scope), sql`${signingAuthorizations.expiresAt} <= ${Date.now()}`));
    const existing = await tx.select({ id: signingAuthorizations.id }).from(signingAuthorizations)
      .where(and(whereSource(scope), eq(signingAuthorizations.kind, rule.scope.kind), eq(signingAuthorizations.dTag, dTag(rule)))).get();
    if (!existing) {
      const size = await tx.select({ total: count() }).from(signingAuthorizations).where(whereSource(scope)).get();
      if ((size?.total ?? 0) >= 64) throw new Error('quota-exceeded');
    }
    guard?.();
    const now = Date.now();
    await tx.insert(signingAuthorizations).values({ ...scope, kind: rule.scope.kind, dTag: dTag(rule), decision: rule.decision,
      expiresAt: rule.duration === 'timed' ? rule.expiresAt! : null, createdAt: rule.createdAt, updatedAt: now })
      .onConflictDoUpdate({ target: [signingAuthorizations.accountPubkey, signingAuthorizations.sourceId, signingAuthorizations.kind, signingAuthorizations.dTag],
        set: { decision: rule.decision, expiresAt: rule.duration === 'timed' ? rule.expiresAt! : null, updatedAt: now } });
    guard?.();
  });
  return invalidateSigning(scope, rule.key);
}
export async function deleteSigningRule(scope: SigningAccountScope, key: string): Promise<number> {
  const parsed = JSON.parse(key) as SigningRule['scope'];
  await db.delete(signingAuthorizations).where(and(whereSource(scope), eq(signingAuthorizations.kind, parsed.kind), eq(signingAuthorizations.dTag, dTag({ scope: parsed }))));
  return invalidateSigning(scope, key);
}
export async function clearSigningPermissions(scope: SigningAccountScope): Promise<void> {
  invalidateSigning(scope);
  await db.delete(signingAuthorizations).where(whereSource(scope));
  invalidateSigning(scope);
}
export async function recordSigningActivity(scope: SigningAccountScope, entry: SigningActivity): Promise<void> {
  await db.transaction(async (tx) => {
    if (!await canReceiveForAccount(scope.accountPubkey, tx)) throw new Error('account-unavailable');
    await tx.insert(signingActivity).values({ ...scope, operation: entry.scope.operation, kind: entry.scope.kind, decision: entry.decision, at: entry.at });
    await tx.run(sql`DELETE FROM signing_activity WHERE account_pubkey=${scope.accountPubkey} AND source_id=${scope.sourceId}
      AND id NOT IN (SELECT id FROM signing_activity WHERE account_pubkey=${scope.accountPubkey} AND source_id=${scope.sourceId} ORDER BY id DESC LIMIT 32)`);
  });
}
export async function clearAccountSigningPermissions(accountPubkey: string): Promise<void> {
  invalidateSigningAccount(accountPubkey);
  await db.delete(signingAuthorizations).where(eq(signingAuthorizations.accountPubkey, accountPubkey));
  invalidateSigningAccount(accountPubkey);
}
