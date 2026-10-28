import { relayPool } from '../../relay/relay-pool';
import { canResolveReferencedEvent, fetchReferencedEvent, getCachedReferencedEvent } from '../event-reference.service';
import { finalizeEvent, generateSecretKey } from 'nostr-tools';

jest.mock('@/db/client', () => ({
  db: { select: () => ({ from: () => ({ where: async () => [] }) }) },
}));
jest.mock('../../profile/profile.service', () => ({ cacheProfileEvent: jest.fn() }));
jest.mock('../../relay/relay-router', () => ({ peerMetaRelays: jest.fn() }));
jest.mock('../../relay/relay-pool', () => ({ relayPool: { query: jest.fn() } }));
jest.mock('../cached-events.service', () => ({ readCachedEvents: jest.fn(async () => new Map()), storeCachedEvent: jest.fn(async () => {}) }));

it('retries a network failure but caches a completed empty lookup', async () => {
  const reference = { bech32: 'note', id: 'a'.repeat(64), relays: [] };
  const query = jest.mocked(relayPool.query);
  query.mockRejectedValueOnce(new Error('network unavailable')).mockResolvedValue([]);
  await expect(fetchReferencedEvent(reference)).resolves.toBeNull();
  expect(getCachedReferencedEvent(reference)).toBeUndefined();
  await expect(fetchReferencedEvent(reference)).resolves.toBeNull();
  expect(getCachedReferencedEvent(reference)).toBeNull();
  await fetchReferencedEvent(reference);
  expect(query).toHaveBeenCalledTimes(2);
});

it('looks up full IDs despite unrelated kind hints and reuses the actual event', async () => {
  const event = finalizeEvent({ kind: 1, content: 'Actual note', created_at: 1, tags: [] }, generateSecretKey());
  const reference = { bech32: 'wrong-hint', id: event.id, kind: 35130, relays: [] };
  const query = jest.mocked(relayPool.query).mockReset().mockResolvedValue([event]);
  expect(canResolveReferencedEvent(reference)).toBe(true);
  expect(await fetchReferencedEvent(reference)).toBe(event);
  expect(query.mock.calls[0][0].filter).toEqual({ ids: [event.id], limit: 1 });
  expect(await fetchReferencedEvent({ ...reference, kind: 1 })).toBe(event);
  expect(getCachedReferencedEvent({ ...reference, kind: 9999 })).toBe(event);
  expect(query).toHaveBeenCalledTimes(1);
  expect(canResolveReferencedEvent({ bech32: 'coordinate', kind: 1, relays: [] })).toBe(false);
});
