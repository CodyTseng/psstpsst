import { and, asc, desc, eq, inArray, isNotNull, like } from 'drizzle-orm';
import { getEventHash, type Event, type EventTemplate } from 'nostr-tools';

import { db } from '@/db/client';
import {
  conversations,
  messageDeliveries,
  messages,
  outbox,
  proximityPeers,
  type PendingPublishPayload,
  type Rumor,
} from '@/db/schema';
import { shortCustomEmojiMessage } from '@/lib/emoji/custom-message';
import { IS_DEVELOPMENT_BUILD } from '@/lib/environment';
import { shortEmojiMessage } from '@/lib/emoji/short-message';
import {
  buildEmojiTag,
  customEmojisFromMessageTags,
  type CustomEmoji,
} from '@/lib/nostr/custom-emoji';
import { normalizeBareNostrUris } from '@/lib/nostr/normalize-content';
import { findFileMeta } from '@/lib/nostr/file-tags';
import { getPTags, getReplyToId, getSubject } from '@/lib/nostr/tags';
import {
  isMessageOrderNewer,
  messageOrderAt,
  withMessageOrderTag,
} from '@/lib/nostr/message-order';
import { resolveDisplayName } from '@/lib/nostr/display-name';
import { platform } from '@/platform';
import type { ProximityTransportPort, ProximityTransportSubscription } from '@/platform';
import { mergeStoredMessageIntoTail } from '@/services/conversation/message-tail-cache';
import { deliveryStatusStore } from '@/services/dm/delivery-status';
import { nextRumorTimestamp, type RumorTimestamp } from '@/services/dm/rumor-clock';
import { buildRumor, KIND_CHAT, KIND_FILE, KIND_REACTION } from '@/services/crypto/nip17-gift-wrap';
import { recordAttachmentMedia, recordEmbeddedMedia } from '@/services/files/media-index.service';
import {
  nearbyFileUploadService,
} from '@/services/files/nearby-file-upload.service';
import { notifyNearbyRemoteAvailable } from '@/services/files/nearby-file-download.service';

import {
  PROXIMITY_CAPABILITY_MESSAGE,
  PROXIMITY_CAPABILITY_FILE_TRANSFER,
  PROXIMITY_CAPABILITY_PROFILE_UPDATE,
  PROXIMITY_MAX_RECORD_SIZE,
  PROXIMITY_SUPPORTED_CAPABILITIES,
  PROXIMITY_VERSION,
  ProximityAccessDecision,
  ProximityErrorCode,
  ProximityMessageStatus,
  ProximityPacketType,
  type ProximityProfile,
  confirmationsEqual,
  decodeAccessResult,
  decodeClientAuth,
  decodeClientHello,
  decodeClientHelloPayload,
  decodeClose,
  decodeHandshakeEnvelope,
  decodeHandshakeId,
  decodeMessageAck,
  decodeFileRemoteAvailable,
  decodeProfile,
  decodeProfileUpdate,
  decodeRumor,
  decodeServerHello,
  decodeServerHelloPayload,
  encodeAccessResult,
  encodeClientAuth,
  encodeClientHello,
  encodeClientHelloPayload,
  encodeClose,
  encodeError,
  encodeMessageAck,
  encodeFileRemoteAvailable,
  encodeProfile,
  encodeProfileUpdate,
  encodeRumor,
  encodeServerHello,
  encodeServerHelloPayload,
  hexToBytes,
  bytesToHex,
} from './proximity-protocol';
import {
  proximityFileTransferService,
  type ProximityFileConnection,
} from './proximity-file-transfer.service';
import { parseNearbyFileOffer } from './proximity-file-offer';
import {
  createNoiseHandshake,
  createNoiseSecureSession,
  destroyNoiseHandshake,
  noiseRemoteStaticKey,
  type ProximityNoiseHandshake,
  type ProximitySecureSession,
  readNoiseMessageA,
  readNoiseMessageB,
  readNoiseMessageC,
  writeNoiseMessageA,
  writeNoiseMessageB,
  writeNoiseMessageC,
} from './proximity-noise';
import {
  ensureProximityIdentity,
  getCachedProximityPubkey,
  hasProximityIdentity,
  type ProximityIdentity,
} from './proximity-identity.service';
import { normalizeProximityDisplayName } from './proximity-display-name';
import { selectCanonicalProximityEndpoint } from './proximity-link-election';
import { resolveNearbySignalTier } from './nearby-signal-tier';
import { getProximityEnabled, setProximityEnabled } from './proximity-preferences';
import { proximityConversationMessageUpdate } from './proximity-conversation-state';
import { proximitySessionStore, type NearbyConnectionFailure } from './proximity-session';

const SCAN_DURATION_MS = 10_000;
const CHAT_SCAN_INTERVAL_MS = 30_000;
const HANDSHAKE_TIMEOUT_MS = 10_000;
const ACCESS_TIMEOUT_MS = 60_000;
const ACK_TIMEOUT_MS = 12_000;
const PING_INTERVAL_MS = 5_000;
const LIVENESS_TIMEOUT_MS = 15_000;
const DUPLICATE_SETTLE_MS = 1_000;
const DISCOVERY_STALE_MS = 5_000;
const DISCOVERY_VISIBILITY_MS = 15_000;
const HANDSHAKE_RETRY_BASE_MS = 400;
const MAX_AUTOMATIC_HANDSHAKE_RETRIES = 3;
const MAX_UNAUTHENTICATED_ENDPOINTS = 16;
const MAX_ENDPOINT_CONTEXTS = 64;
const MAX_INCOMING_CHAT_REQUESTS = 16;
const RETRY_SECONDS = [15, 30, 60, 120, 300] as const;

type EndpointPhase =
  | 'connected'
  | 'preparing_client_hello'
  | 'client_hello_sent'
  | 'server_hello_sent'
  | 'electing'
  | 'awaiting_access'
  | 'access_rejected'
  | 'ready'
  | 'closed';

type EndpointContext = {
  endpointId: string;
  generation: number;
  role: 'initiator' | 'responder';
  phase: EndpointPhase;
  profile?: ProximityProfile;
  peerPubkey?: string;
  handshakeId?: Uint8Array;
  noise?: ProximityNoiseHandshake;
  secure?: ProximitySecureSession;
  selectedCapabilities?: bigint;
  maxRecordSize: number;
  proposedMaxRecordSize?: number;
  accessPurpose: 'session' | 'chat_request';
  accessSent: boolean;
  receivedHandshakePackets?: Map<ProximityPacketType, Uint8Array>;
  lastReceivedAt?: number;
  livenessTimer?: ReturnType<typeof setInterval>;
  timer?: ReturnType<typeof setTimeout>;
};

type PendingChatRequest = {
  peerPubkey: string;
  promise: Promise<ProximityChatRequestResult>;
  resolve(result: ProximityChatRequestResult): void;
  timer: ReturnType<typeof setTimeout>;
};

type IncomingChatRequest = {
  requestId: string;
  endpointId: string;
  peerPubkey: string;
  displayName: string;
  timer: ReturnType<typeof setTimeout>;
};

type ProximityPeerRelationship = 'unlinked' | 'trusted' | 'blocked';
type ProximityPeerConnectionState = {
  relationship: ProximityPeerRelationship;
  failure: NearbyConnectionFailure | null;
  displayName: string | null;
  lastSeenAt: number | null;
};

type AcquireOptions = { activePeer?: string; continuousScan?: boolean };

export type ProximityChatRequestResult = 'accepted' | 'declined' | 'failed' | 'timeout';

class ConflictingHandshakePacketError extends Error {
  constructor() {
    super('Conflicting duplicate handshake packet');
    this.name = 'ConflictingHandshakePacketError';
  }
}

class StaleEndpointContextError extends Error {
  constructor() {
    super('Nearby endpoint context was replaced');
    this.name = 'StaleEndpointContextError';
  }
}

class SessionRotationRequiredError extends Error {
  constructor() {
    super('Nearby secure session rotated before sending the record');
    this.name = 'SessionRotationRequiredError';
  }
}

export class ProximityConversationReadOnlyError extends Error {
  constructor() {
    super('Nearby history belongs to a different proximity identity');
    this.name = 'ProximityConversationReadOnlyError';
  }
}

function nativeModule(): ProximityTransportPort | null {
  const transport = platform.proximityTransport;
  return transport.isAvailable() ? transport : null;
}

function validPubkey(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}

function archivedProximityPeer(rumor: Rumor, localPubkey: string): string | null {
  const recipients = Array.from(new Set(getPTags(rumor.tags)));
  if (rumor.pubkey === localPubkey) {
    return recipients.length === 1 && validPubkey(recipients[0]) ? recipients[0] : null;
  }
  return recipients.length === 1 && recipients[0] === localPubkey && validPubkey(rumor.pubkey)
    ? rumor.pubkey
    : null;
}

function isBytes(value: unknown): value is Uint8Array {
  return value instanceof Uint8Array;
}

function isHandshakePacket(value: Uint8Array): boolean {
  if (value.length < 2 || value[0] !== PROXIMITY_VERSION) return false;
  const type = value[1];
  return (
    type === ProximityPacketType.ClientHello ||
    type === ProximityPacketType.ServerHello ||
    type === ProximityPacketType.ClientAuth
  );
}

function packetTypeForLog(value: Uint8Array): string {
  return value.length >= 2 ? `0x${value[1].toString(16).padStart(2, '0')}` : 'truncated';
}

