import type { Event } from 'nostr-tools';

import { RelayQueryError } from '../../relay/relay-query-error';
import { resolveMessagingMetadata } from '../messaging-metadata';
import { relayPool, type QueryOpts, type QueryCompletion } from '../../relay/relay-pool';
import { applyOwnDmRelayListEvent, loadAccountDmRelays } from '../../relay/relay-list.service';
import { getReplaceableEvents } from '../../relay/replaceable-events.service';

jest.mock('../../relay/relay-pool', () => ({ relayPool: { query: jest.fn() } }));
jest.mock('../../relay/relay-list.service', () => ({
  loadAccountDmRelays: jest.fn(), applyOwnDmRelayListEvent: jest.fn(),
}));
jest.mock('../../relay/replaceable-events.service', () => ({
  getReplaceableEvents: jest.fn(), storeReplaceableEvent: jest.fn(),
}));
jest.mock('../../relay/relay-router', () => ({
  parseRelayListMetadata: (event: Event) => ({ write: event.tags.map((tag) => tag[1]) }),
}));
jest.mock('../encryption-key.service', () => ({
  getEncryptionPubkeyFromEvent: (event: Event) => event.tags.find((tag) => tag[0] === 'n')?.[1],
}));

const self = 'a'.repeat(64);
const key = 'b'.repeat(64);
const signAuth = jest.fn();
const query = jest.mocked(relayPool.query);
function event(kind: number, created_at: number, tags: string[][]): Event {
  return { kind, created_at, tags, id: `${kind}-${created_at}`, pubkey: self, content: '', sig: '' };
}
function reply(options: QueryOpts, events: Event[], complete = true): Promise<Event[]> {
  options.onComplete?.({
    eosed: complete, status: complete ? 'complete' : 'failed',
    relays: options.relays.map((url) => ({ url, status: complete ? 'eose' : 'connection-failed', received: 0 })),
  });
  return complete ? Promise.resolve(events) : Promise.reject(new RelayQueryError([]));
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(getReplaceableEvents).mockResolvedValue([null, null, null]);
  jest.mocked(loadAccountDmRelays).mockResolvedValue(['wss://old.example']);
  query.mockImplementation((opts) => reply(opts, []));
});

it('follows fresh DM/write relays before selecting their latest key', async () => {
  const inbox = event(10050, 20, [['relay', 'wss://new.example']]);
  const outbox = event(10002, 20, [['r', 'wss://write.example']]);
  const announcement = event(10044, 30, [['n', key]]);
  query.mockImplementationOnce((opts) => reply(opts, [inbox, outbox]));
  query.mockImplementationOnce((opts) => {
    expect(opts.relays).toEqual(expect.arrayContaining(['wss://new.example', 'wss://write.example']));
    return reply(opts, [announcement]);
  });
  jest.mocked(applyOwnDmRelayListEvent).mockImplementation(async () => {
    jest.mocked(loadAccountDmRelays).mockResolvedValue(['wss://new.example']);
    return true;
  });
  const metadata = await resolveMessagingMetadata(self, { signAuth });
  expect(metadata.announcement).toEqual(announcement);
  expect(metadata.dmRelays).toEqual(['wss://new.example']);
  expect(query).toHaveBeenCalledTimes(2);
  expect(query.mock.calls[0][0].signAuth).toBe(signAuth);
});

it.each([{ events: [] }, { events: [event(10044, 10, [['n', key]])] }])(
  'rejects metadata queries with no effective completion even when cached keys or interrupted events exist', async ({ events }) => {
    jest.mocked(getReplaceableEvents).mockResolvedValue([null, null, event(10044, 1, [['n', key]])]);
    query.mockImplementation((opts) => reply(opts, events, false));
    await expect(resolveMessagingMetadata(self, { signAuth })).rejects.toThrow('No relay completed');
    expect(applyOwnDmRelayListEvent).not.toHaveBeenCalled();
  },
);

it('does not replace a newer known announcement with an older replay', async () => {
  const current = event(10044, 20, [['n', key]]);
  jest.mocked(getReplaceableEvents).mockResolvedValue([null, null, current]);
  query.mockImplementation((opts) => reply(opts, [event(10044, 10, [['n', 'c'.repeat(64)]])]));
  expect((await resolveMessagingMetadata(self, { signAuth })).announcement).toEqual(current);
});

it('stops before persisting routing when the preparation is cancelled', async () => {
  const controller = new AbortController();
  query.mockImplementation((opts) => {
    controller.abort();
    return reply(opts, []);
  });
  await expect(resolveMessagingMetadata(self, { signAuth, abort: controller.signal })).rejects.toThrow('cancelled');
  expect(applyOwnDmRelayListEvent).not.toHaveBeenCalled();
});


it('uses the latest metadata when one relay completes and others cannot connect', async () => {
  const current = event(10044, 30, [['n', key]]);
  query.mockImplementation((opts) => {
    opts.onComplete?.({
      eosed: true, status: 'complete',
      relays: opts.relays.map((url, i) => ({
        url, status: i === 0 ? 'eose' : 'connection-failed', received: i === 0 ? 1 : 0,
      })),
    });
    return Promise.resolve([event(10044, 10, [['n', 'c'.repeat(64)]]), current]);
  });
  expect((await resolveMessagingMetadata(self, { signAuth })).announcement).toEqual(current);
});

it('does not let an unreachable newly advertised relay veto an earlier completed response', async () => {
  const inbox = event(10050, 20, [['relay', 'wss://new.example']]);
  const current = event(10044, 30, [['n', key]]);
  query.mockImplementationOnce((opts) => reply(opts, [inbox, current]));
  query.mockImplementationOnce((opts) => {
    expect(opts.relays).toEqual(['wss://new.example']);
    return reply(opts, [], false);
  });
  expect((await resolveMessagingMetadata(self, { signAuth })).announcement).toEqual(current);
  expect(query).toHaveBeenCalledTimes(2);
});

it('retains per-relay outcomes when every relay fails to complete', async () => {
  const relays: QueryCompletion['relays'] = [
    { url: 'wss://offline.example', status: 'connection-failed', received: 0, reason: 'offline' },
    { url: 'wss://slow.example', status: 'connection-failed', received: 0 },
  ];
  query.mockImplementation((opts) => {
    opts.onComplete?.({ eosed: false, status: 'failed', relays });
    return Promise.reject(new RelayQueryError(relays));
  });
  await expect(resolveMessagingMetadata(self, { signAuth })).rejects.toMatchObject({ relayResults: relays });
});
