import { BrowserWindow, ipcMain, screen, type IpcMainInvokeEvent, type WebContents } from 'electron';
import type { ApplicationWindowLaunch, ApplicationWindowAction, ApplicationSigningChange, RunningApplication } from '../src/platform/ports/application-window';
import { placeApplicationWindow } from './window-state';
import { IPC } from './ipc-channels';
import { ApplicationMessagingBroker } from '../src/services/explore/messaging-broker';
import type { ApplicationEndpoint, ApplicationEnvelope } from '../src/platform/ports/application-messaging';
import { applicationSourceId, applicationInstanceKey } from '../src/lib/application-identity';
import { isSignedEvent } from '../src/lib/nostr/event-validation';
import type { LocalRelayEvent } from '../src/platform/ports/local-relay-events';
import { verifyEvent, type Event } from 'nostr-tools';
import { eventKey } from '../src/lib/nostr/event-key';

/** Only host renderers enter this registry; application WebContentsViews never do. */
export class ApplicationWindows {
  private hosts = new Map<BrowserWindow, ApplicationWindowLaunch>();
  private identities = new Map<BrowserWindow, RunningApplication>();
  private byIdentity = new Map<string, BrowserWindow>();
  private aliases = new Map<string, string>();
  private messaging = new ApplicationMessagingBroker();
  private endpoints = new Map<string, WebContents>();
  constructor(private options: { create: () => BrowserWindow; parent: () => BrowserWindow | null; url: () => string;
    cleanup: (ownerId: number) => void; trusted: (event: IpcMainInvokeEvent) => boolean }) {}
  owns(sender: WebContents) { return this.windows().some(window => window.webContents === sender); }
  windows() { return [...this.hosts.keys()].filter(window => !window.isDestroyed()); }
  private host(sender: WebContents) { return this.windows().find(window => window.webContents === sender); }
  private changed() {
    const running = [...this.identities.values()];
    for (const window of [this.options.parent(), ...this.windows()]) if (window && !window.isDestroyed() && !window.webContents.isDestroyed())
      window.webContents.send(IPC.applicationWindowsChanged, running);
  }
  register() {
    const handle = (channel: string, callback: (event: IpcMainInvokeEvent, ...args: any[]) => unknown) => ipcMain.handle(channel, (event, ...args) => {
      if (!this.options.trusted(event)) throw new Error('untrusted-application-host');
      return callback(event, ...args);
    });
    handle(IPC.localRelayEvent, (event, message: LocalRelayEvent) => {
      if (!message || typeof message.origin !== 'string' || !isSignedEvent(message.event) || [4, 13, 14, 15, 1059].includes(message.event.kind))
        throw new Error('invalid-local-relay-event');
      for (const window of [this.options.parent(), ...this.windows()]) if (window && !window.isDestroyed() && !window.webContents.isDestroyed() && window.webContents !== event.sender)
        window.webContents.send(IPC.localRelayEvent, message);
    });
    handle(IPC.applicationMessagingConnect, (event, endpoint: ApplicationEndpoint) => {
      const window = this.host(event.sender), launch = window && this.hosts.get(window);
      if (!launch || !endpoint || endpoint.accountPubkey !== launch.accountPubkey || this.endpoints.has(endpoint.instance) ||
        [...this.endpoints.values()].filter(owner => owner === event.sender).length >= 8) throw new Error('invalid-endpoint');
      this.messaging.connect(endpoint, message => {
        if (message.type === 'action' && !window.isDestroyed()) { window.show(); window.focus(); }
        if (!event.sender.isDestroyed()) event.sender.send(IPC.applicationMessagingMessage, endpoint.instance, message);
      });
      this.endpoints.set(endpoint.instance, event.sender);
    });
    handle(IPC.applicationMessagingDisconnect, (event, instance: string) => {
      if (this.endpoints.get(instance) !== event.sender) throw new Error('untrusted-endpoint');
      this.messaging.disconnect(instance); this.endpoints.delete(instance);
    });
    handle(IPC.applicationMessagingRequest, (event, instance: string, message: ApplicationEnvelope) => {
      if (this.endpoints.get(instance) !== event.sender) throw new Error('untrusted-endpoint');
      return this.messaging.request(instance, message);
    });
    handle(IPC.applicationWindowOpen, async (event, launch: ApplicationWindowLaunch) => {
      if (!launch || !/^[a-f0-9]{64}$/.test(launch.accountPubkey) || typeof launch.address !== 'string' || launch.address.length > 8192 ||
        JSON.stringify(launch).length > 512 * 1024) throw new Error('invalid-application-window');
      const sourceId = applicationSourceId(launch.address);
      const key = applicationInstanceKey(launch.accountPubkey, sourceId);
      const existing = this.byIdentity.get(this.aliases.get(key) ?? key);
      if (existing && !existing.isDestroyed()) {
        if (existing.isMinimized()) existing.restore();
        existing.show(); existing.focus(); return;
      }
      if (this.hosts.size >= 8) throw new Error('invalid-application-window');
      const source = this.host(event.sender) ?? this.options.parent();
      const window = this.options.create();
      if (source && !source.isDestroyed()) {
        const sourceBounds = source.getBounds();
        window.setBounds(placeApplicationWindow(sourceBounds, window.getBounds(), screen.getDisplayMatching(sourceBounds).workArea));
      }
      this.hosts.set(window, structuredClone(launch));
      this.identities.set(window, { accountPubkey: launch.accountPubkey, sourceId });
      this.byIdentity.set(key, window); this.changed();
      // The host owns its native title; document/router titles never replace it.
      window.webContents.on('page-title-updated', event => event.preventDefault());
      const ownerId = window.webContents.id;
      const owner = window.webContents;
      const disconnect = () => { for (const [instance, contents] of this.endpoints) if (contents === owner) {
        this.messaging.disconnect(instance); this.endpoints.delete(instance);
      } };
      owner.on('render-process-gone', disconnect);
      owner.on('did-start-navigation', (_event, _url, inPlace, mainFrame) => { if (mainFrame && !inPlace) disconnect(); });
      window.once('closed', () => {
        disconnect(); this.hosts.delete(window); this.identities.delete(window);
        for (const [registered, owner] of this.byIdentity) if (owner === window) this.byIdentity.delete(registered);
        this.changed(); this.options.cleanup(ownerId);
      });
      try { await window.loadURL(this.options.url()); }
      catch (error) { window.destroy(); throw error; }
    });
    handle(IPC.applicationWindowLaunch, event => {
      const window = this.host(event.sender);
      return window ? this.hosts.get(window) : null;
    });
    handle(IPC.applicationWindowResolveIdentity, (event, input: Event) => {
      const window = this.host(event.sender), identity = window && this.identities.get(window);
      if (!window || !identity || !isSignedEvent(input) || JSON.stringify(input).length > 256 * 1024 ||
        ![5129, 15128, 15129, 35128, 35129, 35130].includes(input.kind)) throw new Error('invalid-application-identity');
      const manifest: Event = { id: input.id, pubkey: input.pubkey, kind: input.kind, created_at: input.created_at,
        tags: input.tags, content: input.content, sig: input.sig };
      if (!verifyEvent(manifest)) throw new Error('invalid-application-identity');
      const sourceId = eventKey(manifest);
      if (identity.sourceId !== sourceId && identity.sourceId !== manifest.id) throw new Error('invalid-application-identity');
      const oldKey = applicationInstanceKey(identity.accountPubkey, identity.sourceId);
      const key = applicationInstanceKey(identity.accountPubkey, sourceId);
      if (oldKey === key) return true;
      this.aliases.set(oldKey, key);
      while (this.aliases.size > 512) this.aliases.delete(this.aliases.keys().next().value!);
      const existing = this.byIdentity.get(key);
      if (existing && existing !== window && !existing.isDestroyed()) {
        if (existing.isMinimized()) existing.restore();
        existing.show(); existing.focus(); window.close();
        return false;
      }
      this.byIdentity.delete(oldKey);
      this.byIdentity.set(key, window);
      this.identities.set(window, { accountPubkey: identity.accountPubkey, sourceId });
      this.changed();
      return true;
    });
    handle(IPC.applicationWindowsRunning, () => [...this.identities.values()]);
    handle(IPC.applicationWindowClose, event => { this.host(event.sender)?.close(); });
    handle(IPC.applicationWindowCloseAll, (event, account?: string) => {
      if (event.sender !== this.options.parent()?.webContents) throw new Error('untrusted-window-owner');
      for (const [window, launch] of this.hosts) if (!account || launch.accountPubkey === account) window.close();
    });
    handle(IPC.applicationWindowAction, (event, action: ApplicationWindowAction) => {
      const window = this.host(event.sender), launch = window && this.hosts.get(window);
      if (!launch || !action || JSON.stringify(action).length > 16000) throw new Error('invalid-window-action');
      if (action.type === 'visited') {
        if (action.accountPubkey !== launch.accountPubkey || typeof action.key !== 'string' || action.key.length > 8192) throw new Error('invalid-window-action');
        this.options.parent()?.webContents.send(IPC.applicationWindowAction, action);
        return;
      }
      if (action.type === 'profile' || action.type === 'publisher' ? typeof action.pubkey !== 'string' || !/^[a-f0-9]{64}$/.test(action.pubkey) :
        action.type === 'discover' ? action.accountPubkey !== launch.accountPubkey || typeof action.name !== 'string' || !action.name || action.name.length > 128 || typeof action.auxiliary !== 'boolean' :
        action.type !== 'share' || action.accountPubkey !== launch.accountPubkey || typeof action.title !== 'string' || typeof action.address !== 'string') throw new Error('invalid-window-action');
      const parent = this.options.parent();
      if (!parent || parent.isDestroyed()) throw new Error('window-unavailable');
      parent.show(); parent.focus(); parent.webContents.send(IPC.applicationWindowAction, action);
    });
    handle(IPC.applicationSigningChange, (event, change: ApplicationSigningChange) => {
      if (!change || !/^[a-f0-9]{64}$/.test(change.accountPubkey) || typeof change.sourceId !== 'string' || change.sourceId.length > 8192 ||
        (change.key !== undefined && (typeof change.key !== 'string' || change.key.length > 4096))) throw new Error('invalid-signing-change');
      for (const window of [this.options.parent(), ...this.windows()]) if (window && !window.isDestroyed() && window.webContents !== event.sender)
        window.webContents.send(IPC.applicationSigningChange, change);
    });
    handle(IPC.applicationMetadataChange, (event, key: string) => {
      if (typeof key !== 'string' || !key.length || key.length > 8192) throw new Error('invalid-metadata-change');
      for (const window of [this.options.parent(), ...this.windows()]) if (window && !window.isDestroyed() && window.webContents !== event.sender)
        window.webContents.send(IPC.applicationMetadataChange, key);
    });
    handle(IPC.applicationFavoritesChange, (event, account: string) => {
      if (typeof account !== 'string' || !/^[a-f0-9]{64}$/.test(account)) throw new Error('invalid-favorites-change');
      for (const window of [this.options.parent(), ...this.windows()]) if (window && !window.isDestroyed() && window.webContents !== event.sender)
        window.webContents.send(IPC.applicationFavoritesChange, account);
    });
  }
}
