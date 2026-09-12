import { schnorr } from '@noble/curves/secp256k1.js';
import { sha256 } from '@noble/hashes/sha2.js';

import type { Rumor } from '@/db/schema/types';

export const PROXIMITY_VERSION = 1;
export const PROXIMITY_CAPABILITY_MESSAGE = 1n;
export const PROXIMITY_CAPABILITY_PROFILE_UPDATE = 1n << 1n;
export const PROXIMITY_CAPABILITY_FILE_TRANSFER = 1n << 2n;
export const PROXIMITY_SUPPORTED_CAPABILITIES =
  PROXIMITY_CAPABILITY_MESSAGE |
  PROXIMITY_CAPABILITY_PROFILE_UPDATE |
  PROXIMITY_CAPABILITY_FILE_TRANSFER;
// A transport ciphertext is capped at 65,535 bytes by Noise. The 48-byte
// authenticated record header sits outside that ciphertext.
export const PROXIMITY_MAX_RECORD_SIZE = 65_535 + 48;
export const PROXIMITY_MAX_PAYLOAD_SIZE = 65_535 - 16;
export const PROXIMITY_MIN_RECORD_SIZE = 512;
export const PROXIMITY_MAX_NAME_BYTES = 64;
export const PROXIMITY_MAX_CONTENT_BYTES = 60 * 1024;
export const PROXIMITY_MAX_TAGS = 256;
export const PROXIMITY_MAX_TAG_PARTS = 16;
export const PROXIMITY_MAX_TAG_PART_BYTES = 4 * 1024;
export const PROXIMITY_MAX_RECORDS = 2 ** 20;
export const PROXIMITY_MAX_SESSION_BYTES = 64 * 1024 * 1024 * 1024;
export const PROXIMITY_MAX_SESSION_AGE_MS = 24 * 60 * 60 * 1000;

export const enum ProximityPacketType {
  ClientHello = 0x01,
  ServerHello = 0x02,
  ClientAuth = 0x03,
  AccessRequest = 0x10,
  AccessResult = 0x11,
  Ping = 0x12,
  Pong = 0x13,
  ProfileUpdate = 0x14,
  Message = 0x20,
  MessageAck = 0x21,
  FileRequest = 0x30,
  FileAccept = 0x31,
  FileChunk = 0x32,
  FileProgress = 0x33,
  FileComplete = 0x34,
  FileCancel = 0x35,
  FileRemoteAvailable = 0x36,
  Error = 0x7e,
  Close = 0x7f,
}

export const enum ProximityErrorCode {
  None = 0,
  UnsupportedVersion = 1,
  InvalidPacket = 2,
  InvalidHandshake = 3,
  AuthFailed = 4,
  AccessDenied = 5,
  NotReady = 6,
  PayloadTooLarge = 7,
  Busy = 8,
  UnsupportedType = 9,
  InvalidEvent = 10,
  StorageFailed = 11,
  RateLimited = 12,
  Timeout = 13,
  DuplicateConnection = 14,
  SessionExpired = 15,
}

export const enum ProximityAccessDecision {
  Accepted = 0,
  Declined = 1,
  Blocked = 2,
  Expired = 3,
}

export const enum ProximityMessageStatus {
  Stored = 0,
  Duplicate = 1,
  Rejected = 2,
}

export const enum ProximityFileCompleteStatus {
  Stored = 0,
  AlreadyPresent = 1,
}

export const enum ProximityFileCancelReason {
  NotAvailable = 0x0001,
  InvalidRequest = 0x0002,
  Busy = 0x0003,
  InsufficientStorage = 0x0004,
  IntegrityFailure = 0x0005,
  UserCancelled = 0x0006,
  Timeout = 0x0007,
}

export type ProximityFileRequest = {
  transferId: Uint8Array;
  rumorId: Uint8Array;
  ox: Uint8Array;
  resumeOffset: number;
  desiredChunkSize: number;
  desiredWindow: number;
};

export type ProximityFileAccept = {
  transferId: Uint8Array;
  ox: Uint8Array;
  plainSize: number;
  acceptedOffset: number;
  chunkSize: number;
  windowChunks: number;
};

