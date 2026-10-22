import { and, count, desc, eq, sql } from 'drizzle-orm';
import { db } from '@/db/client';
import { signingAuthorizations, signingActivity } from '@/db/schema';
import { canReceiveForAccount } from '@/services/account/account-receive-guard';
import { canRememberSigning, isSignerAccess, signingRuleKey, signingScope, type SigningActivity, type SigningRule, type SigningScope, type SigningSnapshot } from './model';
import { invalidateSigning, invalidateSigningAccount } from './changes';

export type SigningAccountScope = { accountPubkey: string; sourceId: string };
const whereSource = (scope: SigningAccountScope) => and(eq(signingAuthorizations.accountPubkey, scope.accountPubkey), eq(signingAuthorizations.sourceId, scope.sourceId));
function storageScope(scope: SigningScope) {
  const canonical = signingScope(scope);
  // Non-event operations have no event kind; the legacy NOT NULL column uses -1.
  return { operation: canonical.operation, kind: canonical.kind ?? -1,
    scopeKey: canonical.scopeKey ?? '', recipient: '',
    destinations: JSON.stringify(canonical.relays) };
}
const whereRule = (scope: SigningAccountScope, rule: SigningScope) => {
  const value = storageScope(rule);
  return and(whereSource(scope), eq(signingAuthorizations.operation, value.operation), eq(signingAuthorizations.kind, value.kind),
    eq(signingAuthorizations.scopeKey, value.scopeKey), eq(signingAuthorizations.recipient, value.recipient), value.operation === 'relay-auth' ? undefined : eq(signingAuthorizations.destinations, value.destinations));
};

export async function readSigningSnapshot(scope: SigningAccountScope): Promise<SigningSnapshot> {
  const [rules, activity] = await Promise.all([
    db.select().from(signingAuthorizations).where(whereSource(scope)).limit(64),
    db.select().from(signingActivity).where(and(eq(signingActivity.accountPubkey, scope.accountPubkey), eq(signingActivity.sourceId, scope.sourceId))).orderBy(desc(signingActivity.id)).limit(32),
  ]);
  return {
    rules: rules.filter((row) => row.expiresAt === null || row.expiresAt > Date.now()).flatMap((row) => {
      const operation = row.operation as SigningScope['operation'];
      let canonical: SigningScope;
      const access = { operation, relays: [] as string[] };
      if (isSignerAccess(access)) {
        if (row.recipient) return [];
        canonical = signingScope(access);
        if (!canRememberSigning(canonical) || row.kind !== -1) return [];
      } else {
        if (!['publish', 'relay-auth', 'upload'].includes(operation) || !Number.isInteger(row.kind) || row.kind < 0 || row.kind > 65535) return [];
        let destinations: unknown;
        try { destinations = JSON.parse(row.destinations); } catch { return []; }
        if (!Array.isArray(destinations) || destinations.some(value => typeof value !== 'string') ||
          (operation === 'relay-auth' && destinations.length)) return [];
        const scope: SigningScope = { operation: operation as 'publish' | 'relay-auth' | 'upload', kind: row.kind, relays: destinations,
          ...(row.scopeKey || (row.kind >= 30000 && row.kind < 40000) ? { scopeKey: row.scopeKey } : {}) };
        if (!canRememberSigning(scope)) return [];
        canonical = signingScope(scope);
      }
      return [{ key: signingRuleKey(canonical), scope: canonical, decision: row.decision,
        duration: row.expiresAt === null ? 'always' as const : 'timed' as const,
        createdAt: row.createdAt, ...(row.expiresAt !== null ? { expiresAt: row.expiresAt } : {}) }];
    }),
    activity: activity.reverse().map((row) => {
      const operation = row.operation as SigningActivity['scope']['operation'];
      return { scope: { operation, ...(isSignerAccess({ operation }) ? {} : { kind: row.kind }) }, at: row.at, decision: row.decision };
    }),
  };
}

/** Write one rule atomically; callers can invalidate an in-flight request before commit. */
export async function saveSigningRule(scope: SigningAccountScope, rule: SigningRule, guard?: () => void): Promise<number> {
  if (rule.duration === 'session') throw new Error('invalid-signing-permissions');
  const value = storageScope(rule.scope);
  if (signingRuleKey(rule.scope) !== rule.key) throw new Error('invalid-signing-permissions');
  await db.transaction(async (tx) => {
    guard?.();
    if (!await canReceiveForAccount(scope.accountPubkey, tx)) throw new Error('account-unavailable');
    await tx.delete(signingAuthorizations).where(and(whereSource(scope), sql`${signingAuthorizations.expiresAt} <= ${Date.now()}`));
    const existing = await tx.select({ id: signingAuthorizations.id }).from(signingAuthorizations)
      .where(whereRule(scope, rule.scope)).get();
    if (!existing) {
      const size = await tx.select({ total: count() }).from(signingAuthorizations).where(whereSource(scope)).get();
      if ((size?.total ?? 0) >= 64) throw new Error('quota-exceeded');
    }
    guard?.();
    const now = Date.now();
    await tx.insert(signingAuthorizations).values({ ...scope, ...value, decision: rule.decision,
      expiresAt: rule.duration === 'timed' ? rule.expiresAt! : null, createdAt: rule.createdAt, updatedAt: now })
      .onConflictDoUpdate({ target: [signingAuthorizations.accountPubkey, signingAuthorizations.sourceId, signingAuthorizations.operation, signingAuthorizations.kind, signingAuthorizations.scopeKey, signingAuthorizations.recipient, signingAuthorizations.destinations],
        set: { decision: rule.decision, expiresAt: rule.duration === 'timed' ? rule.expiresAt! : null, updatedAt: now } });
    guard?.();
  });
  return invalidateSigning(scope, rule.key);
}
export async function deleteSigningRule(scope: SigningAccountScope, key: string): Promise<number> {
  const parsed = JSON.parse(key) as SigningRule['scope'];
  if (signingRuleKey(parsed) !== key) throw new Error('invalid-signing-permissions');
  await db.delete(signingAuthorizations).where(whereRule(scope, parsed));
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
    await tx.insert(signingActivity).values({ ...scope, operation: entry.scope.operation, kind: entry.scope.kind ?? -1, decision: entry.decision, at: entry.at });
    await tx.run(sql`DELETE FROM signing_activity WHERE account_pubkey=${scope.accountPubkey} AND source_id=${scope.sourceId}
      AND id NOT IN (SELECT id FROM signing_activity WHERE account_pubkey=${scope.accountPubkey} AND source_id=${scope.sourceId} ORDER BY id DESC LIMIT 32)`);
  });
}
export async function clearAccountSigningPermissions(accountPubkey: string): Promise<void> {
  invalidateSigningAccount(accountPubkey);
  await db.delete(signingAuthorizations).where(eq(signingAuthorizations.accountPubkey, accountPubkey));
  invalidateSigningAccount(accountPubkey);
}
