import { platform } from '@/platform';
import type { NoiseKeyPair, NoisePort, NoiseRole } from '@/platform';

import { ProximityPacketType } from './proximity-protocol';

function expectLength(value: Uint8Array, length: number, field: string): Uint8Array {
  if (value.length !== length) throw new Error(`Invalid ${field} length`);
  return value;
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) difference |= a[index] ^ b[index];
  return difference === 0;
}

export type ProximityNoiseHandshake = {
  handle: string;
  port: NoisePort;
  destroyed: boolean;
};

export async function generateNoiseStaticKeyPair(
  port: NoisePort = platform.noise,
): Promise<NoiseKeyPair> {
  return port.generateKeyPair();
}

export async function noiseStaticKeyPairFromSeed(
  seed: Uint8Array,
  port: NoisePort = platform.noise,
): Promise<NoiseKeyPair> {
  return port.generateKeyPair(expectLength(seed, 32, 'Noise static private key').slice());
}

export async function createNoiseHandshake(
  role: NoiseRole,
  staticPrivateKey: Uint8Array,
  ephemeralPrivateKey?: Uint8Array,
  port: NoisePort = platform.noise,
): Promise<ProximityNoiseHandshake> {
  const handle = await port.createHandshake(
    role,
    expectLength(staticPrivateKey, 32, 'Noise static private key'),
    ephemeralPrivateKey
      ? expectLength(ephemeralPrivateKey, 32, 'Noise ephemeral private key')
      : undefined,
  );
  return { handle, port, destroyed: false };
}

function activeHandshake(state: ProximityNoiseHandshake): string {
  if (state.destroyed) throw new Error('Nearby Noise handshake is closed');
  return state.handle;
}

export function writeNoiseMessageA(
  state: ProximityNoiseHandshake,
  payload: Uint8Array,
): Promise<Uint8Array> {
  return state.port.writeHandshake(activeHandshake(state), payload);
}

export function readNoiseMessageA(
  state: ProximityNoiseHandshake,
  message: Uint8Array,
): Promise<Uint8Array> {
  return state.port.readHandshake(activeHandshake(state), message);
}

export function writeNoiseMessageB(
  state: ProximityNoiseHandshake,
  payload: Uint8Array,
): Promise<Uint8Array> {
  return state.port.writeHandshake(activeHandshake(state), payload);
}

export function readNoiseMessageB(
  state: ProximityNoiseHandshake,
  message: Uint8Array,
): Promise<Uint8Array> {
  return state.port.readHandshake(activeHandshake(state), message);
}

export function writeNoiseMessageC(
  state: ProximityNoiseHandshake,
  payload: Uint8Array = new Uint8Array(),
): Promise<Uint8Array> {
  return state.port.writeHandshake(activeHandshake(state), payload);
}

export function readNoiseMessageC(
  state: ProximityNoiseHandshake,
  message: Uint8Array,
): Promise<Uint8Array> {
  return state.port.readHandshake(activeHandshake(state), message);
}

export function noiseRemoteStaticKey(state: ProximityNoiseHandshake): Promise<Uint8Array> {
  return state.port.getRemoteStaticKey(activeHandshake(state));
}

export async function destroyNoiseHandshake(
  state: ProximityNoiseHandshake | undefined,
): Promise<void> {
  if (!state || state.destroyed) return;
  state.destroyed = true;
  await state.port.destroyHandshake(state.handle);
}

export class ProximitySecureSession {
  private destroyed = false;

  constructor(
    readonly sessionId: Uint8Array,
    private readonly handle: string,
    private readonly port: NoisePort,
    readonly maxRecordSize: number,
  ) {}

  shouldRotateBeforeSend(payloadLength: number): Promise<boolean> {
    if (this.destroyed) return Promise.resolve(true);
    return this.port.shouldRotateSession(this.handle, payloadLength);
  }

  async seal(type: ProximityPacketType, payload: Uint8Array): Promise<Uint8Array> {
    if (this.destroyed) throw new Error('Nearby secure session is closed');
    try {
      return await this.port.seal(this.handle, type, payload);
    } catch (error) {
      await this.destroy();
      throw error;
    }
  }

  async open(value: Uint8Array): Promise<{ type: ProximityPacketType; payload: Uint8Array }> {
    if (this.destroyed) throw new Error('Nearby secure session is closed');
    try {
      const result = await this.port.open(this.handle, value);
      return { type: result.type as ProximityPacketType, payload: result.payload };
    } catch (error) {
      await this.destroy();
      throw error;
    }
  }

  matchesRecordSession(value: Uint8Array): boolean {
    return value.length >= 36 && constantTimeEqual(value.subarray(4, 36), this.sessionId);
  }

  async destroy(): Promise<void> {
    if (this.destroyed) return;
    this.destroyed = true;
    await this.port.destroySession(this.handle);
  }
}

export async function createNoiseSecureSession(
  _role: NoiseRole,
  state: ProximityNoiseHandshake,
  maxRecordSize: number,
): Promise<ProximitySecureSession> {
  const handle = activeHandshake(state);
  const session = await state.port.finishHandshake(handle, maxRecordSize);
  state.destroyed = true;
  return new ProximitySecureSession(
    session.sessionId,
    session.handle,
    state.port,
    maxRecordSize,
  );
}
