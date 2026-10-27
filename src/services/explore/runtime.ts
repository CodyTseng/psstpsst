import { platform } from '@/platform';
import type { ExplorePage, ExploreMessage } from '@/platform/ports/explore';
import { assertNotAborted } from '@/platform/abort';
import { NappletNetwork } from '@/services/napplet/network';
import { SigningPermissions } from '@/services/signing/permissions';
import { ApplicationSigner } from '@/services/signing/application-signer';
import { BrowserActions } from './browser-actions';
import type { WebLn } from './webln';
import i18n from '@/i18n/core';
import { signingRevision } from '@/services/signing/changes';
import { nip19, verifyEvent } from 'nostr-tools';
import { signingTemplate } from '@/services/signing/event-template';
import { randomId } from '@/services/napplet/protocol';
import { isSignedEvent } from '@/lib/nostr/event-validation';
import { publicEventAddress } from './event-address';
import { encodeNappletBytes } from '@/platform/napplet-bytes';
import { loadSiteBlob, recordArtifactVersion } from '@/services/napplet/artifacts';
import { applicationPresentation, websiteAddress } from './model';
import type { ExploreEntry } from './model';
import type { RuntimePrompt } from '@/services/napplet/runtime';
import { localRelay } from '@/services/local-relay';
import { ExploreStreams } from './streams';
import { NappCapabilities } from './capabilities';
import type { ConfigSchema } from '@/services/napplet/config';
import { NappData } from './data';
import { NappSync } from './sync';
import { NappDevice } from './device';
import { LIST_KINDS, SET_KINDS } from './lists';
import { relayHealth } from './relay-health';
import type { LocalInstaller } from './local-installer';
const isPermissionDenied = (error: unknown) => error instanceof Error && error.message === 'permission-denied';
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
  private browser?: BrowserActions;
  private webLn?: WebLn;
  private installer?: LocalInstaller;
  private stopLocalWatch?: () => void;
  private permissions?: SigningPermissions;
  private document = '';
  private documentActive = false;
  private suspendedDocument?: { document: string; origin: string; url: string; nonce: string };
  private origin = '';
  private url = '';
  private pending = new Set<string>();
  private logWindow = { start: Date.now(), count: 0 };
  private unsubscribe?: () => void;
  private opening?: Promise<string>;
  private stopped?: Promise<void>;
  presented=false;
  containerId?: string;
  constructor(readonly account: string, readonly entry: ExploreEntry, private options: {
    presented?:()=>void;
    focus?: () => Promise<void>;
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
    launch?: (entry: ExploreEntry) => Promise<void>;
    installed?: (entry: ExploreEntry) => void;
    replaced?: (entry?: ExploreEntry) => void;
  }) { this.network = new NappletNetwork(account); this.streams = new ExploreStreams(this.network); }
  async start() {
    if (!platform.napplet.openPage)
      throw new Error('napplets.rebuild_required');
    const page: ExplorePage = { storageId: this.entry.local ? `${this.account}:${this.entry.key}` : this.account, sourceId: `${this.account}:${this.entry.key}`, network: this.entry.kind !== 'napp' || this.entry.required.includes('network'),
      script: '', bootstrap: { napp: this.entry.kind === 'napp', theme: this.options.theme?.(), domains: this.entry.required, instance: this.instance } };
    page.labels = { ok: i18n.t('common.ok'), cancel: i18n.t('common.cancel'), allow: i18n.t('napplets.allow') };
    if (this.entry.kind === 'website')
      page.url = this.entry.address;
    else {
      page.files = [];
      const artifactFiles = (this.entry.files ?? []).map(file => `files/${file.hash}.blob`);
      if (!this.entry.local) await recordArtifactVersion(this.entry, artifactFiles, false);
      let total = 0;
      let mediaServers: Promise<string[]> | undefined;
      const load = async (hash: string) => {
        if (this.entry.local) {
          const { loadLocalApplicationFile } = await import('./local-applications');
          return loadLocalApplicationFile(this.account, this.entry, hash, this.lifetime.signal);
        }
        try { return await loadSiteBlob(this.entry, hash, this.lifetime.signal); }
        catch (error) {
          assertNotAborted(this.lifetime.signal);
          if (!(error instanceof Error) || error.message !== 'napplets.download_failed' || !this.entry.manifest) throw error;
          // All workers share one lazy metadata lookup, after signed hints fail.
          mediaServers ??= this.network.mediaServers(this.entry.manifest.pubkey, this.lifetime.signal);
          const servers = (await mediaServers).filter(server => !this.entry.servers.includes(server));
          assertNotAborted(this.lifetime.signal);
          if (!servers.length) throw error;
          return loadSiteBlob({ ...this.entry, servers }, hash, this.lifetime.signal);
        }
      };
      // A small worker pool bounds network and memory pressure; blobs remain hash-verified.
      const paths = [...(this.entry.files ?? [])];
      let nextFile = 0;
      const files = page.files;
      const worker = async () => {
        while (nextFile < paths.length) {
          const file = paths[nextFile++];
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
      assertNotAborted(this.lifetime.signal);
      if (!this.entry.local) await recordArtifactVersion(this.entry, artifactFiles, true);
    }
    assertNotAborted(this.lifetime.signal);
    const receive = (id: string, raw: string) => {
      if (id !== this.containerId)
        return;
      let message: ExploreMessage;
      try {
        message = JSON.parse(raw);
      }
      catch {
        return;
      }
      if (!['explore.navigation', 'explore.request', 'explore.error', 'explore.browser'].includes(message.type) || typeof message.document !== 'string' || typeof message.origin !== 'string')
        return;
      if (message.type === 'explore.error') {
        this.log('warn', 'navigation', { url: message.url, error: message.error });
        this.options.failed?.();
        return;
      }
      if (message.type === 'explore.navigation') {
        if (message.phase === 'resume') {
          const previous = this.suspendedDocument;
          if (this.documentActive || !previous || message.previousDocument !== previous.document || message.origin !== previous.origin) return;
          this.enterDocument(message);
          this.nonce = previous.nonce;
          this.documentActive = true;
          this.suspendedDocument = undefined;
        } else {
          if (message.phase === 'start' && this.documentActive) {
            this.suspendedDocument = { document: this.document, origin: this.origin, url: this.url, nonce: this.nonce };
          }
          this.enterDocument(message);
          this.documentActive = message.phase !== 'start';
          if (this.documentActive) this.suspendedDocument = undefined;
        }
        return;
      }
      // Only a native download policy callback may run while page JS is blocked.
      const policySource = this.suspendedDocument ?? { document: this.document, origin: this.origin };
      const navigationPolicy = !this.documentActive && message.type === 'explore.browser' &&
        message.browser?.action === 'download' && message.document === this.document &&
        message.policyDocument === policySource.document && message.origin === policySource.origin;
      if (!navigationPolicy && (!this.documentActive || this.document !== message.document || message.origin !== this.origin)) return;
      if (message.type === 'explore.browser' && message.browser) {
        const request = message.browser, document = message.document, signal = this.documentLife.signal;
        const actions = navigationPolicy ? this.createBrowserActions(message.origin) : this.browserActions();
        void (async () => {
          let result = false;
          let permissionExpiresAt: number | null | undefined;
          try {
            if (this.entry.kind === 'website' && !message.origin.startsWith('https://') && request.action === 'permission') throw new Error('insecure-origin');
            if (request.action === 'window' || request.action === 'external') {
              await actions.handle(request.action === 'window' ? 'open' : 'external', [request.url]); result = true;
            } else { const decision = await actions.authorize(request); result = decision.allowed; permissionExpiresAt = decision.expiresAt; }
          } catch (error) { if (!isPermissionDenied(error)) this.log('warn', 'browser', { error: String(error) }); }
          if (this.document === document && !signal.aborted) await this.reply(document, { type: 'browser.result', id: request.id, result, permissionExpiresAt });
        })().catch(() => {});
        return;
      }
      if (message.type === 'explore.request' && message.origin === this.origin)
        void this.request(message);
    };
    const early: {
      id: string;
      raw: string;
    }[] = [];
    this.unsubscribe = platform.napplet.addMessageListener((id, raw) => {
      if (!this.containerId) {
        early.push({ id, raw });
      }
      else
        receive(id, raw);
    });
    this.containerId = await (this.opening = platform.napplet.openPage(page));
    if (this.lifetime.signal.aborted) {
      await this.stop();
      this.containerId = undefined;
      throw new Error('session-closed');
    }
    for (const message of early)
      receive(message.id, message.raw);
    if (this.entry.local) {
      const { watchLocalApplication } = await import('./local-applications');
      assertNotAborted(this.lifetime.signal);
      this.stopLocalWatch = watchLocalApplication(this.account, this.entry, latest => {
        // Revoke old document authority before any new version is presented.
        this.documentLife.abort();
        if (this.options.replaced) this.options.replaced(latest);
        else void this.stop();
      });
    }
    return this.containerId;
  }
  private enterDocument(message: ExploreMessage) {
    this.capabilitiesClosed = Promise.all([this.capabilitiesClosed, this.capabilities?.stop()]).then(() => {});
    void this.capabilitiesClosed.catch(() => {});
    this.capabilities = undefined;
    this.nonce = '';
    this.streams.clear();
    this.documentLife.abort();
    this.data = undefined; this.sync = undefined; this.device = undefined; this.browser = undefined; this.webLn = undefined; this.installer = undefined;
    this.documentLife = new AbortController();
    this.pending.clear();
    this.document = message.document;
    this.origin = message.origin;
    this.url = message.url ?? message.origin;
    const sourceId = this.entry.kind === 'website' ? this.origin : this.entry.key;
    if (this.entry.kind === 'website' && !/^https:\/\//.test(sourceId)) {
      this.permissions = undefined;
      return;
    }
    const application = this.entry.kind === 'website' ? { title:new URL(this.origin).host,description:'',servers:[],required:[],origin:this.origin } : applicationPresentation(this.entry);
    this.permissions = new SigningPermissions({ accountPubkey: this.account, sourceId,
      ...(this.entry.local ? { localVersion: this.entry.local.version } : {}) }, (signing, signal) => this.options.confirm({ title: application.title, detail: '', signing, application,
      requester: { title: application.title, origin: sourceId } }, signal ?? this.documentLife.signal), this.documentLife.signal, () => { });
  }
  private async request(message: ExploreMessage) {
    const document = message.document, signal = this.documentLife.signal;
    let method = 'invalid-request';
    let id: string | undefined;
    let nonce: string | undefined;
    const current = () => { assertNotAborted(signal); assertNotAborted(this.lifetime.signal); if (document !== this.document)
      throw new Error('session-closed'); };
    try {
      const request = JSON.parse(message.raw ?? '');
      if (typeof request.nonce !== 'string' || typeof request.id !== 'string' || !Array.isArray(request.args) || this.pending.has(request.id))
        throw new Error('invalid-request');
      id = request.id;nonce=request.nonce;
      if (this.nonce && nonce !== this.nonce) throw new Error('invalid-document-token');
      this.nonce = nonce!;
      method = typeof request.method === 'string' ? request.method.slice(0, 80) : 'invalid-request';
      this.pending.add(id!);
      current();
      const result = await this.dispatch(request.method, request.args, current, signal, nonce!);
      current();
      await this.reply(document, { id, nonce, result });
    }
    catch (error) {
      if (!method.startsWith('webln.') && !signal.aborted && !isPermissionDenied(error)) this.log('warn', method, { error: error instanceof Error ? error.message.slice(0, 240) : 'request-failed' });
      if (id && !signal.aborted)
        await this.reply(document, { id, nonce, error: error instanceof Error ? error.message : 'request-failed' });
    }
    finally {
      if (document === this.document && id)
        this.pending.delete(id);
    }
  }
  private log(level: 'warn', method: string, details: object) {
    if (Date.now() - this.logWindow.start >= 10000) this.logWindow = { start: Date.now(), count: 0 };
    if (++this.logWindow.count > 60) return;
    console[level]('[explore]', this.entry.title, method, details);
  }
  private async reply(document: string, reply: unknown) {
    if (this.containerId && document === this.document && !this.lifetime.signal.aborted) {
      const raw = JSON.stringify({ document, reply });
      await platform.napplet.send(this.containerId, raw);
    }
  }
  private browserActions() {
    return this.browser ??= this.createBrowserActions(this.origin);
  }
  private createBrowserActions(origin: string) {
    return new BrowserActions({ account: this.account, sourceId: this.entry.kind === 'website' ? origin : this.entry.key, localVersion: this.entry.local?.version,
      permissionsChanged: () => { void this.reply(this.document, { type: 'browser.permissions-changed' }).catch(() => {}); }, signal: this.documentLife.signal, confirm: this.options.confirm,
      application: this.entry.kind === 'website' ? { title: new URL(origin).host, description: '', servers: [], required: [], origin } : applicationPresentation(this.entry),
      open: async address => {
        if (!this.options.launch) throw new Error('window-unavailable');
        const url = websiteAddress(address);
        await this.options.launch({ key: url, address: url, title: new URL(url).host, description: '', kind: 'website', servers: [], required: [], desktopPosition: null, lastUsedAt: null });
      } });
  }
  private async dispatch(method: string, args: any[], current: () => void, signal: AbortSignal, nonce: string): Promise<unknown> {
    if (this.entry.kind === 'website' && !this.origin.startsWith('https://') &&
      !['ready', 'log', 'browser.open', 'browser.external'].includes(method)) throw new Error('insecure-origin');
    if (method.startsWith('webln.')) {
      if (!this.permissions) throw new Error('invalid-origin');
      const source = this.entry.kind === 'website' ? this.origin : this.entry.key;
      if (this.entry.kind === 'website' && new URL(this.origin).protocol !== 'https:') throw new Error('insecure-origin');
      if (!this.webLn) {
        // Defer wallet/database initialization until a page actually requests it.
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { WebLn } = require('./webln') as typeof import('./webln');
        current();
        this.webLn ??= new WebLn(this.account, source, this.entry.kind === 'website' ? new URL(this.origin).host : this.entry.title,
          signal, (prompt, reviewSignal) => this.options.confirm({ ...prompt,
            application: this.entry.kind === 'website'
              ? { title: new URL(this.origin).host, description: '', servers: [], required: [], origin: this.origin }
              : applicationPresentation(this.entry) }, reviewSignal));
      }
      return this.webLn.handle(method.slice(6), args);
    }
    if (method.startsWith('browser.')) return this.browserActions().handle(method.slice(8), args);
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
    if (method === 'getPublicKey' || /^(nip04|nip44)\.(encrypt|decrypt)$/.test(method)) {
      const permissions = this.permissions;
      if (!permissions) throw new Error('invalid-origin');
      const signer = new ApplicationSigner({ accountPubkey: this.account, permissions,
        signer: () => this.network.getSigner(), current });
      if (method === 'getPublicKey') return signer.getPublicKey();
      const [algorithm, operation] = method.split('.') as ['nip04' | 'nip44', 'encrypt' | 'decrypt'];
      return signer.crypto(algorithm, operation, args[0], args[1]);
    }
    if (method === 'signEvent') {
      const event = signingTemplate(args[0]);
      const permissions = this.permissions;
      if (!permissions)
        throw new Error('invalid-origin');
      const operation = event.kind === 22242 ? 'relay-auth' : 'sign';
      const revision = await permissions.authorize({ operation, kind: event.kind,
        relays: operation === 'relay-auth' ? [event.tags.find(tag => tag[0] === 'relay')![1]] : [],
        accountPubkey: this.account, content: event.content, tags: event.tags, createdAt: event.created_at });
      current();
      const signed = await this.network.sign(event);
      current();
      const scope = { accountPubkey: this.account, sourceId: this.entry.kind === 'website' ? this.origin : this.entry.key };
      if (signingRevision(scope) !== revision)
        throw new Error('permission-revoked');
      return signed;
    }
    if (method === 'clipboard.writeText') {
      const application = this.entry.kind === 'website'
        ? { title: new URL(this.origin).host, description: '', servers: [], required: [], origin: this.origin }
        : applicationPresentation(this.entry);
      this.device ??= new NappDevice(application, this.account, signal, this.options.confirm);
      return this.device.handle('copyText', args);
    }
    if (method === 'storeSubscribe') {
      const document = this.document;
      await this.streams.open(method, args, signal,
        message => this.reply(document, { ...message, nonce }),
        async () => { throw new Error('unsupported-method'); });
      return true;
    }
    if (method === 'streamClose') { this.streams.close(String(args[0]));return true; }
    if (method === 'storeAdd') { const added = await localRelay.add(args[0]);current();return added; }
    if (method === 'storeRemove') return localRelay.remove(args[0]);
    if (method === 'storeEvent') return await localRelay.event(args[0]) ?? null;
    if (method === 'storeReplaceable') return await localRelay.replaceable(args[0],args[1],args[2]) ?? null;
    if (method === 'query' || method === 'count') {
      return method === 'count' ? localRelay.count(args[0]) : localRelay.query(args[0]);
    }
    if (!napp)
      throw new Error('unsupported-method');
    if (method.startsWith('dev.installLocal.')) {
      if (!this.entry.required.includes('dev')) throw new Error('permission-denied');
      const { LocalInstaller } = await import('./local-installer'); current();
      this.installer ??= new LocalInstaller(this.account, this.entry, signal, this.options.confirm,
        app => this.options.installed?.(app));
      return this.installer.handle(method.slice('dev.installLocal.'.length), args);
    }
    if (method === 'sync' || method === 'relayHealth' || method.startsWith('utils.')) {
      if (method.startsWith('utils.saveFile.') || method === 'utils.copyText') {
        this.device ??= new NappDevice(applicationPresentation(this.entry), this.account, signal, this.options.confirm);
        return this.device.handle(method.slice(6), args);
      }
      const data = this.data ??= new NappData(this.account, this.network, signal);
      if (method === 'sync') {
        this.sync ??= new NappSync(data);
        return this.sync.run(args[0], args[1], args[2] ?? {});
      }
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
        send: async message => {
          if (message.type === 'action') await this.options.focus?.();
          await this.reply(document, { ...(message.type?.startsWith('inc.') ? { type: 'nap', message } : message), nonce });
        },
        configure: (schema, values, save, life) => {
          if (!this.options.configure) throw new Error('settings-unavailable');
          this.options.configure(schema, values, save, life);
        },
        applications: this.options.applications ?? (async () => []),
        launch: this.options.launch ?? (async () => { throw new Error('handler-unavailable'); }),
      }, this.instance);
      return this.capabilities.handle(method === 'instance' ? 'ready' : method, args);
    }
    if (method === 'relaySubscribe' || method === 'outboxSubscribe') {
      const document=this.document;
      await this.streams.open(method,args,signal,
        message=>this.reply(document,{...message,nonce}),
        async input=>{
          const event=signingTemplate(input);
          if(event.kind!==22242)throw new Error('invalid-auth');
          const permissions = this.permissions!;
          const revision = await permissions.authorize({operation:'relay-auth',kind:event.kind,
            relays:[event.tags.find(tag=>tag[0]==='relay')![1]],
            accountPubkey:this.account,content:event.content,tags:event.tags,createdAt:event.created_at});
          current();const signed=await this.network.sign(event);current();
          if(permissions.version!==revision)throw new Error('permission-revoked');
          return signed;
        });
      return true;
    }
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
      return isSignedEvent(args[0]) && verifyEvent(args[0]);
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
      if (!isSignedEvent(event) || !verifyEvent(event))
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
  stop(): Promise<void> {
    if (this.stopped) return this.stopped;
    const capabilities = this.capabilities?.stop(); this.capabilities = undefined;
    this.streams.clear();
    this.lifetime.abort();
    this.stopLocalWatch?.(); this.stopLocalWatch = undefined;
    this.documentLife.abort();
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.pending.clear();
    this.data = undefined; this.sync = undefined; this.device = undefined; this.browser = undefined; this.webLn = undefined; this.permissions = undefined;
    this.network.destroy();
    const container = this.containerId ? Promise.resolve(this.containerId) : this.opening;
    this.containerId = undefined;
    this.stopped = Promise.all([this.capabilitiesClosed, capabilities, container?.then(id => platform.napplet.close(id))]).then(() => {});
    // Existing fire-and-forget callers remain safe; restart callers await the same cleanup.
    void this.stopped.catch(() => {});
    return this.stopped;
  }
}
