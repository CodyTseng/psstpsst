import { encryptionKeyWatcher } from '../encryption-key-watcher';
import { relayPool } from '../../relay/relay-pool';

jest.mock('@/db/client', () => ({ db: { select: () => ({ from: async () => [] }) } }));
jest.mock('../../relay/relay-router', () => ({
  resolvePeerOutbox: jest.fn(async () => { throw new Error('network unavailable'); }),
  pickPeerRelays: (relays: string[]) => relays,
  capDeliveryRelays: (relays: string[]) => relays,
  uniq: (relays: string[]) => [...new Set(relays)],
}));
jest.mock('../../relay/relay-list.service', () => ({
  fetchDmRelays: jest.fn(async () => { throw new Error('network unavailable'); }),
}));
jest.mock('../../relay/relay-pool', () => ({
  relayPool: { subscribe: jest.fn(() => jest.fn()) },
}));

it('keeps a durable key subscription on fallback relays when routing queries fail', async () => {
  await encryptionKeyWatcher.init({ dmRelays: ['wss://own.example'] });
  const unwatch = encryptionKeyWatcher.watch(['alice']);
  for (let i = 0; i < 20; i++) await Promise.resolve();
  expect(relayPool.subscribe).toHaveBeenCalledWith(expect.objectContaining({
    relays: expect.arrayContaining(['wss://own.example']),
    filter: expect.objectContaining({ authors: ['alice'] }),
  }));
  unwatch();
  encryptionKeyWatcher.destroy();
});