export type ProximityFileChunk = {
  transferId: Uint8Array;
  offset: number;
  data: Uint8Array;
};

export type ProximityFileProgress = {
  transferId: Uint8Array;
  receivedThrough: number;
};

export type ProximityFileComplete = {
  transferId: Uint8Array;
  ox: Uint8Array;
  plainSize: number;
  status: ProximityFileCompleteStatus;
};

export type ProximityFileCancel = {
  transferId: Uint8Array;
  reason: ProximityFileCancelReason;
  retryable: boolean;
};

export type ProximityFileRemoteAvailable = {
  rumorId: Uint8Array;
  x: Uint8Array;
};

export type ProximityProfile = {
  version: typeof PROXIMITY_VERSION;
  publicKey: Uint8Array;
  noisePublicKey: Uint8Array;
  noiseBindingSignature: Uint8Array;
  capabilities: bigint;
  name: string;
};

export type ClientHello = {
  message: Uint8Array;
};

export type ServerHello = {
  handshakeId: Uint8Array;
  message: Uint8Array;
};

export type ClientAuth = {
  handshakeId: Uint8Array;
  message: Uint8Array;
};

export type ClientHelloPayload = {
  profile: ProximityProfile;
  maxRecordSize: number;
};

export type ServerHelloPayload = {
  profile: ProximityProfile;
  selectedCapabilities: bigint;
  maxRecordSize: number;
};

export type MessageAck = {
  rumorId: Uint8Array;
  status: ProximityMessageStatus;
  errorCode: ProximityErrorCode;
};

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder('utf-8', { fatal: true });

