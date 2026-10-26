import type { KeyVaultPort } from './ports/key-vault';
import { getPlatform } from './registry';

/** Internal transport for key-owning services. Ordinary consumers receive Signer capabilities. */
export const vaultAccess: KeyVaultPort = {
  importIdentity: nsec => getPlatform().keyVault.importIdentity(nsec),
  execute: command => getPlatform().keyVault.execute(command),
  backupIdentity: (account, confirmation) => getPlatform().keyVault.backupIdentity(account, confirmation),
};
