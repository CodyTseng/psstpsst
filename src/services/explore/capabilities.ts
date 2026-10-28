import { verifyEvent } from 'nostr-tools';
import { assertNotAborted } from '@/platform/abort';
import type { ApplicationEndpoint, ApplicationEnvelope } from '@/platform/ports/application-messaging';
import type { NappletNetwork } from '@/services/napplet/network';
import { eventWeight, randomId } from '@/services/napplet/protocol';
import { localRelay } from '@/services/local-relay';
import { publicEventAddress } from './event-address';
import { getData, setData } from '@/services/napplet/repository';
import { reconcileConfig, validateSchema, validateValues, type ConfigSchema } from '@/services/napplet/config';
import type { RuntimePrompt } from '@/services/napplet/runtime';
import { applicationMessaging } from './messaging';
import { matchesAction, supportsApplicationAction } from './action-matching';
import { applicationListEntry, type ExploreEntry } from './model';

type Options = {
  signal: AbortSignal;
  send(message: ApplicationEnvelope): Promise<void>;
  confirm(prompt: RuntimePrompt, signal: AbortSignal): Promise<string | false>;
  configure(schema: ConfigSchema, values: Record<string, unknown>, save: (values: Record<string, unknown>) => Promise<void>, signal: AbortSignal): void;
  /** Current account's favorite applications, including metadata beyond visible list pages. */
  applications(): Promise<ExploreEntry[]>;
  launch(entry: ExploreEntry): Promise<void>;
  beforeConnect?(): Promise<void>;
};

