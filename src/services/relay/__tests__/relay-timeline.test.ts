import type { Event, Filter } from 'nostr-tools';
import { RelayTimeline, type RelayTimelineQuery } from '../relay-timeline';

const event = (id: number, created_at: number, kind = 1, tags: string[][] = []): Event => ({
  id: id.toString(16).padStart(64, '0'), pubkey: 'a'.repeat(64), sig: 'b'.repeat(128),
  kind, created_at, content: 'Example', tags,
});
const a = 'wss://a.example/', b = 'wss://b.example/';
function queryFor(data: Record<string, Event[]>) {
  return jest.fn(async (relay: string, filter: Filter) => ({
    events: (data[relay] ?? []).filter(e => (filter.until === undefined || e.created_at <= filter.until) &&
      (!filter.kinds || filter.kinds.includes(e.kind)))
      .sort((a, b) => b.created_at - a.created_at || a.id.localeCompare(b.id)).slice(0, filter.limit),
    incomplete: false,
  }));
}

it('keeps each relay cursor independent while merging and deduplicating cached event pages', async () => {
  const recent = Array.from({ length: 7 }, (_, i) => event(i + 1, 100 - i));
  const old = event(50, 50);
  const query = queryFor({ [a]: recent, [b]: [recent[0], old] });
  const timeline = new RelayTimeline([{ urls: [a, b], filter: { kinds: [1] } }], 4);
  expect((await timeline.next(query, 2)).events).toEqual(recent.slice(0, 2));
  expect(query).toHaveBeenCalledTimes(2);
  expect((await timeline.next(query, 2)).events).toEqual(recent.slice(2, 4));
  expect(query).toHaveBeenCalledTimes(2);
  expect((await timeline.next(query, 2)).events).toEqual(recent.slice(4, 6));
  expect(query.mock.calls[2]).toEqual([a, { kinds: [1], limit: 4, until: 97 }, expect.anything()]);
  const end = await timeline.next(query, 10);
  expect(end.events).toEqual([recent[6], old]);
  expect(end).toMatchObject({ hasMore: false, incomplete: false });
  expect(query.mock.calls.find(([url, filter]) => url === b && filter.until !== undefined)?.[1].until).toBe(50);
});

it('keeps two different filters on the same relay independent and preserves filter constraints', async () => {
  const one = event(1, 80, 1, [['p', 'target']]), two = event(2, 20, 7, [['p', 'target']]);
  const query = queryFor({ [a]: [one, two, event(3, 70, 1, [['p', 'other']]), event(4, 120)] });
  const timeline = new RelayTimeline([
    { urls: [a], filter: { kinds: [1], '#p': ['target'], since: 10, until: 90 } },
    { urls: [a], filter: { kinds: [7], '#p': ['target'], since: 10, until: 30 } },
  ], 100);
  expect((await timeline.next(query, 10)).events).toEqual([one, two]);
  expect(query.mock.calls[0][1]).toEqual({ kinds: [1], '#p': ['target'], since: 10, until: 90, limit: 100 });
  expect(query.mock.calls[1][1]).toEqual({ kinds: [7], '#p': ['target'], since: 10, until: 30, limit: 100 });
});

it('retains healthy relay results while reporting a failed source as incomplete', async () => {
  const one = event(1, 50);
  const query: RelayTimelineQuery = async relay => {
    if (relay === a) throw new Error('offline');
    return { events: [one], incomplete: true };
  };
  const timeline = new RelayTimeline([{ urls: [a, b], filter: { kinds: [1] } }]);
  expect(await timeline.next(query)).toEqual({ events: [one], incomplete: true, hasMore: true });
});

it('shares in-flight calls and rolls back cursor progress when an external signal cancels a read', async () => {
  const one = event(1, 100), two = event(2, 50);
  const timeline = new RelayTimeline([{ urls: [a, b], filter: { kinds: [1] } }]);
  const controller = new AbortController();
  let finish!: (value: { events: Event[]; incomplete: boolean }) => void;
  const query = jest.fn().mockResolvedValueOnce({ events: [one], incomplete: false })
    .mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const pending = timeline.next(query, 2, controller.signal);
  expect(timeline.next(query, 2)).toBe(pending);
  const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  controller.abort();
  finish({ events: [two], incomplete: false });
  await rejected;
  const retry = queryFor({ [a]: [one], [b]: [two] });
  expect((await timeline.next(retry, 2)).events).toEqual([one, two]);
  expect(retry.mock.calls.slice(0, 2).every(([, filter]) => filter.until === undefined)).toBe(true);
});

it('disposes pending reads even if the transport ignores cancellation', async () => {
  const timeline = new RelayTimeline([{ urls: [a], filter: { kinds: [1] } }]);
  let finish!: (value: { events: Event[]; incomplete: boolean }) => void;
  const query: RelayTimelineQuery = () => new Promise(resolve => { finish = resolve; });
  const pending = timeline.next(query);
  const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  timeline.dispose();
  finish({ events: [event(1, 100)], incomplete: false });
  await rejected;
  await expect(timeline.next(query)).rejects.toMatchObject({ name: 'AbortError' });
});
