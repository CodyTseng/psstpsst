import { EVERYDAY_SIGNING } from '@/services/app-authorization/policy';
import { signingRuleKey } from '../model';
import type { AppAuthorization, AppAuthorizationPreset } from '@/services/app-authorization/model';
import type { SigningAccountScope } from '../repository';
import type { SigningRule, SigningActivity } from '../model';
import { invalidateSigning } from '../changes';

/** Legacy fixtures start initialized; first-use tests explicitly install an undefined authorization. */
export const authorizations = new Map<string, AppAuthorization | undefined>();
export const walletRules = new Map<string, { resource: string; decision: 'allow'; expiresAt: null; updatedAt: number }>();
export const rules = new Map<string, SigningRule[]>();
export const activity = new Map<string, SigningActivity[]>();
const id = (scope: SigningAccountScope) => JSON.stringify(scope);
export const memoryRepository = {
  readAppAuthorization: jest.fn(async (scope: SigningAccountScope) => authorizations.has(id(scope)) ? authorizations.get(id(scope)) : { fullyTrusted: false }),
  readSigningSnapshot: jest.fn(async (scope: SigningAccountScope) => ({ authorization: authorizations.has(id(scope)) ? authorizations.get(id(scope)) : { fullyTrusted: false }, rules: structuredClone(rules.get(id(scope)) ?? []), activity: structuredClone(activity.get(id(scope)) ?? []) })),
  initializeAppAuthorization: jest.fn(async (scope: SigningAccountScope, level: AppAuthorizationPreset, guard?: () => void) => {
    guard?.();
    if (authorizations.get(id(scope))) throw new Error('authorization-already-initialized');
    authorizations.set(id(scope), { fullyTrusted: level === 'trusted' });
    if (level === 'routine') {
      walletRules.set(id(scope), { resource: 'webln-info', decision: 'allow', expiresAt: null, updatedAt: Date.now() });
      const existing = rules.get(id(scope)) ?? [];
      const keys = new Set(existing.map(rule => rule.key));
      rules.set(id(scope), [...existing, ...EVERYDAY_SIGNING.filter(scope => !keys.has(signingRuleKey(scope))).map(scope => ({
        key: signingRuleKey(scope), scope, decision: 'allow' as const, duration: 'always' as const, createdAt: Date.now(),
      }))]);
    }
    return invalidateSigning(scope);
  }),
  setFullyTrusted: jest.fn(async (scope: SigningAccountScope, fullyTrusted: boolean) => {
    authorizations.set(id(scope), { fullyTrusted }); invalidateSigning(scope, 'trust');
  }),
  saveSigningRule: jest.fn(async (scope: SigningAccountScope, rule: SigningRule, guard?: () => void) => {
    guard?.();
    const next = (rules.get(id(scope)) ?? []).filter((item) => item.key !== rule.key);
    next.push(structuredClone(rule)); rules.set(id(scope), next);
    return invalidateSigning(scope, rule.key);
  }),
  deleteSigningRule: jest.fn(async (scope: SigningAccountScope, key: string) => {
    rules.set(id(scope), (rules.get(id(scope)) ?? []).filter((item) => item.key !== key));
    return invalidateSigning(scope, key);
  }),
  clearSigningPermissions: jest.fn(async (scope: SigningAccountScope) => { rules.delete(id(scope)); authorizations.set(id(scope), undefined); invalidateSigning(scope); }),
  recordSigningActivity: jest.fn(async (scope: SigningAccountScope, entry: SigningActivity) => {
    activity.set(id(scope), [...(activity.get(id(scope)) ?? []), entry].slice(-32));
  }),
};
