import { and, eq, gt, isNull, or } from 'drizzle-orm';
import { db } from '@/db/client';
import { browserAuthorizations } from '@/db/schema';
import { canReceiveForAccount } from '@/services/account/account-receive-guard';
import { invalidateSigning, invalidateSigningAccount } from '@/services/signing/changes';
import type { SigningAccountScope } from '@/services/signing/repository';
import { rememberBrowserPermission } from './browser-permissions';

export type BrowserPermissionRule = { resource: string; decision: 'allow' | 'deny'; expiresAt: number | null; updatedAt: number };
const source = (scope: SigningAccountScope) => and(eq(browserAuthorizations.accountPubkey, scope.accountPubkey), eq(browserAuthorizations.sourceId, scope.sourceId));
export async function readBrowserPermissions(scope: SigningAccountScope): Promise<BrowserPermissionRule[]> {
  return db.select({ resource: browserAuthorizations.resource, decision: browserAuthorizations.decision,
    expiresAt: browserAuthorizations.expiresAt, updatedAt: browserAuthorizations.updatedAt })
    .from(browserAuthorizations).where(and(source(scope), or(isNull(browserAuthorizations.expiresAt), gt(browserAuthorizations.expiresAt, Date.now())))).limit(32);
}
export async function saveBrowserPermissions(scope: SigningAccountScope, resources: string[], decision: 'allow' | 'deny', expiresAt: number | null, guard: () => void = () => {}) {
  if (!rememberBrowserPermission(resources) || !['allow', 'deny'].includes(decision) ||
    expiresAt !== null && (!Number.isSafeInteger(expiresAt) || expiresAt <= Date.now())) throw new Error('invalid-permissions');
  await db.transaction(async tx => {
    guard();
    if (!await canReceiveForAccount(scope.accountPubkey, tx)) throw new Error('account-unavailable');
    const updatedAt = Date.now();
    await tx.insert(browserAuthorizations).values([...new Set(resources)].map(resource => ({ ...scope, resource, decision, expiresAt, updatedAt })))
      .onConflictDoUpdate({ target: [browserAuthorizations.accountPubkey, browserAuthorizations.sourceId, browserAuthorizations.resource], set: { decision, expiresAt, updatedAt } });
    guard();
  });
  return invalidateSigning(scope, 'browser:*');
}
export async function clearBrowserPermissions(scope: SigningAccountScope, resource?: string) {
  await db.delete(browserAuthorizations).where(and(source(scope), resource === undefined ? undefined : eq(browserAuthorizations.resource, resource)));
  invalidateSigning(scope, 'browser:*');
}

export async function clearAccountBrowserPermissions(accountPubkey: string) {
  invalidateSigningAccount(accountPubkey);
  await db.delete(browserAuthorizations).where(eq(browserAuthorizations.accountPubkey, accountPubkey));
  invalidateSigningAccount(accountPubkey);
}
