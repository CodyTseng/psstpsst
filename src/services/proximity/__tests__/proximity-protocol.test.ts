import { secp256k1 } from '@noble/curves/secp256k1.js';
import { x25519 } from '@noble/curves/ed25519.js';

import type { Rumor } from '@/db/schema/types';

import {
  createNoiseHandshake,
  createNoiseSecureSession,
  noiseRemoteStaticKey,
  readNoiseMessageA,
  readNoiseMessageB,
  readNoiseMessageC,
  writeNoiseMessageA,
  writeNoiseMessageB,
  writeNoiseMessageC,
} from '../proximity-noise';
import { createNoiseTestPort } from '../test-support/noise-test-port';
import {
  PROXIMITY_CAPABILITY_MESSAGE,
  PROXIMITY_CAPABILITY_FILE_TRANSFER,
  PROXIMITY_CAPABILITY_PROFILE_UPDATE,
  PROXIMITY_MAX_RECORD_SIZE,
  PROXIMITY_MAX_SESSION_AGE_MS,
  PROXIMITY_VERSION,
  ProximityErrorCode,
  ProximityFileCancelReason,
  ProximityFileCompleteStatus,
  ProximityPacketType,
  bytesToHex,
  decodeClientAuth,
  decodeClientHello,
  decodeClientHelloPayload,
  decodeClose,
  decodeFileAccept,
  decodeFileCancel,
  decodeFileChunk,
  decodeFileComplete,
  decodeFileProgress,
  decodeFileRemoteAvailable,
  decodeFileRequest,
  decodeHandshakeEnvelope,
  decodeProfile,
  decodeProfileUpdate,
  decodeRumor,
  decodeServerHello,
  decodeServerHelloPayload,
  encodeClientAuth,
  encodeClientHello,
  encodeClientHelloPayload,
  encodeClose,
  encodeFileAccept,
  encodeFileCancel,
  encodeFileChunk,
  encodeFileComplete,
  encodeFileProgress,
  encodeFileRemoteAvailable,
  encodeFileRequest,
  encodeProfile,
  encodeProfileUpdate,
  encodeRumor,
  encodeServerHello,
  encodeServerHelloPayload,
  signNoiseBinding,
  type ProximityProfile,
} from '../proximity-protocol';

const initiatorSecret = new Uint8Array(32).fill(1);
const responderSecret = new Uint8Array(32).fill(2);
const initiatorNoiseSecret = new Uint8Array(32).fill(3);
const responderNoiseSecret = new Uint8Array(32).fill(4);
const initiatorEphemeral = new Uint8Array(32).fill(5);
const responderEphemeral = new Uint8Array(32).fill(6);

function profile(
  secret: Uint8Array,
  noiseSecret: Uint8Array,
  name: string,
): ProximityProfile {
  const publicKey = secp256k1.getPublicKey(secret, true).subarray(1);
  const noisePublicKey = x25519.getPublicKey(noiseSecret);
  return {
    version: PROXIMITY_VERSION,
    publicKey,
    noisePublicKey,
    noiseBindingSignature: signNoiseBinding(secret, noisePublicKey, new Uint8Array(32)),
    capabilities: PROXIMITY_CAPABILITY_MESSAGE | PROXIMITY_CAPABILITY_PROFILE_UPDATE,
    name,
  };
}

async function completeHandshake(ephemeralOffset = 0) {
  const port = createNoiseTestPort();
  const initiatorProfile = profile(initiatorSecret, initiatorNoiseSecret, 'Alice');
  const responderProfile = profile(responderSecret, responderNoiseSecret, 'Bob');
  const initiator = await createNoiseHandshake(
    'initiator',
    initiatorNoiseSecret,
    initiatorEphemeral.map((value) => value + ephemeralOffset),
    port,
  );
  const responder = await createNoiseHandshake(
    'responder',
    responderNoiseSecret,
    responderEphemeral.map((value) => value + ephemeralOffset),
    port,
  );

  const messageA = await writeNoiseMessageA(
    initiator,
    encodeClientHelloPayload({
      profile: initiatorProfile,
      maxRecordSize: PROXIMITY_MAX_RECORD_SIZE,
    }),
  );
  const helloA = decodeClientHello(
    decodeHandshakeEnvelope(encodeClientHello({ message: messageA })).payload,
  );
  expect(decodeClientHelloPayload(await readNoiseMessageA(responder, helloA.message))).toEqual({
    profile: initiatorProfile,
    maxRecordSize: PROXIMITY_MAX_RECORD_SIZE,
  });

  const handshakeId = messageA.subarray(0, 32);
  const messageB = await writeNoiseMessageB(
    responder,
    encodeServerHelloPayload({
      profile: responderProfile,
      selectedCapabilities: PROXIMITY_CAPABILITY_MESSAGE,
      maxRecordSize: PROXIMITY_MAX_RECORD_SIZE,
    }),
  );
  const helloB = decodeServerHello(
    decodeHandshakeEnvelope(encodeServerHello({ handshakeId, message: messageB })).payload,
  );
  expect(decodeServerHelloPayload(await readNoiseMessageB(initiator, helloB.message))).toEqual({
    profile: responderProfile,
    selectedCapabilities: PROXIMITY_CAPABILITY_MESSAGE,
    maxRecordSize: PROXIMITY_MAX_RECORD_SIZE,
  });
  expect(await noiseRemoteStaticKey(initiator)).toEqual(responderProfile.noisePublicKey);

  const messageC = await writeNoiseMessageC(initiator);
  const auth = decodeClientAuth(
    decodeHandshakeEnvelope(encodeClientAuth({ handshakeId, message: messageC })).payload,
  );
  expect(await readNoiseMessageC(responder, auth.message)).toEqual(new Uint8Array());
  expect(await noiseRemoteStaticKey(responder)).toEqual(initiatorProfile.noisePublicKey);

  return { initiator, responder, messageA, messageB, messageC };
}