function concatBytes(...values: Uint8Array[]): Uint8Array {
  const length = values.reduce((total, value) => total + value.length, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  for (const value of values) {
    output.set(value, offset);
    offset += value.length;
  }
  return output;
}

class Writer {
  private readonly parts: Uint8Array[] = [];

  u8(value: number): this {
    this.parts.push(Uint8Array.of(value & 0xff));
    return this;
  }

  u16(value: number): this {
    const bytes = new Uint8Array(2);
    new DataView(bytes.buffer).setUint16(0, value, false);
    this.parts.push(bytes);
    return this;
  }

  u32(value: number): this {
    const bytes = new Uint8Array(4);
    new DataView(bytes.buffer).setUint32(0, value, false);
    this.parts.push(bytes);
    return this;
  }

  u64(value: bigint): this {
    const bytes = new Uint8Array(8);
    new DataView(bytes.buffer).setBigUint64(0, value, false);
    this.parts.push(bytes);
    return this;
  }

  bytes(value: Uint8Array): this {
    this.parts.push(value);
    return this;
  }

  finish(): Uint8Array {
    return concatBytes(...this.parts);
  }
}

class Reader {
  private offset = 0;

  constructor(private readonly value: Uint8Array) {}

  private take(length: number): Uint8Array {
    if (!Number.isSafeInteger(length) || length < 0 || this.offset + length > this.value.length) {
      throw new Error('Truncated proximity packet');
    }
    const result = this.value.subarray(this.offset, this.offset + length);
    this.offset += length;
    return result;
  }

  u8(): number {
    return this.take(1)[0];
  }

  u16(): number {
    const bytes = this.take(2);
    return new DataView(bytes.buffer, bytes.byteOffset, 2).getUint16(0, false);
  }

  u32(): number {
    const bytes = this.take(4);
    return new DataView(bytes.buffer, bytes.byteOffset, 4).getUint32(0, false);
  }

  u64(): bigint {
    const bytes = this.take(8);
    return new DataView(bytes.buffer, bytes.byteOffset, 8).getBigUint64(0, false);
  }

  bytes(length: number): Uint8Array {
    return this.take(length);
  }

  done(): void {
    if (this.offset !== this.value.length) throw new Error('Trailing proximity packet bytes');
  }
}

function expectLength(value: Uint8Array, length: number, field: string): Uint8Array {
  if (value.length !== length) throw new Error(`Invalid ${field} length`);
  return value;
}

const NOISE_BINDING_LABEL = textEncoder.encode('PsstPsst Nearby Noise Binding/1');

export function noiseBindingMessage(
  publicKey: Uint8Array,
  noisePublicKey: Uint8Array,
): Uint8Array {
  return sha256(
    concatBytes(
      NOISE_BINDING_LABEL,
      expectLength(publicKey, 32, 'proximity public key'),
      expectLength(noisePublicKey, 32, 'Noise static public key'),
    ),
  );
}

export function signNoiseBinding(
  proximityPrivateKey: Uint8Array,
  noisePublicKey: Uint8Array,
  auxRand?: Uint8Array,
): Uint8Array {
  const publicKey = schnorr.getPublicKey(proximityPrivateKey);
  return schnorr.sign(noiseBindingMessage(publicKey, noisePublicKey), proximityPrivateKey, auxRand);
}

export function verifyNoiseBinding(profile: ProximityProfile): boolean {
  return schnorr.verify(
    profile.noiseBindingSignature,
    noiseBindingMessage(profile.publicKey, profile.noisePublicKey),
    profile.publicKey,
  );
}

export function encodeProfile(profile: ProximityProfile): Uint8Array {
  expectLength(profile.publicKey, 32, 'proximity public key');
  expectLength(profile.noisePublicKey, 32, 'Noise static public key');
  expectLength(profile.noiseBindingSignature, 64, 'Noise binding signature');
  if (!verifyNoiseBinding(profile)) throw new Error('Invalid Noise identity binding');
  const name = textEncoder.encode(profile.name);
  if (name.length > PROXIMITY_MAX_NAME_BYTES) throw new Error('Nearby name is too long');
  return new Writer()
    .u8(PROXIMITY_VERSION)
    .bytes(profile.publicKey)
    .bytes(profile.noisePublicKey)
    .bytes(profile.noiseBindingSignature)
    .u64(profile.capabilities)
    .u8(name.length)
    .bytes(name)
    .finish();
}

export function decodeProfile(value: Uint8Array): ProximityProfile {
  const reader = new Reader(value);
  if (reader.u8() !== PROXIMITY_VERSION) throw new Error('Unsupported proximity profile');
  const publicKey = reader.bytes(32);
  if (!schnorr.utils.lift_x(BigInt(`0x${bytesToHex(publicKey)}`))) {
    throw new Error('Invalid proximity public key');
  }
  const noisePublicKey = reader.bytes(32);
  const noiseBindingSignature = reader.bytes(64);
  const capabilities = reader.u64();
  const nameLength = reader.u8();
  if (nameLength > PROXIMITY_MAX_NAME_BYTES) throw new Error('Nearby name is too long');
  const name = textDecoder.decode(reader.bytes(nameLength));
  reader.done();
  const profile: ProximityProfile = {
    version: PROXIMITY_VERSION,
    publicKey,
    noisePublicKey,
    noiseBindingSignature,
    capabilities,
    name,
  };
  if (!verifyNoiseBinding(profile)) throw new Error('Invalid Noise identity binding');
  return profile;
}

export function encodeProfileUpdate(name: string): Uint8Array {
  const encoded = textEncoder.encode(name);
  if (encoded.length > PROXIMITY_MAX_NAME_BYTES) throw new Error('Nearby name is too long');
  return new Writer().u8(encoded.length).bytes(encoded).finish();
}

export function decodeProfileUpdate(value: Uint8Array): string {
  const reader = new Reader(value);
  const length = reader.u8();
  if (length > PROXIMITY_MAX_NAME_BYTES) throw new Error('Nearby name is too long');
  const name = textDecoder.decode(reader.bytes(length));
  reader.done();
  return name;
}

function encodeHandshake(type: ProximityPacketType, payload: Uint8Array): Uint8Array {
  if (payload.length > PROXIMITY_MAX_RECORD_SIZE - 8) throw new Error('Handshake too large');
  return new Writer()
    .u8(PROXIMITY_VERSION)
    .u8(type)
    .u16(0)
    .u32(payload.length)
    .bytes(payload)
    .finish();
}

export function decodeHandshakeEnvelope(value: Uint8Array): {
  type: ProximityPacketType;
  payload: Uint8Array;
} {
  if (value.length < 8 || value.length > PROXIMITY_MAX_RECORD_SIZE) {
    throw new Error('Invalid handshake size');
  }
  const reader = new Reader(value);
  if (reader.u8() !== PROXIMITY_VERSION) throw new Error('Unsupported protocol version');
  const type = reader.u8() as ProximityPacketType;
  if (
    type !== ProximityPacketType.ClientHello &&
    type !== ProximityPacketType.ServerHello &&
    type !== ProximityPacketType.ClientAuth
  ) {
    throw new Error('Invalid handshake type');
  }
  if (reader.u16() !== 0) throw new Error('Invalid handshake flags');
  const length = reader.u32();
  const payload = reader.bytes(length);
  reader.done();
  return { type, payload };
}

function validateMaxRecordSize(value: number): number {
  if (value < PROXIMITY_MIN_RECORD_SIZE || value > PROXIMITY_MAX_RECORD_SIZE) {
    throw new Error('Invalid maximum record size');
  }
  return value;
}

export function encodeClientHelloPayload(value: ClientHelloPayload): Uint8Array {
  const profile = encodeProfile(value.profile);
  return new Writer()
    .u8(PROXIMITY_VERSION)
    .u16(profile.length)
    .bytes(profile)
    .u32(validateMaxRecordSize(value.maxRecordSize))
    .finish();
}

export function encodeClientHello(value: ClientHello): Uint8Array {
  if (value.message.length < 32) throw new Error('Truncated Noise message A');
  return encodeHandshake(ProximityPacketType.ClientHello, value.message);
}

export function decodeClientHello(payload: Uint8Array): ClientHello {
  if (payload.length < 32) throw new Error('Truncated Noise message A');
  return { message: payload };
}

export function decodeClientHelloPayload(payload: Uint8Array): ClientHelloPayload {
  const reader = new Reader(payload);
  if (reader.u8() !== PROXIMITY_VERSION) throw new Error('Unsupported protocol version');
  const profile = decodeProfile(reader.bytes(reader.u16()));
  const maxRecordSize = validateMaxRecordSize(reader.u32());
  reader.done();
  return { profile, maxRecordSize };
}

export function encodeServerHelloPayload(value: ServerHelloPayload): Uint8Array {
  const profile = encodeProfile(value.profile);
  return new Writer()
    .u8(PROXIMITY_VERSION)
    .u16(profile.length)
    .bytes(profile)
    .u64(value.selectedCapabilities)
    .u32(validateMaxRecordSize(value.maxRecordSize))
    .finish();
}

export function encodeServerHello(value: ServerHello): Uint8Array {
  return encodeHandshake(
    ProximityPacketType.ServerHello,
    concatBytes(expectLength(value.handshakeId, 32, 'handshake id'), value.message),
  );
}

export function decodeServerHello(payload: Uint8Array): ServerHello {
  if (payload.length < 32) throw new Error('Truncated server hello');
  return { handshakeId: payload.subarray(0, 32), message: payload.subarray(32) };
}

export function decodeServerHelloPayload(payload: Uint8Array): ServerHelloPayload {
  const reader = new Reader(payload);
  if (reader.u8() !== PROXIMITY_VERSION) throw new Error('Unsupported protocol version');
  const profile = decodeProfile(reader.bytes(reader.u16()));
  const selectedCapabilities = reader.u64();
  const maxRecordSize = validateMaxRecordSize(reader.u32());
  reader.done();
  return { profile, selectedCapabilities, maxRecordSize };
}

export function encodeClientAuth(value: ClientAuth): Uint8Array {
  return encodeHandshake(
    ProximityPacketType.ClientAuth,
    concatBytes(expectLength(value.handshakeId, 32, 'handshake id'), value.message),
  );
}

export function decodeClientAuth(payload: Uint8Array): ClientAuth {
  if (payload.length < 32) throw new Error('Truncated client auth');
  return { handshakeId: payload.subarray(0, 32), message: payload.subarray(32) };
}

export function decodeHandshakeId(
  type: ProximityPacketType,
  payload: Uint8Array,
): Uint8Array {
  if (
    type !== ProximityPacketType.ClientHello &&
    type !== ProximityPacketType.ServerHello &&
    type !== ProximityPacketType.ClientAuth
  ) {
    throw new Error('Invalid handshake type');
  }
  if (payload.length < 32) throw new Error('Truncated handshake id');
  return payload.subarray(0, 32);
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i += 1) difference |= a[i] ^ b[i];
  return difference === 0;
}

