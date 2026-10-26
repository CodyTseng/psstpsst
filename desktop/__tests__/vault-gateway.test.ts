import { BrowserWindow, clipboard, dialog, type IpcMainInvokeEvent } from 'electron';
import { DesktopVaultGateway } from '../vault-gateway';
import { VaultOperationError } from '../vault-failure';
import type { KeyVaultService } from '../key-vault-service';
import type { CredentialSecurityService } from '../credential-security';

jest.mock('electron', () => ({
  app: { getLocale: () => 'en' }, BrowserWindow: { fromWebContents: jest.fn() },
  clipboard: { writeText: jest.fn() }, dialog: { showMessageBox: jest.fn() },
}));

const account = 'a'.repeat(64), recipient = 'b'.repeat(64);
const event = { sender: {} } as IpcMainInvokeEvent;
let owner: { isDestroyed: jest.Mock };
let vault: { revision: number; importIdentity: jest.Mock; execute: jest.Mock; walletInternal: jest.Mock; isBunkerBound: jest.Mock; bindBunker: jest.Mock; identityBackup: jest.Mock };
let security: { authorizePayment: jest.Mock };
let trusted: jest.Mock;
let gateway: DesktopVaultGateway;

beforeEach(() => {
  jest.resetAllMocks();
  owner = { isDestroyed: jest.fn(() => false) };
  jest.mocked(BrowserWindow.fromWebContents).mockReturnValue(owner as unknown as BrowserWindow);
  vault = { revision: 1, importIdentity: jest.fn(async () => ({ pubkey: account })), execute: jest.fn(async () => 'result'), walletInternal: jest.fn(async () => null),
    isBunkerBound: jest.fn(async () => true), bindBunker: jest.fn(async () => {}), identityBackup: jest.fn(async () => 'synthetic-private-backup') };
  security = { authorizePayment: jest.fn(async () => true) };
  trusted = jest.fn(() => true);
  gateway = new DesktopVaultGateway(vault as unknown as KeyVaultService, security as unknown as CredentialSecurityService, trusted);
});

test.each([null, [], {}, { method: 'getItem' }, { method: 'importNsec', nsec: 'synthetic-key' }, { method: 'walletInternal' }, { method: '__proto__' }])(
  'rejects unsupported request envelopes before calling the vault', async input => {
    await expect(gateway.execute(event, input)).rejects.toThrow('Invalid vault command');
    expect(vault.execute).not.toHaveBeenCalled();
    expect(dialog.showMessageBox).not.toHaveBeenCalled();
  },
);

test('ordinary signing forwards to the vault without presentation or extra authorization state', async () => {
  const command = { method: 'signEvent', key: { account, role: 'identity' }, template: { kind: 1, content: 'hello', tags: [], created_at: 100 } };
  expect(await gateway.execute(event, command)).toEqual({ ok: true, value: 'result' });
  expect(vault.execute).toHaveBeenCalledWith(command);
  expect(dialog.showMessageBox).not.toHaveBeenCalled();
});

test('key transfer needs platform approval and is cancelled when vault state changes', async () => {
  const command = { method: 'exportTransfer', account, pubkey: null, recipient, confirmation: { language: 'en' } };
  jest.mocked(dialog.showMessageBox).mockImplementationOnce(async () => { vault.revision++; return { response: 1, checkboxChecked: false }; });
  await expect(gateway.execute(event, command)).rejects.toThrow('Vault operation cancelled');
  expect(vault.execute).not.toHaveBeenCalled();
  jest.mocked(dialog.showMessageBox).mockResolvedValueOnce({ response: 1, checkboxChecked: false });
  expect(await gateway.execute(event, command)).toEqual({ ok: true, value: 'result' });
});

test('a caller-supplied trusted flag cannot bypass wallet payment authentication', async () => {
  security.authorizePayment.mockResolvedValueOnce(false);
  await expect(gateway.execute(event, { method: 'walletRequest', account, walletId: 'wallet', operation: 'pay_invoice', params: {}, trusted: true }))
    .rejects.toThrow('Wallet authentication failed');
  expect(vault.walletInternal).not.toHaveBeenCalled();
  expect(vault.execute).not.toHaveBeenCalled();
});

test('backup copies inside the gateway and returns only a boolean', async () => {
  jest.mocked(dialog.showMessageBox).mockResolvedValueOnce({ response: 0, checkboxChecked: false });
  expect(await gateway.backupIdentity(event, account, { language: 'en' })).toBe(true);
  expect(clipboard.writeText).toHaveBeenCalledWith('synthetic-private-backup');
  expect((dialog.showMessageBox as jest.Mock).mock.calls[0][1]).not.toHaveProperty('detail');
});

test('cancelled or stale backup cannot read or copy a private key', async () => {
  jest.mocked(dialog.showMessageBox).mockResolvedValueOnce({ response: 1, checkboxChecked: false });
  expect(await gateway.backupIdentity(event, account)).toBe(false);
  jest.mocked(dialog.showMessageBox).mockImplementationOnce(async () => { vault.revision++; return { response: 0, checkboxChecked: false }; });
  expect(await gateway.backupIdentity(event, account)).toBe(false);
  expect(vault.identityBackup).not.toHaveBeenCalled();
  expect(clipboard.writeText).not.toHaveBeenCalled();
});

test('identity import is input-only and returns public metadata', async () => {
  expect(await gateway.importIdentity(event, 'synthetic-nsec')).toEqual({ pubkey: account });
  expect(vault.importIdentity).toHaveBeenCalledWith('synthetic-nsec');
  expect(vault.execute).not.toHaveBeenCalled();
});

test('all gateway routes reject untrusted senders', async () => {
  trusted.mockReturnValue(false);
  await expect(gateway.execute(event, { method: 'publicKey' })).rejects.toThrow('untrusted sender');
  await expect(gateway.backupIdentity(event, account)).rejects.toThrow('untrusted sender');
  expect(() => gateway.importIdentity(event, 'synthetic-nsec')).toThrow('untrusted sender');
  expect(vault.execute).not.toHaveBeenCalled();
  expect(vault.identityBackup).not.toHaveBeenCalled();
  expect(vault.importIdentity).not.toHaveBeenCalled();
});

test('known vault failures remain structured outcomes without exposing exception details', async () => {
  vault.execute.mockRejectedValueOnce(new VaultOperationError('Key vault operation failed (crypto: OPERATION_FAILED)'));
  expect(await gateway.execute(event, { method: 'crypto' })).toEqual({ ok: false, error: 'Key vault operation failed (crypto: OPERATION_FAILED)' });
});
