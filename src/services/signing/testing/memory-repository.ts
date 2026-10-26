import type { SigningAccountScope } from '../repository';
import type { SigningRule, SigningActivity } from '../model';
import { invalidateSigning } from '../changes';

export const rules = new Map<string, SigningRule[]>();
export const activity = new Map<string, SigningActivity[]>();
const id = (scope: SigningAccountScope) => JSON.stringify(scope);
export const memoryRepository = {
  readSigningSnapshot: jest.fn(async (scope: SigningAccountScope) => ({ rules: structuredClone(rules.get(id(scope)) ?? []), activity: structuredClone(activity.get(id(scope)) ?? []) })),
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
  clearSigningPermissions: jest.fn(async (scope: SigningAccountScope) => { rules.delete(id(scope)); invalidateSigning(scope); }),
  recordSigningActivity: jest.fn(async (scope: SigningAccountScope, entry: SigningActivity) => {
    activity.set(id(scope), [...(activity.get(id(scope)) ?? []), entry].slice(-32));
  }),
};
