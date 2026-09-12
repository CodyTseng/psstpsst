import { relayPool } from '../../relay/relay-pool';
import { fetchReferencedEvent, getCachedReferencedEvent } from '../event-reference.service';

jest.mock('@/db/client', () => ({
  db: { select: () => ({ from: () => ({ where: async () => [] }) }) },
}));
jest.mock('../../profile/profile.service', () => ({ cacheProfileEvent: jest.fn() }));
jest.mock('../../relay/relay-router', () => ({ peerMetaRelays: jest.fn() }));
jest.mock('../../relay/relay-pool', () => ({ relayPool: { query: jest.fn() } }));

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
