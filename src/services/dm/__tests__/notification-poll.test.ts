import type { Event } from 'nostr-tools';

import { relayPool, type QueryOpts } from '../../relay/relay-pool';
import { RelayQueryError } from '../../relay/relay-query-error';
import { pollRecentGiftWraps } from '../notification-poll';

jest.mock('../../relay/relay-pool', () => ({ relayPool: { query: jest.fn() } }));

const query = jest.mocked(relayPool.query);
const first = 'wss://first.example';
const second = 'wss://second.example';
let controller: AbortController;
let received: Set<string>;

function event(id: number, createdAt: number): Event {
  return { id: String(id), kind: 1059, created_at: createdAt } as Event;
}

function complete(opts: QueryOpts, events: Event[], reason?: string) {
  opts.onComplete?.({
    eosed: true, status: 'complete',
    relays: [{ url: opts.relays[0], status: 'eose', received: events.length, reason }],
  });
  return events;
}

function serve(inboxes: Record<string, Event[]>, serverLimit = Infinity) {
  query.mockImplementation(async (opts) => complete(opts,
    (inboxes[opts.relays[0]] ?? [])
      .filter((item) => item.created_at >= opts.filter!.since! && item.created_at <= opts.filter!.until!)
      .sort((a, b) => b.created_at - a.created_at || a.id.localeCompare(b.id))
      .slice(0, Math.min(serverLimit, opts.filter!.limit!)),
  ));
}

function poll(overrides: Partial<Parameters<typeof pollRecentGiftWraps>[0]> = {}) {
  return pollRecentGiftWraps({
    accountPubkey: 'self', relays: [first], since: 100, until: 1000,
    abort: controller.signal, isCurrent: () => true,
    signAuth: jest.fn(), onReceived: jest.fn(),
    onEvent: async (item) => { received.add(item.id); },
    ...overrides,
  });
}

beforeEach(() => {
  query.mockReset();
  controller = new AbortController();
  received = new Set();
});

it('pages a busy relay independently of a sparse replica and includes the lower boundary', async () => {
  const busy = Array.from({ length: 650 }, (_, i) => event(i, 100 + i));
  serve({ [first]: busy, [second]: [event(999, 101)] });
  expect(await poll({ relays: [first, second] })).toEqual([]);
  expect(received.size).toBe(651);
  expect(query.mock.calls.slice(0, 4).map(([opts]) => opts.relays[0]))
    .toEqual([first, second, first, second]);
  expect(query.mock.calls.every(([opts]) => opts.filter!.since === 100)).toBe(true);
  expect(query.mock.calls.every(([opts]) => opts.filter!.until! <= 1000)).toBe(true);
});

it('continues after short pages imposed by a lower server limit', async () => {
  serve({ [first]: Array.from({ length: 500 }, (_, i) => event(i, 100 + i)) }, 73);
  expect(await poll()).toEqual([]);
  expect(received.size).toBe(500);
  expect(query.mock.calls.length).toBeGreaterThan(7);
});

it('expands a saturated second before crossing it', async () => {
  serve({ [first]: [
    ...Array.from({ length: 550 }, (_, i) => event(i, 500)), event(999, 499),
  ] });
  expect(await poll()).toEqual([]);
  expect(received.size).toBe(551);
  expect(query.mock.calls.map(([opts]) => opts.filter!.limit)).toContain(800);
});

it('leaves a still-saturated boundary unconfirmed instead of skipping older messages', async () => {
  serve({ [first]: Array.from({ length: 3300 }, (_, i) => event(i, 500)) });
  expect(await poll()).toEqual([first]);
  expect(query.mock.calls.every(([opts]) => opts.filter!.until! >= 500)).toBe(true);
  expect(query.mock.calls.at(-1)![0].filter!.limit).toBe(3200);
});

it('stores partial results on timeout but does not page past them, while another relay continues', async () => {
  serve({ [second]: [event(2, 300)] });
  query.mockImplementationOnce(async (opts) => complete(opts, [event(1, 500)], 'query timed out'));
  expect(await poll({ relays: [first, second] })).toEqual([first]);
  expect(received).toEqual(new Set(['1', '2']));
  expect(query.mock.calls.filter(([opts]) => opts.relays[0] === first)).toHaveLength(1);
});

it('does not accept effective EOSE on CLOSED as a completed page', async () => {
  query.mockImplementation(async (opts) => {
    opts.onComplete?.({ eosed: true, status: 'complete', relays: [
      { url: first, status: 'closed', received: 0, reason: 'restricted' },
    ] });
    return [];
  });
  expect(await poll()).toEqual([first]);
});

it('allows a healthy relay to continue after another connection fails', async () => {
  serve({ [second]: [event(2, 300)] });
  query.mockRejectedValueOnce(new RelayQueryError([
    { url: first, status: 'connection-failed', received: 0 },
  ]));
  expect(await poll({ relays: [first, second] })).toEqual([first]);
  expect(received).toEqual(new Set(['2']));
});

it('stops between messages when the OS expires the task', async () => {
  serve({ [first]: [event(1, 500), event(2, 400)] });
  await poll({ onEvent: async (item) => { received.add(item.id); controller.abort(); } });
  expect(received).toEqual(new Set(['1']));
  expect(query).toHaveBeenCalledTimes(1);
});

it('discards an outstanding page when the receive session changes', async () => {
  let current = true;
  query.mockImplementation(async (opts) => {
    current = false;
    return complete(opts, [event(1, 500)]);
  });
  await poll({ isCurrent: () => current });
  expect(received.size).toBe(0);
  expect(query).toHaveBeenCalledTimes(1);
});

it('does not query or store out-of-window events', async () => {
  query.mockImplementationOnce(async (opts) => complete(opts, [event(1, 99), event(2, 1001)]));
  expect(await poll()).toEqual([]);
  expect(received.size).toBe(0);
  expect(query).toHaveBeenCalledTimes(1);
});
