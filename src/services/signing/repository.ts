import { isAppAuthorizationPreset, type AppAuthorization, type AppAuthorizationPreset } from '@/services/app-authorization/model';
import { EVERYDAY_ACCESS, EVERYDAY_SIGNING } from '../app-authorization/policy';
import { getData, setData } from '../napplet/data-repository';
import { WALLET_INFO_PERMISSION } from '../explore/browser-permissions';
import { isApplicationAction } from './action-request';
import { and, desc, eq, sql } from 'drizzle-orm';
import { db, type Database } from '@/db/client';
import { signingAuthorizations, signingActivity, appAuthorizationPreferences, localApplications, browserAuthorizations } from '@/db/schema';
import { canReceiveForAccount } from '@/services/account/account-receive-guard';
import { canRememberSigning, isSignerAccess, signingRuleKey, signingScope, type SigningActivity, type SigningRule, type SigningScope, type SigningSnapshot } from './model';
import { invalidateSigning, invalidateSigningAccount } from './changes';

export type SigningAccountScope = { accountPubkey: string; sourceId: string; localVersion?: string };
/** A document's version is a write precondition, never part of the durable source identity. */
export async function assertCurrentSigningSource(scope: SigningAccountScope, transaction: Database = db): Promise<void> {
  if (scope.localVersion === undefined) return;
  const row = await transaction.select({ version: localApplications.version }).from(localApplications)
    .where(and(eq(localApplications.accountPubkey, scope.accountPubkey), eq(localApplications.appId, scope.sourceId))).get();
  if (row?.version !== scope.localVersion) throw new Error('permission-revoked');
}
const whereSource = (scope: SigningAccountScope) => and(eq(signingAuthorizations.accountPubkey, scope.accountPubkey), eq(signingAuthorizations.sourceId, scope.sourceId));
function storageScope(scope: SigningScope) {
  const canonical = signingScope(scope);
  // Non-event operations have no event kind; the legacy NOT NULL column uses -1.
  return { operation: canonical.operation, kind: canonical.kind ?? -1,
    scopeKey: canonical.scopeKey ?? '' };
}
const whereRule = (scope: SigningAccountScope, rule: SigningScope) => {
  const value = storageScope(rule);
  return and(whereSource(scope), eq(signingAuthorizations.operation, value.operation), eq(signingAuthorizations.kind, value.kind),
    eq(signingAuthorizations.scopeKey, value.scopeKey));
};

