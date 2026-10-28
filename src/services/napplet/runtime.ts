import type { WalletApprovalRequest } from '@/lib/wallet/approval';
import { isEventTemplate } from '@/lib/nostr/event-validation';
import { normalizeSigningSource } from '@/services/signing/source';
import { applicationPresentation, type ApplicationInfo, type ApplicationListEntry } from '@/services/explore/model';
import { NappDevice } from '@/services/explore/device';
import { BrowserActions } from '@/services/explore/browser-actions';
import { encodeNappletBytes } from '@/platform/napplet-bytes';
import { assertNotAborted, linkAbort } from '@/platform/abort';
import i18n from '@/i18n/core';
import { base64 } from '@scure/base';
import { matchFilters, type Event, type EventTemplate } from 'nostr-tools';
import { incBroker } from './inc';
import { platform } from '@/platform';
import { NAPPLET_FRAME_READY_MESSAGE } from '@/platform/ports/napplet';
import { fetchBlob } from './artifacts';
import { reconcileConfig, validateSchema, validateValues, type ConfigSchema } from './config';
import { buildDocument } from './document';
import { NappletNetwork, relayUrls } from './network';
import { relayFilters } from './filters';
import { SigningPermissions, appSigningScope, type SigningRequest } from './signing-permissions';
import { subscribeSigning } from '@/services/signing/changes';
import {
  eventWeight,
  randomId,
  MAX_RESOURCE_BYTES,
  publicUrl,
  resourceMime,
  type NappletRelease,
} from './protocol';
import { dataEntries, dataKeys, getData, setData, type AppScope } from './repository';
import { NappletUploads } from './upload';
import { signingTemplate } from '@/services/signing/event-template';
import { ApplicationSigner } from '@/services/signing/application-signer';
import { queueAuthorization } from '@/services/signing/authorization-queue';
import { NAP_DOMAINS } from './protocol';
import { readDomainPermissions } from './domain-permissions';

