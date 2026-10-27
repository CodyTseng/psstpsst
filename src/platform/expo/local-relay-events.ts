import { requireOptionalNativeModule } from 'expo-modules-core';
import type { LocalRelayEvent, LocalRelayEventsPort } from '../ports/local-relay-events';

type NativeEvents = {
  broadcastLocalRelayEventAsync?(message: string): Promise<void>;
  addListener(name: string, listener: (value: { message: string }) => void): { remove(): void };
};
let native: NativeEvents | null | undefined;
let channel: BroadcastChannel | undefined;
let warned = false;
function transport() {
  if (native === undefined) native = requireOptionalNativeModule<NativeEvents>('ExpoNapplet');
  if (native?.broadcastLocalRelayEventAsync) return native;
  if (typeof BroadcastChannel !== 'undefined') channel ??= new BroadcastChannel('psstpsst-local-relay');
  return undefined;
}
export const localRelayEventsAdapter: LocalRelayEventsPort = {
  async publish(message) {
    const module = transport();
    if (module) await module.broadcastLocalRelayEventAsync!(JSON.stringify(message));
    else if (channel) channel.postMessage(message);
    else if (!warned) { warned = true; console.warn('[local-relay] Cross-context notifications require a native rebuild'); }
  },
  subscribe(listener) {
    const module = transport();
    if (module) {
      const subscription = module.addListener('onLocalRelayEvent', ({ message }) => listener(JSON.parse(message) as LocalRelayEvent));
      return () => subscription.remove();
    }
    if (channel) {
      const receive = (event: MessageEvent<LocalRelayEvent>) => listener(event.data);
      channel.addEventListener('message', receive);
      return () => channel?.removeEventListener('message', receive);
    }
    return () => {};
  },
};