export function confirmationsEqual(a: Uint8Array, b: Uint8Array): boolean {
  return constantTimeEqual(a, b);
}

export function encodeAccessResult(decision: ProximityAccessDecision): Uint8Array {
  return Uint8Array.of(decision);
}

export function decodeAccessResult(payload: Uint8Array): ProximityAccessDecision {
  if (payload.length !== 1 || payload[0] > ProximityAccessDecision.Expired) {
    throw new Error('Invalid access result');
  }
  return payload[0] as ProximityAccessDecision;
}

export function encodeMessageAck(value: MessageAck): Uint8Array {
  return new Writer()
    .bytes(expectLength(value.rumorId, 32, 'rumor id'))
    .u8(value.status)
    .u16(value.errorCode)
    .finish();
}

export function decodeMessageAck(payload: Uint8Array): MessageAck {
  const reader = new Reader(payload);
  const rumorId = reader.bytes(32);
  const status = reader.u8() as ProximityMessageStatus;
  const errorCode = reader.u16() as ProximityErrorCode;
  reader.done();
  if (status > ProximityMessageStatus.Rejected) throw new Error('Invalid message status');
  return { rumorId, status, errorCode };
}

function safeU64(reader: Reader, field: string): number {
  const value = reader.u64();
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error(`Invalid ${field}`);
  return Number(value);
}

