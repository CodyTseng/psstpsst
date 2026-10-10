import { db } from '@/db/client';
import { relayOutboxJobs } from '@/db/schema';
import { relayPool } from '../../relay/relay-pool';
import { relayMessageOutbox } from '../relay-message-outbox';

jest.mock('@/db/client', () => ({ db: { transaction: jest.fn(), select: jest.fn() } }));
jest.mock('@/platform', () => ({ platform: {} }));
jest.mock('../../account/account.service', () => ({ buildSigner: jest.fn() }));
jest.mock('../../relay/relay-pool', () => ({ relayPool: { publishEvent: jest.fn() } }));
jest.mock('../peer-encryption-key.service', () => ({ resolvePeerMessagingMetadata: jest.fn() }));
jest.mock('../../crypto/nip17-gift-wrap', () => ({ KIND_CHAT: 14, KIND_FILE: 15 }));

const originalRumor = {
  id: 'original-id', pubkey: 'self', kind: 14, content: 'from another device',
  created_at: 100, tags: [['p', 'peer']],
};

function setup(deliveryStatus: string | null, author = 'self', pending = false) {
  const get = jest.fn()
    .mockResolvedValueOnce({ deliveryStatus, rumor: { ...originalRumor, pubkey: author } })
    .mockResolvedValueOnce(pending ? { id: 1 } : undefined);
  const query = {
    from: jest.fn().mockReturnThis(), where: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(), get,
  };
  const values = jest.fn().mockResolvedValue(undefined);
  const set = jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue(undefined) });
  const tx = {
    select: jest.fn(() => query), insert: jest.fn(() => ({ values })),
    update: jest.fn(() => ({ set })),
  };
  jest.mocked(db.transaction).mockImplementation(async (run) => run(tx as never));
  return { tx, values, set };
}

afterEach(() => jest.restoreAllMocks());

it.each([null, 'sent', 'failed', 'partial', 'queued'])(
  'queues full resend for own stored rumor with %s status', async (status) => {
    const { tx, values } = setup(status);
    const wake = jest.spyOn(relayMessageOutbox, 'wake').mockImplementation(() => {});
    await relayMessageOutbox.enqueueResend('self', 'original-id');
    expect(tx.insert).toHaveBeenCalledWith(relayOutboxJobs);
    expect(values).toHaveBeenCalledWith(expect.objectContaining({
      accountPubkey: 'self', messageId: originalRumor.id, scope: 'resend_all',
    }));
    expect(wake).toHaveBeenCalledWith('self');
  },
);

it('rejects republishing a peer rumor under the local identity', async () => {
  const { tx } = setup(null, 'peer');
  await expect(relayMessageOutbox.enqueueResend('self', 'original-id'))
    .rejects.toThrow('Cannot resend another author');
  expect(tx.insert).not.toHaveBeenCalled();
});

it('coalesces repeated resend requests while the job is unfinished', async () => {
  const { tx } = setup('sent', 'self', true);
  jest.spyOn(relayMessageOutbox, 'wake').mockImplementation(() => {});
  await relayMessageOutbox.enqueueResend('self', 'original-id');
  expect(tx.insert).not.toHaveBeenCalled();
});

it('republishes acknowledged targets for a full resend without querying prior results', async () => {
  const harness = relayMessageOutbox as unknown as {
    skipSuccessfulTargets: (job: { scope: string }, targets: unknown[], durable: boolean) => Promise<unknown[]>;
  };
  const targets = [{ recipientPubkey: 'peer', relayUrl: 'wss://accepted.example' }];
  jest.mocked(db.select).mockClear();
  expect(await harness.skipSuccessfulTargets({ scope: 'resend_all' }, targets, true))
    .toBe(targets);
  expect(db.select).not.toHaveBeenCalled();
});

it('prepares and publishes a resend to peer and self from the original stored rumor', async () => {
  const harness = relayMessageOutbox as unknown as {
    processJob: (job: unknown, session: unknown, generation: number) => Promise<boolean>;
    loadTargets: () => Promise<unknown[]>;
    prepareAllTargets: () => Promise<unknown[]>;
    isCurrent: () => boolean;
    ensurePayloads: (...args: unknown[]) => Promise<void>;
    markTargetsPending: () => Promise<void>;
  };
  const targets = [
    { recipientPubkey: 'peer', relayUrl: 'wss://peer.example' },
    { recipientPubkey: 'self', relayUrl: 'wss://self.example' },
  ];
  const job = { id: 1, scope: 'resend_all', accountPubkey: 'self', messageId: originalRumor.id };
  const query = {
    from: jest.fn().mockReturnThis(), where: jest.fn().mockReturnThis(),
    get: jest.fn().mockResolvedValue({ rumor: originalRumor, kind: 14 }),
    all: jest.fn().mockResolvedValue([
      { recipientPubkey: 'peer', giftWrap: { id: 'fresh-peer-wrap' } },
      { recipientPubkey: 'self', giftWrap: { id: 'fresh-self-wrap' } },
    ]),
  };
  jest.mocked(db.select).mockReturnValue(query as never);
  jest.spyOn(harness, 'loadTargets').mockResolvedValueOnce([]).mockResolvedValue(targets);
  const prepare = jest.spyOn(harness, 'prepareAllTargets').mockResolvedValue(targets);
  jest.spyOn(harness, 'isCurrent').mockReturnValue(true);
  const wrap = jest.spyOn(harness, 'ensurePayloads').mockResolvedValue(undefined);
  jest.spyOn(harness, 'markTargetsPending').mockResolvedValue(undefined);
  jest.mocked(relayPool.publishEvent).mockClear().mockResolvedValue(undefined as never);
  expect(await harness.processJob(job, {}, 0)).toBe(true);
  expect(prepare).toHaveBeenCalledWith(job, originalRumor, true, {}, 0);
  expect(wrap).toHaveBeenCalledWith(job, originalRumor, targets, {}, 0);
  expect(relayPool.publishEvent).toHaveBeenCalledTimes(2);
  expect(relayPool.publishEvent).toHaveBeenCalledWith(expect.objectContaining({
    relays: ['wss://peer.example'], event: { id: 'fresh-peer-wrap' },
  }));
  expect(relayPool.publishEvent).toHaveBeenCalledWith(expect.objectContaining({
    relays: ['wss://self.example'], event: { id: 'fresh-self-wrap' },
  }));
});
