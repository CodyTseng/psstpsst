import { pureJsCrypto } from '@libp2p/noise/crypto/js';
import { wrapCrypto } from '@libp2p/noise/crypto';
import { type CipherState, XXHandshakeState } from '@libp2p/noise/protocol';
import { parentPort } from 'node:worker_threads';
import { Uint8ArrayList } from 'uint8arraylist';

import type { NoiseRole } from '../src/platform/ports/noise';
import type { NoiseWorkerRequest, NoiseWorkerResponse } from './noise-worker-protocol';
import { validNoiseRecordType } from './noise-record-types';

const noiseCrypto = wrapCrypto(pureJsCrypto);
const protocolName = 'Noise_XX_25519_ChaChaPoly_SHA256';
const prologue = new TextEncoder().encode('PsstPsst Nearby/1');
const maxSessionAgeMs = 24 * 60 * 60 * 1000;
const maxRecords = 2 ** 20;
const maxSessionBytes = 64 * 1024 * 1024 * 1024;

type HandshakeEntry = {
  role: NoiseRole;
  state: XXHandshakeState;
  reads: number;
  writes: number;
  fixedEphemeralPrivateKey?: Uint8Array;
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

const handshakes = new Map<string, HandshakeEntry>();
const sessions = new Map<string, SessionEntry>();
let nextHandle = 1;

function newHandle(): string {
  return String(nextHandle++);
}

function asBytes(value: Uint8Array | Uint8ArrayList): Uint8Array {
  return value instanceof Uint8Array ? value : value.subarray();
}

function keyPair(seed: Uint8Array) {
  return pureJsCrypto.generateX25519KeyPairFromSeed(seed.slice());
}

function getHandshake(handle: string): HandshakeEntry {
  const value = handshakes.get(handle);
  if (!value) throw new Error('Unknown Noise handshake');
  return value;
}

function getSession(handle: string): SessionEntry {
  const value = sessions.get(handle);
  if (!value) throw new Error('Unknown Noise session');
  return value;
}

function destroyHandshake(handle: string): null {
  const value = handshakes.get(handle);
  if (value) {
    value.state.s?.privateKey.fill(0);
    value.state.e?.privateKey.fill(0);
    value.fixedEphemeralPrivateKey?.fill(0);
    value.state.ss.cs.k?.fill(0);
    value.state.ss.ck.fill(0);
    handshakes.delete(handle);
  }
  return null;
}

function destroySession(handle: string): null {
  const value = sessions.get(handle);
  if (value) {
    value.send.k?.fill(0);
    value.receive.k?.fill(0);
    sessions.delete(handle);
  }
  return null;
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

function encodeHeader(type: number, sessionId: Uint8Array, sequence: bigint, length: number) {
  const output = new Uint8Array(48);
  const view = new DataView(output.buffer);
  output[0] = 1;
  output[1] = type;
  output.set(sessionId, 4);
  view.setBigUint64(36, sequence, false);
  view.setUint32(44, length, false);
  return output;
}

function requireLength(value: Uint8Array, length: number, name: string): void {
  if (!(value instanceof Uint8Array) || value.length !== length) {
    throw new Error(`Invalid ${name}`);
  }
}

function ensureSessionActive(
  handle: string,
  value: SessionEntry,
  direction: 'send' | 'receive',
  nextPayloadLength = 0,
): void {
  const records = direction === 'send' ? value.sentRecords : value.receivedRecords;
  const bytes = direction === 'send' ? value.sentBytes : value.receivedBytes;
  if (
    Date.now() - value.startedAt >= maxSessionAgeMs ||
    records >= maxRecords ||
    bytes >= maxSessionBytes ||
    (nextPayloadLength > 0 && nextPayloadLength >= maxSessionBytes - bytes)
  ) {
    destroySession(handle);
    throw new Error('Noise session expired');
  }
}

function execute(method: string, args: unknown[]): unknown {
  switch (method) {
    case 'generateKeyPair': {
      const seed = args[0] as Uint8Array | undefined;
      if (!seed) return pureJsCrypto.generateX25519KeyPair();
      requireLength(seed, 32, 'Noise seed');
      try {
        return keyPair(seed);
      } finally {
        seed.fill(0);
      }
    }
    case 'createHandshake': {
      const [role, staticPrivateKey, fixedEphemeralPrivateKey] = args as [
        NoiseRole,
        Uint8Array,
        Uint8Array | undefined,
      ];
      if (role !== 'initiator' && role !== 'responder') throw new Error('Invalid Noise role');
      requireLength(staticPrivateKey, 32, 'Noise static key');
      if (fixedEphemeralPrivateKey) {
        requireLength(fixedEphemeralPrivateKey, 32, 'Noise ephemeral key');
      }
      try {
        const staticKeyPair = keyPair(staticPrivateKey);
        const fixedEphemeralKeyPair = fixedEphemeralPrivateKey
          ? keyPair(fixedEphemeralPrivateKey)
          : undefined;
        const selectedCrypto = fixedEphemeralKeyPair
          ? { ...noiseCrypto, generateKeypair: () => fixedEphemeralKeyPair }
          : noiseCrypto;
        const handle = newHandle();
        handshakes.set(handle, {
          role,
          reads: 0,
          writes: 0,
          fixedEphemeralPrivateKey: fixedEphemeralKeyPair?.privateKey,
          state: new XXHandshakeState({
            crypto: selectedCrypto,
            protocolName,
            prologue,
            initiator: role === 'initiator',
            s: staticKeyPair,
          }),
        });
        return handle;
      } finally {
        staticPrivateKey.fill(0);
        fixedEphemeralPrivateKey?.fill(0);
      }
    }
    case 'writeHandshake': {
      const [handle, payload] = args as [string, Uint8Array];
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
    }
    case 'readHandshake': {
      const [handle, message] = args as [string, Uint8Array];
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
    }
    case 'getRemoteStaticKey': {
      const remote = getHandshake(args[0] as string).state.rs;
      if (!remote) throw new Error('Noise remote static key is unavailable');
      return asBytes(remote).slice();
    }
    case 'finishHandshake': {
      const [handle, maxRecordSize] = args as [string, number];
      if (!Number.isSafeInteger(maxRecordSize) || maxRecordSize < 512 || maxRecordSize > 65_583) {
        destroyHandshake(handle);
        throw new Error('Invalid Noise record limit');
      }
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
      destroyHandshake(handle);
      return { handle: sessionHandle, sessionId };
    }
    case 'destroyHandshake':
      return destroyHandshake(args[0] as string);
    case 'shouldRotateSession': {
      const [handle, nextPayloadLength] = args as [string, number];
      const value = getSession(handle);
      if (
        !Number.isSafeInteger(nextPayloadLength) ||
        nextPayloadLength < 0 ||
        nextPayloadLength > 65_519
      ) {
        throw new Error('Invalid Noise payload length');
      }
      return (
        Date.now() - value.startedAt >= maxSessionAgeMs - 5_000 ||
        value.sentRecords >= maxRecords - 1 ||
        value.receivedRecords >= maxRecords - 1 ||
        value.sentBytes + nextPayloadLength >= maxSessionBytes ||
        value.receivedBytes >= maxSessionBytes
      );
    }
    case 'seal': {
      const [handle, type, payload] = args as [string, number, Uint8Array];
      const value = getSession(handle);
      try {
        ensureSessionActive(handle, value, 'send', payload.length);
        if (!validNoiseRecordType(type)) throw new Error('Invalid secure record type');
        if (payload.length + 64 > value.maxRecordSize || payload.length > 65_519) {
          throw new Error('Nearby payload is too large');
        }
        const recordHeader = encodeHeader(type, value.sessionId, value.sendSequence, payload.length);
        const ciphertext = asBytes(value.send.encryptWithAd(recordHeader, payload));
        value.sendSequence += 1n;
        value.sentRecords += 1;
        value.sentBytes += payload.length;
        return concatBytes(recordHeader, ciphertext);
      } catch (error) {
        destroySession(handle);
        throw error;
      } finally {
        payload.fill(0);
      }
    }
    case 'open': {
      const [handle, record] = args as [string, Uint8Array];
      const value = getSession(handle);
      try {
        if (record.length < 64 || record.length > value.maxRecordSize) {
          throw new Error('Invalid secure record size');
        }
        const recordHeader = record.subarray(0, 48);
        const view = new DataView(
          recordHeader.buffer,
          recordHeader.byteOffset,
          recordHeader.byteLength,
        );
        const type = recordHeader[1];
        if (
          recordHeader[0] !== 1 ||
          !validNoiseRecordType(type) ||
          view.getUint16(2, false) !== 0 ||
          !equal(recordHeader.subarray(4, 36), value.sessionId) ||
          view.getBigUint64(36, false) !== value.receiveSequence
        ) {
          throw new Error('Invalid secure record header');
        }
        const payloadLength = view.getUint32(44, false);
        if (payloadLength + 64 !== record.length) throw new Error('Invalid secure payload length');
        ensureSessionActive(handle, value, 'receive', payloadLength);
        const payload = asBytes(value.receive.decryptWithAd(recordHeader, record.subarray(48)));
        value.receiveSequence += 1n;
        value.receivedRecords += 1;
        value.receivedBytes += payload.length;
        return { type, payload };
      } catch (error) {
        destroySession(handle);
        throw error;
      }
    }
    case 'destroySession':
      return destroySession(args[0] as string);
    default:
      throw new Error('Unsupported Noise worker method');
  }
}

const workerPort = parentPort;
if (!workerPort) throw new Error('Noise worker requires a parent port');
workerPort.on('message', (request: NoiseWorkerRequest) => {
  let response: NoiseWorkerResponse;
  try {
    response = { id: request.id, result: execute(request.method, request.args) as never };
  } catch (error) {
    response = {
      id: request.id,
      error: error instanceof Error ? error.message : 'Noise worker failed',
    };
  }
  workerPort.postMessage(response);
});