function yieldToUi(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function boundedProfileName(value: string): string {
  const characters = Array.from(normalizeProximityDisplayName(value));
  while (characters.length > 0 && new TextEncoder().encode(characters.join('')).length > 64) {
    characters.pop();
  }
  return characters.join('');
}

class ProximityService {
  private accountPubkey: string | null = null;
  private identity: ProximityIdentity | null = null;
  private sessionStarted = false;
  private startWork: Promise<void> | null = null;
  private foregroundAccountPubkey: string | null = null;
  private foregroundTransition: Promise<void> = Promise.resolve();
  private pendingForegroundScanAccount: string | null = null;
  private activeForegroundScanAccount: string | null = null;
  private foregroundScanUntil = 0;
  private references = 0;
  private continuousScanReferences = 0;
  private activePeer: string | null = null;
  private subscriptions: ProximityTransportSubscription[] = [];
  private endpointSends = new Map<string, Promise<void>>();
  private endpointSecureSends = new Map<string, Promise<void>>();
  private endpointReceives = new Map<string, Promise<void>>();
  private endpointContexts = new Map<string, EndpointContext>();
  private endpointGenerations = new Map<string, number>();
  private endpointProfiles = new Map<string, ProximityProfile>();
  private explicitUnsuppressionEndpoints = new Set<string>();
  private endpointSignals = new Map<string, number>();
  private signalPeerPubkeys = new Map<string, string>();
  private connectedEndpoints = new Set<string>();
  private ignoredEndpoints = new Set<string>();
  private endpointToPubkey = new Map<string, string>();
  private canonicalEndpoints = new Map<string, string>();
  private electionTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private pendingChatRequests = new Map<string, PendingChatRequest>();
  private incomingChatRequests = new Map<string, IncomingChatRequest>();
  private connectionFailures = new Map<string, NearbyConnectionFailure>();
  private connectionDiscoveryTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private handshakeRetryAttempts = new Map<string, number>();
  private pendingMessages = new Map<string, { peerPubkey: string; endpointId: string }>();
  private ackTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private scanningTimer: ReturnType<typeof setTimeout> | null = null;
  private chatScanTimer: ReturnType<typeof setTimeout> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private retryAt = 0;
  private drainRunning = false;
  private drainRequested = false;
  private discoveryGenerations = new Map<string, number>();
  private discoveryStaleTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private discoveryExpiryTimers = new Map<string, ReturnType<typeof setTimeout>>();
  constructor() {
    nearbyFileUploadService.addRemoteAvailableListener((value) => {
      if (value.accountPubkey === this.accountPubkey) void this.announceRemoteAvailable(value.x);
    });
  }

  async acquire(accountPubkey: string, options: AcquireOptions = {}): Promise<() => void> {
    const { activePeer, continuousScan = false } = options;
    const startsContinuousScan = continuousScan && this.continuousScanReferences === 0;
    if (startsContinuousScan) this.clearDiscoveries();
    this.references += 1;
    if (continuousScan) this.continuousScanReferences += 1;
    if (activePeer) this.activePeer = activePeer;
    try {
      await this.start(accountPubkey, true);
      if (activePeer) await this.retryFailedConnection(accountPubkey, activePeer, false);
      await this.reconcileScanning();
    } catch (error) {
      this.references = Math.max(0, this.references - 1);
      if (continuousScan)
        this.continuousScanReferences = Math.max(0, this.continuousScanReferences - 1);
      throw error;
    }
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.references = Math.max(0, this.references - 1);
      if (continuousScan)
        this.continuousScanReferences = Math.max(0, this.continuousScanReferences - 1);
      if (this.activePeer === activePeer) this.activePeer = null;
      void this.reconcileScanning()
        .then(() => this.stopIfIdle())
        .catch(() => {});
    };
  }

  setForegroundState(accountPubkey: string, isForeground: boolean): Promise<void> {
    if (isForeground) {
      if (this.foregroundAccountPubkey !== accountPubkey) {
        this.pendingForegroundScanAccount = accountPubkey;
        this.activeForegroundScanAccount = null;
        this.foregroundScanUntil = 0;
      }
      this.foregroundAccountPubkey = accountPubkey;
    } else if (this.foregroundAccountPubkey === accountPubkey) {
      this.foregroundAccountPubkey = null;
      if (this.pendingForegroundScanAccount === accountPubkey) {
        this.pendingForegroundScanAccount = null;
      }
      if (this.activeForegroundScanAccount === accountPubkey) {
        this.activeForegroundScanAccount = null;
        this.foregroundScanUntil = 0;
      }
    }
    const transition = this.foregroundTransition
      .catch(() => {})
      .then(() => this.applyForegroundState());
    this.foregroundTransition = transition;
    return transition;
  }

  private async applyForegroundState(): Promise<void> {
    const desired = this.foregroundAccountPubkey;
    if (!desired) {
      if (this.startWork) await this.startWork.catch(() => {});
      if (this.sessionStarted) await this.stop(true);
      return;
    }
    if (!(await getProximityEnabled(desired))) {
      if (this.pendingForegroundScanAccount === desired) this.pendingForegroundScanAccount = null;
      if (this.accountPubkey === desired) await this.stop(true);
      return;
    }
    if (this.accountPubkey && this.accountPubkey !== desired) await this.stop(true);
    if (!(await hasProximityIdentity(desired)) || this.foregroundAccountPubkey !== desired) {
      if (this.pendingForegroundScanAccount === desired) this.pendingForegroundScanAccount = null;
      return;
    }
    await this.start(desired, false);
    await this.reconcileScanning();
  }

  private async start(accountPubkey: string, askPermission: boolean): Promise<void> {
    while (this.startWork) {
      await this.startWork.catch(() => {});
      if (this.accountPubkey === accountPubkey && this.identity && this.sessionStarted) return;
    }
    const work = this.startInternal(accountPubkey, askPermission);
    this.startWork = work;
    try {
      await work;
    } finally {
      if (this.startWork === work) this.startWork = null;
    }
  }

  private async startInternal(accountPubkey: string, askPermission: boolean): Promise<void> {
    if (!(await getProximityEnabled(accountPubkey)))
      throw new Error('Nearby messaging is disabled');
    if (this.accountPubkey && this.accountPubkey !== accountPubkey) await this.stop(true);
    if (this.accountPubkey === accountPubkey && this.identity && this.sessionStarted) return;
    const native = nativeModule();
    if (!native) throw new Error('Nearby messaging requires a development build.');
    this.installListeners(native);
    if (askPermission && !(await native.requestPermissions())) {
      this.removeListeners();
      throw new Error('Bluetooth permission was denied.');
    }
    this.accountPubkey = accountPubkey;
    this.identity = await ensureProximityIdentity(accountPubkey);
    nearbyFileUploadService.start(accountPubkey);
    const failures = await db
      .select({
        proximityPubkey: proximityPeers.proximityPubkey,
        failure: proximityPeers.connectionFailure,
      })
      .from(proximityPeers)
      .where(
        and(
          eq(proximityPeers.accountPubkey, accountPubkey),
          isNotNull(proximityPeers.connectionFailure),
        ),
      );
    this.connectionFailures.clear();
    for (const peer of failures)
      if (peer.failure) this.connectionFailures.set(peer.proximityPubkey, peer.failure);
    await db
      .update(outbox)
      .set({ status: 'queued', nextAttemptAt: Math.floor(Date.now() / 1000) })
      .where(
        and(
          eq(outbox.accountPubkey, accountPubkey),
          eq(outbox.deliveryKind, 'proximity'),
          inArray(outbox.status, ['sending', 'awaiting_ack']),
        ),
      );
    try {
      await native.startAdvertisingAsync(encodeProfile(this.localProfile()));
      this.sessionStarted = true;
    } catch (error) {
      this.removeListeners();
      this.accountPubkey = null;
      this.identity = null;
      throw error;
    }
    void this.drain();
  }

  private localProfile(): ProximityProfile {
    if (!this.identity) throw new Error('Nearby identity is unavailable');
    return {
      version: PROXIMITY_VERSION,
      publicKey: hexToBytes(this.identity.proximityPubkey),
      noisePublicKey: this.identity.noisePubkey,
      noiseBindingSignature: this.identity.noiseBindingSignature,
      capabilities: PROXIMITY_SUPPORTED_CAPABILITIES,
      name: boundedProfileName(this.identity.displayName),
    };
  }

  async refresh(): Promise<void> {
    await this.scan(this.continuousScanReferences > 0 ? 0 : SCAN_DURATION_MS);
  }

  async refreshProfile(): Promise<void> {
    if (!this.accountPubkey) return;
    if (!(await getProximityEnabled(this.accountPubkey))) {
      await this.stop(true);
      return;
    }
    this.identity = await ensureProximityIdentity(this.accountPubkey);
    const native = nativeModule();
    if (!native) return;
    const localProfile = this.localProfile();
    const profile = encodeProfile(localProfile);
    if (this.sessionStarted) await native.updateProfileAsync(profile);
    else {
      await native.startAdvertisingAsync(profile);
      this.sessionStarted = true;
      await this.reconcileScanning();
    }
    this.notifyReadyPeersOfProfile(localProfile.name);
  }

  private notifyReadyPeersOfProfile(name: string): void {
    const payload = encodeProfileUpdate(name);
    for (const context of this.endpointContexts.values()) {
      if (
        context.phase !== 'ready' ||
        ((context.selectedCapabilities ?? 0n) & PROXIMITY_CAPABILITY_PROFILE_UPDATE) === 0n
      ) {
        continue;
      }
      void this.sendSecure(
        context,
        ProximityPacketType.ProfileUpdate,
        payload,
      ).catch(() => {});
    }
  }

  private installListeners(native: ProximityTransportPort): void {
    this.removeListeners();
    this.subscriptions = [
      native.addListener('onPeer', (event) => void this.onPeer(event)),
      native.addListener('onSignal', (event) => this.onSignal(event)),
      native.addListener('onMessage', (event) => this.enqueuePacket(event)),
      native.addListener('onConnection', (event) => this.onConnection(event)),
      native.addListener('onBluetoothState', (event) => {
        if (typeof event.state === 'string')
          proximitySessionStore.getState().setBluetoothState(event.state);
      }),
    ];
  }

  private removeListeners(): void {
    this.subscriptions.forEach((subscription) => subscription.remove());
    this.subscriptions = [];
  }

  private async scan(durationMs: number): Promise<void> {
    const native = nativeModule();
    if (!native || !this.identity) {
      if (IS_DEVELOPMENT_BUILD)
        console.info(
          `[nearby] trace scan skipped native=${String(Boolean(native))} identity=${String(Boolean(this.identity))}`,
        );
      return;
    }
    if (IS_DEVELOPMENT_BUILD)
      console.info(
        `[nearby] trace scan begin duration=${durationMs} session=${String(this.sessionStarted)}`,
      );
    if (this.scanningTimer) clearTimeout(this.scanningTimer);
    this.scanningTimer = null;
    proximitySessionStore.getState().setScanning(true);
    if (durationMs > 0) {
      this.scanningTimer = setTimeout(() => {
        this.scanningTimer = null;
        proximitySessionStore.getState().setScanning(false);
      }, durationMs);
    }
    try {
      await native.startScanAsync(durationMs);
      if (IS_DEVELOPMENT_BUILD) console.info(`[nearby] trace scan submitted duration=${durationMs}`);
    } catch (error) {
      if (IS_DEVELOPMENT_BUILD)
        console.info(
          `[nearby] trace scan failed duration=${durationMs}: ${error instanceof Error ? error.message : String(error)}`,
        );
      throw error;
    }
  }

  private activePeerIsSettled(): boolean {
    if (!this.activePeer) return false;
    const peer = proximitySessionStore.getState().peers[this.activePeer];
    return peer?.connectionStatus === 'connected' || this.connectionFailures.has(this.activePeer);
  }

  private async reconcileScanning(): Promise<void> {
    if (this.chatScanTimer) clearTimeout(this.chatScanTimer);
    this.chatScanTimer = null;
    if (!this.sessionStarted) return;
    if (this.continuousScanReferences > 0) {
      if (this.pendingForegroundScanAccount === this.accountPubkey) {
        this.pendingForegroundScanAccount = null;
      }
      if (this.activeForegroundScanAccount === this.accountPubkey) {
        this.activeForegroundScanAccount = null;
        this.foregroundScanUntil = 0;
      }
      await this.scan(0);
      return;
    }
    if (this.references > 0 && !this.activePeerIsSettled()) {
      if (this.pendingForegroundScanAccount === this.accountPubkey) {
        this.pendingForegroundScanAccount = null;
      }
      if (this.activeForegroundScanAccount === this.accountPubkey) {
        this.activeForegroundScanAccount = null;
        this.foregroundScanUntil = 0;
      }
      await this.scan(SCAN_DURATION_MS);
      this.chatScanTimer = setTimeout(() => {
        this.chatScanTimer = null;
        void this.reconcileScanning().catch(() => {});
      }, CHAT_SCAN_INTERVAL_MS);
      return;
    }
    if (this.pendingForegroundScanAccount === this.accountPubkey) {
      this.pendingForegroundScanAccount = null;
      this.activeForegroundScanAccount = this.accountPubkey;
      this.foregroundScanUntil = Date.now() + SCAN_DURATION_MS;
      await this.scan(SCAN_DURATION_MS);
      return;
    }
    if (
      this.activeForegroundScanAccount === this.accountPubkey &&
      Date.now() < this.foregroundScanUntil
    ) {
      return;
    }
    this.activeForegroundScanAccount = null;
    this.foregroundScanUntil = 0;
    await nativeModule()?.stopScanAsync();
    if (this.scanningTimer) clearTimeout(this.scanningTimer);
    this.scanningTimer = null;
    proximitySessionStore.getState().setScanning(false);
  }

  private onSignal(event: Record<string, unknown>): void {
    if (IS_DEVELOPMENT_BUILD)
      console.info(
        `[nearby] trace signal endpoint=${String(event.endpointId)} rssi=${String(event.rssi)} mapped=${typeof event.endpointId === 'string' ? (this.signalPeerPubkeys.get(event.endpointId)?.slice(0, 8) ?? 'none') : 'none'}`,
      );
    if (
      typeof event.endpointId !== 'string' ||
      typeof event.rssi !== 'number' ||
      !Number.isFinite(event.rssi) ||
      event.rssi === 0 ||
      event.rssi === 127
    )
      return;
    const endpointId = event.endpointId;
    const rssi = Math.round(event.rssi);
    this.endpointSignals.set(endpointId, rssi);
    const profile = this.endpointProfiles.get(endpointId);
    const mappedPubkey = this.signalPeerPubkeys.get(endpointId);
    if (!profile && !mappedPubkey && endpointId.startsWith('c:')) {
      const rawEndpoint = endpointId.slice(2);
      const pendingPeer = Array.from(this.pendingChatRequests.keys()).find((peerPubkey) => {
        const storedEndpoint = proximitySessionStore.getState().peers[peerPubkey]?.endpointId;
        return storedEndpoint?.slice(2) === rawEndpoint;
      });
      if (pendingPeer && !this.explicitUnsuppressionEndpoints.has(endpointId)) {
        this.explicitUnsuppressionEndpoints.add(endpointId);
        if (IS_DEVELOPMENT_BUILD)
          console.info(
            `[nearby] trace signal releases suppression endpoint=${endpointId} peer=${pendingPeer.slice(0, 8)}`,
          );
        void nativeModule()
          ?.refreshPeerProfileAsync(endpointId)
          .catch(() => this.explicitUnsuppressionEndpoints.delete(endpointId));
      }
    }
    const pubkey =
      (profile ? bytesToHex(profile.publicKey) : null) ??
      (mappedPubkey && this.readyEndpoints(mappedPubkey).length > 0 ? mappedPubkey : null);
    if (!pubkey) return;
    const now = Math.floor(Date.now() / 1000);
    const smoothed = this.recordDiscovery(pubkey, rssi, now);
    const peer = proximitySessionStore.getState().peers[pubkey];
    if (peer)
      proximitySessionStore.getState().upsertPeer({
        ...peer,
        rssi: smoothed,
        lastSeenAt: now,
        deviceStatus: 'online',
      });
  }

  private recordDiscovery(pubkey: string, rssi: number, lastSeenAt: number): number {
    const current = proximitySessionStore.getState().discoveries[pubkey];
    const smoothed =
      current == null || current.rssi === 0 ? rssi : Math.round(current.rssi * 0.65 + rssi * 0.35);
    proximitySessionStore.getState().upsertDiscovery({
      proximityPubkey: pubkey,
      rssi: smoothed,
      lastSeenAt,
      signalFresh: true,
      signalTier: resolveNearbySignalTier(smoothed, current?.signalTier),
    });
    const generation = (this.discoveryGenerations.get(pubkey) ?? 0) + 1;
    this.discoveryGenerations.set(pubkey, generation);
    const stale = this.discoveryStaleTimers.get(pubkey);
    if (stale) clearTimeout(stale);
    this.discoveryStaleTimers.set(
      pubkey,
      setTimeout(() => {
        this.discoveryStaleTimers.delete(pubkey);
        if (this.discoveryGenerations.get(pubkey) !== generation) return;
        const discovery = proximitySessionStore.getState().discoveries[pubkey];
        if (discovery)
          proximitySessionStore.getState().upsertDiscovery({ ...discovery, signalFresh: false });
        const peer = proximitySessionStore.getState().peers[pubkey];
        if (peer && !this.hasConnectedEndpoint(pubkey)) {
          proximitySessionStore.getState().upsertPeer({ ...peer, deviceStatus: 'offline' });
        }
      }, DISCOVERY_STALE_MS),
    );
    const expiry = this.discoveryExpiryTimers.get(pubkey);
    if (expiry) clearTimeout(expiry);
    this.discoveryExpiryTimers.set(
      pubkey,
      setTimeout(() => {
        this.discoveryExpiryTimers.delete(pubkey);
        if (this.discoveryGenerations.get(pubkey) !== generation) return;
        this.discoveryGenerations.delete(pubkey);
        proximitySessionStore.getState().removeDiscovery(pubkey);
      }, DISCOVERY_VISIBILITY_MS),
    );
    return smoothed;
  }

  private clearDiscoveries(): void {
    this.discoveryGenerations.clear();
    this.discoveryStaleTimers.forEach(clearTimeout);
    this.discoveryExpiryTimers.forEach(clearTimeout);
    this.discoveryStaleTimers.clear();
    this.discoveryExpiryTimers.clear();
    proximitySessionStore.getState().clearDiscoveries();
  }

  private releasePeerDiscovery(peerPubkey: string): void {
    const discovery = proximitySessionStore.getState().discoveries[peerPubkey];
    if (!discovery) return;
    const stale = this.discoveryStaleTimers.get(peerPubkey);
    if (stale) clearTimeout(stale);
    this.discoveryStaleTimers.delete(peerPubkey);
    proximitySessionStore.getState().upsertDiscovery({
      ...discovery,
      signalFresh: false,
    });
    const peer = proximitySessionStore.getState().peers[peerPubkey];
    if (peer && !this.hasConnectedEndpoint(peerPubkey)) {
      proximitySessionStore.getState().upsertPeer({ ...peer, deviceStatus: 'offline' });
    }
  }

  private reconcilePeerAvailability(peerPubkey: string): void {
    const canonicalEndpoint = this.canonicalEndpoints.get(peerPubkey);
    const canonicalContext = canonicalEndpoint
      ? this.endpointContexts.get(canonicalEndpoint)
      : undefined;
    const canonicalIsAuthenticated =
      canonicalEndpoint != null &&
      this.authenticatedEndpoints(peerPubkey).includes(canonicalEndpoint);
    if (
      canonicalIsAuthenticated &&
      canonicalContext &&
      canonicalContext.phase !== 'ready'
    ) {
      const peer = proximitySessionStore.getState().peers[peerPubkey];
      if (
        peer &&
        (canonicalContext.phase === 'electing' ||
          canonicalContext.phase === 'awaiting_access')
      ) {
        proximitySessionStore.getState().upsertPeer({
          ...peer,
          endpointId: canonicalEndpoint,
          deviceStatus: 'online',
          connectionStatus: 'connecting',
          connectionFailure: null,
        });
      }
      return;
    }
    const replacement = this.readyEndpoints(peerPubkey).find(
      (endpointId) => !this.ignoredEndpoints.has(endpointId),
    );
    const peer = proximitySessionStore.getState().peers[peerPubkey];
    if (replacement && peer) {
      this.canonicalEndpoints.set(peerPubkey, replacement);
      proximitySessionStore.getState().upsertPeer({
        ...peer,
        endpointId: replacement,
        deviceStatus: 'online',
        connectionStatus: 'connected',
        connectionFailure: null,
      });
      return;
    }
    this.canonicalEndpoints.delete(peerPubkey);
    this.releaseCentralSuppression(peerPubkey);
    if (peer) {
      const discovery = proximitySessionStore.getState().discoveries[peerPubkey];
      proximitySessionStore.getState().upsertPeer({
        ...peer,
        deviceStatus:
          this.hasConnectedEndpoint(peerPubkey) || discovery?.signalFresh ? 'online' : 'offline',
        connectionStatus: 'disconnected',
        connectionFailure: this.connectionFailures.get(peerPubkey) ?? null,
      });
    }
    this.releasePeerDiscovery(peerPubkey);
  }

  private releaseCentralSuppression(peerPubkey: string): void {
    for (const [endpointId, mappedPubkey] of Array.from(this.signalPeerPubkeys)) {
      if (mappedPubkey !== peerPubkey) continue;
      if (endpointId.startsWith('c:')) {
        this.ignoredEndpoints.delete(endpointId);
        void nativeModule()
          ?.refreshPeerProfileAsync(endpointId)
          .catch(() => {});
      }
      this.signalPeerPubkeys.delete(endpointId);
      this.endpointSignals.delete(endpointId);
    }
  }

  private surfaceProfile(endpointId: string, profile: ProximityProfile, rssi: number): void {
    const pubkey = bytesToHex(profile.publicKey);
    if (pubkey === this.identity?.proximityPubkey) return;
    this.endpointProfiles.set(endpointId, profile);
    this.signalPeerPubkeys.set(endpointId, pubkey);
    const now = Math.floor(Date.now() / 1000);
    const existing = proximitySessionStore.getState().peers[pubkey];
    const discovery = proximitySessionStore.getState().discoveries[pubkey];
    const hasSignal = Number.isFinite(rssi) && rssi !== 0 && rssi !== 127;
    const smoothed = hasSignal
      ? this.recordDiscovery(pubkey, rssi, now)
      : (discovery?.rssi ?? existing?.rssi ?? 0);
    proximitySessionStore.getState().upsertPeer({
      proximityPubkey: pubkey,
      endpointId: existing?.endpointId || endpointId,
      displayName: resolveDisplayName(pubkey, { displayName: profile.name }),
      rssi: smoothed,
      lastSeenAt: now,
      deviceStatus: hasSignal ? 'online' : (existing?.deviceStatus ?? 'offline'),
      connectionStatus: existing?.connectionStatus ?? 'disconnected',
      connectionFailure:
        existing?.connectionFailure ?? this.connectionFailures.get(pubkey) ?? null,
    });
  }

  private async onPeer(event: Record<string, unknown>): Promise<void> {
    if (!this.identity || typeof event.endpointId !== 'string' || !isBytes(event.profile)) return;
    if (
      typeof event.generation === 'number' &&
      this.endpointContexts.get(event.endpointId)?.generation !== event.generation
    ) {
      return;
    }
    const eventContext = this.endpointContexts.get(event.endpointId);
    try {
      const profile = decodeProfile(event.profile);
      const pubkey = bytesToHex(profile.publicKey);
      if (pubkey === this.identity.proximityPubkey) return;
      const firstProfileForEndpoint = !this.endpointProfiles.has(event.endpointId);
      const announcedRssi =
        typeof event.rssi === 'number' && Number.isFinite(event.rssi)
          ? Math.round(event.rssi)
          : 0;
      const rssi =
        firstProfileForEndpoint && announcedRssi !== 0 && announcedRssi !== 127
          ? announcedRssi
          : firstProfileForEndpoint
            ? (this.endpointSignals.get(event.endpointId) ?? 0)
            : 0;
      this.surfaceProfile(event.endpointId, profile, rssi);
      await this.maybeStartHandshake(event.endpointId);
    } catch (error) {
      if (error instanceof StaleEndpointContextError) return;
      if (eventContext) this.abortEndpoint(event.endpointId, eventContext);
    }
  }

  private onConnection(event: Record<string, unknown>): void {
    if (typeof event.endpointId !== 'string') return;
    const endpointId = event.endpointId;
    const currentForLog = this.endpointContexts.get(endpointId);
    if (IS_DEVELOPMENT_BUILD) {
      console.info(
        `[nearby] trace connection endpoint=${endpointId} state=${String(event.state)} generation=${String(event.generation)} current=${currentForLog?.role ?? 'none'}/${currentForLog?.phase ?? 'none'}/${currentForLog?.generation ?? 'none'}`,
      );
    }
    if (event.state === 'connected') {
      this.explicitUnsuppressionEndpoints.delete(endpointId);
      const current = this.endpointContexts.get(endpointId);
      const suppliedGeneration =
        typeof event.generation === 'number' && Number.isSafeInteger(event.generation)
          ? event.generation
          : null;
      if (
        this.connectedEndpoints.has(endpointId) &&
        current &&
        current.phase !== 'closed' &&
        (suppliedGeneration == null || suppliedGeneration === current.generation)
      ) {
        return;
      }
      if (suppliedGeneration != null && current && suppliedGeneration <= current.generation) return;
      if (suppliedGeneration != null && current && suppliedGeneration > current.generation) {
        this.cleanupEndpoint(endpointId);
      }
      if (!this.hasEndpointCapacity()) {
        void nativeModule()
          ?.disconnectAsync?.(endpointId)
          .catch(() => {});
        return;
      }
      const generation =
        suppliedGeneration ?? (this.endpointGenerations.get(endpointId) ?? 0) + 1;
      this.endpointGenerations.set(endpointId, generation);
      this.ignoredEndpoints.delete(endpointId);
      this.connectedEndpoints.add(endpointId);
      this.endpointContexts.set(endpointId, {
        endpointId,
        generation,
        role: endpointId.startsWith('c:') ? 'initiator' : 'responder',
        phase: 'connected',
        maxRecordSize: PROXIMITY_MAX_RECORD_SIZE,
        accessPurpose: 'session',
        accessSent: false,
      });
      return;
    }
    if (event.state !== 'disconnected') return;
    if (
      typeof event.generation === 'number' &&
      this.endpointContexts.get(endpointId)?.generation !== event.generation
    ) {
      return;
    }
    this.cleanupEndpoint(endpointId);
  }

  private hasEndpointCapacity(): boolean {
    const activeContexts = Array.from(this.endpointContexts.values()).filter(
      (context) => context.phase !== 'closed',
    );
    const unauthenticated = activeContexts.reduce(
      (count, context) => count + (context.secure ? 0 : 1),
      0,
    );
    return (
      activeContexts.length < MAX_ENDPOINT_CONTEXTS &&
      unauthenticated < MAX_UNAUTHENTICATED_ENDPOINTS
    );
  }

  private cleanupEndpoint(endpointId: string): void {
    this.connectedEndpoints.delete(endpointId);
    this.ignoredEndpoints.delete(endpointId);
    const context = this.endpointContexts.get(endpointId);
    if (context) {
      proximityFileTransferService.disconnect(`${endpointId}:${context.generation}`);
    }
    if (context?.timer) clearTimeout(context.timer);
    if (context?.livenessTimer) clearInterval(context.livenessTimer);
    void context?.secure?.destroy();
    void destroyNoiseHandshake(context?.noise);
    this.endpointContexts.delete(endpointId);
    const peer = this.endpointToPubkey.get(endpointId) ?? context?.peerPubkey;
    this.endpointToPubkey.delete(endpointId);
    this.endpointProfiles.delete(endpointId);
    for (const [id, pending] of this.pendingMessages) {
      if (pending.endpointId === endpointId) this.pendingMessages.delete(id);
    }
    for (const [id, request] of this.incomingChatRequests) {
      if (request.endpointId === endpointId) this.removeIncomingChatRequest(id);
    }
    if (peer) this.reconcilePeerAvailability(peer);
    void this.reconcileScanning().catch(() => {});
  }

  private async maybeStartHandshake(endpointId: string): Promise<void> {
    const profile = this.endpointProfiles.get(endpointId);
    if (!profile || !this.accountPubkey) {
      if (IS_DEVELOPMENT_BUILD)
        console.info(
          `[nearby] trace initiator skipped endpoint=${endpointId} profile=${String(Boolean(profile))} account=${String(Boolean(this.accountPubkey))}`,
        );
      return;
    }
    const context = this.claimInitiatorHandshake(endpointId);
    if (!context) {
      if (IS_DEVELOPMENT_BUILD) {
        const current = this.endpointContexts.get(endpointId);
        console.info(
          `[nearby] trace initiator not-claimed endpoint=${endpointId} current=${current?.role ?? 'none'}/${current?.phase ?? 'none'}/${current?.generation ?? 'none'}`,
        );
      }
      return;
    }
    const pubkey = bytesToHex(profile.publicKey);
    const connection = await this.getPeerConnectionState(this.accountPubkey, pubkey);
    const pending = this.pendingChatRequests.has(pubkey);
    if (IS_DEVELOPMENT_BUILD)
      console.info(
        `[nearby] trace initiator policy endpoint=${endpointId} generation=${context.generation} relationship=${connection.relationship} failure=${connection.failure ?? 'none'} pending=${String(pending)}`,
      );
    if (
      this.endpointContexts.get(endpointId) !== context ||
      context.phase !== 'preparing_client_hello'
    ) {
      return;
    }
    const readyEndpoints = this.readyEndpoints(pubkey);
    if (readyEndpoints.length > 0) {
      // A late reverse/duplicate BLE link must not demote an already usable
      // conversation to connecting while it performs a redundant handshake.
      context.peerPubkey = pubkey;
      if (endpointId.startsWith('c:') && readyEndpoints.some((id) => id.startsWith('p:'))) {
        void nativeModule()
          ?.preferPeripheralAsync(endpointId)
          .catch(() => {});
      }
      this.abortEndpoint(endpointId, context);
      return;
    }
    if (
      (connection.relationship !== 'trusted' && !pending) ||
      (connection.failure != null && !pending)
    ) {
      this.surfaceStoredConnectionFailure(pubkey, connection);
      context.phase = 'connected';
      return;
    }
    const peer = proximitySessionStore.getState().peers[pubkey];
    if (peer) {
      proximitySessionStore.getState().upsertPeer({
        ...peer,
        deviceStatus: 'online',
        connectionStatus: 'connecting',
        connectionFailure: null,
      });
    }
    context.accessPurpose = pending ? 'chat_request' : 'session';
    await this.startInitiatorHandshake(context, profile);
  }

  private claimInitiatorHandshake(endpointId: string): EndpointContext | null {
    const context = this.endpointContexts.get(endpointId);
    if (!context || context.role !== 'initiator' || context.phase !== 'connected') return null;
    context.phase = 'preparing_client_hello';
    return context;
  }

  private scheduleHandshakeTimeout(context: EndpointContext): void {
    if (context.timer) clearTimeout(context.timer);
    context.timer = setTimeout(() => {
      context.timer = undefined;
      this.logEndpointFailure(context, 'handshake timeout');
      if (context.role === 'initiator' && context.peerPubkey) {
        this.recoverFreshHandshake(context);
        return;
      }
      this.abortEndpoint(context.endpointId, context);
      if (context.peerPubkey) this.finishChatRequest(context.peerPubkey, 'timeout');
    }, HANDSHAKE_TIMEOUT_MS);
  }

  private scheduleAccessTimeout(context: EndpointContext): void {
    if (context.timer) clearTimeout(context.timer);
    const timeoutMs =
      context.role === 'initiator' && context.accessPurpose === 'chat_request'
        ? ACCESS_TIMEOUT_MS
        : HANDSHAKE_TIMEOUT_MS;
    context.timer = setTimeout(() => {
      context.timer = undefined;
      this.logEndpointFailure(context, 'access timeout');
      this.abortEndpoint(context.endpointId, context);
      if (context.peerPubkey) this.finishChatRequest(context.peerPubkey, 'timeout');
    }, timeoutMs);
  }

  private holdRejectedAccess(context: EndpointContext): void {
    if (context.timer) clearTimeout(context.timer);
    context.phase = 'access_rejected';
    context.accessSent = false;
    context.timer = setTimeout(() => {
      context.timer = undefined;
      this.abortEndpoint(context.endpointId, context);
    }, ACCESS_TIMEOUT_MS);
  }

  private async resumeRejectedAccess(context: EndpointContext): Promise<boolean> {
    if (
      context.role !== 'initiator' ||
      context.phase !== 'access_rejected' ||
      !context.secure
    ) {
      return false;
    }
    if (context.timer) clearTimeout(context.timer);
    context.timer = undefined;
    context.phase = 'awaiting_access';
    context.accessPurpose = 'chat_request';
    context.accessSent = true;
    if (context.peerPubkey) this.beginConnectionAttempt(context.peerPubkey);
    this.scheduleAccessTimeout(context);
    await this.sendSecure(context, ProximityPacketType.AccessRequest, new Uint8Array());
    return true;
  }

  private async startInitiatorHandshake(
    context: EndpointContext,
    profile: ProximityProfile,
  ): Promise<void> {
    await yieldToUi();
    if (
      this.endpointContexts.get(context.endpointId) !== context ||
      context.phase !== 'preparing_client_hello'
    ) {
      return;
    }
    const noise = await createNoiseHandshake('initiator', this.identity!.noisePrivkey);
    if (
      this.endpointContexts.get(context.endpointId) !== context ||
      context.phase !== 'preparing_client_hello'
    ) {
      await destroyNoiseHandshake(noise);
      return;
    }
    context.noise = noise;
    const helloPayload = encodeClientHelloPayload({
      profile: this.localProfile(),
      maxRecordSize: PROXIMITY_MAX_RECORD_SIZE,
    });
    const message = await writeNoiseMessageA(noise, helloPayload);
    if (
      this.endpointContexts.get(context.endpointId) !== context ||
      context.phase !== 'preparing_client_hello'
    ) {
      return;
    }
    context.profile = profile;
    context.handshakeId = message.subarray(0, 32).slice();
    context.proposedMaxRecordSize = PROXIMITY_MAX_RECORD_SIZE;
    context.peerPubkey = bytesToHex(profile.publicKey);
    context.phase = 'client_hello_sent';
    this.scheduleHandshakeTimeout(context);
    await this.sendPacket(context, encodeClientHello({ message }));
  }

  private async sendPacket(context: EndpointContext, packet: Uint8Array): Promise<void> {
    await this.enqueueSend(context, packet);
  }

  private async enqueueSend(
    context: EndpointContext,
    packet: Uint8Array | Promise<Uint8Array>,
  ): Promise<void> {
    const endpointId = context.endpointId;
    const queueKey = `${endpointId}:${context.generation}`;
    const packetResult = Promise.resolve(packet);
    // Observe a seal failure while this packet waits behind an earlier write;
    // the queued await below still propagates the same rejection to the caller.
    void packetResult.catch(() => {});
    const previous = this.endpointSends.get(queueKey) ?? Promise.resolve();
    const current = previous.then(async () => {
      if (
        this.endpointContexts.get(endpointId) !== context ||
        context.phase === 'closed'
      ) {
        throw new StaleEndpointContextError();
      }
      const native = nativeModule();
      if (!native) throw new Error('Nearby transport is unavailable');
      const encoded = await packetResult;
      if (IS_DEVELOPMENT_BUILD)
        console.info(
          `[nearby] trace outbound begin endpoint=${endpointId} generation=${context.generation} phase=${context.phase} type=${packetTypeForLog(encoded)} bytes=${encoded.length}`,
        );
      await native.sendAsync(endpointId, encoded);
      if (IS_DEVELOPMENT_BUILD)
        console.info(
          `[nearby] trace outbound submitted endpoint=${endpointId} generation=${context.generation} type=${packetTypeForLog(encoded)}`,
        );
    });
    this.endpointSends.set(queueKey, current);
    try {
      await current;
    } finally {
      if (this.endpointSends.get(queueKey) === current) this.endpointSends.delete(queueKey);
    }
  }

  private async sendSecure(
    context: EndpointContext,
    type: ProximityPacketType,
    payload: Uint8Array,
  ): Promise<void> {
    const queueKey = `${context.endpointId}:${context.generation}`;
    const previous = this.endpointSecureSends.get(queueKey) ?? Promise.resolve();
    const queuedPayload = payload.slice();
    let rotationRequired = false;
    const packet = previous.then(async () => {
      if (
        this.endpointContexts.get(context.endpointId) !== context ||
        !context.secure ||
        context.phase === 'closed'
      ) {
        throw new StaleEndpointContextError();
      }
      const secure = context.secure;
      if (IS_DEVELOPMENT_BUILD && type === ProximityPacketType.Close) {
        console.info(
          `[nearby] trace close endpoint=${context.endpointId} generation=${context.generation} phase=${context.phase} reason=${decodeClose(queuedPayload)}`,
        );
      }
      const shouldRotate =
        typeof secure.shouldRotateBeforeSend === 'function'
          ? await secure.shouldRotateBeforeSend(queuedPayload.length)
          : false;
      if (type !== ProximityPacketType.Close && shouldRotate) {
        rotationRequired = true;
        return secure.seal(
          ProximityPacketType.Close,
          encodeClose(ProximityErrorCode.SessionExpired),
        );
      }
      return secure.seal(type, queuedPayload);
    });
    const current = packet.then(() => {
      if (rotationRequired) throw new SessionRotationRequiredError();
    });
    void current.catch(() => {});
    this.endpointSecureSends.set(queueKey, current);
    try {
      await this.enqueueSend(context, packet);
      if (rotationRequired) throw new SessionRotationRequiredError();
    } catch (error) {
      if (
        error instanceof StaleEndpointContextError ||
        this.endpointContexts.get(context.endpointId) !== context
      ) {
        throw error;
      }
      this.abortEndpoint(context.endpointId, context);
      if (rotationRequired && context.peerPubkey) {
        this.scheduleConnectionRetry(context.peerPubkey, HANDSHAKE_RETRY_BASE_MS);
      }
      throw error;
    } finally {
      if (this.endpointSecureSends.get(queueKey) === current) {
        this.endpointSecureSends.delete(queueKey);
      }
    }
  }

  private enqueuePacket(event: Record<string, unknown>): void {
    if (typeof event.endpointId !== 'string') return;
    const endpointId = event.endpointId;
    this.reviveResponderForClientHello(event);
    const queuedContext = this.endpointContexts.get(endpointId);
    if (IS_DEVELOPMENT_BUILD && isBytes(event.payload))
      console.info(
        `[nearby] trace inbound queued endpoint=${endpointId} eventGeneration=${String(event.generation)} current=${queuedContext?.role ?? 'none'}/${queuedContext?.phase ?? 'none'}/${queuedContext?.generation ?? 'none'} type=${packetTypeForLog(event.payload)} bytes=${event.payload.length}`,
      );
    if (
      typeof event.generation === 'number' &&
      queuedContext?.generation !== event.generation
    ) {
      return;
    }
    const previous = this.endpointReceives.get(endpointId) ?? Promise.resolve();
    const current = previous.catch(() => {}).then(() => {
      // A native callback queued by an old physical link must never be applied
      // to a replacement context that reused the same endpoint identifier.
      if (queuedContext && this.endpointContexts.get(endpointId) !== queuedContext) return;
      return this.onPacket(event);
    });
    this.endpointReceives.set(endpointId, current);
    void current
      .finally(() => {
        if (this.endpointReceives.get(endpointId) === current) {
          this.endpointReceives.delete(endpointId);
        }
      })
      .catch(() => {});
  }

  private reviveResponderForClientHello(event: Record<string, unknown>): void {
    if (typeof event.endpointId !== 'string' || !isBytes(event.payload)) return;
    if (!isHandshakePacket(event.payload)) return;
    try {
      if (decodeHandshakeEnvelope(event.payload).type !== ProximityPacketType.ClientHello) return;
    } catch {
      return;
    }
    const previous = this.endpointContexts.get(event.endpointId);
    if (!previous || previous.role !== 'responder' || previous.phase !== 'closed') return;
    if (
      typeof event.generation === 'number' &&
      event.generation !== previous.generation
    ) {
      return;
    }
    if (!this.hasEndpointCapacity()) return;
    // A Peripheral may keep the same native subscription generation after the
    // application closes a logical session. A new ClientHello itself proves
    // that the duplex route is active, so replace the closed protocol context
    // even when the OS does not emit another connection/subscription callback.
    const context: EndpointContext = {
      endpointId: event.endpointId,
      generation: previous.generation,
      role: 'responder',
      phase: 'connected',
      maxRecordSize: PROXIMITY_MAX_RECORD_SIZE,
      accessPurpose: 'session',
      accessSent: false,
    };
    this.endpointSends.delete(`${event.endpointId}:${previous.generation}`);
    this.endpointSecureSends.delete(`${event.endpointId}:${previous.generation}`);
    this.ignoredEndpoints.delete(event.endpointId);
    this.connectedEndpoints.add(event.endpointId);
    this.endpointContexts.set(event.endpointId, context);
    if (IS_DEVELOPMENT_BUILD)
      console.info(
        `[nearby] trace responder revived-from-client-hello endpoint=${event.endpointId} generation=${context.generation}`,
      );
  }

  private async onPacket(event: Record<string, unknown>): Promise<void> {
    if (!this.identity || typeof event.endpointId !== 'string' || !isBytes(event.payload)) return;
    const context = this.endpointContexts.get(event.endpointId);
    if (
      !context ||
      context.phase === 'closed' ||
      this.ignoredEndpoints.has(event.endpointId)
    ) {
      return;
    }
    try {
      if (
        context.phase === 'connected' ||
        context.phase === 'preparing_client_hello' ||
        context.phase === 'client_hello_sent' ||
        context.phase === 'server_hello_sent'
      ) {
        if (!isHandshakePacket(event.payload)) return;
        await this.handleHandshakePacket(context, event.payload);
      } else {
        if (this.isClaimedHandshakeRetransmission(context, event.payload)) return;
        // A different handshake packet cannot belong to an established secure
        // record stream. Treat it as cross-session residue and restart the
        // physical link instead of trying to decrypt it as an application
        // record (which previously surfaced as "Unsupported secure record type").
        if (isHandshakePacket(event.payload)) {
          const envelope = decodeHandshakeEnvelope(event.payload);
          const handshakeId = decodeHandshakeId(envelope.type, envelope.payload);
          if (
            context.handshakeId &&
            !confirmationsEqual(handshakeId, context.handshakeId)
          ) {
            return;
          }
          throw new ConflictingHandshakePacketError();
        }
        if (!context.secure) throw new Error('Missing secure session');
        if (!context.secure.matchesRecordSession(event.payload)) return;
        const record = await context.secure.open(event.payload);
        context.lastReceivedAt = Date.now();
        await this.handleSecureRecord(context, record.type, record.payload);
      }
    } catch (error) {
      if (
        error instanceof StaleEndpointContextError ||
        this.endpointContexts.get(context.endpointId) !== context
      ) {
        return;
      }
      this.logEndpointFailure(context, 'packet handling', error);
      if (error instanceof ConflictingHandshakePacketError) {
        this.recoverFreshHandshake(context);
        return;
      }
      this.surfaceConnectionFailure(context);
      this.abortEndpoint(context.endpointId, context);
    }
  }

  private clearHandshakeRetry(peerPubkey: string): void {
    this.handshakeRetryAttempts.delete(peerPubkey);
    const timer = this.connectionDiscoveryTimers.get(peerPubkey);
    if (timer) clearTimeout(timer);
    this.connectionDiscoveryTimers.delete(peerPubkey);
  }

  private scheduleConnectionRetry(peerPubkey: string, delayMs: number): void {
    const previous = this.connectionDiscoveryTimers.get(peerPubkey);
    if (previous) clearTimeout(previous);
    this.connectionDiscoveryTimers.set(
      peerPubkey,
      setTimeout(() => {
        this.connectionDiscoveryTimers.delete(peerPubkey);
        if (!this.sessionStarted) return;
        if (IS_DEVELOPMENT_BUILD)
          console.info(`[nearby] trace retry scan peer=${peerPubkey.slice(0, 8)}`);
        this.clearConnectionFailure(peerPubkey);
        void this.scan(SCAN_DURATION_MS).catch(() => {});
      }, delayMs),
    );
  }

  private recoverFreshHandshake(context: EndpointContext): void {
    const peerPubkey = context.peerPubkey;
    if (!peerPubkey) {
      this.abortEndpoint(context.endpointId, context);
      return;
    }
    if (context.role === 'responder') {
      if (!context.secure) {
        this.abortEndpoint(context.endpointId, context);
        return;
      }
      void this.sendSecure(
        context,
        ProximityPacketType.Close,
        encodeClose(ProximityErrorCode.InvalidHandshake),
      )
        .catch(() => {})
        .finally(() => this.abortEndpoint(context.endpointId, context));
      return;
    }
    const attempt = (this.handshakeRetryAttempts.get(peerPubkey) ?? 0) + 1;
    if (attempt > MAX_AUTOMATIC_HANDSHAKE_RETRIES) {
      this.clearHandshakeRetry(peerPubkey);
      void this.markConnectionFailure(peerPubkey, 'failed');
      this.finishChatRequest(peerPubkey, 'failed');
      this.abortEndpoint(context.endpointId, context);
      return;
    }
    this.handshakeRetryAttempts.set(peerPubkey, attempt);
    this.connectionFailures.delete(peerPubkey);
    this.abortEndpoint(context.endpointId, context);
    this.scheduleConnectionRetry(peerPubkey, HANDSHAKE_RETRY_BASE_MS * attempt);
  }

  private surfaceConnectionFailure(context: EndpointContext): void {
    if (!context.peerPubkey || context.phase === 'ready' || context.phase === 'closed') return;
    this.connectionFailures.set(context.peerPubkey, 'failed');
    this.finishChatRequest(context.peerPubkey, 'failed');
  }

  private logEndpointFailure(
    context: EndpointContext,
    stage: string,
    error?: unknown,
  ): void {
    if (!IS_DEVELOPMENT_BUILD) return;
    const detail = error instanceof Error ? `: ${error.message}` : '';
    console.info(
      `[nearby] ${stage} failed for ${context.role} endpoint in ${context.phase}${detail}`,
    );
  }

  private async handleHandshakePacket(context: EndpointContext, packet: Uint8Array): Promise<void> {
    const envelope = decodeHandshakeEnvelope(packet);
    const handshakeId = decodeHandshakeId(envelope.type, envelope.payload);
    if (IS_DEVELOPMENT_BUILD)
      console.info(
        `[nearby] trace handshake endpoint=${context.endpointId} generation=${context.generation} role=${context.role} phase=${context.phase} type=${packetTypeForLog(packet)} idMatch=${String(context.handshakeId == null || confirmationsEqual(handshakeId, context.handshakeId))}`,
      );
    // A packet queued by the previous logical session can arrive after the
    // transport reports a fresh connection. Until the Initiator has sent its
    // new ClientHello there is no packet it can legitimately receive, while a
    // Responder can only receive ClientHello. Discard that residue without
    // poisoning or aborting the new handshake context.
    if (
      context.phase === 'preparing_client_hello' ||
      (context.phase === 'connected' &&
        (context.role === 'initiator' || envelope.type !== ProximityPacketType.ClientHello))
    ) {
      if (IS_DEVELOPMENT_BUILD)
        console.info(
          `[nearby] trace handshake discarded-before-hello endpoint=${context.endpointId} generation=${context.generation} phase=${context.phase} type=${packetTypeForLog(packet)}`,
        );
      return;
    }
    if (
      context.role === 'responder' &&
      envelope.type === ProximityPacketType.ClientHello &&
      context.handshakeId &&
      !confirmationsEqual(handshakeId, context.handshakeId)
    ) {
      if (context.phase !== 'server_hello_sent') return;
      this.resetResponderHandshake(context);
    } else if (
      context.handshakeId &&
      !confirmationsEqual(handshakeId, context.handshakeId)
    ) {
      if (IS_DEVELOPMENT_BUILD)
        console.info(
          `[nearby] trace handshake discarded-id endpoint=${context.endpointId} generation=${context.generation} phase=${context.phase} type=${packetTypeForLog(packet)}`,
        );
      return;
    }
    if (!this.claimHandshakePacket(context, envelope.type, packet)) return;
    if (
      context.role === 'responder' &&
      context.phase === 'connected' &&
      envelope.type === ProximityPacketType.ClientHello
    ) {
      await this.acceptClientHello(context, envelope.payload);
      return;
    }
    if (
      context.role === 'initiator' &&
      context.phase === 'client_hello_sent' &&
      envelope.type === ProximityPacketType.ServerHello
    ) {
      await this.acceptServerHello(context, envelope.payload);
      return;
    }
    if (
      context.role === 'responder' &&
      context.phase === 'server_hello_sent' &&
      envelope.type === ProximityPacketType.ClientAuth
    ) {
      await this.acceptClientAuth(context, envelope.payload);
      return;
    }
    throw new Error('Unexpected handshake packet');
  }

  private resetResponderHandshake(context: EndpointContext): void {
    if (context.timer) clearTimeout(context.timer);
    context.timer = undefined;
    void destroyNoiseHandshake(context.noise);
    context.handshakeId = undefined;
    context.noise = undefined;
    context.receivedHandshakePackets = undefined;
    context.selectedCapabilities = undefined;
    context.phase = 'connected';
  }

  private claimHandshakePacket(
    context: EndpointContext,
    type: ProximityPacketType,
    packet: Uint8Array,
  ): boolean {
    const received = context.receivedHandshakePackets ?? new Map();
    context.receivedHandshakePackets = received;
    const previous = received.get(type);
    if (previous) {
      if (confirmationsEqual(previous, packet)) return false;
      throw new ConflictingHandshakePacketError();
    }
    received.set(type, packet.slice());
    return true;
  }

  private isClaimedHandshakeRetransmission(
    context: EndpointContext,
    packet: Uint8Array,
  ): boolean {
    const type = packet[1] as ProximityPacketType | undefined;
    if (type == null) return false;
    const claimed = context.receivedHandshakePackets?.get(type);
    return claimed != null && confirmationsEqual(claimed, packet);
  }

  private async acceptClientHello(context: EndpointContext, payload: Uint8Array): Promise<void> {
    const hello = decodeClientHello(payload);
    const noise = await createNoiseHandshake('responder', this.identity!.noisePrivkey);
    if (
      this.endpointContexts.get(context.endpointId) !== context ||
      context.phase !== 'connected'
    ) {
      await destroyNoiseHandshake(noise);
      return;
    }
    context.noise = noise;
    const clientPayload = decodeClientHelloPayload(await readNoiseMessageA(noise, hello.message));
    if (
      this.endpointContexts.get(context.endpointId) !== context ||
      context.phase !== 'connected'
    ) {
      return;
    }
    if (IS_DEVELOPMENT_BUILD)
      console.info(
        `[nearby] trace responder client-hello endpoint=${context.endpointId} generation=${context.generation} phase=${context.phase}`,
      );
    const peerPubkey = bytesToHex(clientPayload.profile.publicKey);
    if (peerPubkey === this.identity?.proximityPubkey) throw new Error('Self connection');
    if ((clientPayload.profile.capabilities & PROXIMITY_CAPABILITY_MESSAGE) === 0n)
      throw new Error('Message capability missing');
    this.surfaceProfile(
      context.endpointId,
      clientPayload.profile,
      this.endpointSignals.get(context.endpointId) ?? 0,
    );
    await yieldToUi();
    if (
      this.endpointContexts.get(context.endpointId) !== context ||
      context.phase !== 'connected'
    ) {
      if (IS_DEVELOPMENT_BUILD)
        console.info(
          `[nearby] trace responder client-hello abandoned endpoint=${context.endpointId} generation=${context.generation} current=${this.endpointContexts.get(context.endpointId)?.phase ?? 'none'}`,
      );
      return;
    }
    const selectedCapabilities =
      clientPayload.profile.capabilities & PROXIMITY_SUPPORTED_CAPABILITIES;
    const maxRecordSize = Math.min(clientPayload.maxRecordSize, PROXIMITY_MAX_RECORD_SIZE);
    const serverPayload = encodeServerHelloPayload({
      profile: this.localProfile(),
      selectedCapabilities,
      maxRecordSize,
    });
    const message = await writeNoiseMessageB(noise, serverPayload);
    if (
      this.endpointContexts.get(context.endpointId) !== context ||
      context.phase !== 'connected'
    ) {
      return;
    }
    context.profile = clientPayload.profile;
    context.peerPubkey = peerPubkey;
    context.handshakeId = hello.message.subarray(0, 32).slice();
    context.noise = noise;
    context.selectedCapabilities = selectedCapabilities;
    context.maxRecordSize = maxRecordSize;
    context.phase = 'server_hello_sent';
    this.beginConnectionAttempt(peerPubkey);
    if (IS_DEVELOPMENT_BUILD)
      console.info(
        `[nearby] trace responder server-hello ready endpoint=${context.endpointId} generation=${context.generation}`,
      );
    this.scheduleHandshakeTimeout(context);
    await this.sendPacket(
      context,
      encodeServerHello({ handshakeId: context.handshakeId, message }),
    );
  }

  private async acceptServerHello(context: EndpointContext, payload: Uint8Array): Promise<void> {
    const hello = decodeServerHello(payload);
    if (!context.profile || !context.handshakeId || !context.noise) {
      throw new Error('Missing client state');
    }
    const noise = context.noise;
    if (!confirmationsEqual(hello.handshakeId, context.handshakeId)) return;
    const serverPayload = decodeServerHelloPayload(
      await readNoiseMessageB(noise, hello.message),
    );
    if (
      !confirmationsEqual(
        await noiseRemoteStaticKey(noise),
        serverPayload.profile.noisePublicKey,
      )
    ) {
      throw new Error('Responder Noise identity changed');
    }
    if (bytesToHex(serverPayload.profile.publicKey) !== bytesToHex(context.profile.publicKey))
      throw new Error('Responder identity changed');
    if (
      (serverPayload.selectedCapabilities & PROXIMITY_CAPABILITY_MESSAGE) === 0n ||
      (serverPayload.selectedCapabilities & PROXIMITY_SUPPORTED_CAPABILITIES) !==
        serverPayload.selectedCapabilities ||
      (serverPayload.selectedCapabilities & serverPayload.profile.capabilities) !==
        serverPayload.selectedCapabilities ||
      serverPayload.maxRecordSize > (context.proposedMaxRecordSize ?? PROXIMITY_MAX_RECORD_SIZE)
    )
      throw new Error('Invalid server selection');
    this.surfaceProfile(
      context.endpointId,
      serverPayload.profile,
      this.endpointSignals.get(context.endpointId) ?? 0,
    );
    await yieldToUi();
    if (
      this.endpointContexts.get(context.endpointId) !== context ||
      context.phase !== 'client_hello_sent'
    ) {
      return;
    }
    const message = await writeNoiseMessageC(noise);
    if (
      this.endpointContexts.get(context.endpointId) !== context ||
      context.phase !== 'client_hello_sent'
    ) {
      return;
    }
    context.profile = serverPayload.profile;
    context.peerPubkey = bytesToHex(serverPayload.profile.publicKey);
    context.selectedCapabilities = serverPayload.selectedCapabilities;
    context.maxRecordSize = serverPayload.maxRecordSize;
    this.scheduleHandshakeTimeout(context);
    await this.sendPacket(
      context,
      encodeClientAuth({ handshakeId: context.handshakeId, message }),
    );
    if (
      this.endpointContexts.get(context.endpointId) !== context ||
      context.phase !== 'client_hello_sent'
    ) {
      return;
    }
    const secure = await createNoiseSecureSession(
      'initiator',
      noise,
      context.maxRecordSize,
    );
    if (
      this.endpointContexts.get(context.endpointId) !== context ||
      context.phase !== 'client_hello_sent'
    ) {
      await secure.destroy();
      return;
    }
    context.secure = secure;
    context.noise = undefined;
    this.finishHandshake(context);
  }

  private async acceptClientAuth(context: EndpointContext, payload: Uint8Array): Promise<void> {
    const auth = decodeClientAuth(payload);
    if (!context.profile || !context.handshakeId || !context.noise) {
      throw new Error('Missing responder state');
    }
    const noise = context.noise;
    if (!confirmationsEqual(auth.handshakeId, context.handshakeId)) return;
    const finalPayload = await readNoiseMessageC(noise, auth.message);
    if (finalPayload.length !== 0) throw new Error('Unexpected Noise message C payload');
    if (
      !confirmationsEqual(
        await noiseRemoteStaticKey(noise),
        context.profile.noisePublicKey,
      )
    ) {
      throw new Error('Initiator Noise identity changed');
    }
    await yieldToUi();
    if (
      this.endpointContexts.get(context.endpointId) !== context ||
      context.phase !== 'server_hello_sent'
    ) {
      return;
    }
    const secure = await createNoiseSecureSession(
      'responder',
      noise,
      context.maxRecordSize,
    );
    if (
      this.endpointContexts.get(context.endpointId) !== context ||
      context.phase !== 'server_hello_sent'
    ) {
      await secure.destroy();
      return;
    }
    context.secure = secure;
    context.noise = undefined;
    this.finishHandshake(context);
  }

  private finishHandshake(context: EndpointContext): void {
    if (!context.peerPubkey || !context.secure) throw new Error('Incomplete secure session');
    if (context.timer) clearTimeout(context.timer);
    context.timer = undefined;
    context.proposedMaxRecordSize = undefined;
    void destroyNoiseHandshake(context.noise);
    context.noise = undefined;
    this.endpointToPubkey.set(context.endpointId, context.peerPubkey);
    context.phase = 'electing';
    this.scheduleElection(context.peerPubkey);
  }

  private scheduleElection(peerPubkey: string): void {
    const previous = this.electionTimers.get(peerPubkey);
    if (previous) clearTimeout(previous);
    this.electionTimers.set(
      peerPubkey,
      setTimeout(() => {
        this.electionTimers.delete(peerPubkey);
        void this.finishElection(peerPubkey).catch((error: unknown) => {
          const endpointId = this.canonicalEndpoints.get(peerPubkey);
          const context = endpointId ? this.endpointContexts.get(endpointId) : undefined;
          if (context) this.logEndpointFailure(context, 'connection election', error);
        });
      }, DUPLICATE_SETTLE_MS),
    );
  }

  private authenticatedEndpoints(peerPubkey: string): string[] {
    return Array.from(this.endpointToPubkey.entries())
      .filter(
        ([endpointId, pubkey]) => pubkey === peerPubkey && this.connectedEndpoints.has(endpointId),
      )
      .map(([endpointId]) => endpointId)
      .filter((endpointId) => {
        const phase = this.endpointContexts.get(endpointId)?.phase;
        return (
          phase === 'electing' ||
          phase === 'awaiting_access' ||
          phase === 'access_rejected' ||
          phase === 'ready'
        );
      });
  }

  private readyEndpoints(peerPubkey: string): string[] {
    return this.authenticatedEndpoints(peerPubkey).filter(
      (endpointId) => this.endpointContexts.get(endpointId)?.phase === 'ready',
    );
  }

  private async finishElection(peerPubkey: string): Promise<void> {
    if (!this.identity) return;
    const endpoints = this.authenticatedEndpoints(peerPubkey).filter(
      (id) => !this.ignoredEndpoints.has(id),
    );
    const currentEndpoint = this.canonicalEndpoints.get(peerPubkey);
    const currentContext = currentEndpoint
      ? this.endpointContexts.get(currentEndpoint)
      : undefined;
    if (IS_DEVELOPMENT_BUILD)
      console.info(
        `[nearby] trace election peer=${peerPubkey.slice(0, 8)} endpoints=${endpoints.join(',') || 'none'} current=${currentEndpoint ?? 'none'} currentPhase=${currentContext?.phase ?? 'none'}`,
      );
    if (
      currentEndpoint &&
      currentContext &&
      (currentContext.phase === 'awaiting_access' ||
        currentContext.phase === 'access_rejected' ||
        currentContext.phase === 'ready')
    ) {
      // Once access starts, changing the canonical link would cancel or
      // duplicate the user's consent flow. Late authenticated links lose even
      // when they have the otherwise-preferred BLE role.
      for (const endpointId of endpoints) {
        if (endpointId === currentEndpoint) continue;
        this.ignoredEndpoints.add(endpointId);
        const duplicate = this.endpointContexts.get(endpointId);
        if (duplicate?.secure) {
          void this.sendSecure(
            duplicate,
            ProximityPacketType.Close,
            encodeClose(ProximityErrorCode.DuplicateConnection),
          )
            .catch(() => {})
            .finally(() => this.abortEndpoint(endpointId, duplicate));
        } else {
          if (duplicate) this.abortEndpoint(endpointId, duplicate);
        }
      }
      return;
    }
    const selected = selectCanonicalProximityEndpoint(
      this.identity.proximityPubkey,
      peerPubkey,
      endpoints,
      currentEndpoint,
    );
    if (!selected) return;
    if (IS_DEVELOPMENT_BUILD)
      console.info(
        `[nearby] trace election selected peer=${peerPubkey.slice(0, 8)} endpoint=${selected}`,
      );
    this.canonicalEndpoints.set(peerPubkey, selected);
    for (const endpointId of endpoints) {
      if (endpointId === selected) continue;
      this.ignoredEndpoints.add(endpointId);
      const duplicate = this.endpointContexts.get(endpointId);
      if (duplicate?.secure) {
        void this.sendSecure(
          duplicate,
          ProximityPacketType.Close,
          encodeClose(ProximityErrorCode.DuplicateConnection),
        )
          .catch(() => {})
          .finally(() => this.abortEndpoint(endpointId, duplicate));
      } else if (duplicate) {
        this.abortEndpoint(endpointId, duplicate);
      }
      if (endpointId.startsWith('c:'))
        void nativeModule()
          ?.preferPeripheralAsync(endpointId)
          .catch(() => {});
    }
    const context = this.endpointContexts.get(selected);
    if (!context || context.phase !== 'electing') return;
    context.phase = 'awaiting_access';
    this.scheduleAccessTimeout(context);
    const peer = proximitySessionStore.getState().peers[peerPubkey];
    if (peer)
      proximitySessionStore
        .getState()
        .upsertPeer({
          ...peer,
          endpointId: selected,
          deviceStatus: 'online',
          connectionStatus: 'connecting',
          connectionFailure: null,
        });
    if (context.role === 'initiator' && !context.accessSent) {
      context.accessSent = true;
      await this.sendSecure(context, ProximityPacketType.AccessRequest, new Uint8Array());
    }
  }

  private async handleSecureRecord(
    context: EndpointContext,
    type: ProximityPacketType,
    payload: Uint8Array,
  ): Promise<void> {
    if (type === ProximityPacketType.Close) {
      const reason = decodeClose(payload);
      if (context.peerPubkey && reason === ProximityErrorCode.AccessDenied) {
        const peerPubkey = context.peerPubkey;
        await this.markConnectionFailure(peerPubkey, 'rejected');
        this.finishChatRequest(peerPubkey, 'declined');
        this.abortEndpoint(context.endpointId, context);
        return;
      }
      if (
        context.role === 'initiator' &&
        reason === ProximityErrorCode.InvalidHandshake
      ) {
        this.recoverFreshHandshake(context);
        return;
      }
      if (context.peerPubkey && reason === ProximityErrorCode.SessionExpired) {
        const peerPubkey = context.peerPubkey;
        this.clearHandshakeRetry(peerPubkey);
        this.abortEndpoint(context.endpointId, context);
        this.scheduleConnectionRetry(peerPubkey, HANDSHAKE_RETRY_BASE_MS);
        return;
      }
      this.abortEndpoint(context.endpointId, context);
      return;
    }
    if (type === ProximityPacketType.Error) return;
    if (type === ProximityPacketType.Ping) {
      if (context.phase !== 'ready' || payload.length !== 0) throw new Error('Invalid ping');
      await this.sendSecure(context, ProximityPacketType.Pong, new Uint8Array());
      return;
    }
    if (type === ProximityPacketType.Pong) {
      if (context.phase !== 'ready' || payload.length !== 0) throw new Error('Invalid pong');
      return;
    }
    if (type === ProximityPacketType.ProfileUpdate) {
      await this.handleProfileUpdate(context, payload);
      return;
    }
    if (type === ProximityPacketType.AccessRequest) {
      if (context.phase === 'electing' && context.peerPubkey) {
        // Both peers start their settle timer after their own final handshake
        // packet, so the Initiator can legitimately send ACCESS_REQUEST before
        // the Responder's timer fires. Let that authenticated request drive the
        // same deterministic election instead of treating it as out of order.
        await this.finishElection(context.peerPubkey);
        const phaseAfterElection = this.endpointContexts.get(context.endpointId)?.phase as
          | EndpointPhase
          | undefined;
        if (
          phaseAfterElection !== 'awaiting_access' &&
          phaseAfterElection !== 'access_rejected'
        ) {
          return;
        }
      }
      await this.handleAccessRequest(context, payload);
      return;
    }
    if (type === ProximityPacketType.AccessResult) {
      await this.handleAccessResult(context, payload);
      return;
    }
    if (type === ProximityPacketType.Message) {
      await this.handleMessage(context, payload);
      return;
    }
    if (type === ProximityPacketType.MessageAck) {
      await this.handleMessageAck(context, payload);
      return;
    }
    if (
      type === ProximityPacketType.FileRequest ||
      type === ProximityPacketType.FileAccept ||
      type === ProximityPacketType.FileChunk ||
      type === ProximityPacketType.FileProgress ||
      type === ProximityPacketType.FileComplete ||
      type === ProximityPacketType.FileCancel
    ) {
      if (
        context.phase !== 'ready' ||
        ((context.selectedCapabilities ?? 0n) & PROXIMITY_CAPABILITY_FILE_TRANSFER) === 0n
      ) {
        throw new Error('Unexpected file transfer record');
      }
      await proximityFileTransferService.handleRecord(this.fileConnection(context), type, payload);
      return;
    }
    if (type === ProximityPacketType.FileRemoteAvailable) {
      await this.handleFileRemoteAvailable(context, payload);
      return;
    }
    throw new Error('Unsupported secure record');
  }

  private fileConnection(context: EndpointContext): ProximityFileConnection {
    if (!this.accountPubkey || !this.identity || !context.peerPubkey) {
      throw new Error('Nearby file connection is unavailable');
    }
    return {
      id: `${context.endpointId}:${context.generation}`,
      accountPubkey: this.accountPubkey,
      localPubkey: this.identity.proximityPubkey,
      peerPubkey: context.peerPubkey,
      send: (type, payload) => this.sendSecure(context, type, payload),
    };
  }

  private async handleFileRemoteAvailable(
    context: EndpointContext,
    payload: Uint8Array,
  ): Promise<void> {
    if (
      context.phase !== 'ready' ||
      !context.peerPubkey ||
      !this.accountPubkey ||
      ((context.selectedCapabilities ?? 0n) & PROXIMITY_CAPABILITY_FILE_TRANSFER) === 0n
    ) {
      throw new Error('Unexpected remote availability record');
    }
    const available = decodeFileRemoteAvailable(payload);
    const rumorId = bytesToHex(available.rumorId);
    const x = bytesToHex(available.x);
    const row = await db
      .select({ rumor: messages.rumor, senderPubkey: messages.senderPubkey })
      .from(messages)
      .where(
        and(
          eq(messages.accountPubkey, this.accountPubkey),
          eq(messages.id, rumorId),
          eq(messages.conversationKey, context.peerPubkey),
        ),
      )
      .limit(1)
      .get();
    const offer = row ? parseNearbyFileOffer(row.rumor.content, row.rumor.tags) : null;
    if (!row || row.senderPubkey !== context.peerPubkey || offer?.cipherSha256Hex !== x) return;
    notifyNearbyRemoteAvailable(this.accountPubkey, rumorId, x);
  }

  private async handleProfileUpdate(
    context: EndpointContext,
    payload: Uint8Array,
  ): Promise<void> {
    if (
      context.phase !== 'ready' ||
      !context.profile ||
      !context.peerPubkey ||
      !this.accountPubkey ||
      ((context.selectedCapabilities ?? 0n) & PROXIMITY_CAPABILITY_PROFILE_UPDATE) === 0n
    ) {
      throw new Error('Unexpected profile update');
    }
    const name = decodeProfileUpdate(payload);
    if (!name || normalizeProximityDisplayName(name) !== name) {
      throw new Error('Invalid profile update name');
    }
    const accountPubkey = this.accountPubkey;
    const peerPubkey = context.peerPubkey;
    const previousProfile = context.profile;
    const displayName = resolveDisplayName(peerPubkey, { displayName: name });
    const now = Math.floor(Date.now() / 1000);
    const peerWhere = and(
      eq(proximityPeers.accountPubkey, accountPubkey),
      eq(proximityPeers.proximityPubkey, peerPubkey),
    );
    await db.transaction(async (tx) => {
      const peer = await tx
        .select({ nickname: proximityPeers.nickname })
        .from(proximityPeers)
        .where(peerWhere)
        .limit(1)
        .get();
      if (!peer) throw new Error('Authenticated Nearby peer is missing');
      await tx
        .update(proximityPeers)
        .set({ displayName, lastSeenAt: now })
        .where(peerWhere)
        .run();
      await tx
        .update(conversations)
        .set({ name: peer.nickname ?? displayName })
        .where(
          and(
            eq(conversations.accountPubkey, accountPubkey),
            eq(conversations.conversationKey, peerPubkey),
            eq(conversations.deliveryKind, 'proximity'),
          ),
        )
        .run();
    });
    if (
      this.accountPubkey !== accountPubkey ||
      this.endpointContexts.get(context.endpointId) !== context
    ) {
      return;
    }
    const profile = { ...previousProfile, name };
    context.profile = profile;
    this.surfaceProfile(context.endpointId, profile, 0);
  }

  private async handleAccessRequest(context: EndpointContext, payload: Uint8Array): Promise<void> {
    if (
      payload.length !== 0 ||
      context.role !== 'responder' ||
      (context.phase !== 'awaiting_access' && context.phase !== 'access_rejected') ||
      !context.peerPubkey ||
      !this.accountPubkey
    ) {
      throw new Error('Invalid access request');
    }
    context.phase = 'awaiting_access';
    if (context.timer) clearTimeout(context.timer);
    context.timer = undefined;
    const state = await this.getPeerConnectionState(this.accountPubkey, context.peerPubkey);
    if (state.relationship === 'blocked') {
      await this.sendSecure(
        context,
        ProximityPacketType.AccessResult,
        encodeAccessResult(ProximityAccessDecision.Blocked),
      );
      this.markPeerDisconnected(context.peerPubkey);
      this.abortEndpoint(context.endpointId, context);
      return;
    }
    if (state.relationship === 'trusted') {
      await this.sendSecure(
        context,
        ProximityPacketType.AccessResult,
        encodeAccessResult(ProximityAccessDecision.Accepted),
      );
      await this.markReady(context);
      return;
    }
    if (
      this.incomingChatRequests.size >= MAX_INCOMING_CHAT_REQUESTS ||
      Array.from(this.incomingChatRequests.values()).some(
        (request) => request.peerPubkey === context.peerPubkey,
      )
    ) {
      await this.sendSecure(
        context,
        ProximityPacketType.AccessResult,
        encodeAccessResult(ProximityAccessDecision.Expired),
      );
      this.abortEndpoint(context.endpointId, context);
      return;
    }
    this.beginConnectionAttempt(context.peerPubkey);
    const requestId = bytesToHex(context.secure!.sessionId);
    const displayName = resolveDisplayName(context.peerPubkey, {
      displayName: context.profile?.name ?? '',
    });
    const timer = setTimeout(
      () => void this.expireIncomingChatRequest(requestId),
      ACCESS_TIMEOUT_MS,
    );
    this.incomingChatRequests.set(requestId, {
      requestId,
      endpointId: context.endpointId,
      peerPubkey: context.peerPubkey,
      displayName,
      timer,
    });
    proximitySessionStore.getState().addIncomingChatRequest({
      requestId,
      peerPubkey: context.peerPubkey,
      displayName,
    });
  }

  private async handleAccessResult(context: EndpointContext, payload: Uint8Array): Promise<void> {
    if (
      context.role !== 'initiator' ||
      context.phase !== 'awaiting_access' ||
      !context.peerPubkey
    ) {
      throw new Error('Unexpected access result');
    }
    const decision = decodeAccessResult(payload);
    if (decision === ProximityAccessDecision.Accepted) {
      const displayName = resolveDisplayName(context.peerPubkey, {
        displayName: context.profile?.name ?? '',
      });
      if (context.accessPurpose === 'chat_request') {
        await this.ensureAcceptedConversation(context.peerPubkey, displayName);
      }
      await this.markReady(context);
      this.finishChatRequest(context.peerPubkey, 'accepted');
      return;
    }
    await this.markConnectionFailure(
      context.peerPubkey,
      decision === ProximityAccessDecision.Expired ? 'failed' : 'rejected',
    );
    this.finishChatRequest(
      context.peerPubkey,
      decision === ProximityAccessDecision.Declined || decision === ProximityAccessDecision.Blocked
        ? 'declined'
        : 'timeout',
    );
    if (decision === ProximityAccessDecision.Declined) {
      this.holdRejectedAccess(context);
      return;
    }
    this.abortEndpoint(context.endpointId, context);
  }

  private async markReady(context: EndpointContext): Promise<void> {
    if (!this.accountPubkey || !context.peerPubkey) return;
    if (context.timer) clearTimeout(context.timer);
    context.timer = undefined;
    context.phase = 'ready';
    this.startLiveness(context);
    this.connectionFailures.delete(context.peerPubkey);
    this.clearHandshakeRetry(context.peerPubkey);
    const now = Math.floor(Date.now() / 1000);
    const displayName = resolveDisplayName(context.peerPubkey, {
      displayName: context.profile?.name ?? '',
    });
    await db
      .insert(proximityPeers)
      .values({
        accountPubkey: this.accountPubkey,
        proximityPubkey: context.peerPubkey,
        displayName,
        lastSeenAt: now,
        connectionFailure: null,
      })
      .onConflictDoUpdate({
        target: [proximityPeers.accountPubkey, proximityPeers.proximityPubkey],
        set: { displayName, lastSeenAt: now, connectionFailure: null },
      });
    const peer = proximitySessionStore.getState().peers[context.peerPubkey];
    proximitySessionStore.getState().upsertPeer({
      proximityPubkey: context.peerPubkey,
      endpointId: context.endpointId,
      displayName,
      rssi: peer?.rssi ?? 0,
      lastSeenAt: now,
      deviceStatus: 'online',
      connectionStatus: 'connected',
      connectionFailure: null,
    });
    await db
      .update(outbox)
      .set({ nextAttemptAt: now })
      .where(
        and(
          eq(outbox.accountPubkey, this.accountPubkey),
          eq(outbox.deliveryKind, 'proximity'),
          eq(outbox.conversationKey, context.peerPubkey),
          eq(outbox.status, 'queued'),
        ),
      );
    void this.reconcileScanning().catch(() => {});
    void this.drain();
  }

  private async announceRemoteAvailable(x: string): Promise<void> {
    if (!this.accountPubkey || !this.identity || !validPubkey(x)) return;
    const rows = await db
      .select({ id: messages.id, peerPubkey: messages.conversationKey })
      .from(messages)
      .where(
        and(
          eq(messages.accountPubkey, this.accountPubkey),
          eq(messages.kind, KIND_FILE),
          eq(messages.senderPubkey, this.identity.proximityPubkey),
          like(messages.content, `blossom:${x}.bin?%`),
        ),
      );
    for (const row of rows) {
      const endpointId = this.canonicalEndpoints.get(row.peerPubkey);
      const context = endpointId ? this.endpointContexts.get(endpointId) : undefined;
      if (
        !context ||
        context.phase !== 'ready' ||
        ((context.selectedCapabilities ?? 0n) & PROXIMITY_CAPABILITY_FILE_TRANSFER) === 0n
      ) {
        continue;
      }
      await this.sendSecure(
        context,
        ProximityPacketType.FileRemoteAvailable,
        encodeFileRemoteAvailable({ rumorId: hexToBytes(row.id), x: hexToBytes(x) }),
      ).catch(() => {});
    }
  }

  private startLiveness(context: EndpointContext): void {
    if (context.livenessTimer) clearInterval(context.livenessTimer);
    context.lastReceivedAt = Date.now();
    context.livenessTimer = setInterval(() => {
      if (context.phase !== 'ready') {
        if (context.livenessTimer) clearInterval(context.livenessTimer);
        context.livenessTimer = undefined;
        return;
      }
      if (Date.now() - (context.lastReceivedAt ?? 0) >= LIVENESS_TIMEOUT_MS) {
        this.abortEndpoint(context.endpointId, context);
        return;
      }
      void this.sendSecure(context, ProximityPacketType.Ping, new Uint8Array()).catch(() => {
        this.abortEndpoint(context.endpointId, context);
      });
    }, PING_INTERVAL_MS);
  }

  private abortEndpoint(endpointId: string, expectedContext?: EndpointContext): void {
    const context = this.endpointContexts.get(endpointId);
    if (expectedContext && context !== expectedContext) return;
    if (!context || context.phase === 'closed') return;
    proximityFileTransferService.disconnect(`${endpointId}:${context.generation}`);
    context.phase = 'closed';
    if (context.timer) clearTimeout(context.timer);
    if (context.livenessTimer) clearInterval(context.livenessTimer);
    context.livenessTimer = undefined;
    void context.secure?.destroy();
    void destroyNoiseHandshake(context.noise);
    this.ignoredEndpoints.add(endpointId);
    if (context.peerPubkey) this.reconcilePeerAvailability(context.peerPubkey);
    void nativeModule()
      ?.disconnectAsync?.(endpointId)
      .catch(() => {});
  }

  private async getPeerConnectionState(
    accountPubkey: string,
    peerPubkey: string,
  ): Promise<ProximityPeerConnectionState> {
    const [peer] = await db
      .select({
        connectedAt: proximityPeers.connectedAt,
        blockedAt: proximityPeers.blockedAt,
        connectionFailure: proximityPeers.connectionFailure,
        displayName: proximityPeers.displayName,
        lastSeenAt: proximityPeers.lastSeenAt,
      })
      .from(proximityPeers)
      .where(
        and(
          eq(proximityPeers.accountPubkey, accountPubkey),
          eq(proximityPeers.proximityPubkey, peerPubkey),
        ),
      )
      .limit(1);
    const identity = {
      displayName: peer?.displayName ?? null,
      lastSeenAt: peer?.lastSeenAt ?? null,
    };
    if (peer?.blockedAt != null) return { relationship: 'blocked', failure: null, ...identity };
    if (peer?.connectedAt == null) return { relationship: 'unlinked', failure: null, ...identity };
    return {
      relationship: 'trusted',
      failure: peer.connectionFailure,
      ...identity,
    };
  }

  private async getPeerRelationship(
    accountPubkey: string,
    peerPubkey: string,
  ): Promise<ProximityPeerRelationship> {
    return (await this.getPeerConnectionState(accountPubkey, peerPubkey)).relationship;
  }

  async hasTrustedPeer(accountPubkey: string, peerPubkey: string): Promise<boolean> {
    return (await this.getPeerRelationship(accountPubkey, peerPubkey)) === 'trusted';
  }

  private hasConnectedEndpoint(peerPubkey: string): boolean {
    return Array.from(this.endpointProfiles.entries()).some(
      ([endpointId, profile]) =>
        bytesToHex(profile.publicKey) === peerPubkey && this.connectedEndpoints.has(endpointId),
    );
  }

  private findConnectedInitiatorEndpoint(
    peerPubkey: string,
  ): [string, ProximityProfile] | undefined {
    return Array.from(this.endpointProfiles.entries()).find(
      ([endpointId, profile]) =>
        endpointId.startsWith('c:') &&
        bytesToHex(profile.publicKey) === peerPubkey &&
        this.connectedEndpoints.has(endpointId),
    );
  }

  private async restartClosedInitiator(
    context: EndpointContext,
    peerPubkey: string,
  ): Promise<void> {
    if (context.role !== 'initiator' || context.phase !== 'closed') return;
    if (IS_DEVELOPMENT_BUILD)
      console.info(
        `[nearby] trace explicit restart endpoint=${context.endpointId} generation=${context.generation}`,
      );
    const native = nativeModule();
    await native?.disconnectAsync?.(context.endpointId).catch(() => {});
    // Duplicate-link election may have suppressed this Central endpoint in the
    // native adapter. Disconnect alone intentionally preserves rediscovery
    // policy, so explicitly release that suppression before the retry scan.
    await native?.refreshPeerProfileAsync(context.endpointId).catch(() => {});
    if (this.endpointContexts.get(context.endpointId) === context) {
      this.cleanupEndpoint(context.endpointId);
    }
    this.releaseCentralSuppression(peerPubkey);
    this.scheduleConnectionRetry(peerPubkey, HANDSHAKE_RETRY_BASE_MS);
  }

  private async scanForExplicitRequest(peerPubkey: string): Promise<void> {
    this.releaseCentralSuppression(peerPubkey);
    if (IS_DEVELOPMENT_BUILD)
      console.info(`[nearby] trace explicit scan peer=${peerPubkey.slice(0, 8)}`);
    await this.scan(SCAN_DURATION_MS);
  }

  private surfaceStoredConnectionFailure(
    peerPubkey: string,
    state: ProximityPeerConnectionState,
  ): void {
    if (!state.failure) return;
    this.connectionFailures.set(peerPubkey, state.failure);
    const peer = proximitySessionStore.getState().peers[peerPubkey];
    if (
      peer?.connectionStatus === 'disconnected' &&
      peer.connectionFailure === state.failure
    ) {
      return;
    }
    proximitySessionStore.getState().upsertPeer({
      proximityPubkey: peerPubkey,
      endpointId: peer?.endpointId ?? '',
      displayName: resolveDisplayName(peerPubkey, {
        displayName: peer?.displayName ?? state.displayName ?? '',
      }),
      rssi: peer?.rssi ?? 0,
      lastSeenAt: peer?.lastSeenAt ?? state.lastSeenAt ?? 0,
      deviceStatus: peer?.deviceStatus ?? 'offline',
      connectionStatus: 'disconnected',
      connectionFailure: state.failure,
    });
  }

  private async retryFailedConnection(
    accountPubkey: string,
    peerPubkey: string,
    userInitiated: boolean,
  ): Promise<void> {
    const state = await this.getPeerConnectionState(accountPubkey, peerPubkey);
    if (state.relationship !== 'trusted') return;
    if (state.failure === 'rejected' && !userInitiated) {
      this.surfaceStoredConnectionFailure(peerPubkey, state);
      return;
    }
    if (state.failure) {
      await db
        .update(proximityPeers)
        .set({ connectionFailure: null })
        .where(
          and(
            eq(proximityPeers.accountPubkey, accountPubkey),
            eq(proximityPeers.proximityPubkey, peerPubkey),
          ),
        );
    }
    this.clearConnectionFailure(peerPubkey);
    const endpoint = this.findConnectedInitiatorEndpoint(peerPubkey);
    if (endpoint) {
      const context = this.endpointContexts.get(endpoint[0]);
      if (context?.role === 'initiator' && context.phase === 'closed') {
        await this.restartClosedInitiator(context, peerPubkey);
      } else if (!context || !(await this.resumeRejectedAccess(context))) {
        await this.maybeStartHandshake(endpoint[0]);
      }
    } else if (userInitiated) {
      await this.scanForExplicitRequest(peerPubkey);
    }
  }

  /** Discovery retries clear outcome metadata without implying a live handshake. */
  private clearConnectionFailure(peerPubkey: string): void {
    this.connectionFailures.delete(peerPubkey);
    const peer = proximitySessionStore.getState().peers[peerPubkey];
    if (peer?.connectionFailure) {
      proximitySessionStore.getState().upsertPeer({ ...peer, connectionFailure: null });
    }
  }

  private beginConnectionAttempt(peerPubkey: string): void {
    this.connectionFailures.delete(peerPubkey);
    const peer = proximitySessionStore.getState().peers[peerPubkey];
    if (peer && peer.connectionStatus !== 'connected') {
      proximitySessionStore.getState().upsertPeer({
        ...peer,
        connectionStatus: 'connecting',
        connectionFailure: null,
      });
    }
  }

  private markPeerDisconnected(peerPubkey: string): void {
    this.clearHandshakeRetry(peerPubkey);
    this.connectionFailures.delete(peerPubkey);
    const peer = proximitySessionStore.getState().peers[peerPubkey];
    if (!peer) return;
    proximitySessionStore.getState().upsertPeer({
      ...peer,
      connectionStatus: 'disconnected',
      connectionFailure: null,
    });
  }

  private async markConnectionFailure(
    peerPubkey: string,
    failure: NearbyConnectionFailure,
  ): Promise<void> {
    this.clearHandshakeRetry(peerPubkey);
    this.connectionFailures.set(peerPubkey, failure);
    const peer = proximitySessionStore.getState().peers[peerPubkey];
    if (peer) {
      proximitySessionStore.getState().upsertPeer({
        ...peer,
        connectionStatus: 'disconnected',
        connectionFailure: failure,
      });
    }
    if (this.accountPubkey) {
      await db
        .update(proximityPeers)
        .set({ connectionFailure: failure })
        .where(
          and(
            eq(proximityPeers.accountPubkey, this.accountPubkey),
            eq(proximityPeers.proximityPubkey, peerPubkey),
            isNotNull(proximityPeers.connectedAt),
          ),
        );
    }
  }

  async requestChat(
    accountPubkey: string,
    peerPubkey: string,
  ): Promise<ProximityChatRequestResult> {
    const relationship = await this.getPeerRelationship(accountPubkey, peerPubkey);
    if (IS_DEVELOPMENT_BUILD)
      console.info(
        `[nearby] trace request-chat peer=${peerPubkey.slice(0, 8)} relationship=${relationship}`,
      );
    if (relationship === 'blocked') return 'declined';
    if (this.accountPubkey !== accountPubkey || !this.identity || !this.sessionStarted) {
      try {
        await this.start(accountPubkey, true);
      } catch {
        return 'timeout';
      }
    }
    if (relationship === 'trusted' && this.readyEndpoints(peerPubkey).length > 0) return 'accepted';
    const existing = this.pendingChatRequests.get(peerPubkey);
    if (existing) return existing.promise;
    let resolveRequest: (result: ProximityChatRequestResult) => void = () => {};
    const promise = new Promise<ProximityChatRequestResult>((resolve) => {
      resolveRequest = resolve;
    });
    const timer = setTimeout(
      () => this.finishChatRequest(peerPubkey, 'timeout'),
      ACCESS_TIMEOUT_MS,
    );
    this.pendingChatRequests.set(peerPubkey, {
      peerPubkey,
      promise,
      resolve: resolveRequest,
      timer,
    });
    proximitySessionStore.getState().setOutgoingChatRequest(peerPubkey, true);
    if (relationship === 'trusted') {
      try {
        await this.retryFailedConnection(accountPubkey, peerPubkey, true);
      } catch {
        this.finishChatRequest(peerPubkey, 'failed');
      }
      void this.reconcileScanning().catch(() => {});
      return promise;
    }
    this.clearConnectionFailure(peerPubkey);
    const endpoint = this.findConnectedInitiatorEndpoint(peerPubkey);
    if (endpoint) {
      const context = this.endpointContexts.get(endpoint[0]);
      if (context?.role === 'initiator' && context.phase === 'closed') {
        await this.restartClosedInitiator(context, peerPubkey);
      } else if (!context || !(await this.resumeRejectedAccess(context))) {
        await this.maybeStartHandshake(endpoint[0]);
      }
    } else {
      await this.scanForExplicitRequest(peerPubkey).catch(() => {
        this.finishChatRequest(peerPubkey, 'failed');
      });
    }
    await this.reconcileScanning().catch(() => {});
    return promise;
  }

  /**
   * Best-effort recovery after queued conversation work. A trusted peer that
   * declined the previous connection stays idle until `requestChat` is called
   * by an explicit user action.
   */
  async recoverConnection(accountPubkey: string, peerPubkey: string): Promise<void> {
    if (this.accountPubkey !== accountPubkey || !this.identity || !this.sessionStarted) {
      await this.start(accountPubkey, true);
    }
    await this.retryFailedConnection(accountPubkey, peerPubkey, false);
    await this.reconcileScanning().catch(() => {});
  }

  async respondToChatRequest(
    requestId: string,
    accepted: boolean,
  ): Promise<{ peerPubkey: string; displayName: string } | null> {
    const request = this.incomingChatRequests.get(requestId);
    if (!request) return null;
    const context = this.endpointContexts.get(request.endpointId);
    if (!context?.secure || context.phase !== 'awaiting_access') {
      this.removeIncomingChatRequest(requestId);
      return null;
    }
    if (accepted) await this.ensureAcceptedConversation(request.peerPubkey, request.displayName);
    this.removeIncomingChatRequest(requestId);
    await this.sendSecure(
      context,
      ProximityPacketType.AccessResult,
      encodeAccessResult(
        accepted ? ProximityAccessDecision.Accepted : ProximityAccessDecision.Declined,
      ),
    );
    if (accepted) await this.markReady(context);
    else {
      // Rejection is directional outcome metadata for the Initiator. The
      // Responder deliberately declined and remains merely unlinked.
      this.markPeerDisconnected(request.peerPubkey);
      this.holdRejectedAccess(context);
    }
    return { peerPubkey: request.peerPubkey, displayName: request.displayName };
  }

  private finishChatRequest(peerPubkey: string, result: ProximityChatRequestResult): void {
    const pending = this.pendingChatRequests.get(peerPubkey);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pendingChatRequests.delete(peerPubkey);
    proximitySessionStore.getState().setOutgoingChatRequest(peerPubkey, false);
    if (result !== 'accepted') {
      const failure: NearbyConnectionFailure = result === 'declined' ? 'rejected' : 'failed';
      this.connectionFailures.set(peerPubkey, failure);
      const peer = proximitySessionStore.getState().peers[peerPubkey];
      if (peer) {
        proximitySessionStore.getState().upsertPeer({
          ...peer,
          connectionStatus: 'disconnected',
          connectionFailure: failure,
        });
      }
    }
    pending.resolve(result);
  }

  private removeIncomingChatRequest(requestId: string): void {
    const request = this.incomingChatRequests.get(requestId);
    if (request) clearTimeout(request.timer);
    this.incomingChatRequests.delete(requestId);
    proximitySessionStore.getState().removeIncomingChatRequest(requestId);
  }

  private async expireIncomingChatRequest(requestId: string): Promise<void> {
    const request = this.incomingChatRequests.get(requestId);
    if (!request) return;
    this.removeIncomingChatRequest(requestId);
    const context = this.endpointContexts.get(request.endpointId);
    if (context?.secure && context.phase === 'awaiting_access') {
      await this.sendSecure(
        context,
        ProximityPacketType.AccessResult,
        encodeAccessResult(ProximityAccessDecision.Expired),
      ).catch(() => {});
      this.abortEndpoint(context.endpointId, context);
    }
  }

  private async ensureAcceptedConversation(peerPubkey: string, displayName: string): Promise<void> {
    if (!this.accountPubkey) throw new Error('Nearby session is unavailable');
    const identity = await this.assertConversationWritable(this.accountPubkey, peerPubkey);
    const now = Math.floor(Date.now() / 1000);
    await db.transaction(async (tx) => {
      await tx
        .insert(proximityPeers)
        .values({
          accountPubkey: this.accountPubkey!,
          proximityPubkey: peerPubkey,
          displayName,
          lastSeenAt: now,
          connectedAt: now,
          blockedAt: null,
          connectionFailure: null,
        })
        .onConflictDoUpdate({
          target: [proximityPeers.accountPubkey, proximityPeers.proximityPubkey],
          set: {
            displayName,
            lastSeenAt: now,
            connectedAt: now,
            blockedAt: null,
            connectionFailure: null,
          },
        });
      await tx
        .insert(conversations)
        .values({
          accountPubkey: this.accountPubkey!,
          conversationKey: peerPubkey,
          deliveryKind: 'proximity',
          proximityAccountPubkey: identity.proximityPubkey,
          name: displayName,
          lastMessageAt: now,
          lastMessageOrderAt: now * 1000,
          lastMessageId: null,
          unreadCount: 0,
          hasReplied: true,
        })
        .onConflictDoUpdate({
          target: [conversations.accountPubkey, conversations.conversationKey],
          set: { name: displayName, deleted: false, hasReplied: true },
        });
    });
  }

  async removeConnection(accountPubkey: string, peerPubkey: string): Promise<void> {
    await db
      .update(proximityPeers)
      .set({ connectedAt: null, connectionFailure: null })
      .where(
        and(
          eq(proximityPeers.accountPubkey, accountPubkey),
          eq(proximityPeers.proximityPubkey, peerPubkey),
        ),
      );
    if (this.accountPubkey === accountPubkey) await this.revokePeer(peerPubkey);
  }

  async blockPeer(accountPubkey: string, peerPubkey: string): Promise<void> {
    const now = Math.floor(Date.now() / 1000);
    await db
      .update(proximityPeers)
      .set({ connectedAt: null, blockedAt: now, connectionFailure: null })
      .where(
        and(
          eq(proximityPeers.accountPubkey, accountPubkey),
          eq(proximityPeers.proximityPubkey, peerPubkey),
        ),
      );
    if (this.accountPubkey !== accountPubkey) return;
    for (const request of this.incomingChatRequests.values()) {
      if (request.peerPubkey !== peerPubkey) continue;
      const context = this.endpointContexts.get(request.endpointId);
      if (context?.secure) {
        void this.sendSecure(
          context,
          ProximityPacketType.AccessResult,
          encodeAccessResult(ProximityAccessDecision.Blocked),
        ).catch(() => {});
      }
      this.removeIncomingChatRequest(request.requestId);
    }
    await this.revokePeer(peerPubkey);
  }

  async unblockPeer(accountPubkey: string, peerPubkey: string): Promise<void> {
    await db
      .update(proximityPeers)
      .set({ blockedAt: null })
      .where(
        and(
          eq(proximityPeers.accountPubkey, accountPubkey),
          eq(proximityPeers.proximityPubkey, peerPubkey),
        ),
      );
  }

  private async revokePeer(peerPubkey: string): Promise<void> {
    this.canonicalEndpoints.delete(peerPubkey);
    const contexts = this.authenticatedEndpoints(peerPubkey)
      .map((endpointId) => this.endpointContexts.get(endpointId))
      .filter((context): context is EndpointContext => context != null);
    await Promise.all(
      contexts.map(async (context) => {
        if (!context.secure || context.phase === 'closed') return;
        await this.sendSecure(
          context,
          ProximityPacketType.Close,
          encodeClose(ProximityErrorCode.AccessDenied),
        ).catch(() => {});
      }),
    );
    for (const context of contexts) this.abortEndpoint(context.endpointId, context);
    this.markPeerDisconnected(peerPubkey);
  }

  private async handleMessage(context: EndpointContext, payload: Uint8Array): Promise<void> {
    if (!this.identity || !this.accountPubkey || !context.peerPubkey || context.phase !== 'ready') {
      throw new Error('Message before ready');
    }
    let rumor: Rumor;
    try {
      rumor = decodeRumor(payload);
    } catch {
      await this.sendSecure(
        context,
        ProximityPacketType.Error,
        encodeError(ProximityErrorCode.InvalidEvent, false),
      );
      return;
    }
    const rumorId = rumor.id;
    const computedId = getEventHash(rumor as unknown as Event);
    if (computedId !== rumorId || rumor.pubkey !== context.peerPubkey) {
      await this.sendMessageAck(
        context,
        rumorId,
        ProximityMessageStatus.Rejected,
        ProximityErrorCode.InvalidEvent,
      );
      return;
    }
    const recipientTags = rumor.tags.filter((tag) => tag[0] === 'p');
    const replyToId = getReplyToId(rumor.tags);
    const validReaction = this.validReaction(rumor, replyToId);
    const validFile = rumor.kind !== KIND_FILE || findFileMeta(rumor.content, rumor.tags) != null;
    if (
      recipientTags.length !== 1 ||
      recipientTags[0].length < 2 ||
      recipientTags[0][1] !== this.identity.proximityPubkey ||
      rumor.created_at > Math.floor(Date.now() / 1000) + 600 ||
      (replyToId !== undefined && !validPubkey(replyToId)) ||
      !validReaction ||
      !validFile ||
      !(await this.hasTrustedPeer(this.accountPubkey, context.peerPubkey))
    ) {
      await this.sendMessageAck(
        context,
        rumorId,
        ProximityMessageStatus.Rejected,
        ProximityErrorCode.InvalidEvent,
      );
      return;
    }
    try {
      const inserted = await this.storeRumor(rumor, context.peerPubkey);
      if (inserted === null) {
        await this.sendMessageAck(
          context,
          rumorId,
          ProximityMessageStatus.Rejected,
          ProximityErrorCode.AccessDenied,
        );
      } else {
        await this.sendMessageAck(
          context,
          rumorId,
          inserted ? ProximityMessageStatus.Stored : ProximityMessageStatus.Duplicate,
          ProximityErrorCode.None,
        );
      }
    } catch {
      await this.sendMessageAck(
        context,
        rumorId,
        ProximityMessageStatus.Rejected,
        ProximityErrorCode.StorageFailed,
      );
    }
  }

  private validReaction(rumor: Rumor, replyToId: string | undefined): boolean {
    if (rumor.kind !== KIND_REACTION) return true;
    if (!replyToId) return false;
    const emojiTags = rumor.tags.filter((tag) => tag[0] === 'emoji');
    const emojis = customEmojisFromMessageTags(emojiTags);
    const byShortcode = new Map(emojis.map((emoji) => [emoji.shortcode.toLowerCase(), emoji]));
    const unicode = shortEmojiMessage(rumor.content)?.count === 1 && emojiTags.length === 0;
    const custom =
      emojiTags.length === 1 &&
      emojis.length === 1 &&
      shortCustomEmojiMessage(rumor.content, byShortcode)?.length === 1;
    return unicode || custom;
  }

  private async sendMessageAck(
    context: EndpointContext,
    rumorId: string,
    status: ProximityMessageStatus,
    errorCode: ProximityErrorCode,
  ): Promise<void> {
    await this.sendSecure(
      context,
      ProximityPacketType.MessageAck,
      encodeMessageAck({
        rumorId: hexToBytes(rumorId),
        status,
        errorCode,
      }),
    ).catch(() => {});
  }

  private async handleMessageAck(context: EndpointContext, payload: Uint8Array): Promise<void> {
    if (!this.accountPubkey || !context.peerPubkey || context.phase !== 'ready') return;
    const ack = decodeMessageAck(payload);
    const rumorId = bytesToHex(ack.rumorId);
    const pending = this.pendingMessages.get(rumorId);
    if (
      !pending ||
      pending.peerPubkey !== context.peerPubkey ||
      pending.endpointId !== context.endpointId
    )
      return;
    const [row] = await db
      .select()
      .from(outbox)
      .where(
        and(
          eq(outbox.messageId, rumorId),
          eq(outbox.accountPubkey, this.accountPubkey),
          eq(outbox.deliveryKind, 'proximity'),
          eq(outbox.conversationKey, context.peerPubkey),
        ),
      )
      .limit(1);
    if (
      !row ||
      row.pendingPayload?.deliveryKind !== 'proximity' ||
      row.pendingPayload.rumor.id !== rumorId
    )
      return;
    this.pendingMessages.delete(rumorId);
    const timer = this.ackTimers.get(rumorId);
    if (timer) clearTimeout(timer);
    this.ackTimers.delete(rumorId);
    if (ack.status === ProximityMessageStatus.Rejected) {
      if (
        ack.errorCode === ProximityErrorCode.StorageFailed ||
        ack.errorCode === ProximityErrorCode.RateLimited
      ) {
        await this.defer(rumorId, row.attempts, `Nearby error ${ack.errorCode}`);
      } else {
        await db.transaction(async (tx) => {
          await tx
            .update(outbox)
            .set({
              status: 'failed',
              lastError: `Nearby error ${ack.errorCode}`,
              updatedAt: Math.floor(Date.now() / 1000),
            })
            .where(eq(outbox.messageId, rumorId));
          await tx
            .update(messages)
            .set({ deliveryStatus: 'failed' })
            .where(
              and(
                eq(messages.accountPubkey, this.accountPubkey!),
                eq(messages.id, rumorId),
              ),
            );
        });
        deliveryStatusStore.getState().setProximityPhase(rumorId, 'failed');
      }
      return;
    }
    await db.transaction(async (tx) => {
      const updatedAt = Math.floor(Date.now() / 1000);
      await tx
        .insert(messageDeliveries)
        .values({
          messageId: rumorId,
          conversationKey: context.peerPubkey!,
          copies: [{ recipient: context.peerPubkey!, self: false, relays: [] }],
          status: 'sent',
          updatedAt,
        })
        .onConflictDoUpdate({
          target: messageDeliveries.messageId,
          set: { status: 'sent', updatedAt },
        });
      await tx
        .update(messages)
        .set({ deliveryStatus: 'sent' })
        .where(
          and(
            eq(messages.accountPubkey, this.accountPubkey!),
            eq(messages.id, rumorId),
          ),
        );
      await tx.delete(outbox).where(eq(outbox.messageId, rumorId));
    });
    deliveryStatusStore.getState().setProximityPhase(rumorId, 'sent');
    void this.drain();
    void this.stopIfIdle();
  }

  async assertConversationWritable(
    accountPubkey: string,
    peerPubkey: string,
  ): Promise<ProximityIdentity> {
    const identity = await ensureProximityIdentity(accountPubkey);
    const conversation = await db
      .select({
        deliveryKind: conversations.deliveryKind,
        proximityAccountPubkey: conversations.proximityAccountPubkey,
      })
      .from(conversations)
      .where(
        and(
          eq(conversations.accountPubkey, accountPubkey),
          eq(conversations.conversationKey, peerPubkey),
        ),
      )
      .limit(1)
      .get();
    if (
      conversation &&
      (conversation.deliveryKind !== 'proximity' ||
        conversation.proximityAccountPubkey !== identity.proximityPubkey)
    )
      throw new ProximityConversationReadOnlyError();
    return identity;
  }

  async fetchAttachmentDirect(opts: {
    accountPubkey: string;
    peerPubkey: string;
    rumorId: string;
    signal?: AbortSignal;
    onProgress?: (receivedBytes: number, totalBytes: number) => void;
  }): Promise<string> {
    if (!validPubkey(opts.rumorId) || !validPubkey(opts.peerPubkey)) {
      throw new Error('Invalid Nearby attachment request');
    }
    if (this.accountPubkey !== opts.accountPubkey || !this.sessionStarted) {
      await this.start(opts.accountPubkey, false);
    }
    let endpointId = this.canonicalEndpoints.get(opts.peerPubkey);
    let context = endpointId ? this.endpointContexts.get(endpointId) : undefined;
    const handshaking = Array.from(this.endpointContexts.values()).some(
      (candidate) =>
        candidate.peerPubkey === opts.peerPubkey &&
        candidate.phase !== 'ready' &&
        candidate.phase !== 'closed',
    );
    if ((!context || context.phase !== 'ready') && handshaking) {
      await this.waitForFileReady(opts.peerPubkey, opts.signal);
      endpointId = this.canonicalEndpoints.get(opts.peerPubkey);
      context = endpointId ? this.endpointContexts.get(endpointId) : undefined;
    }
    if (
      !context ||
      context.phase !== 'ready' ||
      ((context.selectedCapabilities ?? 0n) & PROXIMITY_CAPABILITY_FILE_TRANSFER) === 0n
    ) {
      throw new Error('Nearby file transfer is unavailable');
    }
    const row = await db
      .select({ rumor: messages.rumor, senderPubkey: messages.senderPubkey })
      .from(messages)
      .where(
        and(
          eq(messages.accountPubkey, opts.accountPubkey),
          eq(messages.id, opts.rumorId),
          eq(messages.conversationKey, opts.peerPubkey),
        ),
      )
      .limit(1)
      .get();
    const offer = row ? parseNearbyFileOffer(row.rumor.content, row.rumor.tags) : null;
    if (!row || row.senderPubkey !== opts.peerPubkey || !offer) {
      throw new Error('Nearby attachment is not eligible for direct transfer');
    }
    return proximityFileTransferService.fetchDirect({
      connection: this.fileConnection(context),
      rumorId: opts.rumorId,
      offer,
      signal: opts.signal,
      onProgress: opts.onProgress,
    });
  }

  private waitForFileReady(peerPubkey: string, signal?: AbortSignal): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        unsubscribe();
        signal?.removeEventListener('abort', abort);
        if (error) reject(error);
        else resolve();
      };
      const check = () => {
        const endpointId = this.canonicalEndpoints.get(peerPubkey);
        const context = endpointId ? this.endpointContexts.get(endpointId) : undefined;
        if (context?.phase === 'ready') finish();
      };
      const abort = () => {
        const error = new Error('Nearby file transfer cancelled');
        error.name = 'AbortError';
        finish(error);
      };
      const unsubscribe = proximitySessionStore.subscribe(check);
      const timer = setTimeout(
        () => finish(new Error('Nearby file session did not become ready')),
        HANDSHAKE_TIMEOUT_MS,
      );
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) abort();
      else check();
    });
  }

  async importRumors(
    accountPubkey: string,
    proximityAccountPubkey: string,
    rumors: Rumor[],
  ): Promise<{ inserted: number; existing: number; invalid: number }> {
    if (!validPubkey(proximityAccountPubkey))
      return { inserted: 0, existing: 0, invalid: rumors.length };
    // Resolve once per batch, including when the Nearby transport is inactive.
    // Reading the public identity must not create or rotate device keys.
    const currentPubkey = (await hasProximityIdentity(accountPubkey))
      ? getCachedProximityPubkey(accountPubkey)
      : undefined;
    let inserted = 0;
    let existing = 0;
    let invalid = 0;
    const candidates = rumors
      .filter(
        (rumor) =>
          rumor.kind === KIND_CHAT || rumor.kind === KIND_FILE || rumor.kind === KIND_REACTION,
      )
      .map((rumor) => {
        const currentPeer = currentPubkey ? archivedProximityPeer(rumor, currentPubkey) : null;
        return {
          rumor,
          peer: currentPeer ?? archivedProximityPeer(rumor, proximityAccountPubkey),
          owner: currentPeer ? currentPubkey! : proximityAccountPubkey,
        };
      })
      .sort((a, b) => a.rumor.created_at - b.rumor.created_at);
    invalid += rumors.length - candidates.length;
    for (const candidate of candidates) {
      if (!candidate.peer) {
        invalid += 1;
        continue;
      }
      const result = await this.storeRumor(candidate.rumor, candidate.peer, {
        accountPubkey,
        proximityAccountPubkey: candidate.owner,
        importing: true,
      });
      if (result === true) inserted += 1;
      else if (result === false) existing += 1;
      else invalid += 1;
    }
    return { inserted, existing, invalid };
  }

  async sendMessage(opts: {
    accountPubkey: string;
    peerPubkey: string;
    content: string;
    extraTags?: string[][];
    replyToId?: string;
    subject?: string;
    timestamp?: RumorTimestamp;
  }): Promise<Rumor> {
    if (opts.replyToId !== undefined && !validPubkey(opts.replyToId))
      throw new Error('Invalid reply target');
    const timestamp = opts.timestamp ?? nextRumorTimestamp();
    const tags = [['p', opts.peerPubkey], ...(opts.extraTags ?? [])];
    if (opts.replyToId) tags.push(['e', opts.replyToId]);
    if (opts.subject) tags.push(['subject', opts.subject]);
    return this.sendRumor(opts.accountPubkey, opts.peerPubkey, {
      kind: KIND_CHAT,
      content: normalizeBareNostrUris(opts.content),
      tags: withMessageOrderTag(tags, timestamp.millisecond),
      created_at: timestamp.createdAt,
    });
  }

  async sendReaction(opts: {
    accountPubkey: string;
    peerPubkey: string;
    targetMessageId: string;
    emoji: string | CustomEmoji;
    timestamp?: RumorTimestamp;
  }): Promise<Rumor> {
    if (!validPubkey(opts.targetMessageId)) throw new Error('Invalid reaction target');
    if (typeof opts.emoji === 'string' && shortEmojiMessage(opts.emoji)?.count !== 1) {
      throw new Error('Reaction must be one emoji');
    }
    const timestamp = opts.timestamp ?? nextRumorTimestamp();
    const custom = typeof opts.emoji === 'string' ? null : opts.emoji;
    return this.sendRumor(opts.accountPubkey, opts.peerPubkey, {
      kind: KIND_REACTION,
      content: custom ? `:${custom.shortcode}:` : (opts.emoji as string),
      tags: withMessageOrderTag(
        [
          ['p', opts.peerPubkey],
          ['e', opts.targetMessageId],
          ...(custom ? [buildEmojiTag(custom)] : []),
        ],
        timestamp.millisecond,
      ),
      created_at: timestamp.createdAt,
    });
  }

  async forwardMessage(opts: {
    accountPubkey: string;
    peerPubkey: string;
    kind: number;
    content: string;
    contentTags: string[][];
    timestamp?: RumorTimestamp;
  }): Promise<Rumor> {
    if (opts.kind !== KIND_CHAT && opts.kind !== KIND_FILE) {
      throw new Error('Unsupported Nearby message kind');
    }
    const timestamp = opts.timestamp ?? nextRumorTimestamp();
    return this.sendRumor(opts.accountPubkey, opts.peerPubkey, {
      kind: opts.kind,
      content: opts.content,
      tags: withMessageOrderTag(
        [['p', opts.peerPubkey], ...opts.contentTags],
        timestamp.millisecond,
      ),
      created_at: timestamp.createdAt,
    });
  }

  private async sendRumor(
    accountPubkey: string,
    peerPubkey: string,
    template: EventTemplate,
  ): Promise<Rumor> {
    const identity = await this.assertConversationWritable(accountPubkey, peerPubkey);
    if (this.accountPubkey && this.accountPubkey !== accountPubkey) await this.stop(true);
    this.accountPubkey = accountPubkey;
    this.identity = identity;
    const rumor = buildRumor(template, identity.proximityPubkey);
    if ((await this.storeRumor(rumor, peerPubkey)) !== true)
      throw new Error('Could not store Nearby message');
    const pendingPayload: PendingPublishPayload = {
      version: 1,
      deliveryKind: 'proximity',
      rumor,
    };
    const now = Math.floor(Date.now() / 1000);
    await db.transaction(async (tx) => {
      await tx
        .insert(outbox)
        .values({
          messageId: rumor.id!,
          accountPubkey,
          conversationKey: peerPubkey,
          deliveryKind: 'proximity',
          status: 'queued',
          attempts: 0,
          nextAttemptAt: now,
          pendingPayload,
          updatedAt: now,
        })
        .onConflictDoNothing();
      await tx
        .update(messages)
        .set({ deliveryStatus: 'queued' })
        .where(
          and(
            eq(messages.accountPubkey, accountPubkey),
            eq(messages.id, rumor.id!),
          ),
        );
    });
    deliveryStatusStore.getState().setProximityPhase(rumor.id!, 'queued');
    void this.drain();
    return rumor;
  }

  private async storeRumor(
    rumor: Rumor,
    peerPubkey: string,
    archive?: {
      accountPubkey: string;
      proximityAccountPubkey: string;
      importing: true;
    },
  ): Promise<boolean | null> {
    const accountPubkey = archive?.accountPubkey ?? this.accountPubkey;
    const localPubkey = archive?.proximityAccountPubkey ?? this.identity?.proximityPubkey;
    if (!accountPubkey || !localPubkey) return false;
    const orderAt = messageOrderAt(rumor);
    const replyToId = getReplyToId(rumor.tags) ?? null;
    const subject = getSubject(rumor.tags) ?? null;
    const incoming = rumor.pubkey !== localPubkey;
    const activePeer = archive ? null : this.activePeer;
    const markRead = archive?.importing || !incoming || activePeer === peerPubkey;
    const reaction = rumor.kind === KIND_REACTION;
    const stored = await db.transaction(async (tx) => {
      const existing = await tx
        .select()
        .from(conversations)
        .where(
          and(
            eq(conversations.accountPubkey, accountPubkey),
            eq(conversations.conversationKey, peerPubkey),
          ),
        )
        .limit(1)
        .get();
      if (
        existing &&
        (existing.deliveryKind !== 'proximity' || existing.proximityAccountPubkey !== localPubkey)
      )
        return null;
      if (!existing && reaction) return null;
      const inserted = await tx
        .insert(messages)
        .values({
          accountPubkey,
          id: rumor.id!,
          conversationKey: peerPubkey,
          senderPubkey: rumor.pubkey,
          kind: rumor.kind,
          content: rumor.content,
          createdAt: rumor.created_at,
          orderAt,
          replyToId,
          subject,
          tags: rumor.tags,
          rumor,
          sourceRelays: null,
        })
        .onConflictDoNothing()
        .returning({ id: messages.id })
        .all();
      if (inserted.length === 0) return false;
      if (rumor.kind === KIND_FILE) {
        await recordAttachmentMedia(tx, rumor, accountPubkey, peerPubkey);
      } else if (rumor.kind === KIND_CHAT) {
        await recordEmbeddedMedia(tx, rumor, accountPubkey, peerPubkey);
      }
      if (reaction) return true;
      const storedPeer = await tx
        .select()
        .from(proximityPeers)
        .where(
          and(
            eq(proximityPeers.accountPubkey, accountPubkey),
            eq(proximityPeers.proximityPubkey, peerPubkey),
          ),
        )
        .limit(1)
        .get();
      const livePeer = proximitySessionStore.getState().peers[peerPubkey];
      const peerName =
        storedPeer?.nickname ?? livePeer?.displayName ?? storedPeer?.displayName ?? null;
      if (!existing) {
        await tx.insert(conversations).values({
          accountPubkey,
          conversationKey: peerPubkey,
          deliveryKind: 'proximity',
          proximityAccountPubkey: localPubkey,
          name: peerName,
          lastMessageAt: rumor.created_at,
          lastMessageOrderAt: orderAt,
          lastMessageId: rumor.id!,
          unreadCount: incoming && !archive && activePeer !== peerPubkey ? 1 : 0,
          hasReplied: true,
          lastReadAt: markRead ? rumor.created_at : null,
          lastReadOrderAt: markRead ? orderAt : null,
          lastReadMessageId: markRead ? rumor.id! : null,
        });
      } else {
        const newest =
          !existing.lastMessageId ||
          isMessageOrderNewer(
            { orderAt, id: rumor.id! },
            { orderAt: existing.lastMessageOrderAt, id: existing.lastMessageId },
          );
        await tx
          .update(conversations)
          .set({
            name: peerName ?? existing.name,
            ...proximityConversationMessageUpdate({
              newest,
              createdAt: rumor.created_at,
              orderAt,
              messageId: rumor.id!,
            }),
            unreadCount:
              existing.unreadCount + (incoming && !archive && activePeer !== peerPubkey ? 1 : 0),
            ...(markRead && (!archive || newest)
              ? {
                  lastReadAt: rumor.created_at,
                  lastReadOrderAt: orderAt,
                  lastReadMessageId: rumor.id!,
                }
              : {}),
          })
          .where(
            and(
              eq(conversations.accountPubkey, accountPubkey),
              eq(conversations.conversationKey, peerPubkey),
            ),
          );
      }
      return true;
    });
    if (stored) {
      // The write already holds every column — merge into the warm tail instead
      // of invalidating it and queueing a full window re-read.
      mergeStoredMessageIntoTail(accountPubkey, {
        accountPubkey,
        id: rumor.id!,
        conversationKey: peerPubkey,
        senderPubkey: rumor.pubkey,
        kind: rumor.kind,
        content: rumor.content,
        createdAt: rumor.created_at,
        orderAt,
        replyToId,
        subject,
        tags: rumor.tags,
        rumor,
        deliveryStatus: null,
        sourceRelays: null,
      });
    }
    return stored;
  }

  private async drain(): Promise<void> {
    if (this.drainRunning) {
      this.drainRequested = true;
      return;
    }
    if (!this.accountPubkey) return;
    const accountPubkey = this.accountPubkey;
    this.drainRunning = true;
    try {
      if (!(await getProximityEnabled(accountPubkey)) || this.accountPubkey !== accountPubkey)
        return;
      const now = Math.floor(Date.now() / 1000);
      const rows = await db
        .select({ entry: outbox })
        .from(outbox)
        .innerJoin(
          messages,
          and(eq(messages.accountPubkey, outbox.accountPubkey), eq(messages.id, outbox.messageId)),
        )
        .where(
          and(
            eq(outbox.accountPubkey, accountPubkey),
            eq(outbox.deliveryKind, 'proximity'),
            inArray(outbox.status, ['queued', 'sending', 'awaiting_ack']),
          ),
        )
        .orderBy(asc(messages.orderAt), desc(messages.id));
      const conversationsSeen = new Set<string>();
      for (const { entry: row } of rows) {
        if (conversationsSeen.has(row.conversationKey)) continue;
        conversationsSeen.add(row.conversationKey);
        if (row.status !== 'queued') continue;
        if (row.nextAttemptAt != null && row.nextAttemptAt > now) {
          this.scheduleRetryAt(row.nextAttemptAt * 1000);
          continue;
        }
        const endpointId = this.canonicalEndpoints.get(row.conversationKey);
        const context = endpointId ? this.endpointContexts.get(endpointId) : undefined;
        if (!context || context.phase !== 'ready') {
          await this.defer(row.messageId, row.attempts + 1);
          continue;
        }
        const payload = row.pendingPayload;
        if (!payload || payload.deliveryKind !== 'proximity') {
          await db.transaction(async (tx) => {
            await tx
              .update(outbox)
              .set({
                status: 'failed',
                lastError: 'Missing proximity rumor',
                updatedAt: now,
              })
              .where(eq(outbox.messageId, row.messageId));
            await tx
              .update(messages)
              .set({ deliveryStatus: 'failed' })
              .where(
                and(
                  eq(messages.accountPubkey, accountPubkey),
                  eq(messages.id, row.messageId),
                ),
              );
          });
          continue;
        }
        await db
          .update(outbox)
          .set({
            status: 'sending',
            attempts: row.attempts + 1,
            updatedAt: now,
          })
          .where(eq(outbox.messageId, row.messageId));
        deliveryStatusStore.getState().setProximityPhase(row.messageId, 'sending');
        try {
          this.pendingMessages.set(row.messageId, {
            peerPubkey: row.conversationKey,
            endpointId: context.endpointId,
          });
          await this.sendSecure(context, ProximityPacketType.Message, encodeRumor(payload.rumor));
          await db
            .update(outbox)
            .set({
              status: 'awaiting_ack',
              lastError: null,
              updatedAt: Math.floor(Date.now() / 1000),
            })
            .where(eq(outbox.messageId, row.messageId));
          deliveryStatusStore.getState().setProximityPhase(row.messageId, 'awaiting_ack');
          const previous = this.ackTimers.get(row.messageId);
          if (previous) clearTimeout(previous);
          this.ackTimers.set(
            row.messageId,
            setTimeout(() => void this.defer(row.messageId, row.attempts + 1), ACK_TIMEOUT_MS),
          );
        } catch (error) {
          await this.defer(
            row.messageId,
            row.attempts + 1,
            error instanceof Error ? error.message : String(error),
          );
        }
      }
    } finally {
      this.drainRunning = false;
      if (this.drainRequested) {
        this.drainRequested = false;
        void this.drain();
      }
    }
  }

  private async defer(messageId: string, attempts: number, error?: string): Promise<void> {
    this.pendingMessages.delete(messageId);
    const timer = this.ackTimers.get(messageId);
    if (timer) clearTimeout(timer);
    this.ackTimers.delete(messageId);
    const delay = RETRY_SECONDS[Math.min(Math.max(0, attempts - 1), RETRY_SECONDS.length - 1)];
    const nextAttemptAt = Math.floor(Date.now() / 1000) + delay;
    const updated = await db
      .update(outbox)
      .set({
        status: 'queued',
        attempts,
        nextAttemptAt,
        lastError: error ?? null,
        updatedAt: Math.floor(Date.now() / 1000),
      })
      .where(eq(outbox.messageId, messageId))
      .returning({ id: outbox.messageId });
    if (updated.length === 0) return;
    deliveryStatusStore.getState().setProximityPhase(messageId, 'queued');
    this.scheduleRetryAt(Date.now() + delay * 1000);
  }

  private scheduleRetryAt(targetAt: number): void {
    if (this.retryTimer && this.retryAt <= targetAt) return;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryAt = targetAt;
    this.retryTimer = setTimeout(
      () => {
        this.retryTimer = null;
        this.retryAt = 0;
        const account = this.accountPubkey;
        const scan = this.sessionStarted
          ? this.refresh()
          : account
            ? this.start(account, false)
            : Promise.resolve();
        void scan.catch(() => {}).finally(() => this.drain());
      },
      Math.max(0, targetAt - Date.now()),
    );
  }

  private async stopIfIdle(): Promise<void> {
    if (!this.accountPubkey) return;
    const [pending] = await db
      .select({ id: outbox.messageId })
      .from(outbox)
      .where(
        and(
          eq(outbox.accountPubkey, this.accountPubkey),
          eq(outbox.deliveryKind, 'proximity'),
          inArray(outbox.status, ['queued', 'sending', 'awaiting_ack']),
        ),
      )
      .limit(1);
    if (!pending && this.references === 0 && this.foregroundAccountPubkey !== this.accountPubkey) {
      await this.stop(false);
    }
  }

  async setFeatureEnabled(accountPubkey: string, enabled: boolean): Promise<void> {
    await setProximityEnabled(accountPubkey, enabled);
    if (enabled) return;
    const transition = this.foregroundTransition
      .catch(() => {})
      .then(async () => {
        if (this.startWork) await this.startWork.catch(() => {});
        if (this.accountPubkey === accountPubkey) await this.stop(true);
      });
    this.foregroundTransition = transition;
    try {
      await transition;
    } catch (error) {
      await setProximityEnabled(accountPubkey, true).catch(() => {});
      throw error;
    }
  }

  private async stop(force: boolean): Promise<void> {
    if (!force && this.references > 0) return;
    if (this.activeForegroundScanAccount === this.accountPubkey) {
      this.activeForegroundScanAccount = null;
      this.foregroundScanUntil = 0;
    }
    if (this.retryTimer) clearTimeout(this.retryTimer);
    if (this.scanningTimer) clearTimeout(this.scanningTimer);
    if (this.chatScanTimer) clearTimeout(this.chatScanTimer);
    this.retryTimer = null;
    this.scanningTimer = null;
    this.chatScanTimer = null;
    this.ackTimers.forEach(clearTimeout);
    this.ackTimers.clear();
    this.electionTimers.forEach(clearTimeout);
    this.electionTimers.clear();
    proximityFileTransferService.stop();
    for (const context of this.endpointContexts.values()) {
      if (context.timer) clearTimeout(context.timer);
      if (context.livenessTimer) clearInterval(context.livenessTimer);
      await context.secure?.destroy();
      await destroyNoiseHandshake(context.noise);
    }
    for (const pubkey of Array.from(this.pendingChatRequests.keys()))
      this.finishChatRequest(pubkey, 'timeout');
    for (const requestId of Array.from(this.incomingChatRequests.keys()))
      this.removeIncomingChatRequest(requestId);
    this.clearDiscoveries();
    this.removeListeners();
    await nativeModule()?.stopSessionAsync();
    proximitySessionStore.getState().resetSession();
    this.accountPubkey = null;
    this.identity = null;
    this.sessionStarted = false;
    this.activePeer = null;
    this.endpointSends.clear();
    this.endpointSecureSends.clear();
    this.endpointReceives.clear();
    this.endpointContexts.clear();
    this.endpointGenerations.clear();
    this.endpointProfiles.clear();
    this.explicitUnsuppressionEndpoints.clear();
    this.endpointSignals.clear();
    this.signalPeerPubkeys.clear();
    this.connectedEndpoints.clear();
    this.ignoredEndpoints.clear();
    this.endpointToPubkey.clear();
    this.canonicalEndpoints.clear();
    this.pendingMessages.clear();
    this.connectionFailures.clear();
    this.connectionDiscoveryTimers.forEach(clearTimeout);
    this.connectionDiscoveryTimers.clear();
    this.handshakeRetryAttempts.clear();
    this.drainRequested = false;
  }
}

const PROXIMITY_SERVICE_GLOBAL_KEY = '__psstpsstProximityServiceV1__';
const proximityGlobal = globalThis as typeof globalThis & {
  [PROXIMITY_SERVICE_GLOBAL_KEY]?: ProximityService;
};

// Expo Router and Electron development reloads can evaluate the service module
// through more than one bundle graph. One process-wide instance is required:
// separate instances have separate send queues and can concurrently write two
// ClientHellos to the same native endpoint, causing the losing write to tear
// down the winner's transport.
export const proximityService =
  proximityGlobal[PROXIMITY_SERVICE_GLOBAL_KEY] ??
  (proximityGlobal[PROXIMITY_SERVICE_GLOBAL_KEY] = new ProximityService());
