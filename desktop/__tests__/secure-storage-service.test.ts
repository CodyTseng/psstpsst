import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

jest.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: jest.fn(() => false),
    getSelectedStorageBackend: jest.fn(() => 'basic_text'),
    encryptStringAsync: jest.fn(),
    decryptStringAsync: jest.fn(),
  },
}));

import { safeStorage } from 'electron';
import { SecureStorageService } from '../secure-storage-service';

const mockSafeStorage = safeStorage as jest.Mocked<typeof safeStorage>;

describe('Electron secure-storage password fallback', () => {
  let directory: string;

  beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'psstpsst-secure-storage-test-'));
    mockSafeStorage.isEncryptionAvailable.mockReturnValue(false);
    mockSafeStorage.getSelectedStorageBackend.mockReturnValue('basic_text');
  });

  afterEach(async () => {
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
    await expect(second.unlockWithPassword('correct horse battery staple')).resolves.toBe(true);
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
});
