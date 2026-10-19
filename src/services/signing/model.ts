export type SignerAccessOperation = 'get-public-key' | 'nip04-encrypt' | 'nip04-decrypt' | 'nip44-encrypt' | 'nip44-decrypt';
export type SignerAccessScope = {
  operation: SignerAccessOperation;
  kind?: never;
  relays: string[];
  scopeKey?: never;
  recipient?: string;
};
export type SigningScope = SignerAccessScope | {
  operation: 'sign' | 'publish' | 'encrypt-publish' | 'relay-auth' | 'upload';
  kind: number;
  relays: string[];
  scopeKey?: string;
  recipient?: string;
};
export function isSignerAccess(scope: Pick<SigningScope, 'operation'>): scope is SignerAccessScope {
  return ['get-public-key', 'nip04-encrypt', 'nip04-decrypt', 'nip44-encrypt', 'nip44-decrypt'].includes(scope.operation);
}
export type SigningRequest = SigningScope & {
  accountPubkey: string;
  content: string;
  tags: string[][];
  createdAt: number;
};
export type SigningRule = {
  key: string;
  scope: SigningScope;
  decision: 'allow' | 'deny';
  duration: 'session' | 'always' | 'timed';
  createdAt: number;
  expiresAt?: number;
};
export type SigningActivity = { scope: Pick<SigningScope, 'operation' | 'kind'>; at: number; decision: 'allowed' | 'automatic' | 'denied' };
export type SigningSnapshot = { rules: SigningRule[]; activity: SigningActivity[] };
export type SigningRuleChange = {
  decision: 'allow' | 'deny' | 'ask';
  duration: SigningRule['duration'];
  expiresAt?: number;
};
export type SigningRuleTarget = Pick<SigningRule, 'key' | 'scope'>;
export const MAX_SIGNING_RULES = 64;
export const SIGNING_PERIODS = { '10m': 10 * 60000, '1h': 60 * 60000, '24h': 24 * 60 * 60000 } as const;
export const isSigningRuleActive = (rule: SigningRule) => rule.duration !== 'timed' ||
  (typeof rule.expiresAt === 'number' && Number.isFinite(rule.expiresAt) && rule.expiresAt > Date.now());

export function signingScope(request: SigningScope): SigningScope {
  if (isSignerAccess(request)) return { operation: request.operation, relays: [],
    ...(request.operation !== 'get-public-key' ? { recipient: request.recipient } : {}) };
  const qualified = request.scopeKey || (request.kind !== undefined && request.kind >= 30000 && request.kind < 40000)
    ? { scopeKey: request.scopeKey ?? '' } : {};
  if (request.operation === 'relay-auth') return { operation: request.operation, kind: request.kind, relays: [], ...qualified };
  if (request.operation === 'upload') return {
    operation: request.operation, kind: request.kind,
    relays: [...new Set(request.relays.map(value => new URL(value).href))].sort(), ...qualified,
  };
  return { operation: 'publish', kind: request.kind, relays: [],
    ...qualified };
}
export function signingRuleKey(request: SigningScope): string {
  return JSON.stringify(signingScope(request));
}
export function canRememberSigning(request: SigningScope): boolean {
  if (request.scopeKey !== undefined && (typeof request.scopeKey !== 'string' || request.scopeKey.length > 4096)) return false;
  if (isSignerAccess(request)) return request.operation === 'get-public-key' ||
    typeof request.recipient === 'string' && /^[a-f0-9]{64}$/.test(request.recipient);
  if (request.operation === 'relay-auth' || request.operation === 'upload') {
    if (request.kind !== (request.operation === 'relay-auth' ? 22242 : 24242) ||
      (request.operation === 'upload' && !request.relays.length) || request.relays.length > 16) return false;
    return request.relays.every(value => {
      try { const url = new URL(value); return !!url.hostname && !url.username && !url.password &&
        (request.operation === 'relay-auth' ? ['ws:', 'wss:'] : ['https:']).includes(url.protocol); }
      catch { return false; }
    });
  }
  return Number.isInteger(request.kind) && request.kind >= 0 && request.kind <= 65535;
}
/** Management changes keep the original canonical scope and never broaden it. */
export function replaceSigningRule(rules: SigningRule[], source: SigningRuleTarget, change: SigningRuleChange): SigningRule[] {
  const scope = signingScope(source.scope);
  const key = signingRuleKey(scope);
  if (source.key !== key || !['allow', 'deny', 'ask'].includes(change.decision)) throw new Error('invalid-signing-permissions');
  const next = rules.filter((rule) => rule.key !== key && isSigningRuleActive(rule));
  if (change.decision === 'ask') return next;
  if (!canRememberSigning(scope) || !['always', 'timed', 'session'].includes(change.duration) ||
    (change.duration === 'timed' && (!Number.isSafeInteger(change.expiresAt) || change.expiresAt! <= Date.now())))
    throw new Error('invalid-signing-permissions');
  if (next.length >= MAX_SIGNING_RULES) throw new Error('quota-exceeded');
  next.push({ key, scope, decision: change.decision, duration: change.duration, createdAt: Date.now(),
    ...(change.duration === 'timed' ? { expiresAt: change.expiresAt } : {}) });
  if (JSON.stringify(next).length > 256 * 1024) throw new Error('quota-exceeded');
  return next;
}
