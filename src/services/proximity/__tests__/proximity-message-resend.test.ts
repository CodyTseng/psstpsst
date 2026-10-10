import { db } from '@/db/client';
import { outbox } from '@/db/schema';
import { deliveryStatusStore } from '@/services/dm/delivery-status';
import { proximityService } from '../proximity-runtime.service';

jest.mock('@/db/client', () => ({ db: { transaction: jest.fn() } }));

const rumor = {
  id: 'original-id', pubkey: 'nearby-self', kind: 14, content: 'original',
  tags: [['p', 'peer']], created_at: 100,
};

function setup(status: string | null, author = 'nearby-self') {
  jest.spyOn(proximityService, 'assertConversationWritable').mockResolvedValue({
    proximityPubkey: 'nearby-self',
  } as never);
  const harness = proximityService as unknown as {
    drain: () => Promise<void>;
    accountPubkey: string | null;
    identity: unknown;
  };
  harness.accountPubkey = 'account';
  jest.spyOn(harness, 'drain').mockResolvedValue(undefined);
  const query = {
    from: jest.fn().mockReturnThis(), where: jest.fn().mockReturnThis(),
    get: jest.fn().mockResolvedValueOnce({ rumor: { ...rumor, pubkey: author } })
      .mockResolvedValueOnce(status ? { status } : undefined),
  };
  const onConflictDoUpdate = jest.fn().mockResolvedValue(undefined);
  const values = jest.fn(() => ({ onConflictDoUpdate }));
  const tx = {
    select: jest.fn(() => query), insert: jest.fn(() => ({ values })),
    update: jest.fn(() => ({ set: jest.fn(() => ({ where: jest.fn() })) })),
  };
  jest.mocked(db.transaction).mockImplementation(async (run) => run(tx as never));
  return { harness, tx, values, onConflictDoUpdate };
}

afterEach(() => {
  jest.restoreAllMocks();
  const harness = proximityService as unknown as { accountPubkey: string | null; identity: unknown };
  harness.accountPubkey = null;
  harness.identity = null;
  deliveryStatusStore.setState({ byId: {} });
});

it.each([null, 'sent', 'failed'])(
  'requeues the identical Nearby rumor with %s delivery', async (status) => {
    const { tx, values } = setup(status);
    await proximityService.resendMessage({ accountPubkey: 'account', peerPubkey: 'peer', rumorId: rumor.id });
    expect(tx.insert).toHaveBeenCalledWith(outbox);
    expect(values).toHaveBeenCalledWith(expect.objectContaining({
      messageId: rumor.id, status: 'queued', attempts: 0,
      pendingPayload: { version: 1, deliveryKind: 'proximity', rumor },
    }));
    expect(deliveryStatusStore.getState().byId[rumor.id].phase).toBe('queued');
  },
);

it.each(['queued', 'sending', 'awaiting_ack'])(
  'retains an unfinished Nearby attempt in %s state', async (status) => {
    const { tx } = setup(status);
    await proximityService.resendMessage({ accountPubkey: 'account', peerPubkey: 'peer', rumorId: rumor.id });
    expect(tx.insert).not.toHaveBeenCalled();
    expect(tx.update).not.toHaveBeenCalled();
  },
);

it('rejects a rumor authored by a different proximity identity', async () => {
  const { tx } = setup('sent', 'other-identity');
  await expect(proximityService.resendMessage({
    accountPubkey: 'account', peerPubkey: 'peer', rumorId: rumor.id,
  })).rejects.toThrow('Own Nearby message not found');
  expect(tx.insert).not.toHaveBeenCalled();
});
