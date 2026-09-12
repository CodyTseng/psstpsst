import { createStore } from 'zustand/vanilla';

import type { NearbySignalTier } from '@/services/proximity/nearby-signal-tier';

/**
 * Proximity (BLE) session state: discovered peers, connection state, and
 * pending chat requests.
 *
 * Owned by the **service layer**: `proximity.service` drives this vanilla store
 * as its session state machine (and subscribes to it, e.g. to start a pending
 * chat request once the peer comes online). The React binding for components
 * lives in `stores/proximity.store.ts`, keeping the dependency direction
 * UI → services, never the reverse.
 */
export type NearbyConnectionFailure = 'rejected' | 'failed';
/** Whether the peer device is currently observable on the local transport. */
export type NearbyDeviceStatus = 'online' | 'offline';

/** Whether an authenticated messaging session is usable right now. */
export type NearbyConnectionStatus = 'disconnected' | 'connecting' | 'connected';

export type NearbyPeer = {
  proximityPubkey: string;
  endpointId: string;
  displayName: string;
  rssi: number;
  lastSeenAt: number;
  deviceStatus: NearbyDeviceStatus;
  connectionStatus: NearbyConnectionStatus;
  /** Outcome metadata from the last attempt, never a connection state. */
  connectionFailure: NearbyConnectionFailure | null;
};

export type NearbyDiscovery = {
  proximityPubkey: string;
  rssi: number;
  lastSeenAt: number;
  signalFresh: boolean;
  signalTier: NearbySignalTier;
};

export type NearbyChatRequest = {
  requestId: string;
  peerPubkey: string;
  displayName: string;
};

export type ProximitySessionState = {
  bluetoothState: string;
  featureEnabledByAccount: Record<string, boolean>;
  scanning: boolean;
  peers: Record<string, NearbyPeer>;
  discoveries: Record<string, NearbyDiscovery>;
  incomingChatRequests: NearbyChatRequest[];
  outgoingChatRequests: Record<string, true>;
  setBluetoothState: (state: string) => void;
  setFeatureEnabled: (accountPubkey: string, enabled: boolean) => void;
  setScanning: (scanning: boolean) => void;
  upsertPeer: (peer: NearbyPeer) => void;
  upsertDiscovery: (discovery: NearbyDiscovery) => void;
  removeDiscovery: (pubkey: string) => void;
  clearDiscoveries: () => void;
  addIncomingChatRequest: (request: NearbyChatRequest) => void;
  removeIncomingChatRequest: (requestId: string) => void;
  setOutgoingChatRequest: (pubkey: string, pending: boolean) => void;
  resetSession: () => void;
};

export const proximitySessionStore = createStore<ProximitySessionState>()((set) => ({
  bluetoothState: 'unknown',
  featureEnabledByAccount: {},
  scanning: false,
  peers: {},
  discoveries: {},
  incomingChatRequests: [],
  outgoingChatRequests: {},
  setBluetoothState: (bluetoothState) => set({ bluetoothState }),
  setFeatureEnabled: (accountPubkey, enabled) =>
    set((state) => {
      if (state.featureEnabledByAccount[accountPubkey] === enabled) return state;
      return {
        featureEnabledByAccount: {
          ...state.featureEnabledByAccount,
          [accountPubkey]: enabled,
        },
      };
    }),
  setScanning: (scanning) => set({ scanning }),
  upsertPeer: (peer) =>
    set((state) => ({ peers: { ...state.peers, [peer.proximityPubkey]: peer } })),
  upsertDiscovery: (discovery) =>
    set((state) => ({
      discoveries: {
        ...state.discoveries,
        [discovery.proximityPubkey]: discovery,
      },
    })),
  removeDiscovery: (pubkey) =>
    set((state) => {
      if (!state.discoveries[pubkey]) return state;
      const discoveries = { ...state.discoveries };
      delete discoveries[pubkey];
      return { discoveries };
    }),
  clearDiscoveries: () => set({ discoveries: {} }),
  addIncomingChatRequest: (request) =>
    set((state) => {
      if (state.incomingChatRequests.some((item) => item.requestId === request.requestId)) {
        return state;
      }
      return { incomingChatRequests: [...state.incomingChatRequests, request] };
    }),
  removeIncomingChatRequest: (requestId) =>
    set((state) => ({
      incomingChatRequests: state.incomingChatRequests.filter(
        (request) => request.requestId !== requestId,
      ),
    })),
  setOutgoingChatRequest: (pubkey, pending) =>
    set((state) => {
      if (pending) {
        if (state.outgoingChatRequests[pubkey]) return state;
        return {
          outgoingChatRequests: { ...state.outgoingChatRequests, [pubkey]: true },
        };
      }
      if (!state.outgoingChatRequests[pubkey]) return state;
      const outgoingChatRequests = { ...state.outgoingChatRequests };
      delete outgoingChatRequests[pubkey];
      return { outgoingChatRequests };
    }),
  resetSession: () =>
    set({
      scanning: false,
      incomingChatRequests: [],
      outgoingChatRequests: {},
      peers: {},
      discoveries: {},
    }),
}));
