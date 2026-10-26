import { app, BrowserWindow, clipboard, dialog, type IpcMainInvokeEvent } from 'electron';
import { isVaultMethod, type VaultCommand, type VaultConsent } from '../src/platform/ports/key-vault';
import type { CredentialSecurityService } from './credential-security';
import type { KeyVaultService } from './key-vault-service';
import { vaultConsent } from './vault-consent';
import { vaultReply } from './vault-failure';

function accountHex(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value)) throw new Error('Invalid account or recipient');
  return value;
}

/** Owns transport and trusted presentation, never key storage or business state. */
export class DesktopVaultGateway {
  constructor(private vault: KeyVaultService, private security: CredentialSecurityService,
    private trusted: (event: IpcMainInvokeEvent) => boolean) {}

  private assertTrusted(event: IpcMainInvokeEvent): void {
    if (!this.trusted(event)) throw new Error('Rejected vault request from an untrusted sender');
  }

  private owner(event: IpcMainInvokeEvent): BrowserWindow | null {
    this.assertTrusted(event);
    const owner = BrowserWindow.fromWebContents(event.sender);
    return owner && !owner.isDestroyed() ? owner : null;
  }

  importIdentity(event: IpcMainInvokeEvent, nsec: unknown) {
    this.assertTrusted(event);
    if (typeof nsec !== 'string' || nsec.length > 256) throw new Error('Invalid private key input');
    return this.vault.importIdentity(nsec);
  }

  execute(event: IpcMainInvokeEvent, input: unknown) {
    return vaultReply(async () => {
      this.assertTrusted(event);
      if (!input || typeof input !== 'object' || Array.isArray(input) || !isVaultMethod((input as { method?: unknown }).method)) {
        throw new Error('Invalid vault command');
      }
      // The transport checks dispatch only. Key-purpose and protocol checks stay inside the vault.
      const command = input as VaultCommand;
      if (command.method === 'walletRequest' && command.operation === 'pay_invoice') {
        const owner = this.owner(event);
        if (!owner) throw new Error('Missing wallet owner');
        const revision = this.vault.revision;
        if (!await this.security.authorizePayment(owner, command)) throw new Error('Wallet authentication failed');
        if (owner.isDestroyed() || !this.trusted(event) || this.vault.revision !== revision) throw new Error('Wallet operation cancelled');
        return this.vault.walletInternal('trusted', command.account, command);
      }
      const revision = this.vault.revision;
      const bindingNeeded = command.method === 'bunkerRequest' && !await this.vault.isBunkerBound(command.account, command.peer);
      if (command.method === 'exportTransfer' || bindingNeeded) {
        const owner = this.owner(event);
        if (!owner) throw new Error('No key transfer presenter');
        const account = accountHex('account' in command ? command.account : undefined);
        const recipient = accountHex(command.method === 'exportTransfer' ? command.recipient : command.method === 'bunkerRequest' ? command.peer : undefined);
        const language = 'confirmation' in command ? command.confirmation?.language : undefined;
        const options = vaultConsent(language, app.getLocale(), bindingNeeded ? 'bunker' : 'transfer');
        const result = await dialog.showMessageBox(owner, { type: 'warning',
          title: options.title, message: options.message,
          detail: `${account}\n\n${recipient.slice(0, 4).toUpperCase()} ${recipient.slice(4, 8).toUpperCase()}\n${recipient}`,
          buttons: [options.cancel, options.confirm], defaultId: 0, cancelId: 0, noLink: true });
        if (result.response !== 1 || owner.isDestroyed() || !this.trusted(event) || this.vault.revision !== revision) throw new Error('Vault operation cancelled');
        if (bindingNeeded) await this.vault.bindBunker(account, recipient);
      }
      return this.vault.execute(command);
    });
  }

  async backupIdentity(event: IpcMainInvokeEvent, account: unknown, selection?: VaultConsent): Promise<boolean> {
    const owner = this.owner(event);
    if (!owner) return false;
    const pubkey = accountHex(account);
    const options = vaultConsent(selection?.language, app.getLocale(), 'backup');
    const revision = this.vault.revision;
    const response = await dialog.showMessageBox(owner, { type: 'warning', title: options.title,
      message: options.message, buttons: [options.confirm, options.cancel], defaultId: 0, cancelId: 1, noLink: true });
    if (response.response !== 0 || !this.trusted(event) || this.vault.revision !== revision) return false;
    const nsec = await this.vault.identityBackup(pubkey);
    if (!nsec) throw new Error('No local identity key is available for backup');
    if (owner.isDestroyed() || !this.trusted(event) || this.vault.revision !== revision) return false;
    clipboard.writeText(nsec);
    return true;
  }


}
