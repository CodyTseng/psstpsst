import { NativeModule, requireNativeModule } from 'expo';

import type {
  NoiseKeyPair,
  NoiseOpenResult,
  NoiseRole,
  NoiseSessionResult,
} from './ExpoNoise.types';

declare class ExpoNoiseModule extends NativeModule {
  generateKeyPairAsync(seed: Uint8Array | null): Promise<NoiseKeyPair>;
  createHandshakeAsync(
    role: NoiseRole,
    staticPrivateKey: Uint8Array,
    fixedEphemeralPrivateKey: Uint8Array | null,
  ): Promise<string>;
  writeHandshakeAsync(handle: string, payload: Uint8Array): Promise<Uint8Array>;
  readHandshakeAsync(handle: string, message: Uint8Array): Promise<Uint8Array>;
  getRemoteStaticKeyAsync(handle: string): Promise<Uint8Array>;
  finishHandshakeAsync(handle: string, maxRecordSize: number): Promise<NoiseSessionResult>;
  destroyHandshakeAsync(handle: string): Promise<void>;
  shouldRotateSessionAsync(handle: string, nextPayloadLength: number): Promise<boolean>;
  sealAsync(handle: string, type: number, payload: Uint8Array): Promise<Uint8Array>;
  openAsync(handle: string, record: Uint8Array): Promise<NoiseOpenResult>;
  destroySessionAsync(handle: string): Promise<void>;
}

export default requireNativeModule<ExpoNoiseModule>('ExpoNoise');
