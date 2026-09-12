/**
 * Port for the BLE duplex transport behind nearby (proximity) messaging:
 * advertising the local peer profile, scanning for peers, and exchanging
 * wire frames with connected endpoints. The session/peer-management business
 * logic lives in `services/proximity/proximity.service.ts`; this port exposes
 * only the native transport primitives it drives.
 *
 * Implementations must tolerate the capability being absent (Expo Go, a dev
 * client built before the native module was added, or a platform without
 * Bluetooth): `isAvailable()` returns false and every other method becomes a
 * no-op / resolves to a benign value, so the app boots normally regardless.
 * Callers that require the transport check `isAvailable()` first and surface
 * their own error, matching the previous null-module handling.
 *
 * Transport operations are async-first — see the module note in
 * `secure-storage.ts`. Listener registration (`addListener`) and the
 * availability check are non-I/O and stay synchronous.
 */

/** Handle returned by `addListener`; call `remove()` to unsubscribe. */
export type ProximityTransportSubscription = { remove(): void };

export interface ProximityTransportPort {
  /** Whether the native transport capability is present at all. */
  isAvailable(): boolean;
  /**
   * Request the OS permissions the transport needs. On Android this asks for
   * the runtime Bluetooth permissions (scan/connect/advertise on API 31+,
   * fine location below); other platforms need nothing and resolve granted.
   */
  requestPermissions(): Promise<boolean>;
  /** Start advertising the given binary peer profile. */
  startAdvertisingAsync(profile: Uint8Array): Promise<void>;
  /** Update the advertised profile of a running session. */
  updateProfileAsync(profile: Uint8Array): Promise<void>;
  /** Prefer the peripheral role for a duplicate endpoint connection. */
  preferPeripheralAsync(endpointId: string): Promise<void>;
  /** Tear down one endpoint without suppressing its future rediscovery. */
  disconnectAsync?(endpointId: string): Promise<void>;
  /** Scan for nearby peers for `scanDurationMs`. */
  startScanAsync(scanDurationMs: number): Promise<void>;
  /** Stop an active scan. */
  stopScanAsync(): Promise<void>;
  /** Tear down the whole transport session (advertising, scanning, links). */
  stopSessionAsync(): Promise<void>;
  /** Re-request the profile of a connected endpoint. */
  refreshPeerProfileAsync(endpointId: string): Promise<void>;
  /** Send one complete binary protocol packet to a connected endpoint. */
  sendAsync(endpointId: string, payload: Uint8Array): Promise<void>;
  /**
   * Subscribe to a transport event (e.g. `onPeer`, `onMessage`). Connection,
   * peer, and message events carry the native connection `generation` so a
   * stable platform endpoint ID cannot mix successive physical links. Returns
   * a subscription whose `remove()` unsubscribes.
   */
  addListener(
    name: string,
    listener: (event: Record<string, unknown>) => void,
  ): ProximityTransportSubscription;
}
