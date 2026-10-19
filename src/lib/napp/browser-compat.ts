/** Browser-facing APIs share one document-bound transport on every runtime. */
export function installBrowserCompat(call: (method: string, args?: any[]) => Promise<any>) {
  const report = (error: unknown) => console.warn('[browser]', error);
  const writeText = (text: string) => call('clipboard.writeText', [String(text)]).then(() => undefined);
  if (!(window as any).ClipboardItem) (window as any).ClipboardItem = class {
    readonly types: string[];
    constructor(private data: Record<string, Blob | string | Promise<Blob>>) { this.types = Object.keys(data); }
    async getType(type: string) { if (!this.types.includes(type)) throw new DOMException('Unsupported clipboard type', 'NotFoundError');
      const data = await this.data[type]; return typeof data === 'string' ? new Blob([data], { type }) : data; }
    static supports(type: string) { return ['text/plain', 'image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(type); }
  };
  const transfer = async (blob: Blob, name: string, kind: 'image' | 'download', ticket?: string) => {
    if (blob.size > 64 * 1024 * 1024) throw new Error('file-too-large');
    const handle = await call(`browser.${kind}.begin`, [name, blob.size, blob.type || 'application/octet-stream', ticket]);
    try {
      for (let offset = 0; offset < blob.size; offset += handle.chunkBytes) {
        const bytes = new Uint8Array(await blob.slice(offset, offset + handle.chunkBytes).arrayBuffer());
        let binary = '';
        for (let index = 0; index < bytes.length; index += 8192) binary += String.fromCharCode(...bytes.subarray(index, index + 8192));
        await call(`browser.${kind}.chunk`, [handle.id, btoa(binary)]);
      }
      await call(`browser.${kind}.finish`, [handle.id]);
    } catch (error) { void call(`browser.${kind}.cancel`, [handle.id]).catch(() => {}); throw error; }
  };
  const clipboard = navigator.clipboard ?? {};
  Object.defineProperties(clipboard, {
    writeText: { configurable: true, writable: true, value: writeText },
    readText: { configurable: true, writable: true, value: () => call('browser.clipboard.readText') },
    write: { configurable: true, writable: true, value: async (items: ClipboardItem[]) => {
      if (!Array.isArray(items) || items.length !== 1) throw new DOMException('One clipboard item is supported', 'NotSupportedError');
      const item = items[0];
      const image = item.types.find(type => ['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(type));
      if (image) return transfer(await item.getType(image), 'clipboard-image', 'image');
      if (item.types.includes('text/plain')) return writeText(await (await item.getType('text/plain')).text());
      if (item.types.includes('text/html')) return writeText(new DOMParser().parseFromString(await (await item.getType('text/html')).text(), 'text/html').body.textContent ?? '');
      throw new DOMException('Unsupported clipboard content', 'NotSupportedError');
    } },
  });
  if (!navigator.clipboard) Object.defineProperty(navigator, 'clipboard', { configurable: true, value: clipboard });

  const permissions = navigator.permissions ?? {};
  const statuses = new Set<WeakRef<EventTarget & { onchange?: ((event: Event) => void) | null }>>();
  const notificationState = () => (window as any).Notification?.permission ?? 'default';
  const originalQuery = navigator.permissions?.query.bind(navigator.permissions);
  Object.defineProperty(permissions, 'query', { configurable: true, writable: true, value: async (descriptor: PermissionDescriptor) => {
    const name = String(descriptor.name);
    if (['clipboard-write', 'clipboard-read', 'camera', 'microphone', 'geolocation', 'notifications'].includes(name)) {
      let nativeStatus: PermissionStatus | undefined;
      try { if (originalQuery) nativeStatus = await originalQuery(descriptor); } catch { /* Some WebViews omit these permission descriptors. */ }
      const status = Object.assign(new EventTarget(), { name, onchange: null });
      Object.defineProperty(status, Symbol.toStringTag, { value: 'PermissionStatus' });
      Object.defineProperty(status, 'state', { get: () => name === 'clipboard-write' || nativeStatus?.state === 'granted' ? 'granted' : name === 'notifications' && notificationState() !== 'default' ? notificationState() : 'prompt' });
      const reference = new WeakRef<EventTarget & { onchange?: ((event: Event) => void) | null }>(status);
      nativeStatus?.addEventListener('change', () => { const current = reference.deref(); if (!current) return;
        const event = new Event('change'); current.dispatchEvent(event); current.onchange?.(event);
      });
      if (name === 'notifications') {
        if (statuses.size >= 64) statuses.delete(statuses.values().next().value!);
        statuses.add(new WeakRef(status));
      }
      return Promise.resolve(status);
    }
    return originalQuery ? originalQuery(descriptor) : Promise.reject(new TypeError('Unsupported permission'));
  } });
  if (!navigator.permissions) Object.defineProperty(navigator, 'permissions', { configurable: true, value: permissions });

  const nativeCopy = document.execCommand.bind(document);
  let copying: ClipboardEvent | undefined;
  document.addEventListener('copy', event => { copying = event; });
  document.execCommand = (command: string, showUI?: boolean, value?: string) => {
    if (command.toLowerCase() !== 'copy') return nativeCopy(command, showUI, value);
    copying = undefined;
    let accepted = false;
    try { accepted = nativeCopy(command, showUI, value); } catch { /* The host transport also supports insecure/opaque documents. */ }
    if (!copying) {
      const data = new Map<string, string>();
      const event = new Event('copy', { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'clipboardData', { value: { setData: (type: string, text: string) => data.set(type, text), getData: (type: string) => data.get(type) ?? '', clearData: () => data.clear(), get types() { return [...data.keys()]; } } });
      document.dispatchEvent(event);
      copying = event as ClipboardEvent;
    }
    const input = document.activeElement;
    const selected = input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement
      ? input.value.slice(input.selectionStart ?? 0, input.selectionEnd ?? input.value.length) : window.getSelection()?.toString() ?? '';
    const text = copying?.clipboardData?.getData('text/plain') || selected;
    if (text || !accepted) { void writeText(text).catch(report); return true; }
    return accepted;
  };

  window.open = (url?: string | URL, target?: string) => {
    if (!url || String(url) === 'about:blank') return null;
    const address = new URL(String(url), location.href).href;
    if (address.startsWith('blob:')) { void download(address, 'download').catch(report); return null; }
    if (['_self', '_top', '_parent'].includes(target ?? '')) { location.assign(address); return window; }
    void call('browser.open', [address]).catch(report);
    return null;
  };
  const download = async (url: string, name: string) => {
    const local = /^(blob|data):/.test(url) ? fetch(url) : undefined;
    void local?.catch(() => {});
    const ticket = await call('browser.download.permission', [url.startsWith('data:') ? url.slice(0, 80).split(',')[0] : url, name]);
    const response = await (local ?? fetch(url, { credentials: 'include' }));
    if (!response.ok) throw new Error(`download-failed: ${response.status}`);
    const reader = response.body?.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    if (reader) {
      try {
        for (;;) { const item = await reader.read(); if (item.done) break;
          size += item.value.byteLength; if (size > 64 * 1024 * 1024) throw new Error('file-too-large'); chunks.push(item.value);
        }
      } finally { await reader.cancel().catch(() => {}); }
    }
    await transfer(reader ? new Blob(chunks as BlobPart[], { type: response.headers.get('content-type')?.split(';')[0] || 'application/octet-stream' }) : await response.blob(), name || 'download', 'download', ticket);
  };
  (window as any).__psstBrowserDownload = download;
  if (!(window as any).Notification) {
    let permission: NotificationPermission = 'default';
    (window as any).Notification = class extends EventTarget {
      static get permission() { return permission; }
      static async requestPermission(callback?: (permission: NotificationPermission) => void) {
        permission = await call('browser.permission', [['notifications']]);
        for (const reference of statuses) { const status = reference.deref(); if (!status) { statuses.delete(reference); continue; }
          const event = new Event('change'); status.dispatchEvent(event); status.onchange?.(event);
        }
        callback?.(permission); return permission;
      }
      constructor(title: string, options: NotificationOptions = {}) {
        super();
        if (permission !== 'granted') throw new DOMException('Notification permission required', 'NotAllowedError');
        void call('browser.notify', [String(title), String(options.body ?? '')]).then(result => { if (result === false) throw new Error('notification-unavailable'); }).catch(report);
      }
      close() {}
    };
  }
  document.addEventListener('click', event => {
    if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    const anchor = event.target instanceof Element ? event.target.closest('a[href]') : null;
    if (!(anchor instanceof HTMLAnchorElement)) return;
    const url = new URL(anchor.href, location.href);
    if (anchor.hasAttribute('download') && ['blob:', 'data:'].includes(url.protocol)) {
      event.preventDefault(); void download(url.href, anchor.download).catch(report);
    } else if (!['http:', 'https:', 'blob:'].includes(url.protocol)) {
      event.preventDefault(); void call('browser.external', [url.href]).catch(report);
    } else if (anchor.target && !['_self', '_parent', '_top'].includes(anchor.target)) {
      event.preventDefault(); void call('browser.open', [url.href]).catch(report);
    }
  });
}