describe('Nearby protocol v1', () => {
  test('round-trips a public profile with its signed Noise key binding', () => {
    const value = profile(initiatorSecret, initiatorNoiseSecret, 'Alice');
    expect(decodeProfile(encodeProfile(value))).toEqual(value);

    const tampered = { ...value, noisePublicKey: value.noisePublicKey.slice() };
    tampered.noisePublicKey[0] ^= 1;
    expect(() => encodeProfile(tampered)).toThrow('Invalid Noise identity binding');
  });

  test('rejects the unreleased predecessor instead of adding compatibility', () => {
    const legacyProfile = encodeProfile(profile(initiatorSecret, initiatorNoiseSecret, 'Alice'));
    legacyProfile[0] = 2;
    expect(() => decodeProfile(legacyProfile)).toThrow('Unsupported proximity profile');

    const legacyHandshake = encodeClientHello({ message: new Uint8Array(32) });
    legacyHandshake[0] = 2;
    expect(() => decodeHandshakeEnvelope(legacyHandshake)).toThrow(
      'Unsupported protocol version',
    );
  });

  test('round-trips profile updates and enforces the public name bound', () => {
    expect(decodeProfileUpdate(encodeProfileUpdate('Bright Falcon'))).toBe('Bright Falcon');
    expect(() => encodeProfileUpdate('😀'.repeat(17))).toThrow('Nearby name is too long');
    expect(() => decodeProfileUpdate(Uint8Array.of(2, 65))).toThrow(
      'Truncated proximity packet',
    );
  });

  test('completes Noise XX and produces a stable byte fixture', async () => {
    const { initiator, responder, messageA, messageB, messageC } = await completeHandshake();
    const initiatorSession = await createNoiseSecureSession(
      'initiator', initiator, PROXIMITY_MAX_RECORD_SIZE,
    );
    const responderSession = await createNoiseSecureSession(
      'responder', responder, PROXIMITY_MAX_RECORD_SIZE,
    );
    expect(initiatorSession.sessionId).toEqual(responderSession.sessionId);
    expect(bytesToHex(messageA)).toMatchSnapshot('noise-message-a');
    expect(bytesToHex(messageB)).toMatchSnapshot('noise-message-b');
    expect(bytesToHex(messageC)).toMatchSnapshot('noise-message-c');
    expect(bytesToHex(initiatorSession.sessionId)).toMatchSnapshot('noise-handshake-hash');
    await initiatorSession.destroy();
    await responderSession.destroy();
  });

  test('encrypts directional Noise transport records and rejects tampering', async () => {
    const handshake = await completeHandshake();
    const initiator = await createNoiseSecureSession(
      'initiator',
      handshake.initiator,
      PROXIMITY_MAX_RECORD_SIZE,
    );
    const responder = await createNoiseSecureSession(
      'responder',
      handshake.responder,
      PROXIMITY_MAX_RECORD_SIZE,
    );
    const payload = new TextEncoder().encode('hello nearby');
    const record = await initiator.seal(ProximityPacketType.Message, payload);
    expect(responder.matchesRecordSession(record)).toBe(true);
    await expect(responder.open(record)).resolves.toEqual({
      type: ProximityPacketType.Message,
      payload,
    });

    const next = await initiator.seal(ProximityPacketType.Message, payload);
    next[next.length - 1] ^= 1;
    await expect(responder.open(next)).rejects.toThrow();
  });

  test('rejects a secure record from a different session before decryption', async () => {
    const first = await completeHandshake();
    const second = await completeHandshake(1);
    const sender = await createNoiseSecureSession(
      'initiator',
      first.initiator,
      PROXIMITY_MAX_RECORD_SIZE,
    );
    const receiver = await createNoiseSecureSession(
      'responder',
      second.responder,
      PROXIMITY_MAX_RECORD_SIZE,
    );
    const record = await sender.seal(ProximityPacketType.Ping, new Uint8Array());

    expect(receiver.matchesRecordSession(record)).toBe(false);
    await expect(receiver.open(record)).rejects.toThrow('Mismatched secure session');
  });

  test('reserves a final record before session-age rotation', async () => {
    const handshake = await completeHandshake();
    const startedAt = Date.now();
    const session = await createNoiseSecureSession(
      'initiator',
      handshake.initiator,
      PROXIMITY_MAX_RECORD_SIZE,
    );
    const now = jest.spyOn(Date, 'now').mockReturnValue(startedAt + PROXIMITY_MAX_SESSION_AGE_MS);
    try {
      await expect(session.shouldRotateBeforeSend(0)).resolves.toBe(true);
    } finally {
      now.mockRestore();
    }
  });

  test('round-trips strict close reasons', () => {
    expect(decodeClose(encodeClose(ProximityErrorCode.InvalidHandshake))).toBe(
      ProximityErrorCode.InvalidHandshake,
    );
    expect(() => decodeClose(new Uint8Array())).toThrow();
    expect(() => decodeClose(new Uint8Array([0, 1, 2]))).toThrow();
  });

  test('round-trips every negotiated file-transfer record', () => {
    const transferId = new Uint8Array(16).fill(1);
    const rumorId = new Uint8Array(32).fill(2);
    const ox = new Uint8Array(32).fill(3);
    const x = new Uint8Array(32).fill(4);
    const request = {
      transferId,
      rumorId,
      ox,
      resumeOffset: 4096,
      desiredChunkSize: 16 * 1024,
      desiredWindow: 2,
    };
    expect(decodeFileRequest(encodeFileRequest(request))).toEqual(request);

    const accept = {
      transferId,
      ox,
      plainSize: 100_000,
      acceptedOffset: 4096,
      chunkSize: 8 * 1024,
      windowChunks: 1,
    };
    expect(decodeFileAccept(encodeFileAccept(accept))).toEqual(accept);

    const chunk = { transferId, offset: 4096, data: new Uint8Array(8 * 1024).fill(5) };
    expect(decodeFileChunk(encodeFileChunk(chunk))).toEqual(chunk);
    expect(
      decodeFileProgress(encodeFileProgress({ transferId, receivedThrough: 12_288 })),
    ).toEqual({ transferId, receivedThrough: 12_288 });
    expect(
      decodeFileComplete(
        encodeFileComplete({
          transferId,
          ox,
          plainSize: 100_000,
          status: ProximityFileCompleteStatus.Stored,
        }),
      ),
    ).toEqual({
      transferId,
      ox,
      plainSize: 100_000,
      status: ProximityFileCompleteStatus.Stored,
    });
    expect(
      decodeFileCancel(
        encodeFileCancel({
          transferId,
          reason: ProximityFileCancelReason.Timeout,
          retryable: true,
        }),
      ),
    ).toEqual({
      transferId,
      reason: ProximityFileCancelReason.Timeout,
      retryable: true,
    });
    expect(
      decodeFileRemoteAvailable(encodeFileRemoteAvailable({ rumorId, x })),
    ).toEqual({ rumorId, x });
  });

  test('advertises file transfer as capability bit two', () => {
    expect(PROXIMITY_CAPABILITY_FILE_TRANSFER).toBe(4n);
  });

  test('accepts canonical unsigned text, file, and reaction rumors', () => {
    const initiatorProfile = profile(initiatorSecret, initiatorNoiseSecret, 'Alice');
    const responderProfile = profile(responderSecret, responderNoiseSecret, 'Bob');
    const rumor: Rumor = {
      kind: 14,
      content: 'hello',
      tags: [['p', bytesToHex(responderProfile.publicKey)]],
      created_at: 1_700_000_000,
      pubkey: bytesToHex(initiatorProfile.publicKey),
      id: '00'.repeat(32),
    };
    expect(decodeRumor(encodeRumor(rumor))).toEqual(rumor);
    expect(() => encodeRumor({ ...rumor, kind: 15 })).not.toThrow();
    expect(() => encodeRumor({ ...rumor, kind: 16 })).toThrow('Invalid rumor');
  });
});
