import type { NoisePort } from '../ports/noise';

import ExpoNoise from '../../../modules/expo-noise';

export const noiseAdapter: NoisePort = {
  generateKeyPair: (seed) => ExpoNoise.generateKeyPairAsync(seed ?? null),
  createHandshake: (role, staticPrivateKey, fixedEphemeralPrivateKey) =>
    ExpoNoise.createHandshakeAsync(role, staticPrivateKey, fixedEphemeralPrivateKey ?? null),
  writeHandshake: (handle, payload) => ExpoNoise.writeHandshakeAsync(handle, payload),
  readHandshake: (handle, message) => ExpoNoise.readHandshakeAsync(handle, message),
  getRemoteStaticKey: (handle) => ExpoNoise.getRemoteStaticKeyAsync(handle),
  finishHandshake: (handle, maxRecordSize) =>
    ExpoNoise.finishHandshakeAsync(handle, maxRecordSize),
  destroyHandshake: (handle) => ExpoNoise.destroyHandshakeAsync(handle),
  shouldRotateSession: (handle, nextPayloadLength) =>
    ExpoNoise.shouldRotateSessionAsync(handle, nextPayloadLength),
  seal: (handle, type, payload) => ExpoNoise.sealAsync(handle, type, payload),
  open: (handle, record) => ExpoNoise.openAsync(handle, record),
  destroySession: (handle) => ExpoNoise.destroySessionAsync(handle),
};
