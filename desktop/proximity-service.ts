import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { setTimeout } from 'node:timers';

import {
  parseNativeProximityMessage,
  validateNativeProximityHandshake,
} from './proximity-protocol';

const REQUEST_TIMEOUT_MS = 30_000;
const HANDSHAKE_TIMEOUT_MS = 5_000;

/** Owns the platform-specific BLE helper and its bounded JSON-lines RPC channel. */
export class ProximityService {
  private child: ChildProcessWithoutNullStreams | null = null;
  private available = false;
  private initialization: Promise<boolean> | null = null;
  private desiredProfile: string | null = null;
  private nextRequestId = 0;
  private readonly pending = new Map<
    string,
    {
      resolve(value: unknown): void;
      reject(error: Error): void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();

  constructor(
    private readonly executablePath: string,
    private readonly emit: (
      name: string,
      value: Record<string, unknown>,
    ) => void,
    private readonly executableArgs: string[] = [],
  ) {}

  static executable(resourcesPath: string, applicationRoot: string): string {
    const name =
      process.platform === 'win32'
        ? 'psstpsst-proximity.exe'
        : 'psstpsst-proximity';
    const packaged = path.join(
      resourcesPath,
      'proximity',
      process.platform,
      name,
    );
    if (existsSync(packaged)) return packaged;
    return path.join(
      applicationRoot,
      'native',
      'proximity',
      'bin',
      process.platform,
      name,
    );
  }

  isAvailable(): boolean {
    return this.available;
  }

  async initialize(): Promise<boolean> {
    if (this.available) return true;
    if (this.initialization) return this.initialization;
    this.initialization = this.initializeChild().finally(() => {
      this.initialization = null;
    });
    return this.initialization;
  }

  private async initializeChild(): Promise<boolean> {
    if (!existsSync(this.executablePath)) {
      console.error(
        `[proximity-native] helper is missing: ${this.executablePath}`,
      );
      return false;
    }
    try {
      validateNativeProximityHandshake(
        await this.request('handshake', {}, HANDSHAKE_TIMEOUT_MS),
        process.platform,
      );
      this.available = true;
    } catch (error) {
      console.error('[proximity-native] capability probe failed', error);
      this.available = false;
      this.close();
      return false;
    }
    if (this.desiredProfile !== null) {
      try {
        await this.request('startAdvertising', {
          profile: this.desiredProfile,
        });
      } catch (error) {
        console.error('[proximity-native] session restore failed', error);
      }
    }
    return this.available;
  }

  private ensureChild(): ChildProcessWithoutNullStreams {
    if (this.child && !this.child.killed) return this.child;
    if (!existsSync(this.executablePath)) {
      throw new Error(
        `The ${process.platform} proximity module has not been built`,
      );
    }
    const child = spawn(this.executablePath, this.executableArgs, {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.child = child;
    const lines = readline.createInterface({ input: child.stdout });
    lines.on('line', (line) => this.acceptLine(line));
    child.stderr.on('data', (data: Buffer) => {
      console.error(`[proximity-native] ${data.toString('utf8').trimEnd()}`);
    });
    child.once('error', (error) => this.failChild(child, error));
    child.once('exit', (code, signal) => {
      this.failChild(
        child,
        new Error(`Proximity module exited (${code ?? signal ?? 'unknown'})`),
      );
    });
    return child;
  }

  private acceptLine(line: string): void {
    const message = parseNativeProximityMessage(line);
    if (!message) return;
    if (message.type === 'event') {
      this.emit(message.name, message.value);
      return;
    }
    const pending = this.pending.get(message.id);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(message.id);
    if (message.ok) pending.resolve(message.value);
    else
      pending.reject(
        new Error(message.error || 'Native proximity request failed'),
      );
  }

  private failChild(child: ChildProcessWithoutNullStreams, error: Error): void {
    if (this.child !== child) return;
    this.child = null;
    this.available = false;
    for (const request of this.pending.values()) {
      clearTimeout(request.timer);
      request.reject(error);
    }
    this.pending.clear();
  }

  private request<T>(
    command: string,
    args: Record<string, unknown> = {},
    timeoutMs = REQUEST_TIMEOUT_MS,
  ): Promise<T> {
    const child = this.ensureChild();
    const id = String(++this.nextRequestId);
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        const error = new Error(
          `Native proximity request timed out: ${command}`,
        );
        this.failChild(child, error);
        if (!child.killed) child.kill();
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
        timer,
      });
      child.stdin.write(
        `${JSON.stringify({ id, command, args })}\n`,
        (error) => {
          if (!error) return;
          this.failChild(child, error);
          if (!child.killed) child.kill();
        },
      );
    });
  }

  private async ensureAvailable(): Promise<boolean> {
    return this.available || this.initialize();
  }

  requestPermissions(): Promise<boolean> {
    if (!this.available)
      return this.initialize().then(
        (available) => available && this.request('requestPermissions'),
      );
    return this.request('requestPermissions');
  }

  async startAdvertising(profile: string): Promise<void> {
    if (!this.available && this.desiredProfile === null) {
      const available = await this.initialize();
      this.desiredProfile = profile;
      if (!available) return;
      return this.request('startAdvertising', { profile });
    }
    this.desiredProfile = profile;
    if (!(await this.ensureAvailable())) return;
    return this.request('startAdvertising', { profile });
  }

  async updateProfile(profile: string): Promise<void> {
    if (this.desiredProfile !== null) this.desiredProfile = profile;
    if (!(await this.ensureAvailable())) return;
    return this.request('updateProfile', { profile });
  }

  async preferPeripheral(endpointId: string): Promise<void> {
    if (!(await this.ensureAvailable())) return;
    return this.request('preferPeripheral', { endpointId });
  }

  async disconnect(endpointId: string): Promise<void> {
    if (!this.available) return;
    return this.request('disconnect', { endpointId });
  }

  async startScan(scanDurationMs: number): Promise<void> {
    if (!(await this.ensureAvailable())) return;
    return this.request('startScan', { scanDurationMs });
  }

  stopScan(): Promise<void> {
    if (!this.available) return Promise.resolve();
    return this.request('stopScan');
  }

  async stopSession(): Promise<void> {
    this.desiredProfile = null;
    if (!this.available) return Promise.resolve();
    return this.request('stopSession');
  }

  async refreshPeerProfile(endpointId: string): Promise<void> {
    if (!(await this.ensureAvailable())) return;
    return this.request('refreshPeerProfile', { endpointId });
  }

  async send(endpointId: string, payload: string): Promise<void> {
    if (!(await this.ensureAvailable())) return;
    return this.request('send', { endpointId, payload });
  }

  close(): void {
    const child = this.child;
    this.child = null;
    this.available = false;
    const error = new Error('Proximity module closed');
    for (const request of this.pending.values()) {
      clearTimeout(request.timer);
      request.reject(error);
    }
    this.pending.clear();
    if (child && !child.killed) child.kill();
  }
}
