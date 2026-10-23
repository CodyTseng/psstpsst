import { TextDecoder, TextEncoder } from 'node:util';
import { runInNewContext } from 'node:vm';
import { nappletPrelude } from '../prelude.generated';

type Api = {
  identity: { getPublicKey(): Promise<unknown> };
  inc: { channel: { list(): Promise<unknown> } };
};
function sdk(domain: 'identity' | 'inc') {
  const listeners: ((event: unknown) => void)[] = [];
  const parent = { postMessage: jest.fn() };
  const window = {
    parent, napplet: undefined as unknown as Api,
    addEventListener: (_type: string, listener: (event: unknown) => void) => listeners.push(listener),
  };
  const context = { window, TextDecoder, TextEncoder, setTimeout, clearTimeout, crypto: { randomUUID: () => 'request' },
    NappletShimPrelude: undefined as unknown as { install(options: object): void } };
  runInNewContext(nappletPrelude, context);
  context.NappletShimPrelude.install({ domains: [domain] });
  return {
    request: () => domain === 'identity' ? window.napplet.identity.getPublicKey() : window.napplet.inc.channel.list(),
    reply: (data: object, source: object = parent) => {
      for (const listener of listeners) listener({ source, data });
    },
    type: domain === 'identity' ? 'identity.getPublicKey.result' : 'inc.channel.list.result',
  };
}

beforeEach(() => { jest.useFakeTimers(); });
afterEach(() => { jest.clearAllTimers(); jest.useRealTimers(); });

for (const domain of ['identity', 'inc'] as const) {
  it.each(['permission-denied', 'quota-exceeded'])(`rejects ${domain} error responses immediately: %s`, async error => {
    const client = sdk(domain);
    const settled = jest.fn();
    void client.request().then(value => settled('resolved', value), reason => settled('rejected', reason.message));
    client.reply({ type: client.type, id: 'request', ok: false, error });
    await Promise.resolve();
    expect(settled).toHaveBeenCalledWith('rejected', error);
    expect(jest.getTimerCount()).toBe(0);
    // A duplicate or late success cannot change a settled rejection.
    client.reply({ type: client.type, id: 'request', pubkey: 'key', channels: [] });
    await Promise.resolve();
    expect(settled).toHaveBeenCalledTimes(1);
  });

  it(`preserves ${domain} success responses`, async () => {
    const client = sdk(domain);
    const pending = client.request();
    const value = domain === 'identity' ? 'a'.repeat(64) : [{ id: 'channel', peer: 'endpoint' }];
    client.reply({ type: client.type, id: 'request', ...(domain === 'identity' ? { pubkey: value } : { channels: value }) });
    await expect(pending).resolves.toEqual(value);
    expect(jest.getTimerCount()).toBe(0);
  });
}

it('keeps INC validation and only rejects the matching request from the host', async () => {
  const client = sdk('inc');
  const settled = jest.fn();
  void client.request().then(settled, settled);
  client.reply({ type: client.type, id: 'request', error: 'permission-denied' }, {});
  client.reply({ type: client.type, id: 'other', error: 'permission-denied' });
  client.reply({ type: client.type, id: 'request', error: { message: 'invalid' } });
  client.reply({ type: client.type, id: 'request', channels: [{}] });
  await Promise.resolve();
  expect(settled).not.toHaveBeenCalled();
  expect(jest.getTimerCount()).toBe(1);
  client.reply({ type: client.type, id: 'request', error: 'permission-denied' });
  await Promise.resolve();
  expect(settled).toHaveBeenCalledTimes(1);
  expect(jest.getTimerCount()).toBe(0);
});
