import { assertNotAborted } from '@/platform/abort';
import { decodeNappletBytes } from '../napplet-bytes';
import { requireOptionalNativeModule } from 'expo-modules-core';
import type { NappletPort } from '../ports/napplet';

type NativeModule = {
  isAvailable(): boolean;
  fetchResourceAsync(id: string, url: string, max: number): Promise<string>;
  cancelResourceAsync(id: string): Promise<void>;
  sendAsync(id: string, message: string): Promise<void>;
  closeAsync(id: string): Promise<void>;
};
export type NativeSurface = { html: string };
const surfaces = new Map<string, NativeSurface>();
const updates = new Set<() => void>();
const messages = new Set<(id: string, raw: string) => void>();
let serial = 0;
export const nativeSurface = {
  get: (id: string) => surfaces.get(id),
  subscribe: (listener: () => void) => {
    updates.add(listener);
    return () => {
      updates.delete(listener);
    };
  },
  message: (id: string, raw: string) => {
    if (surfaces.has(id)) for (const listener of messages) listener(id, raw);
  },
};
export const nappletAdapter: NappletPort = {
  async fetchResource(url, max, signal) {
    const native = requireOptionalNativeModule<NativeModule>('ExpoNapplet');
    if (!native) throw new Error('napplets.rebuild_required');
    const id = `resource:${++serial}`;
    assertNotAborted(signal);
    const abort = () => {
      void native.cancelResourceAsync(id).catch(() => {});
    };
    signal?.addEventListener('abort', abort, { once: true });
    try {
      const bytes = await decodeNappletBytes(await native.fetchResourceAsync(id, url, max), signal);
      assertNotAborted(signal);
      return bytes;
    } finally {
      signal?.removeEventListener('abort', abort);
    }
  },
  async open(html) {
    if (!requireOptionalNativeModule<NativeModule>('ExpoNapplet')?.isAvailable())
      throw new Error('napplets.rebuild_required');
    const id = `surface:${Date.now()}:${++serial}`;
    surfaces.set(id, { html });
    updates.forEach((fn) => fn());
    return id;
  },
  async close(id) {
    surfaces.delete(id);
    updates.forEach((fn) => fn());
    await requireOptionalNativeModule<NativeModule>('ExpoNapplet')?.closeAsync(id);
  },
  async send(id, message) {
    if (!surfaces.has(id)) return;
    await requireOptionalNativeModule<NativeModule>('ExpoNapplet')?.sendAsync(
      id,
      JSON.stringify([{ serial: ++serial, message }]),
    );
  },
  async setBounds() {},
  addMessageListener(listener) {
    messages.add(listener);
    return () => {
      messages.delete(listener);
    };
  },
};
