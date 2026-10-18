import type { ExplorePage } from '../ports/explore';
import { assertNotAborted } from '@/platform/abort';
import { decodeNappletBytes } from '../napplet-bytes';
import { requireOptionalNativeModule } from 'expo-modules-core';
import { NAPPLET_FRAME_READY_MESSAGE, type NappletPort } from '../ports/napplet';

type NativeModule = {
  isAvailable(): boolean;
  isExploreAvailable?(): boolean;
  clearPageDataAsync?(storageId: string): Promise<void>;
  fetchResourceAsync(id: string, url: string, max: number): Promise<string>;
  cancelResourceAsync(id: string): Promise<void>;
  sendAsync(id: string, message: string): Promise<void>;
  closeAsync(id: string): Promise<void>;
  goBackAsync(id: string): Promise<boolean>;
};
export type NativeSurface = { html: string; page?: string; ready: boolean };
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
    const surface = surfaces.get(id);
    if (!surface) return;
    let exploreReady=false;
    if(surface.page) {try{const envelope=JSON.parse(raw);exploreReady=envelope.type==='explore.request' && JSON.parse(envelope.raw).method==='ready';}catch{/* Ignore malformed page messages. */}}
    if (raw === NAPPLET_FRAME_READY_MESSAGE || exploreReady) {
      if (!surface.ready) {
        surfaces.set(id, { ...surface, ready: true });
        updates.forEach((fn) => fn());
        for (const listener of messages) listener(id, raw);
      }
      return;
    }
    for (const listener of messages) listener(id, raw);
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
  async clearPageData(storageId) { await requireOptionalNativeModule<NativeModule>('ExpoNapplet')?.clearPageDataAsync?.(storageId); },
  async openPage(page: ExplorePage) {
    if (!requireOptionalNativeModule<NativeModule>('ExpoNapplet')?.isExploreAvailable?.()) throw new Error('napplets.rebuild_required');
    const id=`surface:${Date.now()}:${++serial}`;
    surfaces.set(id,{html:'',page:JSON.stringify(page),ready:false});updates.forEach(fn=>fn());return id;
  },
  async open(html) {
    if (!requireOptionalNativeModule<NativeModule>('ExpoNapplet')?.isAvailable())
      throw new Error('napplets.rebuild_required');
    const id = `surface:${Date.now()}:${++serial}`;
    surfaces.set(id, { html, ready: false });
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
  async goBack(id) {
    if (!surfaces.has(id)) return false;
    const native = requireOptionalNativeModule<NativeModule>('ExpoNapplet');
    if (!native?.goBackAsync) throw new Error('napplets.rebuild_required');
    return native.goBackAsync(id);
  },
  async setBounds() {},
  async capture() { return null; },
  addMessageListener(listener) {
    messages.add(listener);
    return () => {
      messages.delete(listener);
    };
  },
};
