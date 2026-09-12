export type NoiseRole = 'initiator' | 'responder';

export type NoiseKeyPair = {
  privateKey: Uint8Array;
  publicKey: Uint8Array;
};

export type NoiseSessionResult = {
  handle: string;
  sessionId: Uint8Array;
};

export type NoiseOpenResult = {
  type: number;
  payload: Uint8Array;
};
