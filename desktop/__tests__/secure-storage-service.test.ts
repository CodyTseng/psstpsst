import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { safeStorage } from 'electron';
import { SecureStorageService } from '../secure-storage-service';

jest.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: jest.fn(() => false),
    getSelectedStorageBackend: jest.fn(() => 'basic_text'),
    encryptStringAsync: jest.fn(),
    decryptStringAsync: jest.fn(),
  },
}));

const mockSafeStorage = safeStorage as jest.Mocked<typeof safeStorage>;

describe('Electron secure-storage password fallback', () => {
  let directory: string;

  beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'psstpsst-secure-storage-test-'));
    mockSafeStorage.isEncryptionAvailable.mockReturnValue(false);
    mockSafeStorage.getSelectedStorageBackend.mockReturnValue('basic_text');
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await fs.rm(directory, { recursive: true, force: true });
  });

  it('requires setup, encrypts values, and unlocks a later process', async () => {
    const first = new SecureStorageService(directory);
    await expect(first.accessStatus()).resolves.toBe('password_setup_required');
    await first.configurePassword('correct horse battery staple');
    await first.setItem('wallet-key', 'secret-value');
    await expect(first.configurePassword('replacement password')).rejects.toThrow(
      'already configured',
    );

    const raw = await fs.readFile(path.join(directory, 'secrets.password.enc'), 'utf8');
    expect(raw).not.toContain('secret-value');

    const second = new SecureStorageService(directory);
    await expect(second.accessStatus()).resolves.toBe('password_required');
    await expect(second.unlockWithPassword('wrong password')).resolves.toBe(false);
    const now = Date.now();
    const clock = jest.spyOn(Date, 'now').mockReturnValue(now + 1001);
    await expect(second.unlockWithPassword('correct horse battery staple')).resolves.toBe(true);
    clock.mockRestore();
    await expect(second.getItem('wallet-key')).resolves.toBe('secret-value');
  });

  it('refuses to replace an inaccessible OS-encrypted vault', async () => {
    await fs.writeFile(path.join(directory, 'secrets.enc'), 'existing encrypted data');
    const service = new SecureStorageService(directory);

    await expect(service.accessStatus()).rejects.toThrow('existing OS-encrypted vault');
    await expect(service.configurePassword('correct horse battery staple')).rejects.toThrow(
      'Cannot replace',
    );
  });
  it('does not install an unlock key after the trusted input window closes', async () => {
    const first = new SecureStorageService(directory);
    await first.configurePassword('correct horse battery staple');
    const restarted = new SecureStorageService(directory);
    await expect(restarted.unlockWithPassword('correct horse battery staple', () => false)).resolves.toBe(false);
    await expect(restarted.accessStatus()).resolves.toBe('password_required');
  });
  it('serializes password setup so a second request cannot replace the vault', async () => {
    const service = new SecureStorageService(directory);
    const outcomes = await Promise.allSettled([service.configurePassword('first strong password'), service.configurePassword('second strong password')]);
    expect(outcomes.filter(outcome => outcome.status === 'fulfilled')).toHaveLength(1);
    const restarted = new SecureStorageService(directory);
    await expect(restarted.unlockWithPassword('first strong password')).resolves.toBe(true);
  });

  it('leaves a just-created vault locked when setup is cancelled during its durable write', async () => {
    const service = new SecureStorageService(directory);
    let checks = 0;
    await expect(service.configurePassword('correct horse battery staple', () => ++checks === 1)).rejects.toThrow('cancelled');
    await expect(service.accessStatus()).resolves.toBe('password_required');
    await expect(service.unlockWithPassword('correct horse battery staple')).resolves.toBe(true);
  });

});
