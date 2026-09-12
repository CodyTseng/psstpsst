import { act, create, type ReactTestRenderer } from 'react-test-renderer';

const mockPairingCodeBlock = jest.fn(
  ({ children }: { children?: React.ReactNode }) => {
    const { View } = jest.requireActual<typeof import('react-native')>('react-native');
    return <View>{children}</View>;
  },
);
const mockBottomSheet = jest.fn(
  ({ visible, children }: { visible: boolean; children?: React.ReactNode; onClose: () => void }) => {
    const { View } = jest.requireActual<typeof import('react-native')>('react-native');
    return visible ? <View>{children}</View> : null;
  },
);
const mockSubscribe = jest.fn(() => jest.fn());
const mockAccountPubkey = 'f'.repeat(64);
const mockLocalProximityPubkey = '01'.repeat(32);
const mockPeerPubkey = 'ab'.repeat(32);
const mockProximityState = {
  incomingChatRequests: [
    { requestId: 'request', peerPubkey: mockPeerPubkey, displayName: 'Peer' },
  ],
  outgoingChatRequests: { [mockPeerPubkey]: true },
};

jest.mock('expo-router', () => ({
  router: { push: jest.fn() },
  useIsFocused: () => true,
}));
jest.mock('@/components/common/ActionRow', () => ({ ActionRow: () => null }));
jest.mock('@/components/common/AppText', () => ({
  AppText: ({ children }: { children?: React.ReactNode }) => {
    const { View } = jest.requireActual<typeof import('react-native')>('react-native');
    return <View>{children}</View>;
  },
}));
jest.mock('@/components/common/BottomSheet', () => ({
  BottomSheet: (props: {
    visible: boolean;
    children?: React.ReactNode;
    onClose: () => void;
  }) => mockBottomSheet(props),
}));
jest.mock('@/components/keysync/PairingCodeBlock', () => ({
  PairingCodeBlock: (props: { children?: React.ReactNode }) => mockPairingCodeBlock(props),
}));
jest.mock('@/hooks/use-proximity', () => ({
  useProximityIdentity: () => ({
    identity: {
      accountPubkey: mockAccountPubkey,
      proximityPubkey: mockLocalProximityPubkey,
    },
  }),
}));
jest.mock('@/services/proximity/proximity-identity.service', () => ({
  getCachedProximityPubkey: () => mockLocalProximityPubkey,
}));
jest.mock('@/services/proximity/proximity.service', () => ({
  proximityService: { respondToChatRequest: jest.fn() },
}));
jest.mock('@/stores/active-account.store', () => ({
  useActiveAccount: (selector: (state: { activePubkey: string }) => unknown) =>
    selector({ activePubkey: mockAccountPubkey }),
}));
jest.mock('@/stores/proximity.store', () => ({
  useProximityStore: Object.assign(
    (selector: (state: typeof mockProximityState) => unknown) => selector(mockProximityState),
    { subscribe: mockSubscribe },
  ),
}));
jest.mock('@/stores/toast.store', () => ({ showToast: jest.fn() }));
jest.mock('@/theme', () => ({ spacing: { lg: 16 } }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

const { NearbyChatRequestSheet } = jest.requireActual<
  typeof import('../nearby-chat-request-sheet')
>('../nearby-chat-request-sheet');
const { NearbyOutgoingRequestSheet } = jest.requireActual<
  typeof import('../nearby-outgoing-request-sheet')
>('../nearby-outgoing-request-sheet');

describe('Nearby first-contact pairing code', () => {
  let renderer: ReactTestRenderer | undefined;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = undefined;
  });

  it('shows the pairwise code in the responder approval sheet', () => {
    act(() => {
      renderer = create(<NearbyChatRequestSheet />);
    });

    expect(mockPairingCodeBlock).toHaveBeenCalledWith(
      expect.objectContaining({ label: 'nearby.pairing_code', code: '1533 BA4A' }),
    );
  });

  it('shows the same pairwise code in the initiator waiting sheet', () => {
    act(() => {
      renderer = create(<NearbyOutgoingRequestSheet peerPubkey={mockPeerPubkey} />);
    });

    expect(mockPairingCodeBlock).toHaveBeenCalledWith(
      expect.objectContaining({ label: 'nearby.pairing_code', code: '1533 BA4A' }),
    );
  });

  it('reopens a dismissed outgoing sheet when the user selects the same peer again', () => {
    jest.useFakeTimers();
    const onClose = jest.fn();
    try {
      act(() => {
        renderer = create(
          <NearbyOutgoingRequestSheet
            peerPubkey={mockPeerPubkey}
            awaitingRequest
            onClose={onClose}
          />,
        );
      });
      expect(mockBottomSheet.mock.lastCall?.[0].visible).toBe(true);

      act(() => mockBottomSheet.mock.lastCall?.[0].onClose());
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(mockBottomSheet.mock.lastCall?.[0].visible).toBe(false);

      act(() => {
        renderer?.update(
          <NearbyOutgoingRequestSheet peerPubkey={null} awaitingRequest={false} onClose={onClose} />,
        );
        renderer?.update(
          <NearbyOutgoingRequestSheet
            peerPubkey={mockPeerPubkey}
            awaitingRequest
            onClose={onClose}
          />,
        );
        jest.runOnlyPendingTimers();
      });

      expect(mockBottomSheet.mock.lastCall?.[0].visible).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });
});
