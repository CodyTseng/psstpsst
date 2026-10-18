import { SigningPermissions as SharedSigningPermissions } from '@/services/signing/permissions';
import { readSigningSnapshot as readSharedSnapshot } from '@/services/signing/repository';
import { signingSourceFromLegacyKey } from '@/services/signing/source';
import type { AppScope } from './repository';
import type { NappletRelease } from './protocol';
import type { RuntimePrompt } from './runtime';

export { signingScope, signingRuleKey, canRememberSigning, replaceSigningRule, PROTECTED_EVENT_KINDS, SIGNING_PERIODS } from '@/services/signing/model';
export type { SigningScope, SigningRequest, SigningRule, SigningActivity, SigningSnapshot, SigningRuleChange, SigningRuleTarget } from '@/services/signing/model';
export function appSigningScope(scope: AppScope) {
  return { accountPubkey: scope.accountPubkey, sourceId: signingSourceFromLegacyKey(scope.appKey) };
}
export function readSigningSnapshot(scope: AppScope) { return readSharedSnapshot(appSigningScope(scope)); }

/** The app adapter supplies display context; authorization storage has no app dependency. */
export class SigningPermissions extends SharedSigningPermissions {
  constructor(scope: AppScope, release: NappletRelease, confirm: (prompt: RuntimePrompt, signal?: AbortSignal) => Promise<string | false>, signal: AbortSignal, changed: () => void) {
    super(appSigningScope(scope), (request, signal) => confirm({ title: release.title, detail: '', app: release,
      accountPubkey: scope.accountPubkey, signing: request }, signal), signal, changed);
  }
}
