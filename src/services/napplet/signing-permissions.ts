import type { NappletRelease } from './protocol';
import { getData, setData, type AppScope } from './repository';
import type { RuntimePrompt } from './runtime';
import { assertNotAborted, linkAbort } from '@/platform/abort';

export type SigningScope = {
  operation: 'publish' | 'encrypt-publish' | 'relay-auth' | 'upload';
  kind: number;
  relays: string[];
  identifier?: string;
  recipient?: string;
};
export type SigningRequest = SigningScope & {
  accountPubkey: string;
  content: string;
  tags: string[][];
  createdAt: number;
  upload?: { filename: string; mimeType: string; size: number; sha256: string };
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
const MAX_RULES = 64;
export const PROTECTED_EVENT_KINDS = new Set([
  0, 3, 4, 5, 13, 14, 15, 1059, 10000, 10002, 10044, 10050, 10063, 22242, 24133, 24242, 27235,
]);
export const SIGNING_PERIODS = { '10m': 10 * 60000, '1h': 60 * 60000, '24h': 24 * 60 * 60000 } as const;
const activeRule = (rule: SigningRule) => rule.duration !== 'timed' ||
  (typeof rule.expiresAt === 'number' && Number.isFinite(rule.expiresAt) && rule.expiresAt > Date.now());

export function signingScope(request: SigningScope): SigningScope {
  return {
    operation: request.operation,
    kind: request.kind,
    relays: request.operation === 'relay-auth' || request.operation === 'upload' ? [...new Set(request.relays)].sort() : [],
    ...(request.identifier !== undefined ? { identifier: request.identifier } : {}),
    ...(request.recipient ? { recipient: request.recipient } : {}),
  };
}
export function signingRuleKey(request: SigningScope): string {
  return JSON.stringify(signingScope(request));
}
export function canRememberSigning(request: SigningScope): boolean {
  if (request.operation === 'relay-auth') return request.kind === 22242;
  if (request.operation === 'upload') return request.kind === 24242 && request.relays.length > 0;
  return Number.isInteger(request.kind) && request.kind >= 0 && request.kind <= 65535 &&
    !PROTECTED_EVENT_KINDS.has(request.kind) && !(request.kind >= 10000 && request.kind < 20000) && request.kind !== 30000;
}
/** An older reader must fail closed instead of treating timed grants as permanent. */
export function encodeSigningRules(rules: SigningRule[]): string {
  return JSON.stringify({ version: 3, rules });
}
export async function readSigningSnapshot(scope: AppScope): Promise<SigningSnapshot> {
  const [rules, activity] = await Promise.all([
    getData(scope, 'permissions', 'signing'),
    getData(scope, 'permissions', 'signing-activity'),
  ]);
  const parsed: unknown = rules ? JSON.parse(rules) : [];
  const entries = Array.isArray(parsed) ? parsed :
    parsed && typeof parsed === 'object' && 'version' in parsed && (parsed.version === 2 || parsed.version === 3) &&
      'rules' in parsed && Array.isArray(parsed.rules) ? parsed.rules : null;
  if (!entries) throw new Error('invalid-signing-permissions');
  const current = !Array.isArray(parsed) && parsed && typeof parsed === 'object' && 'version' in parsed && parsed.version === 3;
  return {
    rules: (entries as SigningRule[]).slice(-MAX_RULES).filter((rule) => (current || rule.scope?.operation === 'relay-auth') && activeRule(rule)),
    activity: activity ? (JSON.parse(activity) as SigningActivity[]).slice(-32) : [],
  };
}

/** Cached per execution session; persistent grants remain account/app/artifact scoped. */
export class SigningPermissions {
  private loaded?: Promise<void>;
  private revision = 0;
  private revoked = new Set<string>();
  private rules: SigningRule[] = [];
  private activity: SigningActivity[] = [];
  private writes: Promise<unknown> = Promise.resolve();
  constructor(
    private scope: AppScope,
    private release: NappletRelease,
    private confirm: (prompt: RuntimePrompt, signal?: AbortSignal) => Promise<string | false>,
    private signal: AbortSignal,
    private changed: () => void,
  ) {}

  private load() {
    return this.loaded ??= readSigningSnapshot(this.scope).then((value) => {
      assertNotAborted(this.signal);
      this.rules = value.rules;
      this.activity = value.activity;
    });
  }
  async snapshot(): Promise<SigningSnapshot> {
    await this.load();
    assertNotAborted(this.signal);
    return { rules: this.rules.filter(activeRule), activity: [...this.activity].reverse() };
  }
  get version(): number { return this.revision; }
  async settled(): Promise<void> { await this.writes.catch(() => {}); }

  async revoke(key: string): Promise<void> {
    this.revision++;
    this.revoked.add(key);
    await this.load();
    const update = this.writes.catch(() => {}).then(async () => {
      assertNotAborted(this.signal);
      const next = this.rules.filter((rule) => rule.key !== key);
      await setData(this.scope, 'permissions', 'signing', encodeSigningRules(next.filter((rule) => rule.duration !== 'session')));
      assertNotAborted(this.signal);
      this.rules = next;
      this.changed();
    });
    this.writes = update;
    await update;
  }

  async authorize(input: SigningRequest, expiresAt?: number, requestSignal?: AbortSignal): Promise<void> {
    const revision = this.revision;
    const current = () => {
      assertNotAborted(this.signal);
      assertNotAborted(requestSignal);
      if (revision !== this.revision) throw new Error('permission-denied');
    };
    // Freeze the approval payload before any await; the caller signs this same snapshot.
    const request: SigningRequest = JSON.parse(JSON.stringify(input));
    if (request.accountPubkey !== this.scope.accountPubkey) throw new Error('account-unavailable');
    await this.load();
    assertNotAborted(this.signal);
    if (expiresAt !== undefined && Date.now() >= expiresAt) throw new Error('timeout');
    current();
    const scope = signingScope(request);
    const key = signingRuleKey(scope);
    let rule = this.rules.find((entry) => entry.key === key && !this.revoked.has(key) && activeRule(entry));
    if (rule?.decision === 'allow' && !canRememberSigning(scope)) rule = undefined;
    if (rule) {
      await this.record(scope, rule.decision === 'allow' ? 'automatic' : 'denied');
      current();
      if (rule.decision === 'deny') throw new Error('permission-denied');
      return;
    }
    const linked = linkAbort(requestSignal ? [this.signal, requestSignal] : [this.signal]);
    let answer: string | false;
    try { answer = await this.confirm({
      title: this.release.title,
      detail: '',
      app: this.release,
      accountPubkey: this.scope.accountPubkey,
      signing: request,
      expiresAt,
    }, linked.signal); }
    finally { linked.dispose(); }
    assertNotAborted(this.signal);
    if (expiresAt !== undefined && Date.now() >= expiresAt) throw new Error('timeout');
    current();
    const decidedAt = Date.now();
    const period = typeof answer === 'string' ? answer.replace(/^(allow|deny)-/, '') : '';
    const ttl = Object.prototype.hasOwnProperty.call(SIGNING_PERIODS, period)
      ? SIGNING_PERIODS[period as keyof typeof SIGNING_PERIODS] : undefined;
    const approved = answer === 'allow' || answer === 'allow-session' || answer === 'allow-always' ||
      (typeof answer === 'string' && answer.startsWith('allow-') && ttl !== undefined);
    const remembered = ['allow-session', 'allow-always', 'deny-always'].includes(String(answer)) ||
      (typeof answer === 'string' && /^(allow|deny)-/.test(answer) && ttl !== undefined);
    if ((canRememberSigning(scope) || !approved) && remembered) {
      const update = this.writes.catch(() => {}).then(async () => {
        assertNotAborted(this.signal);
        current();
        const next = this.rules.filter((entry) => entry.key !== key && activeRule(entry));
        if (next.length >= MAX_RULES) throw new Error('quota-exceeded');
        next.push({
          key, scope, decision: approved ? 'allow' : 'deny',
          duration: ttl !== undefined ? 'timed' : answer === 'allow-session' ? 'session' : 'always',
          createdAt: decidedAt, ...(ttl !== undefined ? { expiresAt: decidedAt + ttl } : {}),
        });
        const serialized = encodeSigningRules(next.filter((entry) => entry.duration !== 'session'));
        if (JSON.stringify(next).length > 256 * 1024) throw new Error('quota-exceeded');
        await setData(this.scope, 'permissions', 'signing', serialized);
        assertNotAborted(this.signal);
        current();
        this.revoked.delete(key);
        this.rules = next;
      });
      this.writes = update;
      await update;
    }
    await this.record(scope, approved ? 'allowed' : 'denied');
    current();
    if (!approved) throw new Error('permission-denied');
  }

  private async record(scope: SigningScope, decision: SigningActivity['decision']) {
    this.activity.push({ scope: { operation: scope.operation, kind: scope.kind }, decision, at: Date.now() });
    if (this.activity.length > 32) this.activity.shift();
    await this.write('signing-activity', this.activity);
    this.changed();
    assertNotAborted(this.signal);
  }
  private write(key: string, value: unknown) {
    const serialized = JSON.stringify(value);
    const work = this.writes.catch(() => {}).then(async () => {
      assertNotAborted(this.signal);
      await setData(this.scope, 'permissions', key, serialized);
      assertNotAborted(this.signal);
    });
    this.writes = work;
    return work;
  }
}
