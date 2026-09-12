import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import type { Event } from 'nostr-tools';

const mockSyncRequestListeners = new Set<(event: Event) => void>();
const mockKeyTransferListeners = new Set<(event: Event) => void>();
const mockBuildSigner = jest.fn();
const mockExportKeyForTransfer = jest.fn();
const mockOwnKeyTransferRelays = jest.fn(async () => ['wss://relay.example']);
const mockMarkSyncRequestProcessed = jest.fn(async () => {});
const mockActionRow = jest.fn((_props: unknown) => null);
const mockWatchSyncRequestResolution = jest.fn();

jest.mock('@/components/common/ActionRow', () => ({
  ActionRow: (props: unknown) => mockActionRow(props),
}));
jest.mock('@/components/common/AppText', () => ({
  AppText: ({ children }: { children?: React.ReactNode }) => {
    const { View } = jest.requireActual<typeof import('react-native')>('react-native');
    return <View>{children}</View>;
  },
}));
jest.mock('@/components/common/BottomSheet', () => ({
  BottomSheet: ({ visible, children }: { visible: boolean; children?: React.ReactNode }) => {
    const { View } = jest.requireActual<typeof import('react-native')>('react-native');
    return visible ? <View>{children}</View> : null;
  },
}));
jest.mock('@/components/keysync/PairingCodeBlock', () => ({
  PairingCodeBlock: ({ children }: { children?: React.ReactNode }) => {
    const { View } = jest.requireActual<typeof import('react-native')>('react-native');
    return <View>{children}</View>;
  },
}));
jest.mock('@/services/account/account.service', () => ({ buildSigner: mockBuildSigner }));
jest.mock('@/services/dm/dm.service', () => ({
  dmService: {
    onSyncRequest: jest.fn((listener: (event: Event) => void) => {
      mockSyncRequestListeners.add(listener);
      return () => mockSyncRequestListeners.delete(listener);
    }),
    onKeyTransfer: jest.fn((listener: (event: Event) => void) => {
      mockKeyTransferListeners.add(listener);
      return () => mockKeyTransferListeners.delete(listener);
    }),
    onEncryptionKeyChanged: jest.fn(() => () => {}),
    markSyncRequestProcessed: mockMarkSyncRequestProcessed,
    watchSyncRequestResolution: mockWatchSyncRequestResolution,
  },
}));
jest.mock('@/services/dm/encryption-key.service', () => ({
  exportKeyForTransfer: mockExportKeyForTransfer,
  getClientPubkeyFromEvent: (event: Event) =>
    event.tags.find((tag) => tag[0] === 'P')?.[1] ?? null,
  getEncryptionPubkeyFromEvent: () => null,
  getKeySyncRelayHints: () => [],
  getVerificationCode: () => 'PAIR CODE',
}));
jest.mock('@/services/dm/key-sync-session', () => ({
  classifyKeySyncRequest: (current: Event, incoming: Event) =>
    current.tags.find((tag) => tag[0] === 'P')?.[1] ===
    incoming.tags.find((tag) => tag[0] === 'P')?.[1]
      ? 'duplicate'
      : 'replace',
  isKeySyncRequestResolvedByTransfer: (request: Event, transfer: Event) => {
    const clientPubkey = request.tags.find((tag) => tag[0] === 'P')?.[1];
    return !!clientPubkey && transfer.tags.some((tag) => tag[0] === 'p' && tag[1] === clientPubkey);
  },
}));
jest.mock('@/services/relay/relay-list.service', () => ({
  ownKeyTransferRelays: mockOwnKeyTransferRelays,
}));
jest.mock('@/stores/active-account.store', () => ({
  useActiveAccount: (selector: (state: { activePubkey: string; requireResync: () => Promise<void> }) => unknown) =>
    selector({ activePubkey: 'a'.repeat(64), requireResync: async () => {} }),
}));
jest.mock('@/theme', () => ({ spacing: { lg: 16 } }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

const { KeySyncRequestSheet } = jest.requireActual<typeof import('../KeySyncRequestSheet')>(
  '../KeySyncRequestSheet',
);

const ACCOUNT_PUBKEY = 'a'.repeat(64);
const FIRST_CLIENT_PUBKEY = 'b'.repeat(64);
const SECOND_CLIENT_PUBKEY = 'c'.repeat(64);

function keySyncRequest(id: string, clientPubkey: string): Event {
  return {
    id: id.padEnd(64, '0'),
    pubkey: ACCOUNT_PUBKEY,
    created_at: 100,
    kind: 4454,
    tags: [['P', clientPubkey]],
    content: '',
    sig: 'd'.repeat(128),
  };
}

function keyTransfer(clientPubkey: string): Event {
  return {
    id: 'transfer'.padEnd(64, '0'),
    pubkey: ACCOUNT_PUBKEY,
    created_at: 101,
    kind: 4455,
    tags: [['p', ACCOUNT_PUBKEY], ['p', clientPubkey]],
    content: '',
    sig: 'd'.repeat(128),
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function actionRow() {
  const props = mockActionRow.mock.lastCall?.[0] as
    | { confirm: { loading?: boolean; onPress: () => void } }
    | undefined;
  if (!props) throw new Error('ActionRow was not rendered');
  return props;
}

describe('KeySyncRequestSheet', () => {
  let renderer: ReactTestRenderer | undefined;

  beforeEach(() => {
    mockSyncRequestListeners.clear();
    mockKeyTransferListeners.clear();
    jest.clearAllMocks();
    mockWatchSyncRequestResolution.mockReturnValue(jest.fn());
    mockExportKeyForTransfer.mockResolvedValue({});
  });

  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = undefined;
  });

  it('does not carry a superseded request loading state into a new approval', async () => {
    const signer = deferred<{ signEvent: jest.Mock }>();
    mockBuildSigner.mockImplementationOnce(() => signer.promise);
    act(() => {
      renderer = create(<KeySyncRequestSheet />);
    });
    act(() => {
      mockSyncRequestListeners.forEach((listener) =>
        listener(keySyncRequest('first', FIRST_CLIENT_PUBKEY)),
      );
    });

    await act(async () => {
      actionRow().confirm.onPress();
      await Promise.resolve();
    });
    expect(actionRow().confirm.loading).toBe(true);

    act(() => {
      mockKeyTransferListeners.forEach((listener) => listener(keyTransfer(FIRST_CLIENT_PUBKEY)));
      mockSyncRequestListeners.forEach((listener) =>
        listener(keySyncRequest('second', SECOND_CLIENT_PUBKEY)),
      );
    });
    expect(actionRow().confirm.loading).toBe(false);

    signer.resolve({ signEvent: jest.fn() });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mockExportKeyForTransfer).not.toHaveBeenCalled();
  });

  it('watches the request return relays and withdraws a fulfilled approval', () => {
    act(() => {
      renderer = create(<KeySyncRequestSheet />);
    });
    const request = keySyncRequest('first', FIRST_CLIENT_PUBKEY);
    act(() => {
      mockSyncRequestListeners.forEach((listener) => listener(request));
    });

    const stopWatching = mockWatchSyncRequestResolution.mock.results[0]?.value as jest.Mock;
    expect(mockWatchSyncRequestResolution).toHaveBeenCalledWith(request);
    expect(renderer?.toJSON()).not.toBeNull();

    act(() => {
      mockKeyTransferListeners.forEach((listener) => listener(keyTransfer(FIRST_CLIENT_PUBKEY)));
    });

    expect(stopWatching).toHaveBeenCalledTimes(1);
    expect(mockMarkSyncRequestProcessed).toHaveBeenCalledWith(request.id);
    expect(renderer?.toJSON()).toBeNull();
  });

  it('sends a transfer through the account DM and write relays', async () => {
    mockBuildSigner.mockResolvedValue({ signEvent: jest.fn() });
    mockOwnKeyTransferRelays.mockResolvedValue([
      'wss://dm.example',
      'wss://write.example',
    ]);
    act(() => {
      renderer = create(<KeySyncRequestSheet />);
    });
    act(() => {
      mockSyncRequestListeners.forEach((listener) =>
        listener(keySyncRequest('first', FIRST_CLIENT_PUBKEY)),
      );
    });

    await act(async () => {
      actionRow().confirm.onPress();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockExportKeyForTransfer).toHaveBeenCalledWith(
      expect.objectContaining({
        relays: ['wss://dm.example', 'wss://write.example'],
      }),
    );
  });
});
