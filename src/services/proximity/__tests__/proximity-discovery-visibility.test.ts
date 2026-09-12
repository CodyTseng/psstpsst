import { secp256k1 } from '@noble/curves/secp256k1.js';
import { x25519 } from '@noble/curves/ed25519.js';

import { platform } from '@/platform';
import { db } from '@/db/client';

import { proximitySessionStore } from '../proximity-session';
import {
  ProximityAccessDecision,
  PROXIMITY_CAPABILITY_PROFILE_UPDATE,
  PROXIMITY_SUPPORTED_CAPABILITIES,
  PROXIMITY_VERSION,
  ProximityErrorCode,
  ProximityPacketType,
  decodeProfileUpdate,
  encodeAccessResult,
  encodeClientAuth,
  encodeClientHello,
  encodeClose,
  encodeProfile,
  encodeProfileUpdate,
  encodeServerHello,
  signNoiseBinding,
  type ProximityProfile,
} from '../proximity-protocol';
import { proximityService } from '../proximity-runtime.service';

jest.mock('@/db/client', () => ({ db: {} }));

type DiscoveryVisibilityHarness = {
  abortEndpoint: (
    endpointId: string,
    context?: { endpointId: string; generation: number; phase: string; peerPubkey?: string },
  ) => void;
  acceptClientHello: (
    context: { endpointId: string; phase: string },
    payload: Uint8Array,
  ) => Promise<void>;
  accountPubkey: string | null;
  activePeer: string | null;
  activeForegroundScanAccount: string | null;
  applyForegroundState: () => Promise<void>;
  beginConnectionAttempt: (peerPubkey: string) => void;
  claimInitiatorHandshake: (endpointId: string) => { phase: string } | null;
  claimHandshakePacket: (
    context: { receivedHandshakePackets?: Map<ProximityPacketType, Uint8Array> },
    type: ProximityPacketType,
    packet: Uint8Array,
  ) => boolean;
  clearDiscoveries: () => void;
  clearConnectionFailure: (peerPubkey: string) => void;
  canonicalEndpoints: Map<string, string>;
  connectedEndpoints: Set<string>;
  connectionDiscoveryTimers: Map<string, ReturnType<typeof setTimeout>>;
  connectionFailures: Map<string, 'failed' | 'rejected'>;
  continuousScanReferences: number;
  endpointContexts: Map<
    string,
    { phase: string; generation?: number; selectedCapabilities?: bigint }
  >;
  endpointProfiles: Map<string, ProximityProfile>;
  endpointReceives: Map<string, Promise<void>>;
  endpointSends: Map<string, Promise<void>>;
  endpointToPubkey: Map<string, string>;
  explicitUnsuppressionEndpoints: Set<string>;
  enqueuePacket: (event: Record<string, unknown>) => void;
  finishChatRequest: (
    peerPubkey: string,
    result: 'accepted' | 'declined' | 'failed' | 'timeout',
  ) => void;
  finishElection: (peerPubkey: string) => Promise<void>;
  findConnectedInitiatorEndpoint: (
    peerPubkey: string,
  ) => [string, ProximityProfile] | undefined;
  foregroundAccountPubkey: string | null;
  foregroundScanUntil: number;
  foregroundTransition: Promise<void>;
  getPeerConnectionState: (
    accountPubkey: string,
    peerPubkey: string,
  ) => Promise<{
    relationship: 'unlinked' | 'trusted' | 'blocked';
    failure: null | 'failed' | 'rejected';
  }>;
  handleAccessRequest: (
    context: IncomingAccessContext,
    payload: Uint8Array,
  ) => Promise<void>;
  handleProfileUpdate: (
    context: {
      endpointId: string;
      phase: 'ready';
      peerPubkey: string;
      profile: ProximityProfile;
      selectedCapabilities: bigint;
    },
    payload: Uint8Array,
  ) => Promise<void>;
  handleHandshakePacket: (
    context: {
      endpointId: string;
      role: 'initiator' | 'responder';
      phase: string;
      handshakeId?: Uint8Array;
      receivedHandshakePackets?: Map<ProximityPacketType, Uint8Array>;
    },
    packet: Uint8Array,
  ) => Promise<void>;
  holdRejectedAccess: (context: RejectedAccessContext) => void;
  handshakeRetryAttempts: Map<string, number>;
  identity: { proximityPubkey: string; displayName?: string } | null;
  ignoredEndpoints: Set<string>;
  incomingChatRequests: Map<
    string,
    {
      requestId: string;
      endpointId: string;
      peerPubkey: string;
      displayName: string;
      timer: ReturnType<typeof setTimeout>;
    }
  >;
  isClaimedHandshakeRetransmission: (
    context: { receivedHandshakePackets?: Map<ProximityPacketType, Uint8Array> },
    packet: Uint8Array,
  ) => boolean;
  localProfile: () => ProximityProfile;
  notifyReadyPeersOfProfile: (name: string) => void;
  maybeStartHandshake: (endpointId: string) => Promise<void>;
  onSignal: (event: Record<string, unknown>) => void;
  onConnection: (event: Record<string, unknown>) => void;
  onPacket: (event: Record<string, unknown>) => Promise<void>;
  onPeer: (event: Record<string, unknown>) => Promise<void>;
  pendingChatRequests: Map<string, unknown>;
  pendingForegroundScanAccount: string | null;
  reconcileScanning: () => Promise<void>;
  reconcilePeerAvailability: (pubkey: string) => void;
  recoverFreshHandshake: (context: {
    endpointId: string;
    role: 'initiator' | 'responder';
    phase: string;
    peerPubkey?: string;
  }) => void;
  recordDiscovery: (pubkey: string, rssi: number, lastSeenAt: number) => number;
  releasePeerDiscovery: (pubkey: string) => void;
  removeIncomingChatRequest: (requestId: string) => void;
  revokePeer: (pubkey: string) => Promise<void>;
  resumeRejectedAccess: (context: RejectedAccessContext) => Promise<boolean>;
  retryFailedConnection: (
    accountPubkey: string,
    peerPubkey: string,
    userInitiated: boolean,
  ) => Promise<void>;
  reviveResponderForClientHello: (event: Record<string, unknown>) => void;
  restartClosedInitiator: (
    context: {
      endpointId: string;
      generation: number;
      role: 'initiator';
      phase: 'closed';
    },
    peerPubkey: string,
  ) => Promise<void>;
  requestChat: (
    accountPubkey: string,
    peerPubkey: string,
  ) => Promise<'accepted' | 'declined' | 'failed' | 'timeout'>;
  respondToChatRequest: (
    requestId: string,
    accepted: boolean,
  ) => Promise<{ peerPubkey: string; displayName: string } | null>;
  scheduleAccessTimeout: (context: {
    endpointId: string;
    role: 'initiator' | 'responder';
    phase: string;
    accessPurpose: 'session' | 'chat_request';
    timer?: ReturnType<typeof setTimeout>;
  }) => void;
  scan: (durationMs: number) => Promise<void>;
  sendSecure: (
    context: {
      endpointId: string;
      phase: 'ready' | 'closed';
      secure: {
        seal(type: ProximityPacketType, payload: Uint8Array): Promise<Uint8Array>;
      };
    },
    type: ProximityPacketType,
    payload: Uint8Array,
  ) => Promise<void>;
  signalPeerPubkeys: Map<string, string>;
  references: number;
  sessionStarted: boolean;
  setForegroundState: (accountPubkey: string, isForeground: boolean) => Promise<void>;
  surfaceProfile: (endpointId: string, profile: ProximityProfile, rssi: number) => void;
  start: (accountPubkey: string, enableIfNeeded: boolean) => Promise<void>;
  startInitiatorHandshake: (
    context: { endpointId: string; generation: number; phase: string },
    profile: ProximityProfile,
  ) => Promise<void>;
};

type RejectedAccessContext = {
  endpointId: string;
  peerPubkey?: string;
  role: 'initiator' | 'responder';
  phase: string;
  accessPurpose: 'session' | 'chat_request';
  accessSent: boolean;
  secure: {
    seal(type: ProximityPacketType, payload: Uint8Array): Promise<Uint8Array>;
    destroy(): void;
  };
  timer?: ReturnType<typeof setTimeout>;
};

type IncomingAccessContext = RejectedAccessContext & {
  peerPubkey: string;
  profile: ProximityProfile;
  secure: RejectedAccessContext['secure'] & {
    sessionId: Uint8Array;
  };
};

const service = proximityService as unknown as DiscoveryVisibilityHarness;
const peerPubkey = '11'.repeat(32);
const testNoisePublicKey = new Uint8Array(32).fill(0x22);
const testNoiseBindingSignature = new Uint8Array(64).fill(0x33);

function stubProfile(
  publicKey = new Uint8Array(32).fill(0x11),
  name = 'Peer',
  capabilities = 1n,
): ProximityProfile {
  return {
    version: PROXIMITY_VERSION,
    publicKey,
    noisePublicKey: testNoisePublicKey,
    noiseBindingSignature: testNoiseBindingSignature,
    capabilities,
    name,
  };
}

