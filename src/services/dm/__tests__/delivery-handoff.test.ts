import { deliveryStatusStore, failedRelayRetryUrls } from '../delivery-status';
import { dmService } from '../dm.service';
import {
  beginMessagingSendPreparation,
  cancelMessagingSendPreparation,
} from '../messaging-send-readiness';

jest.mock('@/db/client', () => ({ db: {} }));
jest.mock('@/platform', () => ({
  platform: {
    appState: {
      currentState: () => 'active',
      addChangeListener: () => () => {},
    },
    notifications: { shouldNotifyNow: () => true },
  },
}));
jest.mock('../../account/account.service', () => ({ buildSigner: jest.fn() }));
jest.mock('../../files/media-index.service', () => ({}));
jest.mock('../../files/file-attachment.service', () => ({}));
jest.mock('../../conversation/message-tail-cache', () => ({}));
jest.mock('../../relay/relay-list.service', () => ({}));
jest.mock('../../relay/relay-router', () => ({ capDeliveryRelays: (urls: string[]) => urls }));
jest.mock('../../relay/relay-pool', () => ({ relayPool: {} }));
jest.mock('../../self-events/self-event-stream.service', () => ({
  selfEventStream: { destroy: jest.fn() },
}));
jest.mock('../encryption-key-watcher', () => ({
  encryptionKeyWatcher: { destroy: jest.fn() },
}));
jest.mock('../block.service', () => ({}));
jest.mock('../sync-store', () => ({}));
jest.mock('../encryption-key.service', () => ({}));

const accountPubkey = 'a'.repeat(64);
const recipientPubkey = 'b'.repeat(64);

type MutableDmService = {
  accountPubkey: string | null;
  encryptionKeys: { pubkey: string; privkey: Uint8Array; createdAt: number }[];
  storeRumor: () => Promise<void>;
};

afterEach(() => {
  jest.restoreAllMocks();
  cancelMessagingSendPreparation();
  dmService.destroy();
  deliveryStatusStore.setState({ byId: {} });
});

it('stores a pending message without waiting for the startup session', () => {
  const service = dmService as unknown as MutableDmService;
  service.accountPubkey = null;
  service.encryptionKeys = [];
  beginMessagingSendPreparation(accountPubkey);
  const stored = new Promise<void>(() => {});
  const storeRumor = jest.spyOn(service, 'storeRumor').mockReturnValue(stored);

  void dmService.sendMessage({
    accountPubkey,
    recipientPubkeys: [recipientPubkey],
    content: 'hello',
    timestamp: { createdAt: 1, millisecond: 0, orderAt: 1000 },
  });

  expect(storeRumor).toHaveBeenCalledTimes(1);
  const rumorId = Object.keys(deliveryStatusStore.getState().byId)[0];
  expect(deliveryStatusStore.getState().byId[rumorId!]?.phase).toBe('signing');
});

it('retains a whole-attempt failure reason for message details', () => {
  const delivery = deliveryStatusStore.getState();
  delivery.begin('rumor');
  delivery.finish('rumor', 'failed', 'Signer rejected the request.');

  expect(deliveryStatusStore.getState().byId.rumor).toMatchObject({
    phase: 'failed',
    error: 'Signer rejected the request.',
  });
  expect(failedRelayRetryUrls(deliveryStatusStore.getState().byId.rumor!)).toEqual([]);
});

it('seeds signing status before the stored message can replace its optimistic row', () => {
  const service = dmService as unknown as MutableDmService;
  service.accountPubkey = accountPubkey;
  service.encryptionKeys = [
    {
      pubkey: 'c'.repeat(64),
      privkey: new Uint8Array(32).fill(1),
      createdAt: 1,
    },
  ];

  const stored = new Promise<void>(() => {});
  const storeRumor = jest.spyOn(service, 'storeRumor').mockReturnValue(stored);

  void dmService.sendMessage({
    accountPubkey,
    recipientPubkeys: [recipientPubkey],
    content: 'hello',
    timestamp: { createdAt: 1, millisecond: 0, orderAt: 1000 },
  });

  expect(storeRumor).toHaveBeenCalledTimes(1);
  const rumorId = Object.keys(deliveryStatusStore.getState().byId)[0];
  expect(rumorId).toBeDefined();
  expect(deliveryStatusStore.getState().byId[rumorId!]).toMatchObject({
    rumorId,
    phase: 'signing',
    copies: [],
  });
});
