import { clearSigningPermissions, deleteSigningRule, readSigningSnapshot, saveSigningRule, type SigningAccountScope } from './repository';
import { replaceSigningRule, type SigningRuleTarget, type SigningRuleChange } from './model';
export { readSigningSnapshot as readPermissions, clearSigningPermissions as resetPermissions };
const edits = new Map<string, Promise<unknown>>();
export function updatePermissions(scope: SigningAccountScope, target: SigningRuleTarget, change: SigningRuleChange) {
  const key = JSON.stringify(scope);
  const task = (edits.get(key) ?? Promise.resolve()).then(async () => {
    const snapshot = await readSigningSnapshot(scope);
    const rules = replaceSigningRule(snapshot.rules, target, change);
    if (change.decision === 'ask')
      await deleteSigningRule(scope, target.key);
    else {
      const rule = rules.find(r => r.key === target.key)!;
      await saveSigningRule(scope, rule);
    }
  });
  const settled = task.catch(() => { }).finally(() => { if (edits.get(key) === settled)
    edits.delete(key); });
  edits.set(key, settled);
  return task;
}