function validateFileChunkSize(value: number): number {
  if (!Number.isSafeInteger(value) || value < 4 * 1024 || value > 32 * 1024) {
    throw new Error('Invalid file chunk size');
  }
  return value;
}

function validateFileWindow(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > 4) {
    throw new Error('Invalid file window');
  }
  return value;
}

function encodeSafeU64(writer: Writer, value: number, field: string): Writer {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`Invalid ${field}`);
  return writer.u64(BigInt(value));
}

export function encodeFileRequest(value: ProximityFileRequest): Uint8Array {
  const writer = new Writer()
    .bytes(expectLength(value.transferId, 16, 'transfer id'))
    .bytes(expectLength(value.rumorId, 32, 'rumor id'))
    .bytes(expectLength(value.ox, 32, 'plaintext hash'));
  encodeSafeU64(writer, value.resumeOffset, 'resume offset');
  return writer
    .u32(validateFileChunkSize(value.desiredChunkSize))
    .u16(validateFileWindow(value.desiredWindow))
    .u16(0)
    .finish();
}

export function decodeFileRequest(payload: Uint8Array): ProximityFileRequest {
  const reader = new Reader(payload);
  const result = {
    transferId: reader.bytes(16),
    rumorId: reader.bytes(32),
    ox: reader.bytes(32),
    resumeOffset: safeU64(reader, 'resume offset'),
    desiredChunkSize: validateFileChunkSize(reader.u32()),
    desiredWindow: validateFileWindow(reader.u16()),
  };
  if (reader.u16() !== 0) throw new Error('Invalid file request reserved field');
  reader.done();
  return result;
}

export function encodeFileAccept(value: ProximityFileAccept): Uint8Array {
  const writer = new Writer()
    .bytes(expectLength(value.transferId, 16, 'transfer id'))
    .bytes(expectLength(value.ox, 32, 'plaintext hash'));
  encodeSafeU64(writer, value.plainSize, 'plaintext size');
  encodeSafeU64(writer, value.acceptedOffset, 'accepted offset');
  return writer
    .u32(validateFileChunkSize(value.chunkSize))
    .u16(validateFileWindow(value.windowChunks))
    .u16(0)
    .finish();
}

export function decodeFileAccept(payload: Uint8Array): ProximityFileAccept {
  const reader = new Reader(payload);
  const result = {
    transferId: reader.bytes(16),
    ox: reader.bytes(32),
    plainSize: safeU64(reader, 'plaintext size'),
    acceptedOffset: safeU64(reader, 'accepted offset'),
    chunkSize: validateFileChunkSize(reader.u32()),
    windowChunks: validateFileWindow(reader.u16()),
  };
  if (reader.u16() !== 0) throw new Error('Invalid file acceptance reserved field');
  reader.done();
  if (result.acceptedOffset > result.plainSize) throw new Error('Invalid accepted offset');
  return result;
}