/** Document-scoped capabilities share persistence, never authority, across windows. */
export class NappCapabilities {
  private messaging = applicationMessaging();
  private connected?: Promise<void>;
  private schema?: ConfigSchema;
  private configSubscribed = false;
  private detach?: () => void;
  private stopping?: Promise<void>;
  private scope: { accountPubkey: string; appKey: string };
  constructor(private account: string, private entry: ExploreEntry, private network: NappletNetwork, private options: Options, readonly instance = randomId()) {
    this.scope = { accountPubkey: account, appKey: entry.key };
    options.signal.addEventListener('abort', () => { void this.stop(); }, { once: true });
  }
  private check() { assertNotAborted(this.options.signal); }
  private ensure() {
    this.check();
    return this.connected ??= (async () => {
      await this.options.beforeConnect?.(); this.check();
      this.detach = this.messaging.onMessage((instance, message) => {
        if (instance !== this.instance || this.options.signal.aborted) return;
        if (message.type === 'configChanged') {
          this.schema = undefined;
          if (this.configSubscribed) void this.pushConfig().catch(() => {});
        } else void this.options.send(message).catch(() => { void this.stop(); });
      });
      await this.messaging.connect({ instance: this.instance, accountPubkey: this.account, sourceId: this.entry.key, title: this.entry.title.slice(0, 200),
        domains: this.entry.required, actions: [], auxiliary: !!this.entry.manifest?.tags.some(t => t[0] === 'mode' && t[1] === 'auxiliary') });
      this.check();
    })();
  }
  stop(): Promise<void> {
    this.detach?.(); this.detach = undefined;
    return this.stopping ??= this.connected ? this.connected.catch(() => {}).then(() => this.messaging.disconnect(this.instance)).catch(() => {}) : Promise.resolve();
  }
  private async request(message: ApplicationEnvelope) { await this.ensure(); this.check(); return this.messaging.request(this.instance, message); }
  async handle(method: string, args: any[]): Promise<unknown> {
    if (method === 'ready') { await this.ensure(); return this.instance; }
    if (method === 'registerAction') return this.request({ type: 'register', pattern: args[0] });
    if (method === 'actionResult') return this.request({ type: 'actionResult', requestId: args[0], result: args[1], error: args[2] });
    if (method === 'action') return this.action(args[0], args[1], args[2]);
    if (method === 'nap') return this.nap(args[0]);
    throw new Error('unsupported-method');
  }
  private async action(name: unknown, payload: unknown, options: any = {}) {
    if (typeof name !== 'string' || !name || name.length > 128 || options && (typeof options !== 'object' || Array.isArray(options))) throw new Error('invalid-action');
    options ??= {};
    if (options.instance !== undefined && (typeof options.instance !== 'string' || options.instance.length > 128) ||
      options.auxiliary !== undefined && typeof options.auxiliary !== 'boolean') throw new Error('invalid-action');
    if (name === 'view' || /^view:\d+$/.test(name)) {
      let event = payload as any;
      try {
        if (typeof event === 'string' && event.startsWith('{')) event = JSON.parse(event);
        if (typeof event === 'string') {
          const pointer = publicEventAddress(event);
          const cached = await localRelay.query(pointer.filters);
          if (cached[0]) event = cached[0];
          else {
            const relays = pointer.relays.length ? pointer.relays : await this.network.routes([pointer.author ?? this.account], pointer.author ? 'write' : 'read');
            event = (await this.network.query(relays, pointer.filters, this.options.signal)).events[0];
          }
        }
        if (event && eventWeight(event) <= 256 * 1024 && verifyEvent(event)) {
          if (name !== 'view' && name !== `view:${event.kind}`) throw new Error('invalid-event-kind');
          payload = event; name = `view:${event.kind}`;
        } else if (name !== 'view') throw new Error('event-unavailable');
      } catch (error) { if (name !== 'view') throw error; }
      this.check();
    }
    const endpoints: ApplicationEndpoint[] = await this.request({ type: 'list' });
    const known = new Map((await this.options.applications()).map(app => [app.key, app]));
    const available = endpoints.filter(e => known.has(e.sourceId) && (!options.instance || e.instance === options.instance) &&
      !!e.auxiliary === !!options.auxiliary && e.actions.some(p => matchesAction(p, name as string)));
    const runningSources = new Set(available.map(endpoint => endpoint.sourceId));
    const applications = options.instance ? [] : [...known.values()].filter(app => !runningSources.has(app.key) &&
      supportsApplicationAction(app, { name: name as string, auxiliary: !!options.auxiliary }));
    this.check();
    const choices = [...available.map(endpoint => {
      const app = known.get(endpoint.sourceId);
      let publisher: string | undefined;
      try { publisher = publicEventAddress(endpoint.sourceId).author; } catch { /* Metadata may be unavailable for a live endpoint. */ }
      return { key: `instance:${endpoint.instance}`, title: endpoint.title,
        application: app ? { ...applicationListEntry(app), title: endpoint.title } : { key: endpoint.sourceId, title: endpoint.title, kind: 'napp' as const, servers: [], publisher } };
    }), ...applications.map(app => ({ key: `source:${app.key}`, title: app.title, application: applicationListEntry(app) }))].slice(0, 64);
    if (!choices.length) {
      await this.options.confirm({ title: this.entry.title, detail: '', choices: [], accountPubkey: this.account,
        applicationSelection: { requester: this.entry.title, content: name === 'profile' || name === 'view:0' ? 'profile' : 'content',
          ...(options.instance ? { unavailable: 'instance' as const } : { discovery: { name: name as string, auxiliary: !!options.auxiliary } }) } }, this.options.signal);
      this.check();
      throw new Error('permission-denied');
    }
    const selected = await this.options.confirm({ title: this.entry.title, detail: '', choices,
      applicationSelection: { requester: this.entry.title, content: name === 'profile' || name === 'view:0' ? 'profile' : 'content' } }, this.options.signal);
    this.check();
    if (!selected || !choices.some(choice => choice.key === selected)) throw new Error('permission-denied');
    const selectedSource = available.find(e => `instance:${e.instance}` === selected)?.sourceId ??
      applications.find(app => `source:${app.key}` === selected)?.key;
    const current = (await this.options.applications()).find(app => app.key === selectedSource);
    this.check();
    if (!current) throw new Error('handler-unavailable');
    let target = available.find(e => `instance:${e.instance}` === selected)?.instance;
    if (!target) {
      if (!current.local?.actions.some(pattern => matchesAction(pattern, name as string)) && !current.manifest?.tags.some(t => t[0] === 'action' && matchesAction(t[1], name as string))) throw new Error('handler-unavailable');
      await this.options.launch(current); this.check();
      target = await this.request({ type: 'wait', sourceId: current.key, name });
      const favorites = await this.options.applications();
      this.check();
      if (!favorites.some(app => app.key === selectedSource)) throw new Error('handler-unavailable');
    }
    return this.request({ type: 'invoke', target, name, payload });
  }
  private async loadSchema() {
    if (!this.schema) {
      const saved = await getData(this.scope, 'config', 'schema'); this.check();
      if (saved) this.schema = validateSchema(JSON.parse(saved));
    }
    return this.schema;
  }
  private async values() {
    const schema = await this.loadSchema();
    const saved = await getData(this.scope, 'config', 'values'); this.check();
    return schema ? reconcileConfig(schema, saved ? JSON.parse(saved) : undefined) as Record<string, unknown> : {};
  }
  private async pushConfig(id?: string) {
    await this.options.send({ type: 'nap', message: { type: 'config.values', id, values: await this.values(), schema: this.schema } });
  }
  private async nap(message: ApplicationEnvelope) {
    if (!message || typeof message.type !== 'string' || message.id != null && (typeof message.id !== 'string' || message.id.length > 128)) throw new Error('invalid-message');
    const [domain, operation] = message.type.split('.');
    if (!this.entry.required.includes(domain)) throw new Error('permission-denied');
    if (domain === 'inc') {
      if (message.type === 'inc.channel.open') {
        const peers: ApplicationEndpoint[] = await this.request({ type: 'list' });
        const peer = peers.find(p => p.instance === message.target && p.domains.includes('inc'));
        if (!peer) throw new Error('peer-unavailable');
        const answer = await this.options.confirm({ title: this.entry.title, detail: peer.title, accountPubkey: this.account }, this.options.signal);
        this.check(); if (answer !== 'allow') throw new Error('permission-denied');
      }
      return this.request({ type: 'inc', message });
    }
    if (domain !== 'config') throw new Error('unsupported-method');
    if (operation === 'registerSchema') {
      const schema = validateSchema(message.schema);
      if (schema.type !== 'object') throw new Error('invalid-schema');
      await setData(this.scope, 'config', 'schema', JSON.stringify(schema)); this.check();
      this.schema = schema;
      await this.options.send({ type: 'nap', message: { type: `${message.type}.result`, id: message.id, ok: true } });
      await this.pushConfig();
      await this.request({ type: 'configChanged' });
      return;
    }
    if (operation === 'unsubscribe') { this.configSubscribed = false; return; }
    if (operation === 'subscribe') this.configSubscribed = true;
    if (operation === 'openSettings') {
      const schema = await this.loadSchema();
      if (!schema) throw new Error('invalid-schema');
      this.options.configure(schema, await this.values(), async values => {
        this.check(); validateValues(schema, values);
        await setData(this.scope, 'config', 'values', JSON.stringify(values)); this.check();
        if (this.configSubscribed) await this.pushConfig();
        await this.request({ type: 'configChanged' });
      }, this.options.signal);
      return;
    }
    if (!['get', 'subscribe'].includes(operation)) throw new Error('unsupported-method');
    await this.pushConfig(message.id);
  }
}
