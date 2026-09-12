import path from 'node:path';
import { Worker } from 'node:worker_threads';

import type { NoisePort } from '../src/platform/ports/noise';
import type {
  NoiseWorkerMethod,
  NoiseWorkerRequest,
  NoiseWorkerResponse,
} from './noise-worker-protocol';

export class NoiseService implements NoisePort {
  private readonly worker = new Worker(path.join(__dirname, 'noise-worker.js'));
  private readonly pending = new Map<
    number,
    { resolve(value: unknown): void; reject(error: Error): void }
  >();
  private nextRequestId = 1;
  private closed = false;

  constructor() {
    this.worker.on('message', (response: NoiseWorkerResponse) => {
      const pending = this.pending.get(response.id);
      if (!pending) return;
      this.pending.delete(response.id);
      if (response.error) pending.reject(new Error(response.error));
      else pending.resolve(response.result);
    });
    this.worker.on('error', (error) =>
      this.rejectAll(error instanceof Error ? error : new Error(String(error))),
    );
    this.worker.on('exit', (code) => {
      if (!this.closed) this.rejectAll(new Error(`Noise worker exited with code ${code}`));
    });
  }

  generateKeyPair(seed?: Uint8Array) {
    return this.call<Awaited<ReturnType<NoisePort['generateKeyPair']>>>('generateKeyPair', seed);
  }

  createHandshake(
    role: Parameters<NoisePort['createHandshake']>[0],
    staticPrivateKey: Uint8Array,
    fixedEphemeralPrivateKey?: Uint8Array,
  ) {
    return this.call<string>(
      'createHandshake',
      role,
      staticPrivateKey,
      fixedEphemeralPrivateKey,
    );
  }

  writeHandshake(handle: string, payload: Uint8Array) {
    return this.call<Uint8Array>('writeHandshake', handle, payload);
  }

  readHandshake(handle: string, message: Uint8Array) {
    return this.call<Uint8Array>('readHandshake', handle, message);
  }

  getRemoteStaticKey(handle: string) {
    return this.call<Uint8Array>('getRemoteStaticKey', handle);
  }

  finishHandshake(handle: string, maxRecordSize: number) {
    return this.call<Awaited<ReturnType<NoisePort['finishHandshake']>>>(
      'finishHandshake',
      handle,
      maxRecordSize,
    );
  }

  destroyHandshake(handle: string) {
    return this.call<void>('destroyHandshake', handle);
  }

  shouldRotateSession(handle: string, nextPayloadLength: number) {
    return this.call<boolean>('shouldRotateSession', handle, nextPayloadLength);
  }

  seal(handle: string, type: number, payload: Uint8Array) {
    return this.call<Uint8Array>('seal', handle, type, payload);
  }

  open(handle: string, record: Uint8Array) {
    return this.call<Awaited<ReturnType<NoisePort['open']>>>('open', handle, record);
  }

  destroySession(handle: string) {
    return this.call<void>('destroySession', handle);
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.rejectAll(new Error('Noise worker closed'));
    await this.worker.terminate();
  }

  private call<T>(method: NoiseWorkerMethod, ...args: unknown[]): Promise<T> {
    if (this.closed) return Promise.reject(new Error('Noise worker is closed'));
    const id = this.nextRequestId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
      const request: NoiseWorkerRequest = { id, method, args };
      this.worker.postMessage(request);
    });
  }

  private rejectAll(error: Error): void {
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }
}