function signedProfile(name: string): ProximityProfile {
  const proximitySecret = new Uint8Array(32);
  proximitySecret[31] = 1;
  const noiseSecret = new Uint8Array(32);
  noiseSecret[31] = 2;
  const publicKey = secp256k1.getPublicKey(proximitySecret, true).subarray(1);
  const noisePublicKey = x25519.getPublicKey(noiseSecret);
  return {
    version: PROXIMITY_VERSION,
    publicKey,
    noisePublicKey,
    noiseBindingSignature: signNoiseBinding(proximitySecret, noisePublicKey),
    capabilities: 1n,
    name,
  };
}

describe('Nearby discovery visibility', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    service.clearDiscoveries();
    service.canonicalEndpoints.clear();
    service.accountPubkey = null;
    service.activePeer = null;
    service.activeForegroundScanAccount = null;
    service.connectedEndpoints.clear();
    service.connectionDiscoveryTimers.forEach(clearTimeout);
    service.connectionDiscoveryTimers.clear();
    service.connectionFailures.clear();
    service.continuousScanReferences = 0;
    service.endpointContexts.clear();
    service.endpointProfiles.clear();
    service.endpointReceives.clear();
    service.endpointSends.clear();
    service.endpointToPubkey.clear();
    service.explicitUnsuppressionEndpoints.clear();
    service.foregroundAccountPubkey = null;
    service.foregroundScanUntil = 0;
    service.foregroundTransition = Promise.resolve();
    service.handshakeRetryAttempts.clear();
    service.identity = null;
    service.ignoredEndpoints.clear();
    service.incomingChatRequests.forEach((request) => clearTimeout(request.timer));
    service.incomingChatRequests.clear();
    service.pendingForegroundScanAccount = null;
    service.references = 0;
    service.sessionStarted = false;
    service.signalPeerPubkeys.clear();
    proximitySessionStore.getState().resetSession();
  });

  afterEach(() => {
    service.clearDiscoveries();
    service.canonicalEndpoints.clear();
    service.accountPubkey = null;
    service.activePeer = null;
    service.activeForegroundScanAccount = null;
    service.connectedEndpoints.clear();
    service.connectionDiscoveryTimers.forEach(clearTimeout);
    service.connectionDiscoveryTimers.clear();
    service.connectionFailures.clear();
    service.continuousScanReferences = 0;
    service.endpointContexts.clear();
    service.endpointProfiles.clear();
    service.endpointReceives.clear();
    service.endpointSends.clear();
    service.endpointToPubkey.clear();
    service.foregroundAccountPubkey = null;
    service.foregroundScanUntil = 0;
    service.foregroundTransition = Promise.resolve();
    service.handshakeRetryAttempts.clear();
    service.identity = null;
    service.ignoredEndpoints.clear();
    service.incomingChatRequests.forEach((request) => clearTimeout(request.timer));
    service.incomingChatRequests.clear();
    service.pendingForegroundScanAccount = null;
    service.references = 0;
    service.sessionStarted = false;
    service.signalPeerPubkeys.clear();
    proximitySessionStore.getState().resetSession();
    jest.useRealTimers();
  });

  it('marks a missing signal stale, then removes it 15 seconds after the last signal', () => {
    service.recordDiscovery(peerPubkey, -37, 1_000);

    jest.advanceTimersByTime(5_000);
    expect(proximitySessionStore.getState().discoveries[peerPubkey]?.signalFresh).toBe(false);

    jest.advanceTimersByTime(9_999);
    expect(proximitySessionStore.getState().discoveries[peerPubkey]).toBeDefined();

    jest.advanceTimersByTime(1);
    expect(proximitySessionStore.getState().discoveries[peerPubkey]).toBeUndefined();
  });

  it('does not extend visibility when a connection closes', () => {
    service.recordDiscovery(peerPubkey, -42, 1_000);

    jest.advanceTimersByTime(10_000);
    service.releasePeerDiscovery(peerPubkey);
    jest.advanceTimersByTime(4_999);
    expect(proximitySessionStore.getState().discoveries[peerPubkey]).toBeDefined();

    jest.advanceTimersByTime(1);
    expect(proximitySessionStore.getState().discoveries[peerPubkey]).toBeUndefined();
  });

  it('restarts the 15-second window when a new signal arrives', () => {
    service.recordDiscovery(peerPubkey, -50, 1_000);
    jest.advanceTimersByTime(10_000);

    service.recordDiscovery(peerPubkey, -40, 1_010);
    jest.advanceTimersByTime(14_999);
    expect(proximitySessionStore.getState().discoveries[peerPubkey]).toBeDefined();

    jest.advanceTimersByTime(1);
    expect(proximitySessionStore.getState().discoveries[peerPubkey]).toBeUndefined();
  });

  it('requests one bounded scan for each foreground transition', async () => {
    const originalApplyForegroundState = service.applyForegroundState;
    const pendingScans: (string | null)[] = [];
    service.applyForegroundState = async () => {
      pendingScans.push(service.pendingForegroundScanAccount);
      service.pendingForegroundScanAccount = null;
    };

    try {
      await service.setForegroundState('account-a', true);
      await service.setForegroundState('account-a', true);
      await service.setForegroundState('account-a', false);
      await service.setForegroundState('account-a', true);

      expect(pendingScans).toEqual(['account-a', null, null, 'account-a']);
    } finally {
      service.applyForegroundState = originalApplyForegroundState;
    }
  });

  it('keeps the foreground scan active until its bounded window ends', async () => {
    const originalScan = service.scan;
    const scan = jest.fn(async () => {});
    service.scan = scan;
    service.accountPubkey = 'account-a';
    service.foregroundAccountPubkey = 'account-a';
    service.pendingForegroundScanAccount = 'account-a';
    service.sessionStarted = true;

    try {
      await service.reconcileScanning();
      expect(scan).toHaveBeenCalledWith(10_000);
      expect(service.activeForegroundScanAccount).toBe('account-a');

      await service.reconcileScanning();
      jest.advanceTimersByTime(9_999);
      await service.reconcileScanning();
      expect(scan).toHaveBeenCalledTimes(1);

      jest.advanceTimersByTime(1);
      await service.reconcileScanning();
      expect(service.activeForegroundScanAccount).toBeNull();
    } finally {
      service.scan = originalScan;
    }
  });

  it('keeps matching scan signals after a duplicate Central link is discarded', () => {
    const endpointId = 'c:device';
    const profile = stubProfile();
    service.surfaceProfile(endpointId, profile, -50);
    service.endpointProfiles.delete(endpointId);
    service.surfaceProfile('p:device', profile, 0);
    service.connectedEndpoints.add('p:device');
    service.endpointContexts.set('p:device', { phase: 'ready' });
    service.endpointToPubkey.set('p:device', peerPubkey);

    jest.advanceTimersByTime(10_000);
    service.onSignal({ endpointId, rssi: -40 });
    jest.advanceTimersByTime(14_999);

    expect(proximitySessionStore.getState().discoveries[peerPubkey]?.rssi).toBe(-46);
    jest.advanceTimersByTime(1);
    expect(proximitySessionStore.getState().discoveries[peerPubkey]).toBeUndefined();
  });

  it('ignores cached scan callbacks after every endpoint has disconnected', () => {
    const endpointId = 'c:device';
    const profile = stubProfile();
    service.surfaceProfile(endpointId, profile, -50);
    service.endpointProfiles.delete(endpointId);

    jest.advanceTimersByTime(10_000);
    service.onSignal({ endpointId, rssi: -40 });
    jest.advanceTimersByTime(5_000);

    expect(proximitySessionStore.getState().discoveries[peerPubkey]).toBeUndefined();
  });

  it('does not treat a profile received over a connection as a radio signal', () => {
    service.surfaceProfile(
      'p:device',
      stubProfile(),
      0,
    );

    expect(proximitySessionStore.getState().peers[peerPubkey]).toMatchObject({
      deviceStatus: 'offline',
      connectionStatus: 'disconnected',
    });
    expect(proximitySessionStore.getState().discoveries[peerPubkey]).toBeUndefined();
  });

  it('updates a repeated profile without extending radio visibility', async () => {
    const endpointId = 'c:device';
    const publicKey = new Uint8Array([
      0x79, 0xbe, 0x66, 0x7e, 0xf9, 0xdc, 0xbb, 0xac, 0x55, 0xa0, 0x62,
      0x95, 0xce, 0x87, 0x0b, 0x07, 0x02, 0x9b, 0xfc, 0xdb, 0x2d, 0xce,
      0x28, 0xd9, 0x59, 0xf2, 0x81, 0x5b, 0x16, 0xf8, 0x17, 0x98,
    ]);
    const pubkey = Array.from(publicKey, (byte) => byte.toString(16).padStart(2, '0')).join('');
    service.identity = { proximityPubkey: '22'.repeat(32) };

    await service.onPeer({
      endpointId,
      profile: encodeProfile(signedProfile('Old name')),
      rssi: -40,
    });
    jest.advanceTimersByTime(10_000);
    await service.onPeer({
      endpointId,
      profile: encodeProfile(signedProfile('New name')),
      rssi: -40,
    });

    expect(proximitySessionStore.getState().peers[pubkey]?.displayName).toBe('New name');
    jest.advanceTimersByTime(5_000);
    expect(proximitySessionStore.getState().discoveries[pubkey]).toBeUndefined();
  });

  it('advertises support for authenticated profile updates', () => {
    service.identity = { proximityPubkey: '22'.repeat(32), displayName: 'Local' };

    expect(service.localProfile()).toMatchObject({
      name: 'Local',
      capabilities: PROXIMITY_SUPPORTED_CAPABILITIES,
    });
  });

  it('notifies only ready peers that negotiated profile updates', () => {
    const originalSendSecure = service.sendSecure;
    const sendSecure = jest.fn(
      async (
        _context: unknown,
        _type: ProximityPacketType,
        _payload: Uint8Array,
      ) => undefined,
    );
    service.sendSecure = sendSecure;
    service.endpointContexts.set('c:new', {
      phase: 'ready',
      selectedCapabilities: PROXIMITY_SUPPORTED_CAPABILITIES,
    });
    service.endpointContexts.set('c:old', {
      phase: 'ready',
      selectedCapabilities: 1n,
    });
    service.endpointContexts.set('c:connecting', {
      phase: 'awaiting_access',
      selectedCapabilities: PROXIMITY_SUPPORTED_CAPABILITIES,
    });

    try {
      service.notifyReadyPeersOfProfile('New name');

      expect(sendSecure).toHaveBeenCalledTimes(1);
      expect(sendSecure.mock.calls[0]?.[1]).toBe(ProximityPacketType.ProfileUpdate);
      expect(decodeProfileUpdate(sendSecure.mock.calls[0]?.[2] ?? new Uint8Array())).toBe(
        'New name',
      );
    } finally {
      service.sendSecure = originalSendSecure;
    }
  });

  it('applies an authenticated profile update without replacing a private nickname', async () => {
    const updates: Record<string, unknown>[] = [];
    const run = jest.fn(async () => undefined);
    const tx = {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: () => ({ get: async () => ({ nickname: 'My friend' }) }),
          }),
        }),
      }),
      update: () => ({
        set: (values: Record<string, unknown>) => {
          updates.push(values);
          return { where: () => ({ run }) };
        },
      }),
    };
    const database = db as unknown as {
      transaction?: (task: (transaction: typeof tx) => Promise<void>) => Promise<void>;
    };
    const originalTransaction = database.transaction;
    database.transaction = async (task) => task(tx);
    service.accountPubkey = 'account-a';
    const context = {
      endpointId: 'c:device',
      phase: 'ready' as const,
      peerPubkey,
      selectedCapabilities: PROXIMITY_CAPABILITY_PROFILE_UPDATE,
      profile: stubProfile(
        new Uint8Array(32).fill(0x11),
        'Old name',
        PROXIMITY_SUPPORTED_CAPABILITIES,
      ),
    };
    service.endpointContexts.set(context.endpointId, context);

    try {
      await service.handleProfileUpdate(context, encodeProfileUpdate('New name'));

      expect(context.profile.name).toBe('New name');
      expect(updates).toEqual([
        expect.objectContaining({ displayName: 'New name' }),
        { name: 'My friend' },
      ]);
      expect(proximitySessionStore.getState().peers[peerPubkey]?.displayName).toBe('New name');
    } finally {
      database.transaction = originalTransaction;
    }
  });

  it('releases stale native suppression when an explicit request sees its stored endpoint', () => {
    const transport = platform.proximityTransport;
    const available = jest.spyOn(transport, 'isAvailable').mockReturnValue(true);
    const refresh = jest.spyOn(transport, 'refreshPeerProfileAsync').mockResolvedValue();
    proximitySessionStore.getState().upsertPeer({
      proximityPubkey: peerPubkey,
      endpointId: 'p:device',
      displayName: 'Peer',
      rssi: 0,
      lastSeenAt: 0,
      deviceStatus: 'offline',
      connectionStatus: 'connecting',
      connectionFailure: null,
    });
    service.pendingChatRequests.set(peerPubkey, {});

    try {
      service.onSignal({ endpointId: 'c:device', rssi: -44 });

      expect(refresh).toHaveBeenCalledWith('c:device');
    } finally {
      service.pendingChatRequests.delete(peerPubkey);
      available.mockRestore();
      refresh.mockRestore();
    }
  });

  it('makes a suppressed Central endpoint eligible after its Peripheral link is lost', () => {
    const endpointId = 'c:device';
    service.signalPeerPubkeys.set(endpointId, peerPubkey);
    service.ignoredEndpoints.add(endpointId);

    service.reconcilePeerAvailability(peerPubkey);

    expect(service.ignoredEndpoints.has(endpointId)).toBe(false);
  });

  it('keeps the canonical access exchange while its duplicate link closes', () => {
    const transport = platform.proximityTransport;
    const available = jest.spyOn(transport, 'isAvailable').mockReturnValue(true);
    const refresh = jest.spyOn(transport, 'refreshPeerProfileAsync').mockResolvedValue();
    const endpointId = 'c:winner';
    const context = {
      endpointId,
      generation: 12,
      phase: 'awaiting_access',
    };
    const duplicate = {
      endpointId: 'p:loser',
      generation: 4,
      phase: 'electing' as 'electing' | 'closed',
      peerPubkey,
    };
    service.canonicalEndpoints.set(peerPubkey, endpointId);
    service.endpointContexts.set(endpointId, context);
    service.endpointContexts.set(duplicate.endpointId, duplicate);
    service.endpointToPubkey.set(endpointId, peerPubkey);
    service.endpointToPubkey.set(duplicate.endpointId, peerPubkey);
    service.connectedEndpoints.add(endpointId);
    service.connectedEndpoints.add(duplicate.endpointId);
    service.ignoredEndpoints.add(duplicate.endpointId);
    service.signalPeerPubkeys.set(endpointId, peerPubkey);
    proximitySessionStore.getState().upsertPeer({
      proximityPubkey: peerPubkey,
      endpointId,
      displayName: 'Peer',
      rssi: -35,
      lastSeenAt: 1,
      deviceStatus: 'online',
      connectionStatus: 'connecting',
      connectionFailure: null,
    });

    try {
      service.abortEndpoint(duplicate.endpointId, duplicate);

      expect(service.canonicalEndpoints.get(peerPubkey)).toBe(endpointId);
      expect(service.endpointContexts.get(endpointId)).toBe(context);
      expect(duplicate.phase).toBe('closed');
      expect(refresh).not.toHaveBeenCalled();
      expect(proximitySessionStore.getState().peers[peerPubkey]).toMatchObject({
        endpointId,
        connectionStatus: 'connecting',
      });
    } finally {
      available.mockRestore();
      refresh.mockRestore();
    }
  });

  it('closes a known-device access exchange instead of staying connecting forever', () => {
    const context = {
      endpointId: 'c:device',
      role: 'initiator' as const,
      phase: 'awaiting_access',
      accessPurpose: 'session' as const,
    };
    service.endpointContexts.set(context.endpointId, context);
    service.scheduleAccessTimeout(context);

    jest.advanceTimersByTime(9_999);
    expect(context.phase).toBe('awaiting_access');

    jest.advanceTimersByTime(1);
    expect(context.phase).toBe('closed');
  });

  it('allows a first-contact consent request to wait for the user', () => {
    const consoleInfo = jest.spyOn(console, 'info').mockImplementation(() => undefined);
    const context = {
      endpointId: 'c:device',
      role: 'initiator' as const,
      phase: 'awaiting_access',
      accessPurpose: 'chat_request' as const,
    };
    service.endpointContexts.set(context.endpointId, context);
    service.scheduleAccessTimeout(context);

    jest.advanceTimersByTime(59_999);
    expect(context.phase).toBe('awaiting_access');

    jest.advanceTimersByTime(1);
    expect(context.phase).toBe('closed');
    consoleInfo.mockRestore();
  });

  it('allows only one concurrent handshake start for an endpoint', () => {
    const context = {
      endpointId: 'c:device',
      role: 'initiator' as const,
      phase: 'connected',
      accessPurpose: 'session' as const,
    };
    service.endpointContexts.set(context.endpointId, context);

    expect(service.claimInitiatorHandshake(context.endpointId)).toBe(context);
    expect(context.phase).toBe('preparing_client_hello');
    expect(service.claimInitiatorHandshake(context.endpointId)).toBeNull();
  });

  it('does not send from an Initiator context replaced during a UI yield', async () => {
    const transport = platform.proximityTransport;
    const available = jest.spyOn(transport, 'isAvailable').mockReturnValue(true);
    const send = jest.spyOn(transport, 'sendAsync').mockResolvedValue();
    const context = {
      endpointId: 'c:device',
      generation: 1,
      phase: 'preparing_client_hello',
    };
    const replacement = { phase: 'connected', generation: 2 };
    const profile = stubProfile();
    service.identity = { proximityPubkey: '22'.repeat(32) };
    service.endpointContexts.set(context.endpointId, context);

    try {
      const handshake = service.startInitiatorHandshake(context, profile);
      service.endpointContexts.set(context.endpointId, replacement);
      jest.advanceTimersByTime(0);
      await handshake;

      expect(send).not.toHaveBeenCalled();
      expect(context.phase).toBe('preparing_client_hello');
    } finally {
      available.mockRestore();
      send.mockRestore();
    }
  });

  it('does not reset an active handshake when connection delivery is duplicated', () => {
    const context = {
      endpointId: 'p:device',
      role: 'responder' as const,
      phase: 'server_hello_sent',
      accessPurpose: 'session' as const,
      accessSent: false,
    };
    service.connectedEndpoints.add(context.endpointId);
    service.endpointContexts.set(context.endpointId, context);

    service.onConnection({ endpointId: context.endpointId, state: 'connected' });

    expect(service.endpointContexts.get(context.endpointId)).toBe(context);
    expect(context.phase).toBe('server_hello_sent');
  });

  it.each(['connected', 'preparing_client_hello'] as const)(
    'discards a stale handshake packet while a fresh Initiator is %s',
    async (phase) => {
      const context = {
        endpointId: 'c:device',
        generation: 2,
        role: 'initiator' as const,
        phase,
        accessPurpose: 'chat_request' as const,
        accessSent: false,
      };
      const staleClientAuth = encodeClientAuth({
        handshakeId: new Uint8Array(32).fill(1),
        message: new Uint8Array(48),
      });
      service.identity = { proximityPubkey: '22'.repeat(32) };
      service.endpointContexts.set(context.endpointId, context);

      await service.onPacket({
        endpointId: context.endpointId,
        generation: context.generation,
        payload: staleClientAuth,
      });

      expect(context.phase).toBe(phase);
      expect(service.connectionFailures.size).toBe(0);
    },
  );

  it('discards a handshake packet from a previous wire-level attempt', async () => {
    const context = {
      endpointId: 'c:device',
      generation: 2,
      role: 'initiator' as const,
      phase: 'client_hello_sent',
      handshakeId: new Uint8Array(32).fill(2),
      accessPurpose: 'chat_request' as const,
      accessSent: false,
    };
    const staleServerHello = encodeServerHello({
      handshakeId: new Uint8Array(32).fill(1),
      message: new Uint8Array(96),
    });
    service.identity = { proximityPubkey: '22'.repeat(32) };
    service.endpointContexts.set(context.endpointId, context);

    await service.onPacket({
      endpointId: context.endpointId,
      generation: context.generation,
      payload: staleServerHello,
    });

    expect(context.phase).toBe('client_hello_sent');
    expect(service.connectionFailures.size).toBe(0);
  });

  it('lets a newer ClientHello replace an unauthenticated Responder attempt', async () => {
    const originalAcceptClientHello = service.acceptClientHello;
    const acceptClientHello = jest.fn(async () => {});
    service.acceptClientHello = acceptClientHello;
    const context = {
      endpointId: 'p:device',
      role: 'responder' as const,
      phase: 'server_hello_sent',
      handshakeId: new Uint8Array(32).fill(1),
      receivedHandshakePackets: new Map<ProximityPacketType, Uint8Array>(),
    };
    const newerHello = encodeClientHello({
      message: new Uint8Array(32).fill(2),
    });

    try {
      await service.handleHandshakePacket(context, newerHello);

      expect(acceptClientHello).toHaveBeenCalledTimes(1);
      expect(context.phase).toBe('connected');
      expect(context.handshakeId).toBeUndefined();
    } finally {
      service.acceptClientHello = originalAcceptClientHello;
    }
  });

  it('starts a fresh context when a closed endpoint reconnects', () => {
    const context = {
      endpointId: 'c:device',
      role: 'initiator' as const,
      phase: 'closed',
      accessPurpose: 'session' as const,
      accessSent: false,
    };
    service.connectedEndpoints.add(context.endpointId);
    service.endpointContexts.set(context.endpointId, context);
    service.ignoredEndpoints.add(context.endpointId);

    service.onConnection({ endpointId: context.endpointId, state: 'connected' });

    expect(service.endpointContexts.get(context.endpointId)).not.toBe(context);
    expect(service.endpointContexts.get(context.endpointId)?.phase).toBe('connected');
    expect(service.ignoredEndpoints.has(context.endpointId)).toBe(false);
  });

  it('restarts a closed Central endpoint for an explicit outgoing request', async () => {
    const transport = platform.proximityTransport;
    const available = jest.spyOn(transport, 'isAvailable').mockReturnValue(true);
    const originalDisconnect = transport.disconnectAsync;
    const disconnect = jest.fn(async () => {});
    transport.disconnectAsync = disconnect;
    const refresh = jest.spyOn(transport, 'refreshPeerProfileAsync').mockResolvedValue();
    const profile = stubProfile();
    const peripheral = {
      endpointId: 'p:device',
      generation: 1,
      role: 'responder' as const,
      phase: 'closed',
    };
    const central = {
      endpointId: 'c:device',
      generation: 2,
      role: 'initiator' as const,
      phase: 'closed' as const,
    };
    for (const context of [peripheral, central]) {
      service.endpointContexts.set(context.endpointId, context);
      service.endpointProfiles.set(context.endpointId, profile);
      service.connectedEndpoints.add(context.endpointId);
    }

    try {
      expect(service.findConnectedInitiatorEndpoint(peerPubkey)?.[0]).toBe(
        central.endpointId,
      );

      await service.restartClosedInitiator(central, peerPubkey);

      expect(disconnect).toHaveBeenCalledWith(central.endpointId);
      expect(refresh).toHaveBeenCalledWith(central.endpointId);
      expect(service.endpointContexts.has(central.endpointId)).toBe(false);
      expect(service.connectionDiscoveryTimers.has(peerPubkey)).toBe(true);
    } finally {
      const timer = service.connectionDiscoveryTimers.get(peerPubkey);
      if (timer) clearTimeout(timer);
      service.connectionDiscoveryTimers.delete(peerPubkey);
      available.mockRestore();
      transport.disconnectAsync = originalDisconnect;
      refresh.mockRestore();
    }
  });

  it('ignores disconnects and packets from an older native connection generation', async () => {
    const originalOnPacket = service.onPacket;
    const onPacket = jest.fn(async () => {});
    service.onPacket = onPacket;

    try {
      service.onConnection({ endpointId: 'c:device', state: 'connected', generation: 1 });
      service.onConnection({ endpointId: 'c:device', state: 'connected', generation: 2 });
      expect(service.endpointContexts.get('c:device')?.generation).toBe(2);

      service.onConnection({ endpointId: 'c:device', state: 'disconnected', generation: 1 });
      service.enqueuePacket({
        endpointId: 'c:device',
        generation: 1,
        payload: new Uint8Array([1]),
      });
      await Promise.resolve();

      expect(service.endpointContexts.get('c:device')?.generation).toBe(2);
      expect(onPacket).not.toHaveBeenCalled();
    } finally {
      service.onPacket = originalOnPacket;
    }
  });

  it('bounds unauthenticated endpoint contexts before expensive handshakes', () => {
    for (let index = 0; index < 16; index += 1) {
      service.endpointContexts.set(`c:pending-${index}`, {
        phase: 'connected',
        generation: 1,
      });
    }

    service.onConnection({ endpointId: 'c:overflow', state: 'connected', generation: 1 });

    expect(service.endpointContexts.has('c:overflow')).toBe(false);
  });

  it('does not revive a closed Responder beyond the unauthenticated endpoint cap', () => {
    for (let index = 0; index < 16; index += 1) {
      service.endpointContexts.set(`c:pending-${index}`, {
        phase: 'connected',
        generation: 1,
      });
    }
    const closed = {
      endpointId: 'p:closed',
      generation: 1,
      role: 'responder' as const,
      phase: 'closed',
    };
    service.endpointContexts.set(closed.endpointId, closed);

    service.reviveResponderForClientHello({
      endpointId: closed.endpointId,
      generation: closed.generation,
      payload: encodeClientHello({ message: new Uint8Array(32).fill(1) }),
    });

    expect(service.endpointContexts.get(closed.endpointId)).toBe(closed);
  });

  it('does not replace the canonical endpoint after access has started', async () => {
    const current = {
      endpointId: 'p:current',
      phase: 'awaiting_access',
    };
    const late = {
      endpointId: 'c:late',
      phase: 'electing',
    };
    service.identity = { proximityPubkey: 'f'.repeat(64) };
    service.canonicalEndpoints.set(peerPubkey, current.endpointId);
    service.connectedEndpoints.add(current.endpointId);
    service.connectedEndpoints.add(late.endpointId);
    service.endpointToPubkey.set(current.endpointId, peerPubkey);
    service.endpointToPubkey.set(late.endpointId, peerPubkey);
    service.endpointContexts.set(current.endpointId, current);
    service.endpointContexts.set(late.endpointId, late);

    await service.finishElection(peerPubkey);

    expect(service.canonicalEndpoints.get(peerPubkey)).toBe(current.endpointId);
    expect(current.phase).toBe('awaiting_access');
    expect(late.phase).toBe('closed');
  });

  it('does not demote a ready peer when a late duplicate endpoint appears', async () => {
    const originalGetPeerConnectionState = service.getPeerConnectionState;
    const transport = platform.proximityTransport;
    const available = jest.spyOn(transport, 'isAvailable').mockReturnValue(true);
    const preferPeripheral = jest
      .spyOn(transport, 'preferPeripheralAsync')
      .mockResolvedValue();
    const profile = stubProfile();
    const ready = {
      endpointId: 'p:ready',
      generation: 1,
      role: 'responder' as const,
      phase: 'ready',
    };
    const duplicate = {
      endpointId: 'c:late',
      generation: 2,
      role: 'initiator' as const,
      phase: 'connected',
    };
    service.accountPubkey = 'account-a';
    service.identity = { proximityPubkey: '22'.repeat(32) };
    service.getPeerConnectionState = async () => ({
      relationship: 'trusted',
      failure: null,
      displayName: 'Peer',
      lastSeenAt: 1,
    });
    service.endpointProfiles.set(duplicate.endpointId, profile);
    for (const context of [ready, duplicate]) {
      service.endpointContexts.set(context.endpointId, context);
      service.connectedEndpoints.add(context.endpointId);
    }
    service.endpointToPubkey.set(ready.endpointId, peerPubkey);
    proximitySessionStore.getState().upsertPeer({
      proximityPubkey: peerPubkey,
      endpointId: ready.endpointId,
      displayName: 'Peer',
      rssi: -40,
      lastSeenAt: 1,
      deviceStatus: 'online',
      connectionStatus: 'connected',
      connectionFailure: null,
    });

    try {
      await service.maybeStartHandshake(duplicate.endpointId);

      expect(duplicate.phase).toBe('closed');
      expect(proximitySessionStore.getState().peers[peerPubkey]?.connectionStatus).toBe(
        'connected',
      );
      expect(preferPeripheral).toHaveBeenCalledWith(duplicate.endpointId);
    } finally {
      service.getPeerConnectionState = originalGetPeerConnectionState;
      available.mockRestore();
      preferPeripheral.mockRestore();
    }
  });

  it('does not elect a stale identity mapping on an unauthenticated replacement context', async () => {
    const stale = {
      endpointId: 'c:stale',
      phase: 'connected',
    };
    const fresh = {
      endpointId: 'p:fresh',
      generation: 2,
      role: 'responder' as const,
      phase: 'electing',
      accessPurpose: 'session' as const,
      accessSent: false,
    };
    service.identity = { proximityPubkey: 'f'.repeat(64) };
    for (const context of [stale, fresh]) {
      service.connectedEndpoints.add(context.endpointId);
      service.endpointToPubkey.set(context.endpointId, peerPubkey);
      service.endpointContexts.set(context.endpointId, context);
    }

    await service.finishElection(peerPubkey);

    expect(service.canonicalEndpoints.get(peerPubkey)).toBe(fresh.endpointId);
    expect(fresh.phase).toBe('awaiting_access');
    const timer = (fresh as typeof fresh & { timer?: ReturnType<typeof setTimeout> }).timer;
    if (timer) clearTimeout(timer);
  });

  it('stores a caught failure separately from the disconnected state', () => {
    proximitySessionStore.getState().upsertPeer({
      proximityPubkey: peerPubkey,
      endpointId: 'c:device',
      displayName: 'Peer',
      rssi: -40,
      lastSeenAt: 1_000,
      deviceStatus: 'online',
      connectionStatus: 'connecting',
      connectionFailure: null,
    });
    service.connectionFailures.set(peerPubkey, 'failed');

    service.reconcilePeerAvailability(peerPubkey);

    expect(proximitySessionStore.getState().peers[peerPubkey]).toMatchObject({
      connectionStatus: 'disconnected',
      connectionFailure: 'failed',
    });
  });

  it('clears failure metadata when the user explicitly retries', () => {
    proximitySessionStore.getState().upsertPeer({
      proximityPubkey: peerPubkey,
      endpointId: 'c:device',
      displayName: 'Peer',
      rssi: -40,
      lastSeenAt: 1_000,
      deviceStatus: 'online',
      connectionStatus: 'disconnected',
      connectionFailure: 'rejected',
    });
    service.connectionFailures.set(peerPubkey, 'rejected');

    service.clearConnectionFailure(peerPubkey);

    expect(service.connectionFailures.has(peerPubkey)).toBe(false);
    expect(proximitySessionStore.getState().peers[peerPubkey]).toMatchObject({
      connectionStatus: 'disconnected',
      connectionFailure: null,
    });
  });

  it('keeps an absent conversation peer disconnected across automatic scan retries', async () => {
    const transport = platform.proximityTransport;
    const available = jest.spyOn(transport, 'isAvailable').mockReturnValue(true);
    const scan = jest.spyOn(transport, 'startScanAsync').mockResolvedValue();
    const start = jest.spyOn(service, 'start').mockResolvedValue();
    const state = jest.spyOn(service, 'getPeerConnectionState').mockResolvedValue({
      relationship: 'trusted',
      failure: null,
    });
    service.accountPubkey = 'account-a';
    service.identity = { proximityPubkey: 'local-peer' };
    service.sessionStarted = true;
    service.surfaceProfile('c:device', stubProfile(), 0);
    const peer = proximitySessionStore.getState().peers[peerPubkey];

    try {
      await proximityService.acquire('account-a', { activePeer: peerPubkey });

      expect(scan).toHaveBeenCalledWith(10_000);
      expect(proximitySessionStore.getState().scanning).toBe(true);
      expect(peer.connectionStatus).toBe('disconnected');

      await jest.advanceTimersByTimeAsync(10_000);
      expect(proximitySessionStore.getState().scanning).toBe(false);
      expect(proximitySessionStore.getState().peers[peerPubkey]).toBe(peer);

      await jest.advanceTimersByTimeAsync(20_000);
      expect(scan).toHaveBeenCalledTimes(2);
      expect(proximitySessionStore.getState().peers[peerPubkey]).toBe(peer);
    } finally {
      available.mockRestore();
      scan.mockRestore();
      start.mockRestore();
      state.mockRestore();
      jest.clearAllTimers();
    }
  });

  it.each(['trusted', 'unlinked'] as const)(
    'keeps an explicit %s request disconnected until a peer can handshake',
    async (relationship) => {
      const scan = jest.spyOn(service, 'scan').mockResolvedValue();
      const state = jest.spyOn(service, 'getPeerConnectionState').mockResolvedValue({
        relationship,
        failure: null,
      });
      service.accountPubkey = 'account-a';
      service.identity = { proximityPubkey: 'local-peer' };
      service.sessionStarted = true;
      service.surfaceProfile('c:device', stubProfile(), 0);

      try {
        const result = service.requestChat('account-a', peerPubkey);
        await jest.advanceTimersByTimeAsync(0);

        expect(scan).toHaveBeenCalledWith(10_000);
        expect(proximitySessionStore.getState().outgoingChatRequests[peerPubkey]).toBe(true);
        expect(proximitySessionStore.getState().peers[peerPubkey]?.connectionStatus).toBe(
          'disconnected',
        );

        await jest.advanceTimersByTimeAsync(60_000);
        await expect(result).resolves.toBe('timeout');
        expect(proximitySessionStore.getState().peers[peerPubkey]).toMatchObject({
          connectionStatus: 'disconnected',
          connectionFailure: 'failed',
        });
      } finally {
        scan.mockRestore();
        state.mockRestore();
      }
    },
  );

  it('shows connecting when a discovered trusted peer starts its handshake', async () => {
    const state = jest.spyOn(service, 'getPeerConnectionState').mockResolvedValue({
      relationship: 'trusted',
      failure: null,
    });
    const handshake = jest.spyOn(service, 'startInitiatorHandshake').mockImplementation(async () => {
      expect(proximitySessionStore.getState().peers[peerPubkey]?.connectionStatus).toBe(
        'connecting',
      );
    });
    service.accountPubkey = 'account-a';
    service.surfaceProfile('c:device', stubProfile(), -40);
    service.onConnection({ endpointId: 'c:device', state: 'connected', generation: 1 });

    try {
      expect(proximitySessionStore.getState().peers[peerPubkey]?.connectionStatus).toBe(
        'disconnected',
      );
      await service.retryFailedConnection('account-a', peerPubkey, false);
      expect(handshake).toHaveBeenCalledTimes(1);
    } finally {
      state.mockRestore();
      handshake.mockRestore();
    }
  });

  it('keeps a trusted rejection idle until the user explicitly retries', async () => {
    const originalGetPeerConnectionState = service.getPeerConnectionState;
    service.getPeerConnectionState = async () => ({
      relationship: 'trusted',
      failure: 'rejected',
      displayName: 'Peer',
      lastSeenAt: 1_000,
    });

    try {
      await service.retryFailedConnection('account-a', peerPubkey, false);

      expect(proximitySessionStore.getState().peers[peerPubkey]).toMatchObject({
        deviceStatus: 'offline',
        connectionStatus: 'disconnected',
        connectionFailure: 'rejected',
      });
      expect(service.connectionFailures.get(peerPubkey)).toBe('rejected');
    } finally {
      service.getPeerConnectionState = originalGetPeerConnectionState;
    }
  });

  it('keeps an explicit trusted retry pending so the pairing code sheet opens', async () => {
    const originalGetPeerConnectionState = service.getPeerConnectionState;
    const originalRetryFailedConnection = service.retryFailedConnection;
    const originalReconcileScanning = service.reconcileScanning;
    service.accountPubkey = 'account-a';
    service.identity = { proximityPubkey: 'local-peer' };
    service.sessionStarted = true;
    service.getPeerConnectionState = async () => ({
      relationship: 'trusted',
      failure: 'rejected',
      displayName: 'Peer',
      lastSeenAt: 1_000,
    });
    service.retryFailedConnection = async () => {};
    service.reconcileScanning = async () => {};

    try {
      const result = service.requestChat('account-a', peerPubkey);
      await Promise.resolve();
      await Promise.resolve();

      expect(service.pendingChatRequests.has(peerPubkey)).toBe(true);
      expect(proximitySessionStore.getState().outgoingChatRequests[peerPubkey]).toBe(true);

      service.finishChatRequest(peerPubkey, 'accepted');
      await expect(result).resolves.toBe('accepted');
      expect(proximitySessionStore.getState().outgoingChatRequests[peerPubkey]).toBeUndefined();
    } finally {
      service.getPeerConnectionState = originalGetPeerConnectionState;
      service.retryFailedConnection = originalRetryFailedConnection;
      service.reconcileScanning = originalReconcileScanning;
    }
  });

  it('keeps discovery separate after a peer connection is removed', async () => {
    const profile = stubProfile();
    service.surfaceProfile('c:device', profile, -40);

    await service.revokePeer(peerPubkey);
    service.surfaceProfile('c:device', profile, -39);

    expect(proximitySessionStore.getState().peers[peerPubkey]).toMatchObject({
      deviceStatus: 'online',
      connectionStatus: 'disconnected',
      connectionFailure: null,
    });
  });

  it('sends an authenticated close before removing a live relationship', async () => {
    const originalSendSecure = service.sendSecure;
    const sendSecure = jest.fn(async () => {});
    service.sendSecure = sendSecure;
    const context = {
      endpointId: 'c:device',
      role: 'initiator' as const,
      phase: 'ready' as 'ready' | 'closed',
      peerPubkey,
      secure: { destroy: jest.fn() },
    };
    service.connectedEndpoints.add(context.endpointId);
    service.endpointToPubkey.set(context.endpointId, peerPubkey);
    service.endpointContexts.set(context.endpointId, context);

    try {
      await service.revokePeer(peerPubkey);

      expect(sendSecure).toHaveBeenCalledWith(
        context,
        ProximityPacketType.Close,
        encodeClose(ProximityErrorCode.AccessDenied),
      );
      expect(context.phase).toBe('closed');
    } finally {
      service.sendSecure = originalSendSecure;
    }
  });

  it('retries a conflicting Initiator handshake with a fresh physical link', () => {
    const context = {
      endpointId: 'c:device',
      role: 'initiator' as const,
      phase: 'client_hello_sent',
      peerPubkey,
    };
    service.endpointContexts.set(context.endpointId, context);
    service.connectedEndpoints.add(context.endpointId);
    proximitySessionStore.getState().upsertPeer({
      proximityPubkey: peerPubkey,
      endpointId: context.endpointId,
      displayName: 'Peer',
      rssi: -40,
      lastSeenAt: 1_000,
      deviceStatus: 'online',
      connectionStatus: 'connecting',
      connectionFailure: null,
    });
    service.sessionStarted = true;

    service.recoverFreshHandshake(context);

    expect(context.phase).toBe('closed');
    expect(service.handshakeRetryAttempts.get(peerPubkey)).toBe(1);
    expect(service.connectionFailures.has(peerPubkey)).toBe(false);

    jest.advanceTimersByTime(400);
    expect(service.connectionDiscoveryTimers.has(peerPubkey)).toBe(false);
    expect(proximitySessionStore.getState().peers[peerPubkey]).toMatchObject({
      connectionStatus: 'disconnected',
      connectionFailure: null,
    });
  });

  it('keeps a declined secure session briefly and resends access on explicit retry', async () => {
    const transport = platform.proximityTransport;
    const available = jest.spyOn(transport, 'isAvailable').mockReturnValue(true);
    const send = jest.spyOn(transport, 'sendAsync').mockResolvedValue();
    const context: RejectedAccessContext = {
      endpointId: 'c:device',
      peerPubkey,
      role: 'initiator',
      phase: 'awaiting_access',
      accessPurpose: 'chat_request',
      accessSent: true,
      secure: {
        seal: jest.fn(async () => Uint8Array.of(0x10)),
        destroy: jest.fn(),
      },
    };
    service.endpointContexts.set(context.endpointId, context);
    service.surfaceProfile(context.endpointId, stubProfile(), 0);

    try {
      service.holdRejectedAccess(context);
      expect(context.phase).toBe('access_rejected');

      jest.advanceTimersByTime(59_999);
      expect(context.phase).toBe('access_rejected');

      await expect(service.resumeRejectedAccess(context)).resolves.toBe(true);
      expect(context.phase).toBe('awaiting_access');
      expect(context.accessPurpose).toBe('chat_request');
      expect(context.accessSent).toBe(true);
      expect(proximitySessionStore.getState().peers[peerPubkey]?.connectionStatus).toBe(
        'connecting',
      );
      expect(context.secure.seal).toHaveBeenCalledWith(
        ProximityPacketType.AccessRequest,
        new Uint8Array(),
      );
      expect(send).toHaveBeenCalledWith(context.endpointId, Uint8Array.of(0x10));
    } finally {
      available.mockRestore();
      send.mockRestore();
      service.endpointSends.clear();
    }
  });

  it('closes a declined secure session after the retry grace period', () => {
    const context: RejectedAccessContext = {
      endpointId: 'p:device',
      role: 'responder',
      phase: 'awaiting_access',
      accessPurpose: 'session',
      accessSent: false,
      secure: {
        seal: jest.fn(async () => new Uint8Array()),
        destroy: jest.fn(),
      },
    };
    service.endpointContexts.set(context.endpointId, context);

    service.holdRejectedAccess(context);
    jest.advanceTimersByTime(60_000);

    expect(context.phase).toBe('closed');
    expect(context.secure.destroy).toHaveBeenCalledTimes(1);
  });

  it('presents a new incoming request when a declined responder receives a retry', async () => {
    const requestId = '33'.repeat(32);
    const originalGetPeerConnectionState = service.getPeerConnectionState;
    service.getPeerConnectionState = async () => ({
      relationship: 'unlinked',
      failure: null,
    });
    service.accountPubkey = 'account-a';
    const context: IncomingAccessContext = {
      endpointId: 'p:device',
      role: 'responder',
      phase: 'access_rejected',
      accessPurpose: 'session',
      accessSent: false,
      peerPubkey,
      profile: stubProfile(),
      secure: {
        sessionId: new Uint8Array(32).fill(0x33),
        seal: jest.fn(async () => new Uint8Array()),
        destroy: jest.fn(),
      },
    };
    service.endpointContexts.set(context.endpointId, context);

    try {
      await service.handleAccessRequest(context, new Uint8Array());

      expect(context.phase).toBe('awaiting_access');
      expect(proximitySessionStore.getState().incomingChatRequests).toEqual([
        {
          requestId,
          peerPubkey,
          displayName: 'Peer',
        },
      ]);
    } finally {
      service.removeIncomingChatRequest(requestId);
      service.getPeerConnectionState = originalGetPeerConnectionState;
    }
  });

  it('lets an authenticated access request finish the Responder election', async () => {
    const requestId = '66'.repeat(32);
    const originalGetPeerConnectionState = service.getPeerConnectionState;
    service.getPeerConnectionState = async () => ({
      relationship: 'unlinked',
      failure: null,
    });
    service.accountPubkey = 'account-a';
    service.identity = { proximityPubkey: 'f'.repeat(64) };
    const context = {
      endpointId: 'p:device',
      generation: 1,
      role: 'responder' as const,
      phase: 'electing',
      accessPurpose: 'session' as const,
      accessSent: false,
      peerPubkey,
      profile: stubProfile(),
      secure: {
        sessionId: new Uint8Array(32).fill(0x66),
        matchesRecordSession: jest.fn(() => true),
        open: jest.fn(async () => ({
          type: ProximityPacketType.AccessRequest,
          payload: new Uint8Array(),
        })),
        destroy: jest.fn(),
      },
    };
    service.endpointContexts.set(context.endpointId, context);
    service.connectedEndpoints.add(context.endpointId);
    service.endpointToPubkey.set(context.endpointId, peerPubkey);

    try {
      await service.onPacket({
        endpointId: context.endpointId,
        generation: context.generation,
        payload: new Uint8Array([1]),
      });

      expect(context.phase).toBe('awaiting_access');
      expect(proximitySessionStore.getState().incomingChatRequests).toEqual([
        { requestId, peerPubkey, displayName: 'Peer' },
      ]);
    } finally {
      service.removeIncomingChatRequest(requestId);
      service.getPeerConnectionState = originalGetPeerConnectionState;
    }
  });

  it('rejects a blocked peer without presenting an approval request', async () => {
    const originalGetPeerConnectionState = service.getPeerConnectionState;
    const originalSendSecure = service.sendSecure;
    const sendSecure = jest.fn(async () => {});
    service.getPeerConnectionState = async () => ({
      relationship: 'blocked',
      failure: null,
    });
    service.sendSecure = sendSecure;
    service.accountPubkey = 'account-a';
    const context: IncomingAccessContext = {
      endpointId: 'p:device',
      role: 'responder',
      phase: 'awaiting_access',
      accessPurpose: 'chat_request',
      accessSent: false,
      peerPubkey,
      profile: stubProfile(),
      secure: {
        sessionId: new Uint8Array(32).fill(0x55),
        seal: jest.fn(async () => new Uint8Array()),
        destroy: jest.fn(),
      },
    };
    service.endpointContexts.set(context.endpointId, context);

    try {
      await service.handleAccessRequest(context, new Uint8Array());

      expect(sendSecure).toHaveBeenCalledWith(
        context,
        ProximityPacketType.AccessResult,
        encodeAccessResult(ProximityAccessDecision.Blocked),
      );
      expect(proximitySessionStore.getState().incomingChatRequests).toEqual([]);
      expect(context.phase).toBe('closed');
    } finally {
      service.getPeerConnectionState = originalGetPeerConnectionState;
      service.sendSecure = originalSendSecure;
    }
  });

  it('does not mark the Responder as rejected when they decline a request', async () => {
    const requestId = '44'.repeat(32);
    const originalSendSecure = service.sendSecure;
    service.sendSecure = jest.fn(async () => {});
    service.accountPubkey = 'account-a';
    const context: IncomingAccessContext = {
      endpointId: 'p:device',
      role: 'responder',
      phase: 'awaiting_access',
      accessPurpose: 'chat_request',
      accessSent: false,
      peerPubkey,
      profile: stubProfile(),
      secure: {
        sessionId: new Uint8Array(32).fill(0x44),
        seal: jest.fn(async () => new Uint8Array()),
        destroy: jest.fn(),
      },
    };
    service.endpointContexts.set(context.endpointId, context);
    proximitySessionStore.getState().upsertPeer({
      proximityPubkey: peerPubkey,
      endpointId: context.endpointId,
      displayName: 'Peer',
      rssi: -40,
      lastSeenAt: 1_000,
      deviceStatus: 'online',
      connectionStatus: 'connecting',
      connectionFailure: null,
    });
    proximitySessionStore.getState().addIncomingChatRequest({
      requestId,
      peerPubkey,
      displayName: 'Peer',
    });
    service.incomingChatRequests.set(requestId, {
      requestId,
      endpointId: context.endpointId,
      peerPubkey,
      displayName: 'Peer',
      timer: setTimeout(() => {}, 60_000),
    });

    try {
      await service.respondToChatRequest(requestId, false);

      expect(service.connectionFailures.has(peerPubkey)).toBe(false);
      expect(proximitySessionStore.getState().peers[peerPubkey]).toMatchObject({
        connectionStatus: 'disconnected',
        connectionFailure: null,
      });
    } finally {
      service.sendSecure = originalSendSecure;
      service.removeIncomingChatRequest(requestId);
    }
  });

  it('serializes inbound packets for each physical endpoint', async () => {
    const originalOnPacket = service.onPacket;
    const order: string[] = [];
    let releaseFirst: () => void = () => {};
    service.onPacket = async (event) => {
      const packet = String(event.packet);
      order.push(`start:${packet}`);
      if (packet === 'first') {
        await new Promise<void>((resolve) => {
          releaseFirst = resolve;
        });
      }
      order.push(`end:${packet}`);
    };

    try {
      service.enqueuePacket({ endpointId: 'c:device', packet: 'first' });
      service.enqueuePacket({ endpointId: 'c:device', packet: 'second' });
      await Promise.resolve();
      await Promise.resolve();
      expect(order).toEqual(['start:first']);

      const pending = service.endpointReceives.get('c:device');
      releaseFirst();
      await pending;
      expect(order).toEqual(['start:first', 'end:first', 'start:second', 'end:second']);
    } finally {
      service.onPacket = originalOnPacket;
      service.endpointReceives.clear();
    }
  });

  it('drops a queued packet when its endpoint context has been replaced', async () => {
    const originalOnPacket = service.onPacket;
    const onPacket = jest.fn(async () => {});
    service.onPacket = onPacket;
    const oldContext = { phase: 'client_hello_sent' };
    service.endpointContexts.set('c:device', oldContext);

    try {
      service.enqueuePacket({ endpointId: 'c:device', payload: new Uint8Array([1]) });
      service.endpointContexts.set('c:device', { phase: 'connected' });
      await service.endpointReceives.get('c:device');

      expect(onPacket).not.toHaveBeenCalled();
    } finally {
      service.onPacket = originalOnPacket;
      service.endpointReceives.clear();
    }
  });

  it('revives a closed Responder when a new ClientHello reuses its native generation', async () => {
    const originalOnPacket = service.onPacket;
    const onPacket = jest.fn(async () => {});
    service.onPacket = onPacket;
    const closed = {
      endpointId: 'p:device',
      generation: 1,
      role: 'responder' as const,
      phase: 'closed',
    };
    service.endpointContexts.set(closed.endpointId, closed);
    service.ignoredEndpoints.add(closed.endpointId);

    try {
      service.enqueuePacket({
        endpointId: closed.endpointId,
        generation: closed.generation,
        payload: encodeClientHello({ message: new Uint8Array(32).fill(1) }),
      });
      await service.endpointReceives.get(closed.endpointId);

      const revived = service.endpointContexts.get(closed.endpointId);
      expect(revived).not.toBe(closed);
      expect(revived).toMatchObject({
        generation: closed.generation,
        role: 'responder',
        phase: 'connected',
      });
      expect(service.ignoredEndpoints.has(closed.endpointId)).toBe(false);
      expect(onPacket).toHaveBeenCalledTimes(1);
    } finally {
      service.onPacket = originalOnPacket;
      service.endpointReceives.clear();
    }
  });

  it('pipelines secure record sealing while preserving transport FIFO order', async () => {
    const transport = platform.proximityTransport;
    const available = jest.spyOn(transport, 'isAvailable').mockReturnValue(true);
    const order: string[] = [];
    let releaseFirstWrite: () => void = () => {};
    const firstWriteBlocked = new Promise<void>((resolve) => {
      releaseFirstWrite = resolve;
    });
    let markSecondSealed: () => void = () => {};
    const secondSealed = new Promise<void>((resolve) => {
      markSecondSealed = resolve;
    });
    const send = jest.spyOn(transport, 'sendAsync').mockImplementation(async (_endpoint, packet) => {
      const sequence = packet[0];
      order.push(`send:${sequence}`);
      if (sequence === 0) await firstWriteBlocked;
    });
    let nextSequence = 0;
    const context = {
      endpointId: 'c:device',
      generation: 1,
      phase: 'ready' as const,
      secure: {
        seal: jest.fn(async () => {
          const sequence = nextSequence;
          nextSequence += 1;
          order.push(`seal:${sequence}`);
          if (sequence === 1) markSecondSealed();
          return Uint8Array.of(sequence);
        }),
      },
    };
    service.endpointContexts.set(context.endpointId, context);
    let writes: Promise<void>[] = [];

    try {
      const first = service.sendSecure(context, ProximityPacketType.Ping, new Uint8Array());
      const second = service.sendSecure(context, ProximityPacketType.Pong, new Uint8Array());
      writes = [first, second];
      await secondSealed;

      expect(order).toContain('seal:0');
      expect(order).toContain('seal:1');
      expect(order).toContain('send:0');
      expect(order).not.toContain('send:1');
      expect(order.indexOf('seal:0')).toBeLessThan(order.indexOf('seal:1'));
      releaseFirstWrite();
      await Promise.all([first, second]);
      expect(order.at(-1)).toBe('send:1');
    } finally {
      releaseFirstWrite();
      await Promise.allSettled(writes);
      available.mockRestore();
      send.mockRestore();
      service.endpointSends.clear();
      service.endpointContexts.clear();
    }
  });

  it('uses the reserved final record to rotate an expiring session', async () => {
    const transport = platform.proximityTransport;
    const available = jest.spyOn(transport, 'isAvailable').mockReturnValue(true);
    const send = jest.spyOn(transport, 'sendAsync').mockResolvedValue();
    const context = {
      endpointId: 'c:device',
      phase: 'ready' as 'ready' | 'closed',
      peerPubkey,
      secure: {
        shouldRotateBeforeSend: jest.fn(() => true),
        seal: jest.fn(async () => Uint8Array.of(9)),
        destroy: jest.fn(),
      },
    };
    service.endpointContexts.set(context.endpointId, context);

    try {
      await expect(
        service.sendSecure(context, ProximityPacketType.Ping, new Uint8Array()),
      ).rejects.toThrow('rotated before sending');

      expect(context.secure.seal).toHaveBeenCalledWith(
        ProximityPacketType.Close,
        encodeClose(ProximityErrorCode.SessionExpired),
      );
      expect(send).toHaveBeenCalledWith(context.endpointId, Uint8Array.of(9));
      expect(context.phase).toBe('closed');
      expect(service.connectionDiscoveryTimers.has(peerPubkey)).toBe(true);
    } finally {
      const timer = service.connectionDiscoveryTimers.get(peerPubkey);
      if (timer) clearTimeout(timer);
      service.connectionDiscoveryTimers.delete(peerPubkey);
      available.mockRestore();
      send.mockRestore();
    }
  });

  it('does not swallow a failed SESSION_EXPIRED close write', async () => {
    const transport = platform.proximityTransport;
    const available = jest.spyOn(transport, 'isAvailable').mockReturnValue(true);
    const send = jest
      .spyOn(transport, 'sendAsync')
      .mockRejectedValue(new Error('Nearby rotation close failed'));
    const context = {
      endpointId: 'c:device',
      generation: 1,
      phase: 'ready' as 'ready' | 'closed',
      secure: {
        shouldRotateBeforeSend: jest.fn(() => true),
        seal: jest.fn(async () => Uint8Array.of(9)),
        destroy: jest.fn(),
      },
    };
    service.endpointContexts.set(context.endpointId, context);

    try {
      await expect(
        service.sendSecure(context, ProximityPacketType.Message, new Uint8Array()),
      ).rejects.toThrow('Nearby rotation close failed');
      expect(context.phase).toBe('closed');
    } finally {
      available.mockRestore();
      send.mockRestore();
    }
  });

  it('does not submit queued secure records after a transport write fails', async () => {
    const transport = platform.proximityTransport;
    const available = jest.spyOn(transport, 'isAvailable').mockReturnValue(true);
    const send = jest
      .spyOn(transport, 'sendAsync')
      .mockRejectedValue(new Error('Nearby transport write failed'));
    let nextSequence = 0;
    const destroy = jest.fn();
    const context = {
      endpointId: 'c:device',
      phase: 'ready' as 'ready' | 'closed',
      secure: {
        seal: jest.fn(async () => Uint8Array.of(nextSequence++)),
        destroy,
      },
    };
    service.endpointContexts.set(context.endpointId, context);

    try {
      const results = await Promise.allSettled([
        service.sendSecure(context, ProximityPacketType.Ping, new Uint8Array()),
        service.sendSecure(context, ProximityPacketType.Pong, new Uint8Array()),
      ]);

      expect(results.map(({ status }) => status)).toEqual(['rejected', 'rejected']);
      expect(context.secure.seal).toHaveBeenCalledTimes(2);
      expect(send).toHaveBeenCalledTimes(1);
      expect(context.phase).toBe('closed');
      expect(destroy).toHaveBeenCalledTimes(1);
    } finally {
      available.mockRestore();
      send.mockRestore();
      service.endpointSends.clear();
      service.endpointContexts.clear();
    }
  });

  it('ignores exact handshake retransmissions and rejects conflicting duplicates', () => {
    const context: {
      receivedHandshakePackets?: Map<ProximityPacketType, Uint8Array>;
    } = {};
    const first = new Uint8Array([1, 2, 3]);

    expect(
      service.claimHandshakePacket(context, ProximityPacketType.ClientHello, first),
    ).toBe(true);
    expect(
      service.claimHandshakePacket(
        context,
        ProximityPacketType.ClientHello,
        new Uint8Array(first),
      ),
    ).toBe(false);
    expect(() =>
      service.claimHandshakePacket(
        context,
        ProximityPacketType.ClientHello,
        new Uint8Array([1, 2, 4]),
      ),
    ).toThrow('Conflicting duplicate handshake packet');
  });

  it('closes and resets a Responder when stale handshake data reaches secure access', async () => {
    const consoleInfo = jest.spyOn(console, 'info').mockImplementation(() => undefined);
    const originalSendSecure = service.sendSecure;
    const sendSecure = jest.fn(async () => {});
    service.sendSecure = sendSecure;
    const claimedClientAuth = encodeClientAuth({
      handshakeId: new Uint8Array(32),
      message: new Uint8Array(48),
    });
    const staleClientAuth = encodeClientAuth({
      handshakeId: new Uint8Array(32),
      message: new Uint8Array(48).fill(1),
    });
    const open = jest.fn();
    const context = {
      endpointId: 'p:device',
      role: 'responder' as const,
      phase: 'awaiting_access' as 'awaiting_access' | 'closed',
      peerPubkey,
      secure: { open, destroy: jest.fn() },
      receivedHandshakePackets: new Map([
        [ProximityPacketType.ClientAuth, claimedClientAuth],
      ]),
    };
    service.identity = { proximityPubkey: '22'.repeat(32) };
    service.endpointContexts.set(context.endpointId, context);

    try {
      await service.onPacket({ endpointId: context.endpointId, payload: staleClientAuth });
      await Promise.resolve();
      await Promise.resolve();

      expect(open).not.toHaveBeenCalled();
      expect(sendSecure).toHaveBeenCalledWith(
        context,
        ProximityPacketType.Close,
        encodeClose(ProximityErrorCode.InvalidHandshake),
      );
      expect(context.phase).toBe('closed');
      expect(service.connectionFailures.has(peerPubkey)).toBe(false);
    } finally {
      service.sendSecure = originalSendSecure;
      consoleInfo.mockRestore();
    }
  });

  it('counts INVALID_HANDSHAKE close reasons in the Initiator retry budget', async () => {
    const context = {
      endpointId: 'c:device',
      role: 'initiator' as const,
      phase: 'awaiting_access' as 'awaiting_access' | 'closed',
      peerPubkey,
      secure: {
        matchesRecordSession: jest.fn(() => true),
        open: jest.fn(async () => ({
          type: ProximityPacketType.Close,
          payload: encodeClose(ProximityErrorCode.InvalidHandshake),
        })),
        destroy: jest.fn(),
      },
    };
    service.identity = { proximityPubkey: '22'.repeat(32) };
    service.endpointContexts.set(context.endpointId, context);

    await service.onPacket({ endpointId: context.endpointId, payload: new Uint8Array([1]) });

    expect(context.phase).toBe('closed');
    expect(service.handshakeRetryAttempts.get(peerPubkey)).toBe(1);
    expect(service.connectionDiscoveryTimers.has(peerPubkey)).toBe(true);
  });

  it('persists ACCESS_DENIED so the removed peer does not reconnect automatically', async () => {
    const context = {
      endpointId: 'c:device',
      generation: 1,
      role: 'initiator' as const,
      phase: 'awaiting_access' as 'awaiting_access' | 'closed',
      peerPubkey,
      secure: {
        matchesRecordSession: jest.fn(() => true),
        open: jest.fn(async () => ({
          type: ProximityPacketType.Close,
          payload: encodeClose(ProximityErrorCode.AccessDenied),
        })),
        destroy: jest.fn(),
      },
    };
    service.identity = { proximityPubkey: '22'.repeat(32) };
    service.endpointContexts.set(context.endpointId, context);

    await service.onPacket({ endpointId: context.endpointId, payload: new Uint8Array([1]) });

    expect(context.phase).toBe('closed');
    expect(service.connectionFailures.get(peerPubkey)).toBe('rejected');
  });

  it('ignores an exact claimed handshake retransmission after secure setup', async () => {
    const clientAuth = encodeClientAuth({
      handshakeId: new Uint8Array(32),
      message: new Uint8Array(48),
    });
    const open = jest.fn();
    const context = {
      endpointId: 'p:device',
      role: 'responder' as const,
      phase: 'ready',
      secure: { open, destroy: jest.fn() },
      receivedHandshakePackets: new Map([[ProximityPacketType.ClientAuth, clientAuth]]),
    };
    service.identity = { proximityPubkey: '22'.repeat(32) };
    service.endpointContexts.set(context.endpointId, context);

    await service.onPacket({ endpointId: context.endpointId, payload: new Uint8Array(clientAuth) });

    expect(open).not.toHaveBeenCalled();
    expect(context.phase).toBe('ready');
    expect(
      service.isClaimedHandshakeRetransmission(
        context,
        new Uint8Array([
          PROXIMITY_VERSION,
          ProximityPacketType.ClientAuth,
          0,
          0,
          0,
          0,
          0,
          1,
        ]),
      ),
    ).toBe(false);
    expect(
      service.isClaimedHandshakeRetransmission(
        context,
        new Uint8Array([PROXIMITY_VERSION, ProximityPacketType.AccessRequest]),
      ),
    ).toBe(false);
  });
});
