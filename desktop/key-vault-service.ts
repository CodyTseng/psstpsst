import path from 'node:path';
import { Worker } from 'node:worker_threads';
import type { VaultCommand } from '../src/platform/ports/key-vault';
import type { SecureStorageService } from './secure-storage-service';
import { VaultOperationError } from './vault-failure';

/** The private worker channel is never bridged to renderer IPC. */
export class KeyVaultService {
  private worker: Worker;
  private serial = 0;
  private closed = false;
  revision = 0;
  private pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();
  constructor(private storage: SecureStorageService) {
    const bundled = path.join(__dirname, 'key-vault-worker.js');
    const workerPath = bundled.replace(`${path.sep}app.asar${path.sep}`, `${path.sep}app.asar.unpacked${path.sep}`);
    this.worker = new Worker(workerPath);
    this.worker.on('message', message => {
      if (message.storage) {
        void this.storageRequest(message).then(value => this.worker.postMessage({ storage: true, id: message.id, value }), () => this.worker.postMessage({ storage: true, id: message.id, error: true }));
        return;
      }
      const waiter = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (message.error) waiter?.reject(new VaultOperationError(message.error));
      else waiter?.resolve(message.value);
    });
    const fail = () => {
      this.closed = true;
      for (const waiter of this.pending.values()) waiter.reject(new Error('Key vault unavailable'));
      this.pending.clear();
    };
    this.worker.on('error', fail);
    this.worker.on('exit', fail);
  }
  private async storageRequest(message: { method: string; key: string; value?: string }): Promise<string | null> {
    if (message.method === 'getItem') return this.storage.getItem(message.key);
    if (message.method === 'setItem' && typeof message.value === 'string') await this.storage.setItem(message.key, message.value);
    else if (message.method === 'deleteItem') await this.storage.deleteItem(message.key);
    else throw new Error('Invalid vault storage operation');
    return null;
  }
  private send(message: object): Promise<unknown> {
    if (this.closed) return Promise.reject(new Error('Key vault unavailable'));
    return new Promise((resolve, reject) => {
      const id = ++this.serial;
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ ...message, id });
    });
  }
  walletInternal(action: string, account: string, value?: unknown): Promise<unknown> {
    if (action === 'trusted') this.revision++;
    return this.send({ walletInternal: { action, account, value } });
  }
  isBunkerBound(account: string, peer: string): Promise<unknown> { return this.send({ binding: { account, peer } }); }
  bindBunker(account: string, peer: string): Promise<unknown> { this.revision++; return this.send({ binding: { account, peer, confirm: true } }); }
  execute(command: VaultCommand): Promise<unknown> {
    if (['migrateStorage', 'removeProximity', 'walletImport', 'walletRemove', 'walletRemovePin', 'persistIdentity', 'releaseEphemeral', 'commitBunkerPairing', 'migrateBunkerSecret', 'removeIdentity', 'removeBunker', 'removeMessaging', 'generateMessaging', 'importTransfer', 'endSession'].includes(command.method)) this.revision++;
    return this.send({ command });
  }
  importIdentity(nsec: string): Promise<unknown> {
    this.revision++;
    return this.send({ identityImport: nsec });
  }
  async destroy(): Promise<void> {
    this.closed = true;
    for (const waiter of this.pending.values()) waiter.reject(new Error('Key vault unavailable'));
    this.pending.clear();
    await this.worker.terminate();
  }
  async identityBackup(account: string): Promise<string | null> {
    const value = await this.send({ backup: account });
    if (value === null || typeof value === 'string') return value;
    throw new Error('Invalid backup response');
  }

}
