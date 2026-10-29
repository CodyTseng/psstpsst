import { applicationActionRequest, isApplicationAction } from './action-request';
import { assertNotAborted, linkAbort } from '@/platform/abort';
import { assertCurrentSigningSource, readSigningSnapshot, saveSigningRule, deleteSigningRule, recordSigningActivity, type SigningAccountScope } from './repository';
import { normalizeSigningSource } from './source';
import { invalidateSigning, signingRevision, subscribeSigning } from './changes';
import { queueAuthorization } from './authorization-queue';

import { signingScope, signingRuleKey, canRememberSigning, replaceSigningRule, SIGNING_PERIODS,
  isSigningRuleActive as activeRule, isSignerAccess, type SignerAccessOperation,
  type SigningScope, type SigningRequest, type SigningRule, type SigningActivity, type SigningSnapshot, type SigningRuleChange, type SigningRuleTarget,
} from './model';
export { readSigningSnapshot } from './repository';
export * from './model';

/** Session grants stay in memory; durable rules are shared by account and verified source. */
export class SigningPermissions {
  private loaded?: Promise<void>;
  private revoked = new Set<string>();
  private rules: SigningRule[] = [];
  private activity: SigningActivity[] = [];
  private writes: Promise<unknown> = Promise.resolve();
  constructor(
    private scope: SigningAccountScope,
    private confirm: (request: SigningRequest, signal?: AbortSignal) => Promise<string | false>,
    private signal: AbortSignal,
    private changed: () => void,
  ) {
    this.scope = { ...scope, sourceId: normalizeSigningSource(scope.sourceId) };
    const unsubscribe = subscribeSigning(this.scope, ({ key }) => {
      this.loaded = undefined;
      this.rules = this.rules.filter((rule) => rule.duration === 'session' && key !== undefined && rule.key !== key);
    });
    if (signal.aborted) unsubscribe();
    else signal.addEventListener('abort', unsubscribe, { once: true });
  }

  private load() {
    return this.loaded ??= readSigningSnapshot(this.scope).then((value) => {
      assertNotAborted(this.signal);
      this.rules = [...value.rules, ...this.rules.filter((rule) => rule.duration === 'session')];
      this.activity = value.activity;
    });
  }
  async snapshot(): Promise<SigningSnapshot> {
    await this.load();
    assertNotAborted(this.signal);
    return { rules: this.rules.filter(activeRule), activity: [...this.activity].reverse() };
  }
  get version(): number { return signingRevision(this.scope); }
  async settled(): Promise<void> { await this.writes.catch(() => {}); }

  async revoke(key: string): Promise<void> {
    invalidateSigning(this.scope, key);
    this.revoked.add(key);
    await this.load();
    const update = this.writes.catch(() => {}).then(async () => {
      assertNotAborted(this.signal);
      const next = this.rules.filter((rule) => rule.key !== key);
      await deleteSigningRule(this.scope, key);
      assertNotAborted(this.signal);
      this.rules = next; this.loaded = Promise.resolve();
      this.changed();
    });
    this.writes = update;
    await update;
  }

  async edit(source: SigningRuleTarget, change: SigningRuleChange): Promise<void> {
    const frozen = JSON.parse(JSON.stringify({ source, change })) as { source: SigningRuleTarget; change: SigningRuleChange };
    // Validate before invalidating pending authorizations.
    replaceSigningRule([], frozen.source, frozen.change);
    const revision = invalidateSigning(this.scope, frozen.source.key);
    const wasRevoked = this.revoked.has(frozen.source.key);
    this.revoked.add(frozen.source.key);
    try {
      await this.load();
      const update = this.writes.catch(() => {}).then(async () => {
        assertNotAborted(this.signal);
        const next = replaceSigningRule(this.rules, frozen.source, frozen.change);
        const rule = next.find((entry) => entry.key === frozen.source.key);
        if (!rule || rule.duration === 'session') await deleteSigningRule(this.scope, frozen.source.key);
        else await saveSigningRule(this.scope, rule);
        assertNotAborted(this.signal);
        this.rules = next; this.loaded = Promise.resolve();
        this.revoked.delete(frozen.source.key);
        this.changed();
      });
      this.writes = update;
      await update;
    } catch (error) {
      if (this.version === revision && !wasRevoked) this.revoked.delete(frozen.source.key);
      throw error;
    }
  }

