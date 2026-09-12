export type NoiseRole = 'initiator' | 'responder';

export type NoiseKeyPair = {
  privateKey: Uint8Array;
  publicKey: Uint8Array;
};

export type NoiseSession = {
  handle: string;
  sessionId: Uint8Array;
};

export type NoiseOpenResult = {
  type: number;
  payload: Uint8Array;
};

/**
 * Stateful Noise XX sessions. Implementations own every handshake and
 * transport cipher state behind opaque handles and serialize operations per
 * handle. No cipher key or nonce state crosses this boundary.
 */
export interface NoisePort {
  generateKeyPair(seed?: Uint8Array): Promise<NoiseKeyPair>;
  createHandshake(
    role: NoiseRole,
    staticPrivateKey: Uint8Array,
    fixedEphemeralPrivateKey?: Uint8Array,
  ): Promise<string>;
  writeHandshake(handle: string, payload: Uint8Array): Promise<Uint8Array>;
  readHandshake(handle: string, message: Uint8Array): Promise<Uint8Array>;
  getRemoteStaticKey(handle: string): Promise<Uint8Array>;
  finishHandshake(handle: string, maxRecordSize: number): Promise<NoiseSession>;
  destroyHandshake(handle: string): Promise<void>;
  shouldRotateSession(handle: string, nextPayloadLength: number): Promise<boolean>;
  seal(handle: string, type: number, payload: Uint8Array): Promise<Uint8Array>;
  open(handle: string, record: Uint8Array): Promise<NoiseOpenResult>;
  destroySession(handle: string): Promise<void>;
}
