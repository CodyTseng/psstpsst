import { requireNativeModule } from 'expo-modules-core';
import type { KeyVaultPort } from '../ports/key-vault';

type NativeVault = {
  importIdentity(nsec: string): Promise<string>;
  vaultExecute(command: string): Promise<string>;
  backupIdentity(account: string, confirmation: string): Promise<boolean>;
};
let native: NativeVault | undefined;
function load(): NativeVault {
  // Missing native vaults fail closed; private keys must never fall back to JS.
  return native ??= requireNativeModule<NativeVault>('ExpoCryptoAccelerator');
}
export const keyVaultAdapter: KeyVaultPort = {
  importIdentity: async nsec => JSON.parse(await load().importIdentity(nsec)),
  execute: async command => JSON.parse(await load().vaultExecute(JSON.stringify(command))),
  backupIdentity: async (account, confirmation) => load().backupIdentity(account, JSON.stringify(confirmation)),
};
