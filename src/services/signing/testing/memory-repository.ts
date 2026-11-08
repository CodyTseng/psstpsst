import type { AppAuthorizationLevel } from '@/services/app-authorization/model';
import type { SigningAccountScope } from '../repository';
import type { SigningRule, SigningActivity } from '../model';
import { invalidateSigning } from '../changes';

/** Legacy fixtures start in Manual; first-use tests explicitly install an undefined level. */
export const levels = new Map<string, AppAuthorizationLevel | undefined>();
export const rules = new Map<string, SigningRule[]>();
export const activity = new Map<string, SigningActivity[]>();
const id = (scope: SigningAccountScope) => JSON.stringify(scope);
export const memoryRepository = {
  readAppAuthorizationLevel: jest.fn(async (scope: SigningAccountScope) => levels.has(id(scope)) ? levels.get(id(scope)) : 'manual'),
  readSigningSnapshot: jest.fn(async (scope: SigningAccountScope) => ({ level: levels.has(id(scope)) ? levels.get(id(scope)) : 'manual', rules: structuredClone(rules.get(id(scope)) ?? []), activity: structuredClone(activity.get(id(scope)) ?? []) })),
  saveAppAuthorizationLevel: jest.fn(async (scope: SigningAccountScope, level: AppAuthorizationLevel, guard?: () => void) => {
    guard?.(); levels.set(id(scope), level); return invalidateSigning(scope, 'level');
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
  clearSigningPermissions: jest.fn(async (scope: SigningAccountScope) => { rules.delete(id(scope)); levels.set(id(scope), undefined); invalidateSigning(scope); }),
  recordSigningActivity: jest.fn(async (scope: SigningAccountScope, entry: SigningActivity) => {
    activity.set(id(scope), [...(activity.get(id(scope)) ?? []), entry].slice(-32));
  }),
};
