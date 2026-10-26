import { app, BrowserWindow, systemPreferences } from 'electron';
import { SecurityInputController } from './security-input';
import { securityCopy } from './vault-consent';
import type { KeyVaultService } from './key-vault-service';
import type { SecureStorageService } from './secure-storage-service';
import type { WalletVaultCommand } from '../src/platform/ports/key-vault';

/** Only the main process can connect trusted credential input to vault state. */
export class CredentialSecurityService {
  private inputs = new SecurityInputController();
  constructor(private storage: SecureStorageService, private vault: KeyVaultService) {}
  private systemAvailable(): boolean { return process.platform === 'darwin' && systemPreferences.canPromptTouchID(); }
  async unlock(owner: BrowserWindow, mode: 'setup' | 'unlock', language?: string): Promise<boolean> {
    const copy = securityCopy(language, app.getLocale());
    const status = await this.storage.accessStatus();
    if (status === 'available') return true;
    mode = status === 'password_setup_required' ? 'setup' : 'unlock';
    return this.inputs.prompt(owner, { title: copy.security[mode === 'setup' ? 'setup_title' : 'unlock_title'],
      message: mode === 'setup' ? copy.security.setup_hint + '\n\n' + copy.security.recovery_warning : copy.security.unlock_hint, cancel: copy.cancel,
      confirm: copy.security[mode === 'setup' ? 'create' : 'unlock'], input: copy.security.password,
      confirmation: mode === 'setup' ? copy.security.confirm_password : undefined, error: copy.security.wrong_password },
    async (password, _confirmation, active) => {
      if (mode === 'setup') { await this.storage.configurePassword(password, active); return active(); }
      return this.storage.unlockWithPassword(password, active);
    });
  }
  async ensureWallet(owner: BrowserWindow, account: string, language?: string): Promise<boolean> {
    if (!/^[0-9a-f]{64}$/i.test(account)) throw new Error('Invalid account');
    if (this.systemAvailable() || await this.vault.walletInternal('hasPin', account)) return true;
    const copy = securityCopy(language, app.getLocale());
    return this.inputs.prompt(owner, { title: copy.wallet.save_pin, message: copy.wallet.pin_setup_hint,
      input: copy.wallet.pin, confirmation: copy.wallet.confirm_pin, numeric: true,
      confirm: copy.wallet.save_pin, cancel: copy.cancel, error: copy.wallet.pin_incorrect }, async (pin, _confirmation, active) => {
      if (!active()) return false;
      await this.vault.walletInternal('setPin', account, pin); return active();
    });
  }
  async authorizePayment(owner: BrowserWindow, command: Extract<WalletVaultCommand, { method: 'walletRequest' }>): Promise<boolean> {
    const copy = securityCopy(command.confirmation?.language, app.getLocale());
    const details = await this.vault.walletInternal('details', command.account, command) as { peer: string; invoice: string; amountSats: string };
    const system = this.systemAvailable();
    const setup = !system && !await this.vault.walletInternal('hasPin', command.account);
    return this.inputs.prompt(owner, { title: copy.wallet.confirm_payment,
      message: system ? copy.wallet.auth_prompt : setup ? copy.wallet.pin_setup_hint : copy.wallet.pin_prompt,
      details: `${details.amountSats} ${copy.wallet.sats_unit}\n\n${details.peer}\n\n${details.invoice}`, cancel: copy.cancel, confirm: copy.wallet.pay, error: copy.wallet.pin_incorrect,
      input: system ? undefined : copy.wallet.pin, confirmation: setup ? copy.wallet.confirm_pin : undefined, numeric: !system },
    async (pin, _confirmation, active) => {
      if (!active()) return false;
      if (system) { await systemPreferences.promptTouchID(copy.wallet.auth_prompt); return active(); }
      if (setup) { await this.vault.walletInternal('setPin', command.account, pin); return active(); }
      return await this.vault.walletInternal('verifyPin', command.account, pin) === true && active();
    });
  }
}
