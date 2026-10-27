import { automaticBrowserPermission } from '../src/services/explore/browser-permissions';
import type { ExplorePage } from '../src/platform/ports/explore';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import { rename, copyFile, unlink } from 'node:fs/promises';
import {
  BrowserWindow,
  WebContentsView,
  ipcMain,
  session,
  dialog,
  type Session,
  type IpcMainInvokeEvent,
} from 'electron';
import { NAPPLET_FRAME_READY_MESSAGE, type NappletBounds, type ResourceValidators } from '../src/platform/ports/napplet';
import { IPC } from './ipc-channels';
import { fetchNappletResource, fetchNappletResourceResponse } from './napplet-resource';

export { isPublicAddress } from './napplet-public-dns';

export { fetchNappletResource } from './napplet-resource';

export function registerNappletHandlers(
  trusted: (event: IpcMainInvokeEvent) => boolean,
  parent: () => BrowserWindow | null,
) {
  const views = new Map<
    string,
    {
      page?: ExplorePage; document?: string; navigating?: boolean; committed?: { document: string; url: string }; files?: Map<string, NonNullable<ExplorePage['files']>[number]>;
      view: WebContentsView;
      owner: BrowserWindow;
      url: string;
      ready: boolean;
      painted: boolean;
      visible: boolean;
      inputBlocked: boolean;
      capture?: Promise<string | null>;
      queued: string[];
      ownerClosed: () => void;
      browser: Map<string, { action?: string; resolve(allowed: boolean, expiresAt?: number | null): void; timer: ReturnType<typeof setTimeout> }>;
      fullscreen?: boolean;
      permissions: Map<string, number>;
    }
  >();
  const requests = new Map<string, { abort: AbortController; owner: BrowserWindow }>();
  const configuredProfiles = new Set<Session>();
  const downloads = new Set<Session>();
  const browserRequest = (entry: (typeof views extends Map<string, infer T> ? T : never), action: 'window'|'external'|'permission'|'download',
    details: { url?: string; resources?: string[]; filename?: string }, resolve: (allowed: boolean, expiresAt?: number | null) => void = () => {}, source?: string) => {
    if (!entry.page || entry.browser.size >= 16 || entry.owner.isDestroyed()) { resolve(false); return; }
    const url = source || (entry.navigating && action === 'download' ? entry.committed?.url : undefined) || entry.view.webContents.getURL() || entry.url;
    const target = new URL(url);
    if (!['http:', 'https:'].includes(target.protocol)) { resolve(false); return; }
    const id = `browser:${randomUUID()}`;
    const timer = setTimeout(() => { entry.browser.delete(id); resolve(false); }, 1020000);
    entry.browser.set(id, { action, resolve, timer });
    entry.owner.webContents.send(IPC.nappletMessage, [...views].find(([,value]) => value === entry)?.[0], JSON.stringify({
      type: 'explore.browser', origin: target.origin, url, document: entry.document,
      policyDocument: entry.navigating && action === 'download' ? entry.committed?.document ?? entry.document : undefined, browser: { id, action, ...details },
    }));
  };
  const cancelBrowser = (entry: (typeof views extends Map<string, infer T> ? T : never)) => {
    for (const pending of entry.browser.values()) { clearTimeout(pending.timer); pending.resolve(false); }
    entry.browser.clear();
  };
  const restoreRetainedDocument = async (entry: (typeof views extends Map<string, infer T> ? T : never)) => {
    const previous = entry.committed, pending = entry.document;
    if (!entry.navigating || !previous || entry.view.webContents.isDestroyed() || [...entry.browser.values()].some(request => request.action === 'download')) return;
    try {
      const token = await entry.view.webContents.executeJavaScript('window.__exploreNativeDocumentToken');
      if (!entry.navigating || entry.document !== pending || token !== previous.document || entry.view.webContents.isDestroyed() || [...entry.browser.values()].some(request => request.action === 'download')) return;
      entry.navigating = false;
      entry.document = randomUUID();
      entry.committed = { document: entry.document, url: previous.url };
      cancelBrowser(entry);
      entry.owner.webContents.send(IPC.nappletMessage, [...views].find(([, value]) => value === entry)?.[0], JSON.stringify({
        type: 'explore.navigation', phase: 'resume', document: entry.document, previousDocument: previous.document,
        origin: new URL(previous.url).origin, url: previous.url,
      }));
      await entry.view.webContents.executeJavaScript(`window.__exploreNativeDocumentToken=${JSON.stringify(entry.document)};window.__exploreDocumentCommitted=true;window.__exploreCommit?.()`);
    } catch { /* A replaced or destroyed DOM cannot be resumed. */ }
  };
  const originFor = (source: string) => `https://${createHash('sha256').update(source).digest('hex')}.explore.psstpsst.invalid`;
  const configureProfile = (profile: Session) => {
    if (configuredProfiles.has(profile)) return;
    configuredProfiles.add(profile);
    profile.webRequest.onBeforeRequest((details, callback) => {
      const entry = [...views.values()].find(item => item.view.webContents.id === details.webContentsId);
      const target = new URL(details.url);
      callback({ cancel: !!entry?.page && !entry.page.url && !entry.page.network && target.origin !== originFor(entry.page.sourceId) && !['data:', 'blob:'].includes(target.protocol) });
    });
    profile.protocol.handle('https', async request => {
      const target = new URL(request.url);
      const entry = [...views.values()].reverse().find(item => item.page && !item.page.url && item.view.webContents.session === profile && originFor(item.page.sourceId) === target.origin);
      if (!entry?.page) return profile.fetch(request, { bypassCustomProtocolHandlers: true });
      const pathname = decodeURIComponent(target.pathname);
      const file = entry.files?.get(pathname) ?? (pathname.endsWith('/') ? entry.files?.get(`${pathname}index.html`) : undefined);
      if (!file) return new Response('', { status: 404 });
      return new Response(Buffer.from(file.body, 'base64'), { headers: { 'Content-Type': file.mime,
        'Content-Security-Policy': `default-src 'self' data: blob: ${entry.page.network ? 'https: http: wss: ws:' : ''}; script-src 'self' 'unsafe-inline' 'unsafe-eval' blob: ${entry.page.network ? 'https: http:' : ''}; style-src 'self' 'unsafe-inline' ${entry.page.network ? 'https: http:' : ''}; worker-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'self'`, 'Referrer-Policy': 'no-referrer' } });
    });
  };
  const handle = (channel: string, fn: (...args: any[]) => unknown) =>
    ipcMain.handle(channel, (event, ...args) => {
      if (!trusted(event)) throw new Error('Untrusted napplet IPC');
      const owner = BrowserWindow.fromWebContents(event.sender) ?? parent();
      if (!owner) throw new Error('window-unavailable');
      const entry = views.get(args[0]);
      const request = requests.get(args[0]);
      if (entry && entry.owner !== owner || request && request.owner !== owner) throw new Error('untrusted-container-owner');
      return fn(owner, ...args);
    });
  handle(IPC.nappletFetch, async (owner: BrowserWindow, id: string, url: string, max: number, accept?: string, responseOptions?: { validators?: ResourceValidators }) => {
    if (typeof id !== 'string' || id.length > 128 || requests.size >= 32 || [...requests.values()].filter(request => request.owner === owner).length >= 12)
      throw new Error('quota-exceeded');
    const abort = new AbortController();
    if (requests.has(id)) throw new Error('request-in-progress');
    requests.set(id, { abort, owner });
    const ownerClosed = () => abort.abort();
    owner.once('closed', ownerClosed);
    try {
      if (responseOptions) {
        const response = await fetchNappletResourceResponse(url, max, abort.signal, responseOptions.validators);
        return { ...response, bytes: Buffer.from(response.bytes).toString('base64') };
      }
      return Buffer.from(await fetchNappletResource(url, max, abort.signal, accept)).toString('base64');
    } catch (error) {
      // Resource failures are handled by callers; rejecting invoke logs them again in Electron.
      if (abort.signal.aborted) return null;
      const code = error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
        ? error.code : undefined;
      return { error: error instanceof Error && error.message ? error.message : code ?? 'resource-unavailable', code };
    } finally {
      owner.removeListener('closed', ownerClosed);
      requests.delete(id);
    }
  });
  handle(IPC.nappletCancel, (_owner: BrowserWindow, id: string) => {
    requests.get(id)?.abort.abort();
  });
  const close = (id: string) => {
    const entry = views.get(id);
    if (!entry) return;
    views.delete(id);
    cancelBrowser(entry);
    entry.owner.removeListener('closed', entry.ownerClosed);
    if (!entry.owner.isDestroyed()) entry.owner.contentView.removeChildView(entry.view);
    if (!entry.view.webContents.isDestroyed()) {
      const profile = entry.view.webContents.session;
      entry.view.webContents.close();
      // Remote website profiles use Chromium's loader and have no custom handler to remove.
      if (!entry.page?.url && ![...views.values()].some(item => !item.view.webContents.isDestroyed() && item.view.webContents.session === profile)) {
        profile.protocol.unhandle('https'); profile.webRequest.onBeforeRequest(null); configuredProfiles.delete(profile);
      }
      if (!entry.page) void profile.clearStorageData().catch(() => {});
    }
  };
  handle(IPC.nappletOpen, async (owner: BrowserWindow, html: string) => {
    if (typeof html !== 'string' || html.length > 40 * 1024 * 1024) throw new Error('too-large');
    for (const [id, entry] of views) if (entry.owner === owner) close(id);
    const id = randomUUID();
    const isolated = session.fromPartition(`napplet-${id}`, { cache: false });
    const url = `https://napplet.psstpsst.invalid/${id}`;
    isolated.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    isolated.setPermissionCheckHandler(() => false);
    // The only URL ever served in this profile is the immutable host wrapper.
    isolated.protocol.handle(
      'https',
      () =>
        new Response(html, {
          headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
        }),
    );
    isolated.webRequest.onBeforeRequest((details, callback) =>
      callback({ cancel: details.url !== url || details.resourceType !== 'mainFrame' }),
    );
    const view = new WebContentsView({
      webPreferences: {
        session: isolated,
        preload: path.join(__dirname, 'napplet-preload.js'),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
        // Keep startup frame callbacks unthrottled until the loaded view is presented.
        backgroundThrottling: false,
      },
    });
    const ownerClosed = () => close(id);
    view.setBackgroundColor('transparent');
    views.set(id, { view, owner, url, ready: false, painted: false, visible: false, inputBlocked: true, queued: [], ownerClosed, browser: new Map(), permissions: new Map() });
    owner.contentView.addChildView(view);
    view.setVisible(false);
    view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    view.webContents.on('will-navigate', (event) => event.preventDefault());
    view.webContents.on('will-attach-webview', (event) => event.preventDefault());
    const blockInput = (event: { preventDefault(): void }) => {
      const entry = views.get(id);
      if (!entry || !entry.painted || entry.inputBlocked) event.preventDefault();
    };
    view.webContents.on('before-input-event', blockInput);
    view.webContents.on('before-mouse-event', blockInput);
    owner.once('closed', ownerClosed);
    await view.webContents.loadURL(url);
    setTimeout(() => {
      const entry = views.get(id);
      if (!entry || owner.isDestroyed()) return;
      entry.ready = true;
      for (const raw of entry.queued) owner.webContents.send(IPC.nappletMessage, id, raw);
      entry.queued = [];
    }, 0);
    return id;
  });
  handle(IPC.exploreClearData, async (_owner: BrowserWindow, storageId: string) => {
    if(typeof storageId!=='string' || storageId.length>256) throw new Error('invalid-page');
    for(const [id,entry] of views) if(entry.page?.storageId===storageId) close(id);
    const key = createHash('sha256').update(storageId).digest('hex');
    for (const suffix of ['', '-bundles']) {
      const profile = session.fromPartition(`persist:explore-${key}${suffix}`);
      await profile.clearStorageData(); await profile.clearCache();
    }
  });
  handle(IPC.exploreOpen, async (owner: BrowserWindow, page: ExplorePage) => {
    if (!page || typeof page.sourceId !== 'string' || typeof page.script !== 'string' || page.script.length > 32000 ||
      (page.files && (page.files.length > 512 || JSON.stringify(page.files).length > 48 * 1024 * 1024))) throw new Error('invalid-page');
    if (page.bootstrap && (JSON.stringify(page.bootstrap).length > 8192 || typeof page.bootstrap.napp !== 'boolean' ||
      typeof page.bootstrap.instance !== 'string' || page.bootstrap.instance.length > 128 ||
      !Array.isArray(page.bootstrap.domains) || page.bootstrap.domains.length > 32 || page.bootstrap.domains.some(domain => typeof domain !== 'string' || domain.length > 64) ||
      page.bootstrap.theme && ['background', 'text', 'primary'].some(key => typeof (page.bootstrap!.theme as any)[key] !== 'string' || (page.bootstrap!.theme as any)[key].length > 128))) throw new Error('invalid-page');
    if (page.url) {
      const parsed = new URL(page.url);
      if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error('invalid-page');
    }
    for (const [id, entry] of views) if (entry.owner === owner) close(id);
    const id = randomUUID();
    // Remote pages keep Chromium's native HTTPS loader, including redirects and cookies.
    // Bundle sessions alone intercept HTTPS to serve verified synthetic origins.
    const profile = session.fromPartition(`persist:explore-${createHash('sha256').update(page.storageId??page.sourceId).digest('hex')}${page.url ? '' : '-bundles'}`, { cache: false });
    const host = createHash('sha256').update(page.sourceId).digest('hex');
    const origin = `https://${host}.explore.psstpsst.invalid`;
    const url = page.url ?? `${origin}/index.html`;
    if (!page.url) await profile.clearStorageData({origin,storages:['serviceworkers','cachestorage']});
    if (!page.url) configureProfile(profile);
    profile.setPermissionRequestHandler((contents, permission, callback, details) => {
      const entry = [...views.values()].find(value => value.view.webContents === contents);
      if (!entry?.page || !details.isMainFrame) { callback(false); return; }
      if (automaticBrowserPermission(permission)) { callback(String(permission) === 'persistent-storage' || entry.visible && !entry.inputBlocked); return; }
      const media = permission === 'media' && 'mediaTypes' in details && Array.isArray(details.mediaTypes) ? details.mediaTypes : [];
      const keys = media.length ? media.map(type => `media:${type}`) : [permission];
      browserRequest(entry, 'permission', { resources: media.length ? media : [permission] }, (allowed, expiresAt) => {
        if (allowed) for (const key of keys) entry.permissions.set(key, expiresAt ?? Infinity);
        callback(allowed);
      }, details.requestingUrl);
    });
    profile.setPermissionCheckHandler((contents, permission, _origin, details) => {
      if (!contents || !details.isMainFrame) return false;
      const entry = [...views.values()].find(value => value.view.webContents === contents);
      if (!entry?.page) return false;
      if (automaticBrowserPermission(permission)) return String(permission) === 'persistent-storage' || entry.visible && !entry.inputBlocked;
      const expiresAt = entry.permissions.get(permission === 'media' ? `media:${details.mediaType ?? 'unknown'}` : permission);
      return expiresAt !== undefined && expiresAt > Date.now();
    });
    if (!downloads.has(profile)) {
      downloads.add(profile);
      profile.on('will-download', (_event, item, contents) => {
        const entry = [...views.values()].find(value => value.view.webContents === contents);
        if (!entry?.page) { item.cancel(); return; }
        const temporary = path.join(os.tmpdir(), `psst-download-${randomUUID()}`);
        item.setSavePath(temporary); item.pause();
        let destination: string | undefined;
        const cleanup = () => { void unlink(temporary).catch(() => {}); };
        item.once('done', (_done, state) => {
          if (state !== 'completed' || !destination) { cleanup(); return; }
          const selected = destination;
          void (async () => { try { await rename(temporary, selected); } catch { await copyFile(temporary, selected); await unlink(temporary); } })()
            .catch(error => { cleanup(); console.warn('[explore] Download save failed', error); });
        });
        browserRequest(entry, 'download', { url: item.getURL(), filename: item.getFilename() }, allowed => {
          void restoreRetainedDocument(entry);
          if (!allowed || entry.owner.isDestroyed()) { item.cancel(); cleanup(); return; }
          void dialog.showSaveDialog(entry.owner, { defaultPath: item.getFilename() }).then(result => {
            if (result.canceled || !result.filePath) { item.cancel(); cleanup(); return; }
            destination = result.filePath; item.resume();
          }).catch(() => { item.cancel(); cleanup(); });
        });
      });
    }
    const view = new WebContentsView({ webPreferences: {session:profile,preload:path.join(__dirname,'napplet-preload.js'),
      additionalArguments:[page.bootstrap ? `--psst-explore-bootstrap=${Buffer.from(JSON.stringify(page.bootstrap)).toString('base64')}` : `--psst-explore=${Buffer.from(page.script).toString('base64')}`],sandbox:true,contextIsolation:true,nodeIntegration:false,webSecurity:true,backgroundThrottling:false} });
    const ownerClosed=()=>close(id);
    const entry={view,owner,url,ready:true,painted:true,visible:false,inputBlocked:true,queued:[] as string[],ownerClosed,page,files:page.files ? new Map(page.files.map(file => [file.path, file])) : undefined,document:randomUUID(),navigating:true,committed:undefined as {document:string;url:string}|undefined,browser:new Map<string,{action?:string;resolve(allowed:boolean, expiresAt?:number|null):void;timer:ReturnType<typeof setTimeout>}>(),fullscreen:false,permissions:new Map<string, number>()};
    views.set(id,entry);owner.contentView.addChildView(view);view.setVisible(false);owner.once('closed',ownerClosed);
    view.webContents.setWindowOpenHandler(details=>{ browserRequest(entry, 'window', { url: details.url }); return {action:'deny'}; });
    view.webContents.on('will-attach-webview',(event)=>event.preventDefault());
    view.webContents.on('will-navigate',(event,target)=>{ const u=new URL(target); if(!['http:','https:'].includes(u.protocol) || (!page.url && u.origin!==origin)) {
      event.preventDefault(); browserRequest(entry, ['http:','https:'].includes(u.protocol) ? 'window' : 'external', { url: target });
    } });
    let ownerWasFullscreen = false;
    view.webContents.on('enter-html-full-screen',()=>{ownerWasFullscreen=owner.isFullScreen();entry.fullscreen=true;owner.setFullScreen(true);const bounds=owner.getContentBounds();view.setBounds({x:0,y:0,width:bounds.width,height:bounds.height});});
    view.webContents.on('leave-html-full-screen',()=>{entry.fullscreen=false;owner.setFullScreen(ownerWasFullscreen);});
    view.webContents.on('did-start-navigation',(_event,target,inPlace,main)=>{
      if(!main || inPlace) return;entry.navigating=true;cancelBrowser(entry);entry.permissions.clear();entry.document=randomUUID();
      owner.webContents.send(IPC.nappletMessage,id,JSON.stringify({type:'explore.navigation',phase:'start',document:entry.document,origin:new URL(target).origin,url:target}));
    });
    view.webContents.on('did-frame-navigate', (_event, target, _code, _status, main) => {
      if (!main) return;
      entry.navigating = false;
      entry.committed = { document: entry.document, url: target };
      entry.owner.webContents.send(IPC.nappletMessage, id, JSON.stringify({ type: 'explore.navigation', phase: 'commit',
        document: entry.document, origin: new URL(target).origin, url: target }));
      void view.webContents.executeJavaScript(`window.__exploreNativeDocumentToken=${JSON.stringify(entry.document)};window.__exploreDocumentCommitted=true;window.__exploreCommit?.()`).catch(() => {});
    });
    view.webContents.on('did-stop-loading', () => { void restoreRetainedDocument(entry); });
    view.webContents.on('did-fail-provisional-load', (_event, _code, _description, _url, main) => {
      if (main) void restoreRetainedDocument(entry);
    });
    view.webContents.on('did-fail-load', (_event, _code, _description, _url, main) => {
      if (main) void restoreRetainedDocument(entry);
    });
    view.webContents.on('before-input-event',(event)=>{if(entry.inputBlocked) event.preventDefault();});
    view.webContents.on('before-mouse-event',(event)=>{if(entry.inputBlocked) event.preventDefault();});
    try { await view.webContents.loadURL(url); }
    catch (error) { close(id); throw error; }
    return id;
  });
  ipcMain.on(IPC.exploreMessage,(event,raw:string)=>{
    const found=[...views.entries()].find(([,entry])=>entry.page && event.sender===entry.view.webContents && event.senderFrame===entry.view.webContents.mainFrame);
    if(!found || found[1].navigating || typeof raw!=='string') return;
    const [id,entry]=found;
    try { if (JSON.parse(raw).documentToken !== entry.document) return; } catch { return; }
    const url=event.senderFrame!.url;
    let origin:string;try{origin=new URL(url).origin;}catch{return;}
    if(!['http:','https:'].includes(new URL(url).protocol)) return;
    entry.owner.webContents.send(IPC.nappletMessage,id,JSON.stringify({type:'explore.request',origin,document:entry.document,url,raw}));
  });
  handle(IPC.nappletClose, (_owner: BrowserWindow, id: string) => close(id));
  handle(IPC.nappletCapture, async (_owner: BrowserWindow, id: string) => {
    const entry = views.get(id);
    if (!entry?.painted || entry.view.webContents.isDestroyed()) return null;
    entry.inputBlocked = true;
    if (entry.capture) return entry.capture;
    const capture = (async () => {
      const image = await entry.view.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true });
      if (views.get(id) !== entry || image.isEmpty()) return null;
      const size = image.getSize();
      const scale = Math.min(1, 1600 / Math.max(size.width, size.height));
      const preview = scale < 1 ? image.resize({ width: Math.max(1, Math.round(size.width * scale)), height: Math.max(1, Math.round(size.height * scale)) }) : image;
      return preview.toDataURL();
    })().catch(() => null);
    entry.capture = capture;
    try { return await capture; }
    finally { if (entry.capture === capture) delete entry.capture; }
  });
  handle(IPC.nappletGoBack, (_owner: BrowserWindow, id: string) => {
    const entry = views.get(id);
    if (!entry || entry.view.webContents.isDestroyed()) return false;
    const history = entry.view.webContents.navigationHistory;
    const index = history.getActiveIndex();
    if (index <= 0) return false;
    // Go to the immediate app entry, including entries created without user activation.
    history.goToIndex(index - 1);
    return true;
  });
  handle(IPC.nappletBounds, (_owner: BrowserWindow, id: string, bounds: NappletBounds, visible: boolean, interactive = true) => {
    const entry = views.get(id);
    if (!entry) return;
    if (
      !bounds ||
      !Object.values(bounds).every((value) => Number.isFinite(value) && Math.abs(value) < 30000)
    )
      throw new Error('invalid-bounds');
    const zoom = entry.owner.webContents.getZoomFactor();
    const fullscreenBounds = entry.owner.getContentBounds();
    entry.view.setBounds(entry.fullscreen ? {x:0,y:0,width:fullscreenBounds.width,height:fullscreenBounds.height} : {
      x: Math.round(bounds.x * zoom),
      y: Math.round(bounds.y * zoom),
      width: Math.max(0, Math.round(bounds.width * zoom)),
      height: Math.max(0, Math.round(bounds.height * zoom)),
    });
    entry.visible = !!visible && bounds.width > 0 && bounds.height > 0;
    entry.inputBlocked = !entry.visible || !interactive;
    // loadURL has completed before bounds can arrive. A hidden WebContentsView
    // suppresses requestAnimationFrame even with background throttling disabled;
    // reveal the loaded document so its first-paint handshake can run. Input is
    // still blocked by blockInput until that private handshake completes.
    entry.view.setVisible(entry.visible);
  });
  handle(IPC.nappletSend, (_owner: BrowserWindow, id: string, message: string) => {
    const entry = views.get(id);
    if (!entry || typeof message !== 'string') return;
    if (entry.page) {
      let envelope; try { envelope=JSON.parse(message); } catch { return; }
      if(envelope.document!==entry.document) return;
      if(envelope.reply?.type==='browser.permissions-changed') { entry.permissions.clear(); return; }
      if(envelope.reply?.type==='browser.result') {
        const pending=entry.browser.get(envelope.reply.id);
        if(pending){entry.browser.delete(envelope.reply.id);clearTimeout(pending.timer);pending.resolve(envelope.reply.result===true, envelope.reply.permissionExpiresAt === null ? null : Number.isFinite(envelope.reply.permissionExpiresAt) ? envelope.reply.permissionExpiresAt : Date.now());}
        return;
      }
      entry.view.webContents.send(IPC.exploreReply,JSON.stringify(envelope.reply));
    } else entry.view.webContents.send(IPC.nappletReply, message);
  });
  ipcMain.on(IPC.nappletMessage, (event, message: string) => {
    const found = [...views.entries()].find(
      ([, entry]) =>
        !entry.page && event.sender === entry.view.webContents &&
        event.senderFrame === entry.view.webContents.mainFrame &&
        event.senderFrame.url === entry.url,
    );
    if (found && typeof message === 'string') {
      if (message === NAPPLET_FRAME_READY_MESSAGE) {
        const entry = found[1];
        if (!entry.painted) {
          entry.painted = true;
          entry.view.setVisible(entry.visible);
          entry.view.webContents.setBackgroundThrottling(true);
        }
      }
      if (found[1].ready) found[1].owner.webContents.send(IPC.nappletMessage, found[0], message);
      else if (found[1].queued.length < 32) found[1].queued.push(message);
    }
  });
}
