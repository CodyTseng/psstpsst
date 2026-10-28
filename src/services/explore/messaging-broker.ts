import type { ApplicationEndpoint, ApplicationEnvelope } from '@/platform/ports/application-messaging';
import { IncBroker } from '@/services/napplet/inc';
import { randomId } from '@/services/napplet/protocol';

import { matchesAction } from './action-matching';
export { matchesAction } from './action-matching';
type Endpoint = ApplicationEndpoint & { send(message: ApplicationEnvelope): void; detach(): void };

/** One broker per process on mobile, one in Electron's main process across hosts. */
export class ApplicationMessagingBroker {
  private endpoints = new Map<string, Endpoint>();
  private inc = new IncBroker();
  private pending = new Map<string, { sender: string; target: string; resolve(value: unknown): void; reject(error: Error): void }>();
  private waiters = new Set<() => void>();

  connect(value: ApplicationEndpoint, send: Endpoint['send']) {
    if (!value || typeof value.instance !== 'string' || !value.instance || value.instance.length > 128 ||
      typeof value.sourceId !== 'string' || value.sourceId.length > 8192 || typeof value.title !== 'string' || value.title.length > 200 ||
      !/^[a-f0-9]{64}$/.test(value.accountPubkey) || this.endpoints.has(value.instance) || this.endpoints.size >= 16 ||
      !Array.isArray(value.actions) || value.actions.length > 64 || value.actions.some(p => typeof p !== 'string' || !p || p.length > 128) ||
      !Array.isArray(value.domains) || value.domains.length > 32 || value.domains.some(d => typeof d !== 'string' || d.length > 64))
      throw new Error('invalid-endpoint');
    const detach = value.domains.includes('inc') ? this.inc.attach(value.instance, value.accountPubkey, send) : () => {};
    this.endpoints.set(value.instance, { ...value, actions: [...value.actions], domains: [...value.domains], send, detach });
    this.notify();
  }
  disconnect(instance: string) {
    const endpoint = this.endpoints.get(instance);
    this.endpoints.delete(instance);
    endpoint?.detach();
    for (const entry of this.pending.values()) if (entry.sender === instance || entry.target === instance) entry.reject(new Error('endpoint-closed'));
    this.notify();
  }
  private notify() { for (const waiter of this.waiters) waiter(); }
  async request(instance: string, message: ApplicationEnvelope): Promise<any> {
    const endpoint = this.endpoints.get(instance);
    if (!endpoint) throw new Error('endpoint-closed');
    if (!message || typeof message.type !== 'string' || JSON.stringify(message).length > 256 * 1024) throw new Error('invalid-message');
    if (message.type === 'register') {
      if (typeof message.pattern !== 'string' || !message.pattern || message.pattern.length > 128) throw new Error('invalid-action');
      if (!endpoint.actions.includes(message.pattern)) {
        if (endpoint.actions.length >= 64) throw new Error('quota-exceeded');
        endpoint.actions.push(message.pattern);
      }
      this.notify();
      return;
    }
    if (message.type === 'list') return [...this.endpoints.values()].filter(e => e.accountPubkey === endpoint.accountPubkey)
      .map(({ send: _send, detach: _detach, ...value }) => value);
    if (message.type === 'wait') {
      if (typeof message.sourceId !== 'string' || typeof message.name !== 'string') throw new Error('invalid-action');
      if (this.waiters.size >= 16) throw new Error('quota-exceeded');
      return new Promise((resolve, reject) => {
        const done = (error?: Error, target?: string) => { clearTimeout(timer); this.waiters.delete(check); if (error) reject(error); else resolve(target); };
        const check = () => {
          if (!this.endpoints.has(instance)) return done(new Error('endpoint-closed'));
          const target = [...this.endpoints.values()].find(e => e.accountPubkey === endpoint.accountPubkey && e.sourceId === message.sourceId && e.actions.some(p => matchesAction(p, message.name)));
          if (target) done(undefined, target.instance);
        };
        const timer = setTimeout(() => done(new Error('handler-unavailable')), 25000);
        this.waiters.add(check); check();
      });
    }
    if (message.type === 'invoke') {
      const target = this.endpoints.get(message.target);
      if (!target || target.accountPubkey !== endpoint.accountPubkey || typeof message.name !== 'string' ||
        !target.actions.some(p => matchesAction(p, message.name))) throw new Error('handler-unavailable');
      if (this.pending.size >= 32) throw new Error('quota-exceeded');
      const requestId = randomId();
      return new Promise((resolve, reject) => {
        const finish = (error?: Error, value?: unknown) => {
          clearTimeout(timer); this.pending.delete(requestId); if (error) reject(error); else resolve(value);
        };
        const timer = setTimeout(() => finish(new Error('action-timeout')), 120000);
        this.pending.set(requestId, { sender: instance, target: target.instance, resolve: value => finish(undefined, value), reject: error => finish(error) });
        try { target.send({ type: 'action', requestId, name: message.name, payload: message.payload, sender: instance }); }
        catch { finish(new Error('endpoint-closed')); }
      });
    }
    if (message.type === 'actionResult') {
      const pending = this.pending.get(message.requestId);
      if (!pending || pending.target !== instance) throw new Error('invalid-action-result');
      if (message.error) pending.reject(new Error(String(message.error).slice(0, 400)));
      else pending.resolve(message.result ?? null);
      return;
    }
    if (message.type === 'configChanged') {
      for (const target of this.endpoints.values()) if (target !== endpoint && target.accountPubkey === endpoint.accountPubkey && target.sourceId === endpoint.sourceId)
        target.send({ type: 'configChanged' });
      return;
    }
    if (message.type === 'inc') {
      if (!endpoint.domains.includes('inc')) throw new Error('permission-denied');
      const value = message.message;
      if (!value || !['inc.emit', 'inc.subscribe', 'inc.unsubscribe', 'inc.channel.open', 'inc.channel.list', 'inc.channel.emit', 'inc.channel.broadcast', 'inc.channel.close'].includes(value.type)) throw new Error('invalid-message');
      // The trusted runtime obtains consent before asking the broker to open a channel.
      await this.inc.handle(instance, value, async () => {});
      return;
    }
    throw new Error('unsupported-method');
  }
}
