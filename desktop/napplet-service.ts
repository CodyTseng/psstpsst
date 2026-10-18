import type { ExplorePage } from '../src/platform/ports/explore';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import {
  BrowserWindow,
  WebContentsView,
  ipcMain,
  session,
  type Session,
  type IpcMainInvokeEvent,
} from 'electron';
import { NAPPLET_FRAME_READY_MESSAGE, type NappletBounds } from '../src/platform/ports/napplet';
import { IPC } from './ipc-channels';
import { fetchNappletResource } from './napplet-resource';

export { isPublicAddress } from './napplet-public-dns';

export { fetchNappletResource } from './napplet-resource';

export function registerNappletHandlers(
  trusted: (event: IpcMainInvokeEvent) => boolean,
  parent: () => BrowserWindow | null,
) {
  const views = new Map<
    string,
    {
      page?: ExplorePage; document?: string; files?: Map<string, NonNullable<ExplorePage['files']>[number]>;
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
    }
  >();
  const requests = new Map<string, { abort: AbortController; owner: BrowserWindow }>();
  const configuredProfiles = new Set<Session>();
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
  handle(IPC.nappletFetch, async (owner: BrowserWindow, id: string, url: string, max: number) => {
    if (typeof id !== 'string' || id.length > 128 || requests.size >= 32 || [...requests.values()].filter(request => request.owner === owner).length >= 12)
      throw new Error('quota-exceeded');
    const abort = new AbortController();
    if (requests.has(id)) throw new Error('request-in-progress');
    requests.set(id, { abort, owner });
    const ownerClosed = () => abort.abort();
    owner.once('closed', ownerClosed);
    try {
      return Buffer.from(await fetchNappletResource(url, max, abort.signal)).toString('base64');
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
    entry.owner.removeListener('closed', entry.ownerClosed);
    if (!entry.owner.isDestroyed()) entry.owner.contentView.removeChildView(entry.view);
    if (!entry.view.webContents.isDestroyed()) {
      const profile = entry.view.webContents.session;
      entry.view.webContents.close();
      if (![...views.values()].some(item => !item.view.webContents.isDestroyed() && item.view.webContents.session === profile)) {
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
    views.set(id, { view, owner, url, ready: false, painted: false, visible: false, inputBlocked: true, queued: [], ownerClosed });
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
    const profile=session.fromPartition(`persist:explore-${createHash('sha256').update(storageId).digest('hex')}`);
    await profile.clearStorageData();await profile.clearCache();
  });
  handle(IPC.exploreOpen, async (owner: BrowserWindow, page: ExplorePage) => {
    if (!page || typeof page.sourceId !== 'string' || typeof page.script !== 'string' || page.script.length > 100000 ||
      (page.files && (page.files.length > 512 || JSON.stringify(page.files).length > 48 * 1024 * 1024))) throw new Error('invalid-page');
    if (page.url) {
      const parsed = new URL(page.url);
      if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error('invalid-page');
    }
    for (const [id, entry] of views) if (entry.owner === owner) close(id);
    const id = randomUUID();
    const profile = session.fromPartition(`persist:explore-${createHash('sha256').update(page.storageId??page.sourceId).digest('hex')}`, { cache: false });
    const host = createHash('sha256').update(page.sourceId).digest('hex');
    const origin = `https://${host}.explore.psstpsst.invalid`;
    const url = page.url ?? `${origin}/index.html`;
    if (!page.url) await profile.clearStorageData({origin,storages:['serviceworkers','cachestorage']});
    configureProfile(profile);
    profile.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    profile.setPermissionCheckHandler(() => false);
    const view = new WebContentsView({ webPreferences: {session:profile,preload:path.join(__dirname,'napplet-preload.js'),
      additionalArguments:[`--psst-explore=${Buffer.from(page.script).toString('base64')}`],sandbox:true,contextIsolation:true,nodeIntegration:false,webSecurity:true,backgroundThrottling:false} });
    const ownerClosed=()=>close(id);
    const entry={view,owner,url,ready:true,painted:true,visible:false,inputBlocked:true,queued:[] as string[],ownerClosed,page,files:page.files ? new Map(page.files.map(file => [file.path, file])) : undefined,document:randomUUID()};
    views.set(id,entry);owner.contentView.addChildView(view);view.setVisible(false);owner.once('closed',ownerClosed);
    view.webContents.setWindowOpenHandler(()=>({action:'deny'}));
    view.webContents.on('will-attach-webview',(event)=>event.preventDefault());
    view.webContents.on('will-navigate',(event,target)=>{ const u=new URL(target); if(!['http:','https:'].includes(u.protocol) || (!page.url && u.origin!==origin)) event.preventDefault(); });
    view.webContents.on('did-start-navigation',(_event,target,inPlace,main)=>{
      if(!main || inPlace) return;entry.document=randomUUID();
      owner.webContents.send(IPC.nappletMessage,id,JSON.stringify({type:'explore.navigation',document:entry.document,origin:new URL(target).origin,url:target}));
    });
    view.webContents.on('before-input-event',(event)=>{if(entry.inputBlocked) event.preventDefault();});
    view.webContents.on('before-mouse-event',(event)=>{if(entry.inputBlocked) event.preventDefault();});
    await view.webContents.loadURL(url);
    return id;
  });
  ipcMain.on(IPC.exploreMessage,(event,raw:string)=>{
    const found=[...views.entries()].find(([,entry])=>entry.page && event.sender===entry.view.webContents && event.senderFrame===entry.view.webContents.mainFrame);
    if(!found || typeof raw!=='string' || raw.length>1500000) return;
    const [id,entry]=found;
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
    entry.view.setBounds({
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
    if (!entry || typeof message !== 'string' || message.length > 40 * 1024 * 1024) return;
    if (entry.page) {
      let envelope; try { envelope=JSON.parse(message); } catch { return; }
      if(envelope.document!==entry.document) return;
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
    if (found && typeof message === 'string' && message.length <= 1500000) {
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
