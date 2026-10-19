import { platform } from '@/platform';
import type { ExplorePage, ExploreMessage } from '@/platform/ports/explore';
import { assertNotAborted } from '@/platform/abort';
import { NappletNetwork } from '@/services/napplet/network';
import { SigningPermissions } from '@/services/signing/permissions';
import { signingRevision } from '@/services/signing/changes';
import { nip19, verifyEvent } from 'nostr-tools';
import { signingTemplate } from '@/services/signing/event-template';
import { eventWeight, randomId } from '@/services/napplet/protocol';
import { publicEventAddress } from './event-address';
import { encodeNappletBytes } from '@/platform/napplet-bytes';
import { loadSiteBlob } from '@/services/napplet/artifacts';
import { applicationPresentation, websiteAddress } from './model';
import type { ExploreEntry } from './model';
import type { RuntimePrompt } from '@/services/napplet/runtime';
import { localRelay } from '@/services/local-relay';
import { ExploreStreams } from './streams';
import { getData, setData } from '@/services/napplet/repository';
import { NappCapabilities } from './capabilities';
import type { ConfigSchema } from '@/services/napplet/config';
import { NappData } from './data';
import { NappSync } from './sync';
import { NappDevice } from './device';
import { LIST_KINDS, SET_KINDS } from './lists';
import { relayHealth } from './relay-health';
export class ExploreRuntime {
  private lifetime = new AbortController();
  private documentLife = new AbortController();
  private network: NappletNetwork;
  private streams: ExploreStreams;
  private capabilities?: NappCapabilities;
  private readonly instance = randomId();
  private capabilitiesClosed: Promise<void> = Promise.resolve();
  private nonce = '';
  private data?: NappData;
  private sync?: NappSync;
  private device?: NappDevice;
  private permissions?: SigningPermissions;
  private document = '';
  private origin = '';
  private url = '';
  private identityGranted = false;
  private pending = new Set<string>();
  private logWindow = { start: Date.now(), count: 0 };
  private unsubscribe?: () => void;
  presented=false;
  containerId?: string;
  constructor(readonly account: string, readonly entry: ExploreEntry, private options: {
    accountAccessGranted?: boolean;
    presented?:()=>void;
    failed?: () => void;
    theme?: () => {
      background: string;
      text: string;
      primary: string;
    } | undefined;
    confirm: (prompt: RuntimePrompt, signal: AbortSignal) => Promise<string | false>;
    close: () => void;
    link: (url: string) => void;
    navigated?: (url: string) => void;
    configure?: (schema: ConfigSchema, values: Record<string, unknown>, save: (values: Record<string, unknown>) => Promise<void>, signal: AbortSignal) => void;
    applications?: () => Promise<ExploreEntry[]>;
    application?: (sourceId: string) => Promise<ExploreEntry | undefined>;
    launch?: (entry: ExploreEntry) => Promise<void>;
  }) { this.network = new NappletNetwork(account); this.streams = new ExploreStreams(this.network); }
  async start() {
    if (!platform.napplet.openPage)
      throw new Error('napplets.rebuild_required');
    const page: ExplorePage = { storageId: this.account, sourceId: `${this.account}:${this.entry.key}`, network: this.entry.kind !== 'napp' || this.entry.required.includes('network'),
      script: '', bootstrap: { napp: this.entry.kind === 'napp', theme: this.options.theme?.(), domains: this.entry.required, instance: this.instance } };
    if (this.entry.kind === 'website')
      page.url = this.entry.address;
    else {
      page.files = [];
      let total = 0;
      let mediaServers: Promise<string[]> | undefined;
      const load = async (hash: string) => {
        try { return await loadSiteBlob(this.entry, hash, this.lifetime.signal); }
        catch (error) {
          assertNotAborted(this.lifetime.signal);
          if (!(error instanceof Error) || error.message !== 'napplets.download_failed' || !this.entry.manifest) throw error;
          // All workers share one lazy metadata lookup, after signed hints fail.
          mediaServers ??= this.network.mediaServers(this.entry.manifest.pubkey, this.lifetime.signal);
          const servers = (await mediaServers).filter(server => !this.entry.servers.includes(server));
          assertNotAborted(this.lifetime.signal);
          if (!servers.length) throw error;
          return loadSiteBlob({ servers }, hash, this.lifetime.signal);
        }
      };
      // A small worker pool bounds network and memory pressure; blobs remain hash-verified.
      const paths = [...(this.entry.files ?? [])];
      const files = page.files;
      const worker = async () => {
        while (paths.length) {
          const file = paths.shift()!;
          await new Promise<void>(r => setTimeout(r, 0));
          let bytes: Uint8Array;
          try { bytes = await load(file.hash); }
          catch (error) {
            assertNotAborted(this.lifetime.signal);
            this.log('warn', 'download', { path: file.path, hash: file.hash,
              error: error instanceof Error ? error.message : 'download-failed',
              cause: error instanceof Error && error.cause instanceof Error ? error.cause.message : undefined });
            throw error;
          }
          total += bytes.length;
          if (total > 32 * 1024 * 1024)
            throw new Error('quota-exceeded');
          files.push({ path: file.path, mime: file.mime, body: await encodeNappletBytes(bytes, this.lifetime.signal) });
          await new Promise<void>(r => setTimeout(r, 0));
        }
      };
      await Promise.all([worker(), worker(), worker()]);
    }
    assertNotAborted(this.lifetime.signal);
    const receive = (id: string, raw: string) => {
      if (id !== this.containerId || raw.length > 2 * 1024 * 1024)
        return;
      let message: ExploreMessage;
      try {
        message = JSON.parse(raw);
      }
      catch {
        return;
      }
      if (!['explore.navigation', 'explore.request', 'explore.error'].includes(message.type) || typeof message.document !== 'string' || typeof message.origin !== 'string')
        return;
      if (message.type === 'explore.error') {
        this.log('warn', 'navigation', { url: message.url, error: message.error });
        this.options.failed?.();
        return;
      }
      if (this.document !== message.document || message.type === 'explore.request' && message.origin !== this.origin)
        this.enterDocument(message);
      if (message.type === 'explore.request' && message.origin === this.origin)
        void this.request(message);
    };
    const early: {
      id: string;
      raw: string;
    }[] = [];
    this.unsubscribe = platform.napplet.addMessageListener((id, raw) => {
      if (!this.containerId) {
        if (early.length < 32)
          early.push({ id, raw });
      }
      else
        receive(id, raw);
    });
    this.containerId = await platform.napplet.openPage(page);
    if (this.lifetime.signal.aborted) {
      await platform.napplet.close(this.containerId);
      throw new Error('session-closed');
    }
    for (const message of early)
      receive(message.id, message.raw);
    return this.containerId;
  }
  private enterDocument(message: ExploreMessage) {
    this.capabilitiesClosed = this.capabilities?.stop() ?? this.capabilitiesClosed; this.capabilities = undefined;
    this.nonce = '';
    this.streams.clear();
    this.documentLife.abort();
    this.data = undefined; this.sync = undefined; this.device = undefined;
    this.documentLife = new AbortController();
    this.pending.clear();
    this.document = message.document;
    this.origin = message.origin;
    this.url = message.url ?? message.origin;
    this.identityGranted = !!this.options.accountAccessGranted && (this.entry.kind !== 'website' || this.origin === new URL(this.entry.address).origin);
    const sourceId = this.entry.kind === 'website' ? this.origin : this.entry.key;
    if (this.entry.kind === 'website' && !/^https?:\/\//.test(sourceId)) {
      this.permissions = undefined;
      return;
    }
    const application = this.entry.kind === 'website' ? { title:new URL(this.origin).host,description:'',servers:[],required:[],origin:this.origin } : applicationPresentation(this.entry);
    this.permissions = new SigningPermissions({ accountPubkey: this.account, sourceId }, (signing, signal) => this.options.confirm({ title: application.title, detail: '', signing, application,
      requester: { title: application.title, origin: sourceId } }, signal ?? this.documentLife.signal), this.documentLife.signal, () => { });
  }
  private async request(message: ExploreMessage) {
    const document = message.document, signal = this.documentLife.signal;
    const started = Date.now();
    let method = 'invalid-request';
    let id: string | undefined;
    let nonce: string | undefined;
    const current = () => { assertNotAborted(signal); assertNotAborted(this.lifetime.signal); if (document !== this.document)
      throw new Error('session-closed'); };
    try {
      const request = JSON.parse(message.raw ?? '');
      if (typeof request.nonce !== 'string' || request.nonce.length > 64 || typeof request.id !== 'string' || request.id.length > 128 || !Array.isArray(request.args) || request.args.length > 4 || this.pending.has(request.id) || this.pending.size >= 16)
        throw new Error('invalid-request');
      id = request.id;nonce=request.nonce;
      if (this.nonce && nonce !== this.nonce) throw new Error('invalid-document-token');
      this.nonce = nonce!;
      method = typeof request.method === 'string' ? request.method.slice(0, 80) : 'invalid-request';
      this.pending.add(id!);
      current();
      const result = await this.dispatch(request.method, request.args, current, signal, nonce!);
      current();
      this.log('debug', method, { durationMs: Date.now() - started,
        ...(Array.isArray(result) ? { count: result.length } : {}) });
      await this.reply(document, { id, nonce, result });
    }
    catch (error) {
      if (!signal.aborted) this.log('warn', method, { error: error instanceof Error ? error.message.slice(0, 240) : 'request-failed' });
      if (id && !signal.aborted)
        await this.reply(document, { id, nonce, error: error instanceof Error ? error.message : 'request-failed' });
    }
    finally {
      if (document === this.document && id)
        this.pending.delete(id);
    }
  }
  private log(level: 'debug' | 'warn', method: string, details: object) {
    if (Date.now() - this.logWindow.start >= 10000) this.logWindow = { start: Date.now(), count: 0 };
    if (++this.logWindow.count > 60) return;
    console[level]('[explore]', this.entry.title, method, details);
  }
  private async reply(document: string, reply: unknown) {
    if (this.containerId && document === this.document && !this.lifetime.signal.aborted) {
      const raw = JSON.stringify({ document, reply });
      if (raw.length > 2 * 1024 * 1024) throw new Error('reply-too-large');
      await platform.napplet.send(this.containerId, raw);
    }
  }
  private async dispatch(method: string, args: any[], current: () => void, signal: AbortSignal, nonce: string): Promise<unknown> {
    if (method === 'ready') {
      this.presented=true;this.options.presented?.();
      if (this.entry.kind === 'website')
        this.options.navigated?.(this.url);
      return true;
    }
    if (method === 'log') {
      this.log('warn', 'page', { message: String(args[0] ?? '').slice(0, 400) });
      return true;
    }
    const napp = this.entry.kind === 'napp';
    if (napp && /^(nip04|nip44)\.(encrypt|decrypt)$/.test(method)) {
      const [algorithm, operation] = method.split('.') as ['nip04' | 'nip44', 'encrypt' | 'decrypt'];
      const [peer, text] = args;
      if (typeof peer !== 'string' || !/^[a-f0-9]{64}$/.test(peer) || typeof text !== 'string' || !text || text.length > 100000)
        throw new Error('invalid-crypto-request');
      const signer = await this.network.getSigner(); current();
      const key = `${algorithm}${operation === 'encrypt' ? 'Encrypt' : 'Decrypt'}` as 'nip04Encrypt' | 'nip04Decrypt' | 'nip44Encrypt' | 'nip44Decrypt';
      const run = signer[key];
      if (!run) throw new Error('unsupported-encryption');
      const scope = { accountPubkey: this.account, sourceId: this.entry.key };
      const revision = signingRevision(scope);
      const answer = await this.options.confirm({ title: this.entry.title, detail: '', application: applicationPresentation(this.entry), accountPubkey: this.account,
        crypto: { operation, algorithm, peer } }, signal);
      current();
      if (answer !== 'allow') throw new Error('permission-denied');
      // Give consent UI a paint before a local cryptographic fallback starts.
      await new Promise<void>(resolve => setTimeout(resolve, 0)); current();
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const result = await Promise.race([run.call(signer, peer, text), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('crypto-timeout')), 25000); })]);
        current();
        if (signingRevision(scope) !== revision) throw new Error('permission-revoked');
        return result;
      } finally { clearTimeout(timer); }
    }
    if (method === 'getPublicKey') {
      const source = this.entry.kind === 'website' ? this.origin : this.entry.key;
      const scope = { accountPubkey: this.account, appKey: source };
      if (!this.identityGranted && this.entry.kind === 'website') {
        this.identityGranted = await getData(scope, 'permissions', 'domains') !== null;
        current();
      }
      if (!this.identityGranted) {
        const application = this.entry.kind === 'website' ? { title: new URL(this.origin).host, description: '', servers: [], required: [] }
          : { ...this.entry, publisher: this.entry.manifest?.pubkey };
        const answer = await this.options.confirm({ title: application.title, detail: '', application,
          ...(this.entry.kind === 'website' ? { requester: { title: application.title, origin: this.origin } } : {}), accountPubkey: this.account }, signal);
        current();
        if (answer !== 'allow')
          throw new Error('permission-denied');
        this.identityGranted = true;
        if(this.entry.kind === 'website') { await setData(scope,'permissions','domains','[]');current(); }
      }
      return this.account;
    }
    if (method === 'signEvent') {
      const event = signingTemplate(args[0]);
      const permissions = this.permissions;
      if (!permissions)
        throw new Error('invalid-origin');
      const operation = event.kind === 22242 ? 'relay-auth' : 'sign';
      const revision = await permissions.authorize({ operation, kind: event.kind, relays: [], accountPubkey: this.account, content: event.content, tags: event.tags, createdAt: event.created_at });
      current();
      const expires = Date.now() + 25000;
      const signed = await this.network.sign(event);
      current();
      const scope = { accountPubkey: this.account, sourceId: this.entry.kind === 'website' ? this.origin : this.entry.key };
      if (Date.now() > expires || operation !== 'relay-auth' && signingRevision(scope) !== revision)
        throw new Error('permission-revoked');
      return signed;
    }
    if (!napp)
      throw new Error('unsupported-method');
    if (method === 'sync' || method === 'relayHealth' || method.startsWith('utils.')) {
      if (method.startsWith('utils.saveFile.') || method === 'utils.copyText') {
        this.device ??= new NappDevice(applicationPresentation(this.entry), this.account, signal, this.options.confirm);
        return this.device.handle(method.slice(6), args);
      }
      const data = this.data ??= new NappData(this.account, this.network, signal);
      if (method === 'sync') { this.sync ??= new NappSync(data); return this.sync.run(args[0], args[1], args[2] ?? {}); }
      if (method === 'relayHealth') return relayHealth(data, args[0]);
      const operation = method.slice(6);
      if (Object.hasOwn(LIST_KINDS, operation)) return data.list(operation, args[0]);
      if (Object.hasOwn(SET_KINDS, operation)) return data.sets(operation, args[0]);
      if (['fetchFavoriteRelaysWithSets', 'fetchEmojisWithSets', 'fetchFavoriteFollowSetsWithSets'].includes(operation)) return data.withSets(operation, args[0]);
      if (operation === 'loadNostrUser') return data.user(args[0]);
      if (operation === 'loadRelayInfo') return data.relayInfo(args[0]);
      if (operation === 'loadEvent') return data.loadEvent(args[0], args[1] ?? undefined, args[2] ?? undefined);
      if (operation === 'loadEvents') return data.loadEvents(args[0]);
      if (operation === 'searchUserLocal') return data.searchLocal(args[0]);
      if (operation === 'searchUser') return data.searchRemote(args[0]);
      if (operation === 'findAuthors') return data.findAuthors(args[0], args[1] ?? {});
      if (operation === 'publish') {
        const results = await this.dispatch('publish', args, current, signal, nonce) as Record<string, boolean>;
        const relays = Object.fromEntries(Object.entries(results).map(([url, ok]) => [url, { ok, ...(ok ? {} : { error: 'publication-failed' }) }]));
        const published = Object.values(results).filter(Boolean).length;
        return { published, failed: Object.keys(results).length - published, relays };
      }
      throw new Error('unsupported-method');
    }
    if (['instance', 'registerAction', 'action', 'actionResult', 'nap'].includes(method)) {
      const document = this.document;
      this.capabilities ??= new NappCapabilities(this.account, this.entry, this.network, {
        signal, confirm: this.options.confirm, beforeConnect: () => this.capabilitiesClosed,
        send: message => this.reply(document, { ...(message.type?.startsWith('inc.') ? { type: 'nap', message } : message), nonce }),
        configure: (schema, values, save, life) => {
          if (!this.options.configure) throw new Error('settings-unavailable');
          this.options.configure(schema, values, save, life);
        },
        applications: this.options.applications ?? (async () => []),
        application: this.options.application,
        launch: this.options.launch ?? (async () => { throw new Error('handler-unavailable'); }),
      }, this.instance);
      return this.capabilities.handle(method === 'instance' ? 'ready' : method, args);
    }
    if (method === 'storeSubscribe' || method === 'relaySubscribe' || method === 'outboxSubscribe') {
      const document=this.document;
      await this.streams.open(method,args,signal,
        message=>this.reply(document,{...message,nonce}),
        async input=>{
          const event=signingTemplate(input);
          if(event.kind!==22242)throw new Error('invalid-auth');
          await this.permissions!.authorize({operation:'relay-auth',kind:event.kind,relays:[],
            accountPubkey:this.account,content:event.content,tags:event.tags,createdAt:event.created_at});
          current();const signed=await this.network.sign(event);current();return signed;
        });
      return true;
    }
    if (method === 'streamClose') { this.streams.close(String(args[0]));return true; }
    if (method === 'storeAdd') { await localRelay.add(args[0]);current();return null; }
    if (method === 'storeRemove') return localRelay.remove(args[0]);
    if (method === 'storeEvent') return await localRelay.event(args[0]) ?? null;
    if (method === 'storeReplaceable') return await localRelay.replaceable(args[0],args[1],args[2]) ?? null;
    if (method === 'close') {
      setTimeout(this.options.close, 0);
      return true;
    }
    if (method === 'link') {
      if (!this.entry.required.includes('link'))
        throw new Error('permission-denied');
      const address=websiteAddress(String(args[0]));
      const answer=await this.options.confirm({title:this.entry.title,detail:address,requester:{title:this.entry.title,origin:this.entry.key}},signal);
      current();if(answer!=='allow') throw new Error('permission-denied');
      this.options.link(address);
      return true;
    }
    if (method === 'publish' && !this.entry.required.some(d => ['relay', 'outbox', 'common'].includes(d)))
      throw new Error('permission-denied');
    if (method === 'verifyEvent')
      return eventWeight(args[0]) < 256 * 1024 && verifyEvent(args[0]);
    if (method === 'query' || method === 'count') {
      return method === 'count' ? localRelay.count(args[0]) : localRelay.query(args[0]);
    }
    if (method === 'profile' || method === 'relayList') {
      const pubkey = method === 'profile' && typeof args[0] === 'object' ? args[0]?.pubkey : args[0];
      if (typeof pubkey !== 'string' || !/^[a-f0-9]{64}$/.test(pubkey)) throw new Error('invalid-pubkey');
      const event = await this.network.replaceable(pubkey, method === 'profile' ? 0 : 10002, signal);
      current();
      if (method === 'relayList') {
        const items = new Map<string, { url: string; read: boolean; write: boolean }>();
        for (const tag of event?.tags ?? []) {
          if (tag[0] !== 'r' || tag[2] && !['read', 'write'].includes(tag[2])) continue;
          try {
            const url = new URL(tag[1]);
            if (!['wss:', 'ws:'].includes(url.protocol) || url.username || url.password || url.hash) continue;
            const key = url.href, previous = items.get(key);
            items.set(key, { url: key, read: !!previous?.read || tag[2] !== 'write', write: !!previous?.write || tag[2] !== 'read' });
          } catch { /* Ignore malformed relay URLs in public metadata. */ }
        }
        return { event, items: [...items.values()] };
      }
      let metadata: Record<string, unknown> = {};
      try {
        const value = JSON.parse(event?.content ?? '{}');
        if (value && typeof value === 'object' && !Array.isArray(value)) metadata = value;
      } catch { /* A malformed metadata event still identifies its public author. */ }
      const npub = nip19.npubEncode(pubkey);
      const name = [metadata.name, metadata.display_name].find(value => typeof value === 'string' && value.trim());
      return { pubkey, npub, event, metadata, shortName: name ?? `${npub.slice(0, 12)}…${npub.slice(-4)}` };
    }
    if (method === 'loadEvent') {
      const address = publicEventAddress(args[0]);
      const result = await this.network.query(address.relays.length ? address.relays : await this.network.routes([this.account], 'read'), address.filters, signal);
      current();
      return result.events[0] ?? null;
    }
    if (method === 'publish') {
      const event = args[0];
      if (!event || eventWeight(event) > 256 * 1024 || !verifyEvent(event))
        throw new Error('invalid-event');
      const relays = args[1] ?? await this.network.routes([event.pubkey], 'write');
      current();
      return this.network.publish(event, relays);
    }
    throw new Error('unsupported-method');
  }
  updateTheme() {
    if (this.document)
      void this.reply(this.document, { type: 'theme', value: this.options.theme?.() }).catch(() => { });
  }
  async openConfiguration() {
    assertNotAborted(this.documentLife.signal);
    if (!this.document || !this.nonce) throw new Error('application-not-ready');
    await this.dispatch('nap', [{ type: 'config.openSettings' }], () => assertNotAborted(this.documentLife.signal), this.documentLife.signal, this.nonce);
  }
  async goBack(): Promise<boolean> {
    assertNotAborted(this.lifetime.signal);
    if (!this.containerId) return false;
    return platform.napplet.goBack(this.containerId);
  }
  stop() {
    void this.capabilities?.stop(); this.capabilities = undefined;
    this.streams.clear();
    this.lifetime.abort();
    this.documentLife.abort();
    this.unsubscribe?.();
    this.network.destroy();
    if (this.containerId)
      void platform.napplet.close(this.containerId).catch(() => { });
  }
}
