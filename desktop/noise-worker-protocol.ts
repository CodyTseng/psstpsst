import type { NoiseKeyPair, NoiseOpenResult, NoiseRole, NoiseSession } from '../src/platform/ports/noise';

export type NoiseWorkerMethod =
  | 'generateKeyPair'
  | 'createHandshake'
  | 'writeHandshake'
  | 'readHandshake'
  | 'getRemoteStaticKey'
  | 'finishHandshake'
  | 'destroyHandshake'
  | 'shouldRotateSession'
  | 'seal'
  | 'open'
  | 'destroySession';

export type NoiseWorkerRequest = {
  id: number;
  method: NoiseWorkerMethod;
  args: unknown[];
};

export type NoiseWorkerResponse = {
  id: number;
  result?: NoiseKeyPair | NoiseOpenResult | NoiseSession | Uint8Array | string | boolean | null;
  error?: string;
};

export type CreateHandshakeArgs = [NoiseRole, Uint8Array, Uint8Array | undefined];