export function encodeFileChunk(value: ProximityFileChunk): Uint8Array {
  if (value.data.length === 0 || value.data.length > 32 * 1024) {
    throw new Error('Invalid file chunk data');
  }
  const writer = new Writer().bytes(expectLength(value.transferId, 16, 'transfer id'));
  encodeSafeU64(writer, value.offset, 'chunk offset');
  return writer.u32(value.data.length).bytes(value.data).finish();
}

export function decodeFileChunk(payload: Uint8Array): ProximityFileChunk {
  const reader = new Reader(payload);
  const transferId = reader.bytes(16);
  const offset = safeU64(reader, 'chunk offset');
  const length = reader.u32();
  if (length === 0 || length > 32 * 1024) throw new Error('Invalid file chunk data');
  const data = reader.bytes(length);
  reader.done();
  return { transferId, offset, data };
}

export function encodeFileProgress(value: ProximityFileProgress): Uint8Array {
  const writer = new Writer().bytes(expectLength(value.transferId, 16, 'transfer id'));
  return encodeSafeU64(writer, value.receivedThrough, 'received offset').finish();
}

export function decodeFileProgress(payload: Uint8Array): ProximityFileProgress {
  const reader = new Reader(payload);
  const result = {
    transferId: reader.bytes(16),
    receivedThrough: safeU64(reader, 'received offset'),
  };
  reader.done();
  return result;
}

export function encodeFileComplete(value: ProximityFileComplete): Uint8Array {
  if (value.status > ProximityFileCompleteStatus.AlreadyPresent) {
    throw new Error('Invalid file completion status');
  }
  const writer = new Writer()
    .bytes(expectLength(value.transferId, 16, 'transfer id'))
    .bytes(expectLength(value.ox, 32, 'plaintext hash'));
  encodeSafeU64(writer, value.plainSize, 'plaintext size');
  return writer.u8(value.status).bytes(new Uint8Array(7)).finish();
}

export function decodeFileComplete(payload: Uint8Array): ProximityFileComplete {
  const reader = new Reader(payload);
  const result = {
    transferId: reader.bytes(16),
    ox: reader.bytes(32),
    plainSize: safeU64(reader, 'plaintext size'),
    status: reader.u8() as ProximityFileCompleteStatus,
  };
  if (result.status > ProximityFileCompleteStatus.AlreadyPresent) {
    throw new Error('Invalid file completion status');
  }
  if (reader.bytes(7).some((byte) => byte !== 0)) {
    throw new Error('Invalid file completion reserved field');
  }
  reader.done();
  return result;
}

export function encodeFileCancel(value: ProximityFileCancel): Uint8Array {
  return new Writer()
    .bytes(expectLength(value.transferId, 16, 'transfer id'))
    .u16(value.reason)
    .u8(value.retryable ? 1 : 0)
    .u8(0)
    .finish();
}

export function decodeFileCancel(payload: Uint8Array): ProximityFileCancel {
  const reader = new Reader(payload);
  const transferId = reader.bytes(16);
  const reason = reader.u16() as ProximityFileCancelReason;
  const retryable = reader.u8();
  if (
    reason < ProximityFileCancelReason.NotAvailable ||
    reason > ProximityFileCancelReason.Timeout ||
    retryable > 1 ||
    reader.u8() !== 0
  ) {
    throw new Error('Invalid file cancellation');
  }
  reader.done();
  return { transferId, reason, retryable: retryable === 1 };
}

export function encodeFileRemoteAvailable(value: ProximityFileRemoteAvailable): Uint8Array {
  return new Writer()
    .bytes(expectLength(value.rumorId, 32, 'rumor id'))
    .bytes(expectLength(value.x, 32, 'ciphertext hash'))
    .finish();
}

export function decodeFileRemoteAvailable(payload: Uint8Array): ProximityFileRemoteAvailable {
  const reader = new Reader(payload);
  const result = { rumorId: reader.bytes(32), x: reader.bytes(32) };
  reader.done();
  return result;
}

