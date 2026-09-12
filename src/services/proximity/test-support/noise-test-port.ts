import { pureJsCrypto } from '@libp2p/noise/crypto/js';
import { wrapCrypto } from '@libp2p/noise/crypto';
import { type CipherState, XXHandshakeState } from '@libp2p/noise/protocol';
import { Uint8ArrayList } from 'uint8arraylist';

import type { NoiseKeyPair, NoiseOpenResult, NoisePort, NoiseRole } from '@/platform';

import {
  PROXIMITY_MAX_RECORDS,
  PROXIMITY_MAX_SESSION_AGE_MS,
  PROXIMITY_MAX_SESSION_BYTES,
  PROXIMITY_VERSION,
  ProximityPacketType,
} from '../proximity-protocol';

const crypto = wrapCrypto(pureJsCrypto);
const protocolName = 'Noise_XX_25519_ChaChaPoly_SHA256';
const prologue = new TextEncoder().encode('PsstPsst Nearby/1');

type HandshakeEntry = {
  role: NoiseRole;
  state: XXHandshakeState;
  reads: number;
  writes: number;
};

type SessionEntry = {
  send: CipherState;
  receive: CipherState;
  sessionId: Uint8Array;
  maxRecordSize: number;
  sendSequence: bigint;
  receiveSequence: bigint;
  sentRecords: number;
  receivedRecords: number;
  sentBytes: number;
  receivedBytes: number;
  startedAt: number;
};

function asBytes(value: Uint8Array | Uint8ArrayList): Uint8Array {
  return value instanceof Uint8Array ? value : value.subarray();
}

function keyPair(seed: Uint8Array): NoiseKeyPair {
  return pureJsCrypto.generateX25519KeyPairFromSeed(seed.slice());
}

function concatBytes(...values: Uint8Array[]): Uint8Array {
  const output = new Uint8Array(values.reduce((sum, value) => sum + value.length, 0));
  let offset = 0;
  for (const value of values) {
    output.set(value, offset);
    offset += value.length;
  }
  return output;
}

function equal(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) difference |= a[index] ^ b[index];
  return difference === 0;
}

function header(type: number, sessionId: Uint8Array, sequence: bigint, length: number) {
  const result = new Uint8Array(48);
  const view = new DataView(result.buffer);
  result[0] = PROXIMITY_VERSION;
  result[1] = type;
  result.set(sessionId, 4);
  view.setBigUint64(36, sequence, false);
  view.setUint32(44, length, false);
  return result;
}

