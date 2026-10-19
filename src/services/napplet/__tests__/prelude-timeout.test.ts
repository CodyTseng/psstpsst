import { TextDecoder, TextEncoder } from 'node:util';
import { runInNewContext } from 'node:vm';
import { nappletPrelude } from '../prelude.generated';

it('keeps OUTBOX publication promises alive while consent waits behind other requests', async () => {
  jest.useFakeTimers();
  try {
    const listeners: ((event: unknown) => void)[] = [];
    const parent = { postMessage: jest.fn() };
    const window = {
      parent,
      addEventListener: (_type: string, listener: (event: unknown) => void) => listeners.push(listener),
      napplet: undefined as unknown as { outbox: { publish: (event: object) => Promise<unknown> } },
    };
    const context = { window, TextDecoder, TextEncoder, setTimeout, clearTimeout, crypto: { randomUUID: () => 'queued-publication' },
      NappletShimPrelude: undefined as unknown as { install: (options: object) => void } };
    runInNewContext(nappletPrelude, context);
    context.NappletShimPrelude.install({ domains: ['outbox'] });
    const settled = jest.fn();
    const publication = window.napplet.outbox.publish({ kind: 1, content: 'Queued', tags: [] });
    void publication.then(settled, settled);
    await jest.advanceTimersByTimeAsync(16 * 60000);
    expect(settled).not.toHaveBeenCalled();
    for (const listener of listeners) listener({ source: parent, data: {
      type: 'outbox.publish.result', id: 'queued-publication', ok: true,
    } });
    await expect(publication).resolves.toEqual({ ok: true });
    expect(jest.getTimerCount()).toBe(0);
  } finally { jest.clearAllTimers(); jest.useRealTimers(); }
});