export async function readSigningSnapshot(scope: SigningAccountScope): Promise<SigningSnapshot> {
  await assertCurrentSigningSource(scope);
  const [rules, activity, preference] = await Promise.all([
    db.select().from(signingAuthorizations).where(whereSource(scope)),
    db.select().from(signingActivity).where(and(eq(signingActivity.accountPubkey, scope.accountPubkey), eq(signingActivity.sourceId, scope.sourceId))).orderBy(desc(signingActivity.id)).limit(32),
    db.select().from(appAuthorizationPreferences).where(preferenceSource(scope)).get(),
  ]);
  return {
    authorization: preference ? { fullyTrusted: preference.fullyTrusted } : undefined,
    rules: rules.filter((row) => row.expiresAt === null || row.expiresAt > Date.now()).flatMap((row) => {
      const operation = row.operation as SigningScope['operation'];
      let canonical: SigningScope;
      const access = { operation, relays: [] as string[] };
      if (isSignerAccess(access)) {
        canonical = signingScope(access);
        if (!canRememberSigning(canonical) || row.kind !== -1) return [];
      } else {
        if (!['publish', 'relay-auth', 'http-auth', 'upload'].includes(operation) || !Number.isInteger(row.kind) || row.kind < 0 || row.kind > 65535) return [];
        const scope: SigningScope = { operation: operation as 'publish' | 'relay-auth' | 'http-auth' | 'upload', kind: row.kind, relays: [],
          ...(row.scopeKey || (row.kind >= 30000 && row.kind < 40000) ? { scopeKey: row.scopeKey } : {}) };
        if (!canRememberSigning(scope) || isApplicationAction(scope) && row.scopeKey) return [];
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
    await assertCurrentSigningSource(scope, tx);
    if (!await canReceiveForAccount(scope.accountPubkey, tx)) throw new Error('account-unavailable');
    await tx.delete(signingAuthorizations).where(and(whereSource(scope), sql`${signingAuthorizations.expiresAt} <= ${Date.now()}`));
    guard?.();
    const now = Date.now();
    await tx.insert(signingAuthorizations).values({ accountPubkey: scope.accountPubkey, sourceId: scope.sourceId, ...value, decision: rule.decision,
      expiresAt: rule.duration === 'timed' ? rule.expiresAt! : null, createdAt: rule.createdAt, updatedAt: now })
      .onConflictDoUpdate({ target: [signingAuthorizations.accountPubkey, signingAuthorizations.sourceId, signingAuthorizations.operation, signingAuthorizations.kind, signingAuthorizations.scopeKey],
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
  await db.transaction(async tx => {
    await tx.delete(signingAuthorizations).where(whereSource(scope));
    await tx.delete(appAuthorizationPreferences).where(preferenceSource(scope));
  });
  invalidateSigning(scope);
}
export async function recordSigningActivity(scope: SigningAccountScope, entry: SigningActivity): Promise<void> {
  await db.transaction(async (tx) => {
    await assertCurrentSigningSource(scope, tx);
    if (!await canReceiveForAccount(scope.accountPubkey, tx)) throw new Error('account-unavailable');
    await tx.insert(signingActivity).values({ accountPubkey: scope.accountPubkey, sourceId: scope.sourceId, operation: entry.scope.operation, kind: entry.scope.kind ?? -1, decision: entry.decision, at: entry.at });
    await tx.run(sql`DELETE FROM signing_activity WHERE account_pubkey=${scope.accountPubkey} AND source_id=${scope.sourceId}
      AND id NOT IN (SELECT id FROM signing_activity WHERE account_pubkey=${scope.accountPubkey} AND source_id=${scope.sourceId} ORDER BY id DESC LIMIT 32)`);
  });
}
export async function clearAccountSigningPermissions(accountPubkey: string): Promise<void> {
  invalidateSigningAccount(accountPubkey);
  await db.transaction(async tx => {
    await tx.delete(signingAuthorizations).where(eq(signingAuthorizations.accountPubkey, accountPubkey));
    await tx.delete(appAuthorizationPreferences).where(eq(appAuthorizationPreferences.accountPubkey, accountPubkey));
  });
  invalidateSigningAccount(accountPubkey);
}

const preferenceSource = (scope: SigningAccountScope) => and(eq(appAuthorizationPreferences.accountPubkey, scope.accountPubkey), eq(appAuthorizationPreferences.sourceId, scope.sourceId));

/** Initialize once, atomically with the preset's ordinary grants. Reset is required to choose again. */
export async function initializeAppAuthorization(scope: SigningAccountScope, preset: AppAuthorizationPreset, guard?: () => void): Promise<number> {
  if (!isAppAuthorizationPreset(preset)) throw new Error('invalid-app-authorization-preset');
  await db.transaction(async tx => {
    guard?.();
    await assertCurrentSigningSource(scope, tx);
    if (!await canReceiveForAccount(scope.accountPubkey, tx)) throw new Error('account-unavailable');
    const existing = await tx.select().from(appAuthorizationPreferences).where(preferenceSource(scope)).get();
    if (existing) throw new Error('authorization-already-initialized');
    if (preset === 'routine') {
      const now = Date.now();
      await tx.insert(signingAuthorizations).values(EVERYDAY_SIGNING.map(rule => ({
        accountPubkey: scope.accountPubkey, sourceId: scope.sourceId, ...storageScope(rule),
        decision: 'allow' as const, expiresAt: null, createdAt: now, updatedAt: now,
      }))).onConflictDoNothing();
      await tx.insert(browserAuthorizations).values({ accountPubkey: scope.accountPubkey, sourceId: scope.sourceId,
        resource: WALLET_INFO_PERMISSION, decision: 'allow', expiresAt: null, updatedAt: now }).onConflictDoNothing();
      const appScope = { accountPubkey: scope.accountPubkey, appKey: scope.sourceId };
      const granted: string[] = JSON.parse(await getData(appScope, 'permissions', 'domains', tx) ?? '[]');
      const denied = new Set<string>(JSON.parse(await getData(appScope, 'permissions', 'denied-domains', tx) ?? '[]'));
      await setData(appScope, 'permissions', 'domains', JSON.stringify([...new Set([...granted,
        ...EVERYDAY_ACCESS.filter(domain => !denied.has(domain))])]), tx);
    }
    await tx.insert(appAuthorizationPreferences).values({ accountPubkey: scope.accountPubkey, sourceId: scope.sourceId,
      fullyTrusted: preset === 'trusted' });
    guard?.();
  });
  return invalidateSigning(scope);
}

/** Changing trust preserves durable rules but clears execution-local approvals in every host. */
export async function setFullyTrusted(scope: SigningAccountScope, fullyTrusted: boolean): Promise<void> {
  if (typeof fullyTrusted !== 'boolean') throw new Error('invalid-permissions');
  await db.transaction(async tx => {
    await assertCurrentSigningSource(scope, tx);
    if (!await canReceiveForAccount(scope.accountPubkey, tx)) throw new Error('account-unavailable');
    const existing = await tx.select().from(appAuthorizationPreferences).where(preferenceSource(scope)).get();
    if (!existing) throw new Error('authorization-not-initialized');
    await tx.update(appAuthorizationPreferences).set({ fullyTrusted }).where(preferenceSource(scope));
  });
  invalidateSigning(scope, 'trust');
}

/** Indexed first-use/trust read, independent of signing history or rules. */
export async function readAppAuthorization(scope: SigningAccountScope): Promise<AppAuthorization | undefined> {
  await assertCurrentSigningSource(scope);
  const preference = await db.select().from(appAuthorizationPreferences).where(preferenceSource(scope)).get();
  return preference ? { fullyTrusted: preference.fullyTrusted } : undefined;
}
