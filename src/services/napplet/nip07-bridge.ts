/** Runs inside the sandbox; the immutable parent authenticates the transport. */
export function nappletNip07Bridge(): string {
  return `(${install.toString()})();`;
}

function install() {
  let serial = 0;
  const prefix = `nip07:${Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('')}:`;
  const pending = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  addEventListener('message', event => {
    if (event.source !== parent || typeof event.data?.id !== 'string') return;
    const request = pending.get(event.data.id);
    if (!request || !['signer.getPublicKey.result', 'signer.signEvent.result'].includes(event.data.type)) return;
    pending.delete(event.data.id);
    clearTimeout(request.timer);
    if (event.data.error) request.reject(new Error(event.data.error));
    else request.resolve(event.data.result);
  });
  const call = (method: string, event?: unknown) => new Promise((resolve, reject) => {
    if (pending.size >= 16) return reject(new Error('quota-exceeded'));
    const id = `${prefix}${++serial}`;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('request-timeout')); }, 460000);
    pending.set(id, { resolve, reject, timer });
    parent.postMessage({ type: `signer.${method}`, id, ...(event === undefined ? {} : { event }) }, '*');
  });
  (window as any).nostr = {
    getPublicKey: () => call('getPublicKey'),
    signEvent: (event: unknown) => call('signEvent', event),
  };
}