export type RuntimePromptChoice = { key: string; title: string; application?: ApplicationListEntry };
export type RuntimePrompt = {
  title: string;
  detail: string;
  application?: ApplicationInfo;
  requester?: { title: string; origin: string };
  choices?: RuntimePromptChoice[];
  applicationSelection?: { requester: string; content: 'profile' | 'content'; discovery?: { name: string; auxiliary: boolean }; unavailable?: 'instance' };
  app?: NappletRelease;
  accountPubkey?: string;
  signing?: SigningRequest;
  upload?: { filename: string; mimeType: string; size: number; sha256: string; servers: string[] };
  crypto?: { operation: 'encrypt' | 'decrypt'; algorithm: 'nip04' | 'nip44' };
  device?: { operation: 'save-file' | 'copy-text' };
  installation?: { target: ApplicationInfo; id: string; replacing: boolean; otherInstaller: boolean };
  browser?: { action: 'window' | 'external' | 'permission' | 'download'; resources?: string[]; url?: string; filename?: string };
  capabilities?: { required: string[]; optional: string[]; requested?: string };
  wallet?: WalletApprovalRequest;
  expiresAt?: number;
};
export type RuntimeTheme = {
  colors: { background: string; text: string; primary: string };
  title?: string;
};
export type RuntimeOptions = {
  accountPubkey: string;
  release: NappletRelease;
  html: string;
  domains: string[];
  theme: () => RuntimeTheme;
  confirm: (prompt: RuntimePrompt, signal?: AbortSignal) => Promise<string | false>;
  permissionsChanged?: () => void;
  presented?: () => void;
  configure: (schema: ConfigSchema, values: Record<string, unknown>) => void;
  handlers: () => Promise<NappletRelease[]>;
  invoke: (release: NappletRelease, delivery: Record<string, unknown>) => Promise<void>;
  openBrowser?: (url: string) => Promise<void>;
};
type Message = Record<string, any>;
const requests: Record<string, readonly string[]> = {
  signer: ['getPublicKey', 'signEvent', 'nip04.encrypt', 'nip04.decrypt', 'nip44.encrypt', 'nip44.decrypt'],
  clipboard: ['writeText'],
  browser: ['request'],
  shell: ['ready'],
  theme: ['get'],
  storage: ['get', 'set', 'remove', 'keys'],
  identity: [
    'getPublicKey',
    'getRelays',
    'getProfile',
    'getFollows',
    'getMutes',
    'getBlocked',
    'getList',
    'getZaps',
    'getBadges',
  ],
  resource: ['info', 'bytes', 'bytesMany', 'cancel'],
  upload: ['info', 'status', 'upload', 'transfer.start', 'transfer.chunk', 'transfer.end'],
  link: ['open'],
  relay: ['query', 'subscribe', 'close', 'publish', 'publishEncrypted'],
  outbox: ['getEvent', 'query', 'subscribe', 'close', 'publish', 'resolveRelays'],
  config: ['registerSchema', 'get', 'subscribe', 'unsubscribe', 'openSettings'],
  intent: ['invoke', 'available', 'handlers'],
  inc: [
    'emit',
    'subscribe',
    'unsubscribe',
    'channel.open',
    'channel.list',
    'channel.close',
    'channel.emit',
    'channel.broadcast',
  ],
};
const text = (value: unknown, max = 256): string => {
  if (typeof value !== 'string' || !value || value.length > max) throw new Error('invalid-request');
  return value;
};
/** One authenticated application endpoint. Every async continuation rechecks this lifetime. */
export class NappletRuntime {
  readonly endpoint = `endpoint:${randomId()}`;
  readonly network: NappletNetwork;
  readonly scope: AppScope;
  readonly signingPermissions: SigningPermissions;
  private uploads: NappletUploads;
  private device?: NappDevice;
  private browser?: BrowserActions;
  private life = new AbortController();
  private container: string | null = null;
  private presented = false;
  private unsubscribe?: () => void;
  private streams = new Map<string, () => void>();
  private resources = new Map<string, AbortController>();
  private instanceData = new Map<string, string>();
  private detachInc: () => void;
  private pending = new Set<string>();
  private counters = { start: Date.now(), calls: 0, resource: 0 };
  private resourceActive = 0;
  private deliveredBytes = 0;
  private schema: ConfigSchema | null = null;
  private configSubscribed = false;
  private delivery: Record<string, unknown> | null = null;
  private shellReady = false;
  private readonly availableDomains: string[];
  private domainRequests = new Map<string, Promise<void>>();
  private deniedDomains = new Set<string>();
  constructor(private options: RuntimeOptions) {
    this.availableDomains = [...new Set([...options.domains, ...options.release.optional.filter(domain =>
      (NAP_DOMAINS as readonly string[]).includes(domain))])];
    this.network = new NappletNetwork(options.accountPubkey);
    this.detachInc = incBroker.attach(this.endpoint, options.accountPubkey, (message) =>
      this.send(message),
    );
    this.scope = {
      accountPubkey: options.accountPubkey,
      appKey: options.release.eventKey,
    };
    this.signingPermissions = new SigningPermissions(
      this.scope, options.release, options.confirm, this.signal,
      () => options.permissionsChanged?.(),
    );
    this.uploads = new NappletUploads({
      accountPubkey: options.accountPubkey, signal: this.signal,
      send: (message) => this.send(message), version: () => this.signingPermissions.version,
      authorize: async (template, metadata, servers, signal) => {
        let revision: number | undefined;
        const check = () => {
          this.check(); assertNotAborted(signal);
          if (revision !== undefined && revision !== this.signingPermissions.version) throw new Error('permission-revoked');
        };
        revision = await this.signingPermissions.authorize({ operation: 'upload', kind: template.kind, relays: servers,
          accountPubkey: options.accountPubkey, content: template.content, tags: template.tags, createdAt: template.created_at },
        undefined, signal, (request, life) => options.confirm({ title: options.release.title, detail: '', app: options.release,
          accountPubkey: options.accountPubkey, upload: { ...metadata, servers }, signing: request }, life));
        check();
        const event = await this.network.sign(template);
        check();
        return { event, check };
      },
    });
    const unsubscribeUploads = subscribeSigning(appSigningScope(this.scope), () => this.uploads.authorizationChanged());
    this.signal.addEventListener('abort', unsubscribeUploads, { once: true });
  }
  get signal() {
    return this.life.signal;
  }
  check() {
    assertNotAborted(this.life.signal);
  }
  private applicationSigner() {
    return new ApplicationSigner({ accountPubkey: this.options.accountPubkey, permissions: this.signingPermissions,
      signer: () => this.network.getSigner(), current: () => this.check() });
  }
  async open(): Promise<string> {
    const early: { id: string; raw: string }[] = [];
    this.unsubscribe = platform.napplet.addMessageListener((id, raw) => {
      if (!this.container) {
        if (early.length < 32) early.push({ id, raw });
      } else if (id === this.container) void this.receive(raw);
    });
    const document = await buildDocument(
      this.options.html,
      this.availableDomains,
      this.options.release.title,
      this.options.theme().colors.background,
    );
    this.check();
    this.container = await platform.napplet.open(document);
    if (this.signal.aborted) {
      await platform.napplet.close(this.container);
      this.check();
    }
    for (const entry of early) if (entry.id === this.container) void this.receive(entry.raw);
    return this.container;
  }

