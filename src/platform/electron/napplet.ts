import { assertNotAborted } from '@/platform/abort';
import { decodeNappletBytes } from '../napplet-bytes';
import type { NappletPort } from '../ports/napplet';
import { getElectronBridge } from './bridge';

export const electronNappletAdapter: NappletPort = {
  async fetchResource(url, maxBytes, signal) {
    const bridge = getElectronBridge().napplet;
    const id = crypto.randomUUID();
    const abort = () => {
      void bridge.cancel(id).catch(() => {});
    };
    assertNotAborted(signal);
    signal?.addEventListener('abort', abort, { once: true });
    try {
      const bytes = await decodeNappletBytes(await bridge.fetch(id, url, maxBytes), signal);
      assertNotAborted(signal);
      return bytes;
    } finally {
      signal?.removeEventListener('abort', abort);
    }
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
