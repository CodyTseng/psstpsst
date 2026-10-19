import { installBrowserCompat } from './browser-compat';
/** Runs inside the sandbox; the immutable parent authenticates the transport. */
export function install() {
  let serial = 0;
  const prefix = `nip07:${Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('')}:`;
  const pending = new Map<string, { type: string; resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  addEventListener('message', event => {
    if (event.source !== parent || typeof event.data?.id !== 'string') return;
    const request = pending.get(event.data.id);
    if (!request || event.data.type !== `${request.type}.result`) return;
    pending.delete(event.data.id);
    clearTimeout(request.timer);
    if (event.data.error) request.reject(new Error(event.data.error));
    else request.resolve(event.data.result);
  });
  const call = (type: string, event?: unknown) => new Promise((resolve, reject) => {
    if (pending.size >= 16) return reject(new Error('quota-exceeded'));
    const id = `${prefix}${++serial}`;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('request-timeout')); }, 460000);
    pending.set(id, { type, resolve, reject, timer });
    parent.postMessage({ type, id, ...(event === undefined ? {} : { event }) }, '*');
  });
  (window as any).nostr = {
    getPublicKey: () => call('signer.getPublicKey'),
    signEvent: (event: unknown) => call('signer.signEvent', event),
  };
  for (const algorithm of ['nip04', 'nip44']) (window as any).nostr[algorithm] = {
    encrypt: (pubkey: string, text: string) => call(`signer.${algorithm}.encrypt`, { pubkey, text }),
    decrypt: (pubkey: string, text: string) => call(`signer.${algorithm}.decrypt`, { pubkey, text }),
  };
  installBrowserCompat((method, args) => method === 'clipboard.writeText' ? call(method, { text: args?.[0] }) : call('browser.request', { method, args: args ?? [] }));
}