  async close(): Promise<void> {
    this.life.abort();
    this.uploads.close();
    this.unsubscribe?.();
    for (const close of this.streams.values()) close();
    for (const request of this.resources.values()) request.abort();
    this.streams.clear();
    this.resources.clear();
    this.detachInc();
    this.instanceData.clear();
    this.pending.clear();
    this.network.destroy();
    const id = this.container;
    this.container = null;
    if (id) await platform.napplet.close(id);
  }
  send(message: Message): void {
    if (!this.signal.aborted && this.container)
      void platform.napplet.send(this.container, JSON.stringify(message)).catch(() => {});
  }
  async goBack(): Promise<boolean> {
    this.check();
    if (!this.container) return true;
    const handled = await platform.napplet.goBack(this.container);
    this.check();
    return handled;
  }
  updateTheme() {
    this.send({ type: 'theme.changed', theme: this.options.theme() });
  }
  setDelivery(delivery: Record<string, unknown>) {
    if (this.shellReady) this.send({ type: 'intent.deliver', delivery });
    else this.delivery = delivery;
  }
  private result(message: Message, fields: Message = {}) {
    this.send({ type: `${message.type}.result`, id: message.id, ...fields });
  }
  private async consent(detail: string): Promise<void> {
    if (!(await this.options.confirm({ title: this.options.release.title, detail,
      app: this.options.release, accountPubkey: this.options.accountPubkey }, this.signal)))
      throw new Error('permission-denied');
    this.check();
  }
  private async readConfig(): Promise<Record<string, unknown>> {
    const saved = await getData(this.scope, 'config', 'values');
    return this.schema ? reconcileConfig(this.schema, saved ? JSON.parse(saved) : undefined) as Record<string, unknown> : {};
  }
  async saveConfig(values: Record<string, unknown>) {
    this.check();
    if (!this.schema) throw new Error('invalid-schema');
    validateValues(this.schema, values);
    await setData(this.scope, 'config', 'values', JSON.stringify(values));
    this.check();
    if (this.configSubscribed) this.send({ type: 'config.values', values, schema: this.schema });
  }
  private async signAuth(template: EventTemplate): Promise<Event> {
    this.check();
    const relay = template.tags.find((t) => t[0] === 'relay')?.[1];
    if (template.kind !== 22242 || !relay || !template.tags.some((t) => t[0] === 'challenge'))
      throw new Error('invalid-auth');
    const target = publicUrl(relay, true);
    const revision = await this.signingPermissions.authorize({
      operation: 'relay-auth', kind: 22242, relays: [target],
      accountPubkey: this.options.accountPubkey, content: template.content,
      tags: template.tags.map((tag) => [...tag]), createdAt: template.created_at,
    });
    this.check();
    const event = await this.network.sign(template);
    this.check();
    if (this.signingPermissions.version !== revision) throw new Error('permission-revoked');
    return event;
  }
  private async authorizeDomain(domain: string): Promise<void> {
    this.check();
    if (this.options.domains.includes(domain) || ['signer', 'clipboard', 'browser'].includes(domain)) return;
    if (this.deniedDomains.has(domain)) throw new Error('permission-denied');
    if (!this.options.release.optional.includes(domain) || !this.availableDomains.includes(domain))
      throw new Error('permission-denied');
    let pending = this.domainRequests.get(domain);
    if (!pending) {
      pending = queueAuthorization(appSigningScope(this.scope), [this.signal], async () => {
        const { domains: granted, denied } = await readDomainPermissions(this.scope, this.options.release, this.options.domains);
        this.check();
        if (!granted.includes(domain)) {
          if (denied.includes(domain)) {
            this.deniedDomains.add(domain);
            throw new Error('permission-denied');
          }
          const answer = await this.options.confirm({ title: this.options.release.title, detail: '',
            app: this.options.release, accountPubkey: this.options.accountPubkey,
            capabilities: { required: [domain], optional: [], requested: domain } }, this.signal);
          this.check();
          if (answer === 'deny') {
            await setData(this.scope, 'permissions', 'denied-domains', JSON.stringify([...denied, domain]));
            this.check();
            this.deniedDomains.add(domain);
            this.options.permissionsChanged?.();
          }
          if (answer !== 'allow') throw new Error('permission-denied');
          granted.push(domain);
          await setData(this.scope, 'permissions', 'domains', JSON.stringify(granted));
          this.check();
          this.options.permissionsChanged?.();
        }
        this.options.domains = [...new Set([...this.options.domains, domain])];
      });
      this.domainRequests.set(domain, pending);
    }
    try { await pending; this.check(); }
    finally { if (this.domainRequests.get(domain) === pending) this.domainRequests.delete(domain); }
  }
  async receive(raw: string): Promise<void> {
    if (this.signal.aborted) return;
    if (raw === NAPPLET_FRAME_READY_MESSAGE) {
      if (!this.presented) { this.presented = true; this.options.presented?.(); }
      return;
    }
    let message: Message;
    try {
      message = JSON.parse(raw);
    } catch {
      return;
    }
    if (!message || typeof message !== 'object' || typeof message.type !== 'string') return;
    const [domain, ...rest] = message.type.split('.');
    const operation = rest.join('.');
    if (!requests[domain]?.includes(operation)) return;
    if (domain === 'upload' && operation.startsWith('transfer.') && operation !== 'transfer.start') {
      if (this.options.domains.includes('upload')) this.uploads.transfer(message);
      else this.send({ type: 'psst.upload.ack', id: message.id, seq: message.seq, error: 'permission-denied' });
      return;
    }
    if (domain === 'shell') {
      this.shellReady = true;
      this.result(message, { capabilities: { domains: this.availableDomains }, services: [] });
      this.send({
        type: 'shell.init',
        capabilities: { domains: this.availableDomains },
        services: [],
      });
      if (this.delivery) {
        this.send({ type: 'intent.deliver', delivery: this.delivery });
        this.delivery = null;
      }
      return;
    }
    if (domain === 'resource' && operation === 'cancel') {
      this.resources.get(message.id)?.abort();
      return;
    }
    if (Date.now() - this.counters.start > 60000)
      this.counters = { start: Date.now(), calls: 0, resource: 0 };
    if (
      message.id &&
      (typeof message.id !== 'string' || message.id.length > 128 || this.pending.has(message.id))
    )
      return;
    if (message.id) this.pending.add(message.id);
    const resourceRequest = domain === 'resource' && (operation === 'bytes' || operation === 'bytesMany')
      ? new AbortController() : undefined;
    if (resourceRequest) this.resources.set(message.id, resourceRequest);
    try {
      await this.authorizeDomain(domain);
      if (resourceRequest) assertNotAborted(resourceRequest.signal);
      if (domain === 'upload' && operation === 'transfer.start') {
        this.uploads.transfer(message);
        return;
      }
      await this.dispatch(message, domain, operation);
    } catch (error) {
      if (!this.signal.aborted) {
        const reason = error instanceof Error ? error.message : 'request-failed';
        this.fail(message, reason);
      }
    } finally {
      this.pending.delete(message.id);
      if (resourceRequest && this.resources.get(message.id) === resourceRequest) this.resources.delete(message.id);
    }
  }
  private fail(message: Message, error: string) {
    if (message.type === 'upload.transfer.start') {
      this.send({ type: 'psst.upload.ack', id: message.id, seq: message.seq, error });
      return;
    }
    if (
      message.type.endsWith('.subscribe') &&
      ['relay', 'outbox'].includes(message.type.split('.')[0])
    ) {
      this.send({
        type: `${message.type.split('.')[0]}.closed`,
        subId: message.subId,
        reason: error,
      });
      return;
    }
    if (!message.id) return;
    if (message.type === 'intent.invoke') {
      this.result(message, { result: { ok: false, error } });
      return;
    }
    if (message.type === 'config.get') this.send({ type: 'config.values', id: message.id, error });
    else if (message.type.startsWith('resource.'))
      this.send({ type: `${message.type}.error`, id: message.id, error });
    else this.result(message, { ok: false, error });
  }
  private async dispatch(m: Message, domain: string, op: string): Promise<void> {
    if (domain === 'browser') {
      if (typeof m.event?.method !== 'string' || !m.event.method.startsWith('browser.') || !Array.isArray(m.event.args)) throw new Error('invalid-request');
      this.browser ??= new BrowserActions({ account: this.options.accountPubkey, sourceId: normalizeSigningSource(this.options.release.eventKey), application: applicationPresentation(this.options.release), signal: this.signal,
        confirm: (prompt, signal) => this.options.confirm(prompt, signal),
        open: this.options.openBrowser ?? (async url => { if (!await platform.urlOpener.openExternalUrl(url)) throw new Error('external-open-failed'); }) });
      const result = await this.browser.handle(m.event.method.slice(8), m.event.args);
      this.result(m, { result }); return;
    }
    if (domain === 'clipboard') {
      this.device ??= new NappDevice(applicationPresentation(this.options.release), this.options.accountPubkey, this.signal,
        (prompt, signal) => this.options.confirm(prompt, signal));
      await this.device.handle('copyText', [m.event?.text]);
      this.result(m, {});
      return;
    }
    if (domain === 'signer') {
      if (op === 'getPublicKey') {
        const pubkey = await this.applicationSigner().getPublicKey();
        this.result(m, { result: pubkey });
      } else if (/^(nip04|nip44)\.(encrypt|decrypt)$/.test(op)) {
        const [algorithm, operation] = op.split('.') as ['nip04' | 'nip44', 'encrypt' | 'decrypt'];
        const result = await this.applicationSigner().crypto(algorithm, operation, m.event?.pubkey, m.event?.text);
        this.result(m, { result });
      } else {
        const event = signingTemplate(m.event);
        const operation = event.kind === 22242 ? 'relay-auth' : 'sign';
        const revision = await this.signingPermissions.authorize({ operation, kind: event.kind,
          relays: operation === 'relay-auth' ? [event.tags.find(tag => tag[0] === 'relay')![1]] : [], accountPubkey: this.options.accountPubkey, content: event.content,
          tags: event.tags, createdAt: event.created_at });
        this.check();
        const signed = await this.network.sign(event);
        this.check();
        if (this.signingPermissions.version !== revision)
          throw new Error('permission-revoked');
        this.result(m, { result: signed });
      }
      return;
    }
    if (domain === 'upload') {
      if (op === 'info') this.result(m, { info: await this.uploads.info() });
      else if (op === 'status') this.result(m, { status: this.uploads.status(m.uploadId) });
      else throw new Error('invalid-upload-data');
      return;
    }
    if (domain === 'theme') {
      this.result(m, { theme: this.options.theme() });
      return;
    }
    if (domain === 'storage') {
      if (m.scope != null && !['shared', 'instance'].includes(m.scope))
        throw new Error('invalid-scope');
      const instance = m.scope === 'instance';
      if (op === 'keys') {
        this.result(m, {
          keys: instance ? [...this.instanceData.keys()] : await dataKeys(this.scope, 'storage'),
        });
        return;
      }
      const key = text(m.key);
      if (op === 'get') {
        this.result(m, {
          value: instance
            ? (this.instanceData.get(key) ?? null)
            : await getData(this.scope, 'storage', key),
        });
        return;
      }
      const value =
        op === 'remove'
          ? null
          : typeof m.value === 'string' && m.value.length <= 1024 * 1024
            ? m.value
            : undefined;
      if (value === undefined) throw new Error('invalid-value');
      if (instance) {
        const entries = [...this.instanceData.entries()].filter(([k]) => k !== key);
        if (
          value != null &&
          (entries.length >= 256 ||
            entries.reduce((n, [k, v]) => n + k.length + v.length, key.length + value.length) >
              512 * 1024)
        )
          throw new Error('quota-exceeded');
        if (value == null) this.instanceData.delete(key);
        else this.instanceData.set(key, value);
      } else {
        this.check();
        await setData(this.scope, 'storage', key, value);
      }
      this.result(m);
      return;
    }
    if (domain === 'identity') {
      await this.identity(m, op);
      return;
    }
    if (domain === 'resource') {
      await this.resource(m, op);
      return;
    }
    if (domain === 'link') {
      const url = publicUrl(text(m.url, 4096));
      await this.consent(url);
      this.result(m, {
        status: (await platform.urlOpener.openExternalUrl(url)) ? 'opened' : 'denied',
      });
      return;
    }
    if (domain === 'config') {
      if (op === 'registerSchema') {
        const schema = validateSchema(m.schema);
        if (schema.type !== 'object') throw new Error('invalid-schema');
        this.schema = schema;
        this.result(m, { ok: true });
        this.send({ type: 'config.values', values: await this.readConfig(), schema });
        return;
      }
      if (op === 'unsubscribe') {
        this.configSubscribed = false;
        return;
      }
      if (op === 'subscribe') this.configSubscribed = true;
      if (op === 'openSettings') {
        if (!this.schema) throw new Error('invalid-schema');
        this.options.configure(this.schema, await this.readConfig());
        return;
      }
      this.send({
        type: 'config.values',
        id: m.id,
        values: await this.readConfig(),
        schema: this.schema,
      });
      return;
    }
    if (domain === 'relay' || domain === 'outbox') {
      await this.events(m, domain, op);
      return;
    }
    if (domain === 'intent') {
      await this.intent(m, op);
      return;
    }
    if (domain === 'inc') {
      await incBroker.handle(this.endpoint, m, (peer) => this.consent(peer));
    }
  }

