import { observedPeerKeyService } from '../observed-peer-key.service';

const mockGet = jest.fn(async () => undefined);
const mockOnConflictDoUpdate = jest.fn(async () => {});
const mockValues = jest.fn(() => ({ onConflictDoUpdate: mockOnConflictDoUpdate }));
const mockUpdateWhere = jest.fn(async () => {});

jest.mock('@/db/client', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({ get: mockGet }),
      }),
    }),
    insert: () => ({ values: mockValues }),
    update: () => ({ set: () => ({ where: mockUpdateWhere }) }),
  },
}));

beforeEach(() => jest.clearAllMocks());

it('updates the stored key from newer authenticated seal evidence', async () => {
  const peerPubkey = 'b'.repeat(64);
  const firstKey = 'c'.repeat(64);
  const nextKey = 'd'.repeat(64);

  await observedPeerKeyService.rememberVerifiedSealKey({
    peerPubkey,
    encryptionPubkey: firstKey,
    evidenceId: 'f'.repeat(64),
    evidenceCreatedAt: 100,
  });
  await observedPeerKeyService.rememberVerifiedSealKey({
    peerPubkey,
    encryptionPubkey: nextKey,
    evidenceId: 'e'.repeat(64),
    evidenceCreatedAt: 101,
  });

  await expect(observedPeerKeyService.resolve(peerPubkey)).resolves.toMatchObject({
    encryptionPubkey: nextKey,
    source: 'seal',
    evidenceCreatedAt: 101,
  });
  expect(mockValues).toHaveBeenCalledTimes(2);
});

it('does not let delayed history replace the key from a newer message', async () => {
  const peerPubkey = '3'.repeat(64);
  const currentKey = '4'.repeat(64);

  await observedPeerKeyService.rememberVerifiedSealKey({
    peerPubkey,
    encryptionPubkey: currentKey,
    evidenceId: '5'.repeat(64),
    evidenceCreatedAt: 200,
  });
  await observedPeerKeyService.rememberVerifiedSealKey({
    peerPubkey,
    encryptionPubkey: '6'.repeat(64),
    evidenceId: '4'.repeat(64),
    evidenceCreatedAt: 199,
  });

  await expect(observedPeerKeyService.resolve(peerPubkey)).resolves.toMatchObject({
    encryptionPubkey: currentKey,
    evidenceCreatedAt: 200,
  });
  expect(mockValues).toHaveBeenCalledTimes(1);
});

it('shares the newest peer observation device-wide', async () => {
  const peerPubkey = '9'.repeat(64);
  const firstKey = 'a'.repeat(64);
  const secondKey = 'b'.repeat(64);

  await observedPeerKeyService.rememberVerifiedSealKey({
    peerPubkey,
    encryptionPubkey: firstKey,
    evidenceId: 'c'.repeat(64),
    evidenceCreatedAt: 300,
  });
  await observedPeerKeyService.rememberVerifiedSealKey({
    peerPubkey,
    encryptionPubkey: secondKey,
    evidenceId: 'd'.repeat(64),
    evidenceCreatedAt: 301,
  });

  await expect(observedPeerKeyService.resolve(peerPubkey)).resolves.toMatchObject({
    encryptionPubkey: secondKey,
  });
});

it('lets a newer kind-10044 announcement replace seal evidence', async () => {
  const peerPubkey = 'e'.repeat(64);

  await observedPeerKeyService.rememberVerifiedSealKey({
    peerPubkey,
    encryptionPubkey: '1'.repeat(64),
    evidenceId: 'f'.repeat(64),
    evidenceCreatedAt: 400,
  });
  await observedPeerKeyService.rememberKeyAnnouncement({
    peerPubkey,
    encryptionPubkey: '2'.repeat(64),
    evidenceId: 'e'.repeat(64),
    evidenceCreatedAt: 401,
  });

  await expect(observedPeerKeyService.resolve(peerPubkey)).resolves.toMatchObject({
    encryptionPubkey: '2'.repeat(64),
    source: 'kind-10044',
    evidenceCreatedAt: 401,
  });
});

it('persists newer evidence without notifying when the encryption key is unchanged', async () => {
  const peerPubkey = 'f'.repeat(64);
  const encryptionPubkey = '3'.repeat(64);
  const listener = jest.fn();
  const unsubscribe = observedPeerKeyService.onKeyChanged(listener);

  await observedPeerKeyService.rememberVerifiedSealKey({
    peerPubkey,
    encryptionPubkey,
    evidenceId: 'f'.repeat(64),
    evidenceCreatedAt: 500,
  });
  listener.mockClear();
  await observedPeerKeyService.rememberVerifiedSealKey({
    peerPubkey,
    encryptionPubkey,
    evidenceId: 'e'.repeat(64),
    evidenceCreatedAt: 501,
  });

  expect(mockValues).toHaveBeenCalledTimes(2);
  expect(listener).not.toHaveBeenCalled();
  unsubscribe();
});

it('records a completed announcement miss without changing the seal key', async () => {
  const peerPubkey = '0'.repeat(64);
  const encryptionPubkey = '4'.repeat(64);
  await observedPeerKeyService.rememberVerifiedSealKey({
    peerPubkey,
    encryptionPubkey,
    evidenceId: 'a'.repeat(64),
    evidenceCreatedAt: 600,
  });

  await observedPeerKeyService.markAnnouncementChecked(peerPubkey, 700);

  await expect(observedPeerKeyService.resolve(peerPubkey)).resolves.toMatchObject({
    encryptionPubkey,
    announcementCheckedAt: 700,
  });
  expect(mockUpdateWhere).toHaveBeenCalledTimes(1);
});
