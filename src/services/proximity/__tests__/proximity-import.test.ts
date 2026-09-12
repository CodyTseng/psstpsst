import type { Rumor } from '@/db/schema';
import { KIND_CHAT, KIND_FILE, KIND_REACTION } from '@/services/crypto/nip17-gift-wrap';

import * as identity from '../proximity-identity.service';
import { proximityService } from '../proximity-runtime.service';

jest.mock('@/db/client', () => ({ db: {} }));

const account = '11'.repeat(32);
const deviceA = '22'.repeat(32);
const deviceB = '33'.repeat(32);
const deviceC = '44'.repeat(32);

type ImportContext = {
  accountPubkey: string;
  proximityAccountPubkey: string;
  importing: true;
};

const storage = proximityService as unknown as {
  storeRumor: (rumor: Rumor, peer: string, context: ImportContext) => Promise<boolean | null>;
};

function message(sender: string, recipient: string, kind = KIND_CHAT): Rumor {
  return {
    id: '55'.repeat(32),
    pubkey: sender,
    kind,
    created_at: 123,
    content: 'Archived message',
    tags: [['p', recipient]],
  };
}

describe('Nearby archive conversation resolution', () => {
  let store: jest.SpyInstance;

  beforeEach(() => {
    jest.spyOn(identity, 'hasProximityIdentity').mockResolvedValue(true);
    jest.spyOn(identity, 'getCachedProximityPubkey').mockReturnValue(deviceB);
    store = jest.spyOn(storage, 'storeRumor').mockResolvedValue(true);
  });

  afterEach(() => jest.restoreAllMocks());

  test.each([KIND_CHAT, KIND_FILE, KIND_REACTION])(
    'imports kind %s in both directions into B’s conversation with A',
    async (kind) => {
      const incoming = message(deviceA, deviceB, kind);
      const outgoing = message(deviceB, deviceA, kind);

      expect(await proximityService.importRumors(account, deviceA, [incoming, outgoing])).toEqual({
        inserted: 2,
        existing: 0,
        invalid: 0,
      });
      for (const rumor of [incoming, outgoing]) {
        expect(store).toHaveBeenCalledWith(rumor, deviceA, {
          accountPubkey: account,
          proximityAccountPubkey: deviceB,
          importing: true,
        });
      }
      expect(identity.hasProximityIdentity).toHaveBeenCalledTimes(1);
      expect(identity.hasProximityIdentity).toHaveBeenCalledWith(account);
    },
  );

  test('keeps the archive perspective for unrelated messages in the same batch', async () => {
    const local = message(deviceA, deviceB);
    const archivedOutgoing = message(deviceA, deviceC);
    const archivedIncoming = message(deviceC, deviceA);

    await proximityService.importRumors(account, deviceA, [
      local,
      archivedOutgoing,
      archivedIncoming,
    ]);

    expect(store).toHaveBeenCalledWith(local, deviceA, {
      accountPubkey: account,
      proximityAccountPubkey: deviceB,
      importing: true,
    });
    for (const rumor of [archivedOutgoing, archivedIncoming]) {
      expect(store).toHaveBeenCalledWith(rumor, deviceC, {
        accountPubkey: account,
        proximityAccountPubkey: deviceA,
        importing: true,
      });
    }
  });

  test('does not treat the signed-in Nostr public key as the local Nearby identity', async () => {
    const rumor = message(deviceA, account);
    await proximityService.importRumors(account, deviceA, [rumor]);

    expect(store).toHaveBeenCalledWith(rumor, account, {
      accountPubkey: account,
      proximityAccountPubkey: deviceA,
      importing: true,
    });
  });

  test('falls back to the archive when this account has no Nearby identity', async () => {
    jest.mocked(identity.hasProximityIdentity).mockResolvedValue(false);
    const rumor = message(deviceA, deviceB);
    await proximityService.importRumors(account, deviceA, [rumor]);

    expect(identity.getCachedProximityPubkey).not.toHaveBeenCalled();
    expect(store).toHaveBeenCalledWith(rumor, deviceB, {
      accountPubkey: account,
      proximityAccountPubkey: deviceA,
      importing: true,
    });
  });

  test('preserves the perspective when importing the current device’s own archive', async () => {
    const rumor = message(deviceB, deviceA);
    await proximityService.importRumors(account, deviceB, [rumor]);

    expect(store).toHaveBeenCalledWith(rumor, deviceA, {
      accountPubkey: account,
      proximityAccountPubkey: deviceB,
      importing: true,
    });
  });

  test('rejects messages without a unique recipient or a participating identity', async () => {
    const noRecipient = { ...message(deviceA, deviceB), tags: [] };
    const multipleRecipients = {
      ...message(deviceA, deviceB),
      tags: [['p', deviceB], ['p', deviceC]],
    };
    const unrelated = message(deviceC, account);

    expect(
      await proximityService.importRumors(account, deviceA, [
        noRecipient,
        multipleRecipients,
        unrelated,
      ]),
    ).toEqual({ inserted: 0, existing: 0, invalid: 3 });
    expect(store).not.toHaveBeenCalled();
  });
});
