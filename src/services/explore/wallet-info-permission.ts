import i18n from '@/i18n/core';
import { assertNotAborted } from '@/platform/abort';
import type { RuntimePrompt } from '@/services/napplet/runtime';
import { ensureAppAuthorization } from '@/services/app-authorization/initialize';
import { automaticallyAllowsWalletInfo } from '@/services/app-authorization/policy';
import { queueAuthorization } from '@/services/signing/authorization-queue';
import { signingRevision } from '@/services/signing/changes';
import { SIGNING_PERIODS } from '@/services/signing/model';
import { readAppAuthorization, type SigningAccountScope } from '@/services/signing/repository';
import { readBrowserPermissions, saveBrowserPermissions } from './browser-permission-store';
import { WALLET_INFO_PERMISSION } from './browser-permissions';

/** Indexed policy reads observe authorization and rule changes from other windows. */
export async function authorizeWalletInfo(scope: SigningAccountScope, title: string, signal: AbortSignal,
  confirm: (prompt: RuntimePrompt, signal: AbortSignal) => Promise<string | false>): Promise<() => void> {
  // Choose outside the information queue: both flows serialize on the same source.
  await ensureAppAuthorization(scope, reviewSignal => confirm({ title: i18n.t('applications.app_authorization_level_title'),
    detail: '', accountPubkey: scope.accountPubkey, requester: { title, origin: scope.sourceId }, appAuthorizationLevel: true }, reviewSignal), signal);
  return queueAuthorization(scope, [signal], async () => {
    let revision = signingRevision(scope);
    let expiresAt: number | null = null;
    const check = () => {
      assertNotAborted(signal);
      if (signingRevision(scope) !== revision || expiresAt !== null && expiresAt <= Date.now()) throw new Error('permission-revoked');
    };
    // Recheck after queueing so a concurrent authorization change cannot leave stale authority.
    const authorization = await readAppAuthorization(scope);
    check();
    if (!authorization) throw new Error('permission-revoked');
    if (automaticallyAllowsWalletInfo(authorization)) return check;
    const saved = (await readBrowserPermissions(scope, WALLET_INFO_PERMISSION))[0];
    check();
    if (saved && (saved.expiresAt === null || saved.expiresAt > Date.now())) {
      if (saved.decision !== 'allow') throw new Error('permission-denied');
      expiresAt = saved.expiresAt;
      return check;
    }
    const answer = await confirm({ title: i18n.t('webln.access_title'), detail: i18n.t('webln.access_notice'),
      accountPubkey: scope.accountPubkey, requester: { title, origin: scope.sourceId }, walletAccess: true }, signal);
    check();
    const period = typeof answer === 'string' ? answer.replace(/^(allow|deny)-/, '') : '';
    const timed = Object.hasOwn(SIGNING_PERIODS, period);
    const allowed = answer === 'allow' || answer === 'allow-always' || timed && typeof answer === 'string' && answer.startsWith('allow-');
    const remembered = answer === 'allow-always' || answer === 'deny-always' || timed && typeof answer === 'string' && /^(allow|deny)-/.test(answer);
    if (remembered) {
      expiresAt = timed ? Date.now() + SIGNING_PERIODS[period as keyof typeof SIGNING_PERIODS] : null;
      revision = await saveBrowserPermissions(scope, [WALLET_INFO_PERMISSION], allowed ? 'allow' : 'deny', expiresAt, check);
      check();
    }
    if (!allowed) throw new Error('permission-denied');
    return check;
  });
}
