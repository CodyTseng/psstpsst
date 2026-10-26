import { parentPort } from 'node:worker_threads';
import { LocalKeyVault } from '../src/platform/vault/local-vault';
import type { VaultCommand } from '../src/platform/ports/key-vault';
import { vaultFailure } from './vault-failure';

if (!parentPort) throw new Error('Vault worker requires a private parent port');
const channel = parentPort;
let serial = 0;
const pending = new Map<number, { resolve(value: string | null): void; reject(error: Error): void }>();
function storage(method: string, key: string, value?: string): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const id = ++serial;
    pending.set(id, { resolve, reject });
    channel.postMessage({ storage: true, id, method, key, value });
  });
}
const vault = new LocalKeyVault({
  getItem: key => storage('getItem', key),
  setItem: async (key, value) => { await storage('setItem', key, value); },
  deleteItem: async key => { await storage('deleteItem', key); },
});
channel.on('message', (message: { id: number; storage?: boolean; value?: string | null; error?: string; command?: VaultCommand; identityImport?: string; walletInternal?: { action: string; account: string; value?: unknown }; backup?: string; binding?: { account: string; peer: string; confirm?: boolean } }) => {
  if (message.storage) {
    const waiter = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) waiter?.reject(new Error('Vault storage unavailable'));
    else waiter?.resolve(message.value ?? null);
    return;
  }
  const task = message.identityImport !== undefined ? vault.importIdentity(message.identityImport) : message.walletInternal ? vault.walletInternal(message.walletInternal.action, message.walletInternal.account, message.walletInternal.value) : message.binding ? (message.binding.confirm
    ? vault.bindBunker(message.binding.account, message.binding.peer)
    : vault.isBunkerBound(message.binding.account, message.binding.peer)) : message.backup ? vault.identityBackup(message.backup) : vault.execute(message.command!);
  void task.then(value => channel.postMessage({ id: message.id, value }), error => channel.postMessage({ id: message.id,
    error: vaultFailure(error, message.command?.method, message.command?.method === 'crypto' ? message.command : undefined) }));
});