  private async identity(m: Message, op: string) {
    const pubkey = this.options.accountPubkey;
    if (op === 'getPublicKey') {
      this.result(m, { pubkey: await this.applicationSigner().getPublicKey() });
      return;
    }
    if (op === 'getRelays') {
      const event = await this.network.replaceable(pubkey, 10002);
      const relays: Record<string, { read: boolean; write: boolean }> = {};
      for (const tag of event?.tags ?? [])
        if (tag[0] === 'r') {
          try {
            relays[publicUrl(tag[1], true)] = {
              read: !tag[2] || tag[2] === 'read',
              write: !tag[2] || tag[2] === 'write',
            };
          } catch {}
        }
      this.result(m, { relays });
      return;
    }
    if (op === 'getProfile') {
      const event = await this.network.replaceable(pubkey, 0);
      this.result(m, { profile: event ? JSON.parse(event.content) : null });
      return;
    }
    const kinds: Record<string, number> = { getFollows: 3, getMutes: 10000 };
    if (op === 'getBlocked') throw new Error('unsupported');
    if (kinds[op]) {
      const event = await this.network.replaceable(pubkey, kinds[op]);
      this.result(m, { pubkeys: event?.tags.filter((t) => t[0] === 'p').map((t) => t[1]) ?? [] });
      return;
    }
    if (op === 'getBadges') {
      const result = await this.network.query(
        await this.network.routes([pubkey], 'write'),
        [{ kinds: [30008], authors: [pubkey], '#d': ['profile_badges'], limit: 1 }],
        this.signal,
      );
      this.result(m, { badges: result.events });
      return;
    }
    if (op === 'getZaps') {
      const result = await this.network.query(
        await this.network.routes([pubkey], 'read'),
        [{ kinds: [9735], '#p': [pubkey], limit: 50 }],
        this.signal,
      );
      this.result(m, { zaps: result.events });
      return;
    }
    if (op === 'getList') {
      const kinds: Record<string, number> = {
        bookmarks: 10003,
        interests: 10015,
        pins: 10001,
        mutes: 10000,
      };
      const kind = kinds[m.listType ?? m.name];
      if (!kind) throw new Error('unsupported');
      const event = await this.network.replaceable(pubkey, kind);
      this.result(m, {
        entries:
          event?.tags.filter((t) => ['p', 'e', 'a', 't'].includes(t[0])).map((t) => t[1]) ?? [],
      });
    }
  }
  private async resource(m: Message, op: string) {
    if (op === 'info') {
      this.result(m, {
        info: {
          schemes: [
            { scheme: 'https', enabled: true },
            { scheme: 'blossom', enabled: true },
            { scheme: 'data', enabled: true },
          ],
          maxBytes: MAX_RESOURCE_BYTES,
          maxUrls: 16,
        },
      });
      return;
    }
    const requests =
      op === 'bytesMany' ? (m.requests ?? m.urls) : [{ url: m.url, servers: m.servers }];
    const urls = Array.isArray(requests)
      ? requests.map((request) => (typeof request === 'string' ? { url: request } : request))
      : requests;
    if (
      !Array.isArray(urls) ||
      !urls.length ||
      urls.length > 16 ||
      this.counters.resource + urls.length > 60 ||
      this.resourceActive >= 4
    )
      throw new Error('quota-exceeded');
    const request = this.resources.get(m.id);
    if (!request) throw new Error('invalid-request');
    assertNotAborted(request.signal);
    this.counters.resource += urls.length;
    this.resourceActive++;
    const deadline = new AbortController();
    const timer = setTimeout(() => deadline.abort(), 25000);
    const linked = linkAbort([this.signal, request.signal, deadline.signal]);
    const signal = linked.signal;
    try {
      const items = [];
      let responseBytes = 0;
      for (const value of urls) {
        assertNotAborted(this.signal);
        assertNotAborted(request.signal);
        if (deadline.signal.aborted || responseBytes >= 16 * 1024 * 1024) {
          items.push({
            url: value?.url,
            ok: false,
            error: deadline.signal.aborted ? 'timeout' : 'quota-exceeded',
          });
          continue;
        }
        try {
          const url = text(value?.url, 4096);
          let bytes: Uint8Array;
          const hash = /^blossom:sha256:([a-f0-9]{64})$/.exec(url)?.[1];
          if (hash) {
            const servers = value.servers == null ? [] : value.servers;
            if (!Array.isArray(servers) || servers.length > 8) throw new Error('invalid-request');
            const hints = servers.map((server: unknown) => publicUrl(text(server, 4096)));
            bytes = await fetchBlob(
              {
                ...this.options.release,
                servers: [...new Set([...hints, ...this.options.release.servers])].slice(0, 8),
              },
              hash,
              MAX_RESOURCE_BYTES,
              signal,
            );
          } else if (url.startsWith('data:')) {
            const match = /^data:[^,;]*(?:;base64)?,(.*)$/s.exec(url);
            if (!match) throw new Error('unsupported-scheme');
            bytes = url.slice(0, url.indexOf(',')).endsWith(';base64')
              ? base64.decode(match[1])
              : new TextEncoder().encode(decodeURIComponent(match[1]));
          } else
            bytes = await platform.napplet.fetchResource(
              publicUrl(url),
              MAX_RESOURCE_BYTES,
              signal,
            );
          if (
            bytes.length > MAX_RESOURCE_BYTES ||
            this.deliveredBytes + bytes.length > 50 * 1024 * 1024 ||
            responseBytes + bytes.length > 16 * 1024 * 1024
          )
            throw new Error('quota-exceeded');
          this.deliveredBytes += bytes.length;
          responseBytes += bytes.length;
          const mime = resourceMime(bytes);
          items.push({
            url,
            ok: true,
            blob: { __nappletBlob: await encodeNappletBytes(bytes, signal), mime },
            mime,
          });
        } catch (error) {
          assertNotAborted(this.signal);
          assertNotAborted(request.signal);
          items.push({
            url: value?.url,
            ok: false,
            error: deadline.signal.aborted
              ? 'timeout'
              : error instanceof Error
                ? error.message
                : 'network-error',
          });
        }
      }
      if (op === 'bytesMany') this.result(m, { items });
      else if (items[0].ok) this.result(m, { blob: items[0].blob, mime: items[0].mime });
      else throw new Error(items[0].error);
    } finally {
      clearTimeout(timer);
      linked.dispose();
      this.resourceActive--;
    }
  }
  private async events(m: Message, domain: string, op: string) {
    if (['close', 'publish', 'publishEncrypted'].includes(op))
      return this.eventRequest(m, domain, op, this.signal);
    const timeout = new AbortController();
    const budget = Number.isFinite(m.options?.timeoutMs) && m.options.timeoutMs > 0 ? m.options.timeoutMs : 10000;
    const timer = setTimeout(() => timeout.abort(), budget);
    const linked = linkAbort([this.signal, timeout.signal]);
    try {
      await this.eventRequest(m, domain, op, linked.signal);
    } finally {
      clearTimeout(timer);
      linked.dispose();
    }
  }
  private async eventRequest(m: Message, domain: string, op: string, signal: AbortSignal) {
    if (op === 'close') {
      this.streams.get(m.subId)?.();
      this.streams.delete(m.subId);
      this.result(m);
      return;
    }
    if (op === 'publish' || op === 'publishEncrypted') {
      await this.publish(m, domain, op);
      return;
    }
    const options = m.options ?? {};
    if (op === 'resolveRelays') {
      const target = m.target ?? {};
      const authors = target.authors ?? [target.pubkey ?? this.options.accountPubkey];
      this.result(m, {
        plan: {
          relays: await this.network.routes(authors, 'write', false, signal),
          source: 'nip65',
        },
      });
      return;
    }
    const filters = relayFilters(
      op === 'getEvent' ? { ids: [text(m.eventId)], limit: 1 } : m.filters,
    );
    const authors = [...new Set(filters.flatMap((filter) => filter.authors ?? []))];
    const relays =
      domain === 'relay'
        ? relayUrls(m.relay ? [m.relay] : undefined)
        : options.relays
          ? relayUrls(options.relays)
          : await this.network.routes(
              options.authors ??
                (authors.length ? authors : [options.author ?? this.options.accountPubkey]),
              'write',
              false,
              signal,
            );
    this.check();
    if (op === 'subscribe') {
      const id = text(m.subId, 128);
      if (this.streams.has(id)) throw new Error('invalid-subscription');
      let stopped = false;
      let refreshing = false;
      let currentRoutes = relays;
      const seen = new Set<string>();
      const queue: ({ message: Message; bytes: number } | undefined)[] = [];
      let head = 0;
      let flushTimer: ReturnType<typeof setTimeout> | null = null;
      const flush = () => {
        flushTimer = null;
        if (stopped || this.signal.aborted) return;
        let bytes = 0;
        for (let count = 0; head < queue.length && count < 8 && bytes < 128 * 1024; count++) {
          const entry = queue[head]!;
          queue[head++] = undefined;
          bytes += entry.bytes;
          this.send(entry.message);
        }
        if (head === queue.length) { queue.length = 0; head = 0; }
        else if (head >= 1024 && head * 2 >= queue.length) { queue.splice(0, head); head = 0; }
        if (head < queue.length) flushTimer = setTimeout(flush, 16);
      };
      const enqueue = (message: Message, bytes: number) => {
        queue.push({ message, bytes });
        if (!flushTimer) flushTimer = setTimeout(flush, 0);
      };
      const attach = () =>
        this.network.subscribe(
          {
            relays: currentRoutes,
            filters,
            timeoutMs: 8000,
            abort: this.signal,
            onEvent: (event) => {
              if (stopped || seen.has(event.id) || !matchFilters(filters, event)) return;
              if (seen.size >= 8192) seen.delete(seen.values().next().value!);
              seen.add(event.id);
              enqueue(
                { type: `${domain}.event`, subId: id, result: { event } },
                eventWeight(event),
              );
            },
            onEose: () => {
              if (domain === 'relay') enqueue({ type: 'relay.eose', subId: id }, 128);
            },
            onEnd: (results) => {
              if (!stopped && results.every((result) => result.status !== 'eose')) {
                this.streams.get(id)?.();
                this.streams.delete(id);
                this.send({ type: `${domain}.closed`, subId: id, reason: 'network-error' });
              }
            },
          },
          (event) => this.signAuth(event),
        );
      let stopSubscription = attach();
      const timer =
        domain === 'outbox' && !options.relays
          ? setInterval(() => {
              if (refreshing || stopped) return;
              refreshing = true;
              void this.network
                .routes(
                  options.authors ??
                    (authors.length ? authors : [options.author ?? this.options.accountPubkey]),
                  'write',
                )
                .then((next) => {
                  if (
                    stopped ||
                    this.signal.aborted ||
                    [...next].sort().join() === [...currentRoutes].sort().join()
                  )
                    return;
                  stopSubscription();
                  currentRoutes = next;
                  stopSubscription = attach();
                })
                .catch(() => {})
                .finally(() => {
                  refreshing = false;
                });
            }, 60000)
          : null;
      const close = () => {
        stopped = true;
        if (timer) clearInterval(timer);
        if (flushTimer) clearTimeout(flushTimer);
        queue.length = 0;
        head = 0;
        stopSubscription();
        seen.clear();
      };
      this.streams.set(id, close);
      return;
    }
    const result = await this.network.query(
      relays,
      filters,
      signal,
      async (event) => {
        assertNotAborted(signal);
        const signed = await this.signAuth(event);
        assertNotAborted(signal);
        return signed;
      },
      Math.min(20000, Math.max(100, Number(options.timeoutMs) || 10000)),
    );
    this.result(
      m,
      op === 'getEvent'
        ? {
            result: result.events[0] ? { event: result.events[0] } : undefined,
            incomplete: result.incomplete,
            error: result.error,
          }
        : {
            events: result.events.map((event) => ({ event })),
            incomplete: result.incomplete,
            error: result.error,
          },
    );
  }
  private async publish(m: Message, domain: string, op: string) {
    let routing = true;
    const routingExpiresAt = Date.now() + 25000;
    let permissionVersion: number | undefined;
    const current = () => {
      this.check();
      if (routing && Date.now() >= routingExpiresAt) throw new Error('timeout');
      if (permissionVersion !== undefined && permissionVersion !== this.signingPermissions.version) throw new Error('permission-denied');
    };
    const input = m.event ?? m.template;
    if (input?.created_at != null && !Number.isSafeInteger(input.created_at))
      throw new Error('invalid-timestamp');
    const submitted = { ...input, created_at: input?.created_at ?? Math.floor(Date.now() / 1000) };
    if (!isEventTemplate(submitted)) throw new Error('publication-blocked');
    const opts = m.options ?? {};
    let relays =
      domain === 'outbox' && opts.toOutbox === false
        ? []
        : await this.network.routes([this.options.accountPubkey], 'write');
    if (opts.relays) relays.push(...relayUrls(opts.relays));
    if (opts.toInboxes) relays.push(...(await this.network.routes(opts.toInboxes, 'read', true)));
    relays = [...new Set(relays)];
    current();
    if (!relays.length) throw new Error('invalid-relays');
    const template: EventTemplate = {
      kind: submitted.kind,
      content: submitted.content,
      tags: submitted.tags.map(tag => [...tag]),
      created_at: submitted.created_at,
    };
    if (op === 'publishEncrypted' && !/^[a-f0-9]{64}$/.test(m.recipient))
      throw new Error('invalid-recipient');
    if (op === 'publishEncrypted' && m.encryption && m.encryption !== 'nip44')
      throw new Error('unsupported-encryption');
    routing = false;
    permissionVersion = await this.signingPermissions.authorize({
      operation: op === 'publishEncrypted' ? 'encrypt-publish' : 'publish',
      kind: template.kind, relays, accountPubkey: this.options.accountPubkey,
      content: template.content, tags: template.tags, createdAt: template.created_at,
      ...(template.kind >= 30000 && template.kind < 40000
        ? { identifier: template.tags.find((tag) => tag[0] === 'd')?.[1] ?? '' } : {}),
      ...(op === 'publishEncrypted' ? { recipient: m.recipient } : {}),
    });
    current();
    if (op === 'publishEncrypted') {
      if (m.encryption && m.encryption !== 'nip44') throw new Error('unsupported-encryption');
      const recipient = text(m.recipient);
      if (!/^[a-f0-9]{64}$/.test(recipient)) throw new Error('invalid-recipient');
      const signer = await this.network.getSigner();
      if (!signer.nip44Encrypt) throw new Error('unsupported-encryption');
      template.content = await signer.nip44Encrypt(recipient, template.content);
      current();
    }
    const event = await this.network.sign(template);
    current();
    const outcomes = await this.network.publish(event, relays, (e) => this.signAuth(e));
    const ok = Object.values(outcomes).every(Boolean);
    this.result(m, {
      ok,
      event,
      eventId: event.id,
      relays: outcomes,
      ...(ok ? {} : { error: 'partial-publication' }),
    });
  }
  private async intent(m: Message, op: string) {
    const releases = await this.options.handlers();
    const defaults = { ...this.scope, appKey: 'host:intent-defaults' };
    const preferences = await dataEntries(defaults, 'defaults');
    this.check();
    const availability = (archetype: string) => {
      const candidates = [];
      for (const release of releases) {
        const contracts = release.intents.filter((contract) =>
          contract.convention.startsWith(`napplet:${archetype}/`),
        );
        if (!contracts.length) continue;
        const preferred = contracts.map((contract) => preferences.get(contract.convention));
        candidates.push({
          id: release.eventKey,
          title: release.title,
          contracts,
          actions: [...new Set(contracts.map((contract) => contract.convention.split('/')[1]))],
          conventions: contracts.map((contract) => contract.convention),
          isDefault: preferred.includes(release.eventKey),
        });
      }
      return {
        archetype,
        available: candidates.length > 0,
        candidates,
        hasDefault: candidates.some((candidate) => candidate.isDefault),
      };
    };
    if (op === 'handlers') {
      const roles = [
        ...new Set(
          releases.flatMap((release) =>
            release.intents.map(
              (contract) => contract.convention.slice('napplet:'.length).split('/')[0],
            ),
          ),
        ),
      ];
      const handlers = [];
      for (let offset = 0; offset < Math.min(roles.length, 32); offset += 8) {
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        this.check();
        handlers.push(...roles.slice(offset, offset + 8).map(availability));
      }
      this.result(m, { handlers });
      return;
    }
    if (op === 'available') {
      this.result(m, { availability: await availability(text(m.archetype, 64)) });
      return;
    }
    const request = m.request ?? m;
    const convention = text(request.convention);
    if (!/^napplet:[a-z0-9-]+\/[a-z0-9-]+$/.test(convention)) throw new Error('invalid-convention');
    const candidates = releases
      .filter((release) => release.intents.some((contract) => contract.convention === convention))
      .map((release) => ({ id: release.eventKey, release }));
    if (!candidates.length) throw new Error('handler-unavailable');
    const saved = await getData(defaults, 'defaults', convention);
    const preferred =
      request.handler === 'choose'
        ? undefined
        : candidates.find((candidate) => candidate.id === saved);
    const chosen =
      preferred?.id ??
      (await this.options.confirm({
        title: this.options.release.title,
        app: this.options.release,
        accountPubkey: this.options.accountPubkey,
        detail: convention,
        choices: candidates.slice(0, 16).flatMap((h) => [
          { key: h.id, title: h.release.title },
          { key: `default:${h.id}`, title: `${h.release.title} (${i18n.t('applications.always')})` },
        ]),
      }, this.signal));
    this.check();
    const target = candidates.find(
      (c) => c.id === (typeof chosen === 'string' ? chosen.replace(/^default:/, '') : chosen),
    );
    if (!target) throw new Error('permission-denied');
    const currentTarget = (await this.options.handlers()).find(release => release.eventKey === target.id &&
      release.intents.some(contract => contract.convention === convention));
    this.check();
    if (!currentTarget) throw new Error('handler-unavailable');
    if (typeof chosen === 'string' && chosen.startsWith('default:'))
      await setData(defaults, 'defaults', convention, target.id);
    this.check();
    const [archetype, action] = convention.slice('napplet:'.length).split('/');
    const delivery = {
      id: randomId(),
      sender: this.options.release.eventKey,
      convention,
      archetype,
      action,
      payload: request.payload,
    };
    this.result(m, { result: { ok: true, convention, archetype, action, handler: target.id } });
    await this.options.invoke(currentTarget, delivery);
  }
}