export function encodeError(
  errorCode: ProximityErrorCode,
  retryable: boolean,
  context = '',
): Uint8Array {
  const encoded = textEncoder.encode(context).subarray(0, 512);
  return new Writer()
    .u16(errorCode)
    .u8(retryable ? 1 : 0)
    .u16(encoded.length)
    .bytes(encoded)
    .finish();
}

export function encodeClose(reason: ProximityErrorCode): Uint8Array {
  return new Writer().u16(reason).finish();
}

export function decodeClose(payload: Uint8Array): ProximityErrorCode {
  const reader = new Reader(payload);
  const reason = reader.u16() as ProximityErrorCode;
  reader.done();
  return reason;
}

export function encodeRumor(rumor: Rumor): Uint8Array {
  validateRumor(rumor);
  const encoded = textEncoder.encode(JSON.stringify(rumor));
  if (encoded.length > PROXIMITY_MAX_PAYLOAD_SIZE) {
    throw new Error('Nearby rumor is too large');
  }
  return encoded;
}

export function decodeRumor(payload: Uint8Array): Rumor {
  if (payload.length > PROXIMITY_MAX_PAYLOAD_SIZE) {
    throw new Error('Nearby rumor is too large');
  }
  const text = textDecoder.decode(payload);
  const value = JSON.parse(text) as unknown;
  if (JSON.stringify(value) !== text) throw new Error('Non-canonical rumor JSON');
  validateRumor(value);
  return value as Rumor;
}

export function validateRumor(value: unknown): asserts value is Rumor {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid rumor');
  }
  const rumor = value as Partial<Rumor> & Record<string, unknown>;
  const keys = Object.keys(rumor).sort();
  const expected = ['content', 'created_at', 'id', 'kind', 'pubkey', 'tags'];
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    throw new Error('Invalid rumor fields');
  }
  if (
    !isHex(rumor.id, 32) ||
    !isHex(rumor.pubkey, 32) ||
    !Number.isSafeInteger(rumor.created_at) ||
    (rumor.created_at as number) < 0 ||
    !Number.isSafeInteger(rumor.kind) ||
    (rumor.kind !== 14 && rumor.kind !== 15 && rumor.kind !== 7) ||
    typeof rumor.content !== 'string' ||
    textEncoder.encode(rumor.content).length > PROXIMITY_MAX_CONTENT_BYTES ||
    !Array.isArray(rumor.tags) ||
    rumor.tags.length > PROXIMITY_MAX_TAGS
  ) {
    throw new Error('Invalid rumor value');
  }
  for (const tag of rumor.tags) {
    if (!Array.isArray(tag) || tag.length > PROXIMITY_MAX_TAG_PARTS) {
      throw new Error('Invalid rumor tag');
    }
    for (const part of tag) {
      if (
        typeof part !== 'string' ||
        textEncoder.encode(part).length > PROXIMITY_MAX_TAG_PART_BYTES
      ) {
        throw new Error('Invalid rumor tag value');
      }
    }
  }
  const recipientTags = rumor.tags.filter((tag) => tag[0] === 'p');
  if (
    recipientTags.length !== 1 ||
    recipientTags[0].length < 2 ||
    !isHex(recipientTags[0][1], 32)
  ) {
    throw new Error('Invalid rumor recipient');
  }
}

export function isHex(value: unknown, bytes: number): value is string {
  return typeof value === 'string' && new RegExp(`^[0-9a-f]{${bytes * 2}}$`).test(value);
}

export function bytesToHex(value: Uint8Array): string {
  let result = '';
  for (const byte of value) result += byte.toString(16).padStart(2, '0');
  return result;
}

export function hexToBytes(value: string): Uint8Array {
  if (value.length % 2 !== 0 || !isHex(value, value.length / 2)) {
    throw new Error('Invalid hexadecimal value');
  }
  const output = new Uint8Array(value.length / 2);
  for (let i = 0; i < output.length; i += 1) {
    output[i] = Number.parseInt(value.slice(i * 2, i * 2 + 2), 16);
  }
  return output;
}

export { concatBytes, constantTimeEqual };
