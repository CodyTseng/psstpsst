import { assertNotAborted } from '@/platform/abort';
import { decodeNappletBytes } from '../napplet-bytes';
import type { NappletPort } from '../ports/napplet';
import { getElectronBridge } from './bridge';

export const electronNappletAdapter: NappletPort = {
  async fetchResourceResponse(url, maxBytes, signal, validators) {
    const bridge = getElectronBridge().napplet;
    if (!bridge.fetchResponse) return { status: 200, bytes: await electronNappletAdapter.fetchResource(url, maxBytes, signal) };
    const id = crypto.randomUUID();
    const abort = () => { void bridge.cancel(id).catch(() => {}); };
    assertNotAborted(signal);
    signal?.addEventListener('abort', abort, { once: true });
    try {
      const result = await bridge.fetchResponse(id, url, maxBytes, validators);
      assertNotAborted(signal);
      if (!result) throw Object.assign(new Error('session-closed'), { name: 'AbortError' });
      if ('error' in result) throw Object.assign(new Error(result.error), { code: result.code });
      return { ...result, bytes: await decodeNappletBytes(result.bytes, signal) };
    } finally { signal?.removeEventListener('abort', abort); }
  },
  get windows() { return getElectronBridge().napplet.windows; },
  async fetchResource(url, maxBytes, signal, options) {
    const bridge = getElectronBridge().napplet;
    const id = crypto.randomUUID();
    const abort = () => {
      void bridge.cancel(id).catch(() => {});
    };
    assertNotAborted(signal);
    signal?.addEventListener('abort', abort, { once: true });
    const unsubscribe = options?.onProgress ? bridge.onProgress?.((requestId, progress) => { if (requestId === id && !signal?.aborted) options.onProgress!(progress); }) : undefined;
    try {
      const result = await bridge.fetch(id, url, maxBytes, options?.accept);
      if (result === null) {
        const error = new Error('session-closed');
        error.name = 'AbortError';
        throw error;
      }
      assertNotAborted(signal);
      if (typeof result !== 'string') {
        throw Object.assign(new Error(result.error), { code: result.code });
      }
      const bytes = await decodeNappletBytes(result, signal);
      assertNotAborted(signal);
      return bytes;
    } finally {
      unsubscribe?.();
      signal?.removeEventListener('abort', abort);
    }
  },
  async clearPageData(storageId) {await getElectronBridge().napplet.clearPageData?.(storageId);},
  async openPage(page) {
    const bridge=getElectronBridge().napplet;
    if(typeof bridge.openPage!=='function') throw new Error('applications.rebuild_required');
    if (page.bootstrap && !bridge.supportsExploreBootstrap) throw new Error('applications.rebuild_required');
    return bridge.openPage(page);
  },
  open: (html) => getElectronBridge().napplet.open(html),
  close: (id) => getElectronBridge().napplet.close(id),
  async capture(id) {
    const bridge = getElectronBridge().napplet;
    return typeof bridge.capture === 'function' ? bridge.capture(id) : null;
  },
  goBack: (id) => getElectronBridge().napplet.goBack(id),
  send: (id, message) => getElectronBridge().napplet.send(id, message),
  setBounds: (id, bounds, visible, interactive) => getElectronBridge().napplet.setBounds(id, bounds, visible, interactive),
  addMessageListener: (listener) => getElectronBridge().napplet.onMessage(listener),
};
