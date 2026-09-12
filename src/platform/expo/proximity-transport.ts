import { requireOptionalNativeModule } from 'expo-modules-core';
import { base64 } from '@scure/base';
import { PermissionsAndroid, Platform } from 'react-native';

import type {
  ProximityTransportPort,
  ProximityTransportSubscription,
} from '../ports/proximity-transport';

/**
 * The ExpoProximity native module may be absent (Expo Go, or a dev client
 * built before the module was added). `requireOptionalNativeModule` returns
 * null instead of throwing, and we cache the lookup so the transport stays
 * consistently available or unavailable for the process lifetime.
 */
type ExpoProximityModule = {
  startAdvertisingAsync(profile: string): Promise<void>;
  updateProfileAsync(profile: string): Promise<void>;
  preferPeripheralAsync(endpointId: string): Promise<void>;
  disconnectAsync?(endpointId: string): Promise<void>;
  startScanAsync(scanDurationMs: number): Promise<void>;
  stopScanAsync(): Promise<void>;
  stopSessionAsync(): Promise<void>;
  refreshPeerProfileAsync(endpointId: string): Promise<void>;
  sendAsync(endpointId: string, payload: string): Promise<void>;
  addListener(
    name: string,
    listener: (event: Record<string, unknown>) => void,
  ): ProximityTransportSubscription;
};

let cached: ExpoProximityModule | null | undefined;
function load(): ExpoProximityModule | null {
  if (cached !== undefined) return cached;
  cached = requireOptionalNativeModule<ExpoProximityModule>('ExpoProximity') ?? null;
  return cached;
}

const NO_OP_SUBSCRIPTION: ProximityTransportSubscription = { remove() {} };

/** BLE duplex transport backed by the ExpoProximity native module. */
export const proximityTransportAdapter: ProximityTransportPort = {
  isAvailable: () => load() !== null,

  async requestPermissions() {
    if (Platform.OS !== 'android') return true;
    const api = Number(Platform.Version);
    const permissions = api >= 31
      ? [
          'android.permission.BLUETOOTH_SCAN',
          'android.permission.BLUETOOTH_CONNECT',
          'android.permission.BLUETOOTH_ADVERTISE',
        ]
      : ['android.permission.ACCESS_FINE_LOCATION'];
    const result = await PermissionsAndroid.requestMultiple(
      permissions as Parameters<typeof PermissionsAndroid.requestMultiple>[0],
    );
    return permissions.every(
      (permission) =>
        result[permission as keyof typeof result] === PermissionsAndroid.RESULTS.GRANTED,
    );
  },

  startAdvertisingAsync: (profile) =>
    load()?.startAdvertisingAsync(base64.encode(profile)) ?? Promise.resolve(),
  updateProfileAsync: (profile) =>
    load()?.updateProfileAsync(base64.encode(profile)) ?? Promise.resolve(),
  preferPeripheralAsync: (endpointId) =>
    load()?.preferPeripheralAsync(endpointId) ?? Promise.resolve(),
  disconnectAsync: (endpointId) => load()?.disconnectAsync?.(endpointId) ?? Promise.resolve(),
  startScanAsync: (scanDurationMs) => load()?.startScanAsync(scanDurationMs) ?? Promise.resolve(),
  stopScanAsync: () => load()?.stopScanAsync() ?? Promise.resolve(),
  stopSessionAsync: () => load()?.stopSessionAsync() ?? Promise.resolve(),
  refreshPeerProfileAsync: (endpointId) =>
    load()?.refreshPeerProfileAsync(endpointId) ?? Promise.resolve(),
  sendAsync: (endpointId, payload) =>
    load()?.sendAsync(endpointId, base64.encode(payload)) ?? Promise.resolve(),
  addListener: (name, listener) =>
    load()?.addListener(name, (event) => {
      if (name === 'onPeer' && typeof event.profile === 'string') {
        listener({ ...event, profile: base64.decode(event.profile) });
        return;
      }
      if (name === 'onMessage' && typeof event.payload === 'string') {
        listener({ ...event, payload: base64.decode(event.payload) });
        return;
      }
      listener(event);
    }) ?? NO_OP_SUBSCRIPTION,
};
