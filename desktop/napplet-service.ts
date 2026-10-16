import { randomUUID } from 'node:crypto';
import { lookup } from 'node:dns';
import { request } from 'node:https';
import { isIP } from 'node:net';
import path from 'node:path';
import {
  BrowserWindow,
  WebContentsView,
  ipcMain,
  session,
  type IpcMainInvokeEvent,
} from 'electron';
import { NAPPLET_FRAME_READY_MESSAGE, type NappletBounds } from '../src/platform/ports/napplet';
import { IPC } from './ipc-channels';

export function isPublicAddress(address: string): boolean {
  const value = address.toLowerCase();
  if (value.includes(':')) return /^2[0-9a-f]{3}:/.test(value) && !value.startsWith('2001:db8:');
  const parts = value.split('.').map(Number);
  if (parts.length !== 4 || parts.some((v) => !Number.isInteger(v) || v < 0 || v > 255))
    return false;
  const [a, b] = parts;
  return !(
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && [0, 168].includes(b)) ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 198 && [18, 19, 51].includes(b)) ||
    (a === 203 && b === 0)
  );
}

/** DNS validation is part of the actual TLS connection, not a check-then-fetch preflight. */
export function fetchNappletResource(
  value: string,
  maxBytes: number,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  const url = new URL(value);
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (
    (isIP(host) && !isPublicAddress(host)) ||
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    (url.port && url.port !== '443') ||
    !Number.isSafeInteger(maxBytes) ||
    maxBytes < 1 ||
    maxBytes > 25 * 1024 * 1024
  )
    return Promise.reject(new Error('blocked-by-policy'));
  return new Promise((resolve, reject) => {
    const req = request(
      url,
      {
        method: 'GET',
        agent: false,
        signal,
        headers: { Accept: '*/*', 'Accept-Encoding': 'identity' },
        lookup: (hostname, options, callback) => {
          lookup(hostname, { all: true }, (error, addresses) => {
            if (error) return callback(error, '', 4);
            if (!addresses.length || addresses.some((entry) => !isPublicAddress(entry.address)))
              return callback(new Error('blocked-by-policy'), '', 4);
            if (options.all) callback(null, addresses);
            else callback(null, addresses[0].address, addresses[0].family);
          });
        },
      },
      (response) => {
        if (
          response.statusCode !== 200 ||
          Number(response.headers['content-length']) > maxBytes ||
          (response.headers['content-encoding'] &&
            response.headers['content-encoding'] !== 'identity')
        ) {
          response.destroy();
          reject(new Error('resource-unavailable'));
          return;
        }
        const chunks: Buffer[] = [];
        let length = 0;
        response.on('data', (chunk: Buffer) => {
          length += chunk.length;
          if (length > maxBytes) response.destroy(new Error('too-large'));
          else chunks.push(chunk);
        });
        response.on('end', () => resolve(new Uint8Array(Buffer.concat(chunks, length))));
        response.on('error', reject);
      },
    );
    req.setTimeout(20000, () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.end();
  });
}

export function registerNappletHandlers(
  trusted: (event: IpcMainInvokeEvent) => boolean,
  parent: () => BrowserWindow | null,
) {
  const views = new Map<
    string,
    {
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
  const requests = new Map<string, AbortController>();
  const handle = (channel: string, fn: (...args: any[]) => unknown) =>
    ipcMain.handle(channel, (event, ...args) => {
      if (!trusted(event)) throw new Error('Untrusted napplet IPC');
      return fn(...args);
    });
  handle(IPC.nappletFetch, async (id: string, url: string, max: number) => {
    if (typeof id !== 'string' || id.length > 128 || requests.size >= 12)
      throw new Error('quota-exceeded');
    const abort = new AbortController();
    requests.set(id, abort);
    try {
      return Buffer.from(await fetchNappletResource(url, max, abort.signal)).toString('base64');
    } finally {
      requests.delete(id);
    }
  });
  handle(IPC.nappletCancel, (id: string) => {
    requests.get(id)?.abort();
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
      profile.protocol.unhandle('https');
      profile.webRequest.onBeforeRequest(null);
      void profile.clearStorageData().catch(() => {});
    }
  };
  handle(IPC.nappletOpen, async (html: string) => {
    if (typeof html !== 'string' || html.length > 40 * 1024 * 1024) throw new Error('too-large');
    const owner = parent();
    if (!owner) throw new Error('window-unavailable');
    for (const id of views.keys()) close(id);
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
        // Allow the hidden startup document to paint before revealing its view.
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
  handle(IPC.nappletClose, close);
  handle(IPC.nappletCapture, async (id: string) => {
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
  handle(IPC.nappletGoBack, (id: string) => {
    const entry = views.get(id);
    if (!entry || entry.view.webContents.isDestroyed()) return false;
    const history = entry.view.webContents.navigationHistory;
    const index = history.getActiveIndex();
    if (index <= 0) return false;
    // Go to the immediate app entry, including entries created without user activation.
    history.goToIndex(index - 1);
    return true;
  });
  handle(IPC.nappletBounds, (id: string, bounds: NappletBounds, visible: boolean, interactive = true) => {
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
    entry.view.setVisible(entry.visible && entry.painted);
  });
  handle(IPC.nappletSend, (id: string, message: string) => {
    const entry = views.get(id);
    if (!entry || typeof message !== 'string' || message.length > 40 * 1024 * 1024) return;
    entry.view.webContents.send(IPC.nappletReply, message);
  });
  ipcMain.on(IPC.nappletMessage, (event, message: string) => {
    const found = [...views.entries()].find(
      ([, entry]) =>
        event.sender === entry.view.webContents &&
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