export function createNoiseTestPort(): NoisePort {
  let nextHandle = 1;
  const handshakes = new Map<string, HandshakeEntry>();
  const sessions = new Map<string, SessionEntry>();
  const newHandle = () => String(nextHandle++);
  const getHandshake = (handle: string) => {
    const value = handshakes.get(handle);
    if (!value) throw new Error('Unknown Noise handshake');
    return value;
  };
  const getSession = (handle: string) => {
    const value = sessions.get(handle);
    if (!value) throw new Error('Unknown Noise session');
    return value;
  };

  return {
    async generateKeyPair(seed) {
      return seed ? keyPair(seed) : pureJsCrypto.generateX25519KeyPair();
    },
    async createHandshake(role, staticPrivateKey, fixedEphemeralPrivateKey) {
      const selectedCrypto = fixedEphemeralPrivateKey
        ? { ...crypto, generateKeypair: () => keyPair(fixedEphemeralPrivateKey) }
        : crypto;
      const handle = newHandle();
      handshakes.set(handle, {
        role,
        reads: 0,
        writes: 0,
        state: new XXHandshakeState({
          crypto: selectedCrypto,
          protocolName,
          prologue,
          initiator: role === 'initiator',
          s: keyPair(staticPrivateKey),
        }),
      });
      return handle;
    },
    async writeHandshake(handle, payload) {
      const value = getHandshake(handle);
      let result: Uint8Array | Uint8ArrayList;
      if (value.role === 'initiator' && value.writes === 0) {
        result = value.state.writeMessageA(payload);
      } else if (value.role === 'responder' && value.writes === 0) {
        result = value.state.writeMessageB(payload);
      } else if (value.role === 'initiator' && value.writes === 1) {
        result = value.state.writeMessageC(payload);
      } else {
        throw new Error('Invalid Noise handshake write');
      }
      value.writes += 1;
      return asBytes(result);
    },
    async readHandshake(handle, message) {
      const value = getHandshake(handle);
      let result: Uint8Array | Uint8ArrayList;
      if (value.role === 'responder' && value.reads === 0) {
        result = value.state.readMessageA(new Uint8ArrayList(message));
      } else if (value.role === 'initiator' && value.reads === 0) {
        result = value.state.readMessageB(new Uint8ArrayList(message));
      } else if (value.role === 'responder' && value.reads === 1) {
        result = value.state.readMessageC(new Uint8ArrayList(message));
      } else {
        throw new Error('Invalid Noise handshake read');
      }
      value.reads += 1;
      return asBytes(result);
    },
    async getRemoteStaticKey(handle) {
      const remote = getHandshake(handle).state.rs;
      if (!remote) throw new Error('Noise remote static key is unavailable');
      return asBytes(remote).slice();
    },
    async finishHandshake(handle, maxRecordSize) {
      const value = getHandshake(handle);
      const [initiatorCipher, responderCipher] = value.state.ss.split();
      const initiator = value.role === 'initiator';
      const sessionHandle = newHandle();
      const sessionId = value.state.ss.h.slice();
      sessions.set(sessionHandle, {
        send: initiator ? initiatorCipher : responderCipher,
        receive: initiator ? responderCipher : initiatorCipher,
        sessionId,
        maxRecordSize,
        sendSequence: 0n,
        receiveSequence: 0n,
        sentRecords: 0,
        receivedRecords: 0,
        sentBytes: 0,
        receivedBytes: 0,
        startedAt: Date.now(),
      });
      handshakes.delete(handle);
      return { handle: sessionHandle, sessionId };
    },
    async destroyHandshake(handle) {
      handshakes.delete(handle);
    },
    async shouldRotateSession(handle, nextPayloadLength) {
      const value = getSession(handle);
      return (
        Date.now() - value.startedAt >= PROXIMITY_MAX_SESSION_AGE_MS - 5_000 ||
        value.sentRecords >= PROXIMITY_MAX_RECORDS - 1 ||
        value.receivedRecords >= PROXIMITY_MAX_RECORDS - 1 ||
        value.sentBytes + nextPayloadLength >= PROXIMITY_MAX_SESSION_BYTES ||
        value.receivedBytes >= PROXIMITY_MAX_SESSION_BYTES
      );
    },
    async seal(handle, type, payload) {
      const value = getSession(handle);
      if (payload.length + 64 > value.maxRecordSize) throw new Error('Nearby payload is too large');
      const recordHeader = header(type, value.sessionId, value.sendSequence, payload.length);
      const ciphertext = asBytes(value.send.encryptWithAd(recordHeader, payload));
      value.sendSequence += 1n;
      value.sentRecords += 1;
      value.sentBytes += payload.length;
      return concatBytes(recordHeader, ciphertext);
    },
    async open(handle, record): Promise<NoiseOpenResult> {
      const value = getSession(handle);
      if (record.length < 64 || record.length > value.maxRecordSize) {
        throw new Error('Invalid secure record size');
      }
      const recordHeader = record.subarray(0, 48);
      const view = new DataView(recordHeader.buffer, recordHeader.byteOffset, recordHeader.byteLength);
      if (!equal(recordHeader.subarray(4, 36), value.sessionId)) {
        throw new Error('Mismatched secure session');
      }
      if (view.getBigUint64(36, false) !== value.receiveSequence) {
        throw new Error('Unexpected secure record sequence');
      }
      const payloadLength = view.getUint32(44, false);
      if (payloadLength + 64 !== record.length) throw new Error('Invalid secure payload length');
      const payload = asBytes(value.receive.decryptWithAd(recordHeader, record.subarray(48)));
      value.receiveSequence += 1n;
      value.receivedRecords += 1;
      value.receivedBytes += payload.length;
      return { type: recordHeader[1] as ProximityPacketType, payload };
    },
    async destroySession(handle) {
      sessions.delete(handle);
    },
  };
}