  async authorize(input: SigningRequest, expiresAt?: number, requestSignal?: AbortSignal,
    review?: (request: SigningRequest, signal?: AbortSignal) => Promise<string | false>): Promise<number> {
    // Freeze before queueing; the caller signs this exact snapshot after consent.
    const request = applicationActionRequest(JSON.parse(JSON.stringify(input)) as SigningRequest);
    return queueAuthorization(this.scope, requestSignal ? [this.signal, requestSignal] : [this.signal],
      () => this.authorizeCurrent(request, expiresAt, requestSignal, review));
  }

  private async authorizeCurrent(request: SigningRequest, expiresAt?: number, requestSignal?: AbortSignal,
    review?: (request: SigningRequest, signal?: AbortSignal) => Promise<string | false>): Promise<number> {
    if (this.scope.localVersion !== undefined) await assertCurrentSigningSource(this.scope);
    let revision = this.version;
    const current = () => {
      assertNotAborted(this.signal);
      assertNotAborted(requestSignal);
      if (revision !== this.version) throw new Error('permission-denied');
    };
    if (request.accountPubkey !== this.scope.accountPubkey) throw new Error('account-unavailable');
    if (expiresAt !== undefined && Date.now() >= expiresAt) throw new Error('timeout');
    if (request.operation === 'relay-auth' && !request.relays.length) throw new Error('invalid-signing-request');
    if (isApplicationAction(request) && !canRememberSigning(request)) throw new Error('invalid-signing-request');
    if (isSignerAccess(request)) {
      if (!canRememberSigning(request)) throw new Error('invalid-signing-request');
    } else {
      if (!Number.isInteger(request.kind) || request.kind < 0 || request.kind > 65535) throw new Error('invalid-signing-request');
      if (request.kind >= 30000 && request.kind < 40000) request.scopeKey = request.tags.find((tag) => tag[0] === 'd')?.[1] ?? '';
    }
    await this.load();
    assertNotAborted(this.signal);
    if (expiresAt !== undefined && Date.now() >= expiresAt) throw new Error('timeout');
    current();
    const scope = signingScope(request);
    const key = signingRuleKey(scope);
    let rule = this.rules.find((entry) => entry.key === key && !this.revoked.has(key) && activeRule(entry));
    if (rule?.decision === 'allow' && !canRememberSigning(scope)) rule = undefined;
    if (rule) {
      await this.record(request, rule.decision === 'allow' ? 'automatic' : 'denied');
      current();
      if (rule.decision === 'deny') throw new Error('permission-denied');
      return revision;
    }
    const linked = linkAbort(requestSignal ? [this.signal, requestSignal] : [this.signal]);
    let answer: string | false;
    try { answer = await (review ?? this.confirm)(request, linked.signal); }
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
        next.push({
          key, scope, decision: approved ? 'allow' : 'deny',
          duration: ttl !== undefined ? 'timed' : answer === 'allow-session' ? 'session' : 'always',
          createdAt: decidedAt, ...(ttl !== undefined ? { expiresAt: decidedAt + ttl } : {}),
        });
        const rule = next[next.length - 1];
        revision = rule.duration === 'session' ? invalidateSigning(this.scope, key) : await saveSigningRule(this.scope, rule, current);
        assertNotAborted(this.signal);
        current();
        this.revoked.delete(key);
        this.rules = next; this.loaded = Promise.resolve();
      });
      this.writes = update;
      await update;
    }
    await this.record(request, approved ? 'allowed' : 'denied');
    current();
    if (!approved) throw new Error('permission-denied');
    return revision;
  }

  authorizeAccess(operation: SignerAccessOperation, requestSignal?: AbortSignal, content = ''): Promise<number> {
    return this.authorize({ operation, relays: [], accountPubkey: this.scope.accountPubkey,
      content, tags: [], createdAt: Math.floor(Date.now() / 1000) }, undefined, requestSignal);
  }

  private async record(scope: SigningScope, decision: SigningActivity['decision']) {
    this.activity.push({ scope: { operation: scope.operation, kind: scope.kind }, decision, at: Date.now() });
    if (this.activity.length > 32) this.activity.shift();
    await recordSigningActivity(this.scope, { scope: { operation: scope.operation, kind: scope.kind }, decision, at: Date.now() });
    this.changed();
    assertNotAborted(this.signal);
  }
}
