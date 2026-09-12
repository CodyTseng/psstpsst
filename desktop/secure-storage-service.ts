import { createCipheriv, createDecipheriv, randomBytes, scrypt } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import { safeStorage } from 'electron';
import writeFileAtomic = require('write-file-atomic');

const MAX_KEY_LENGTH = 512;
const MAX_VALUE_LENGTH = 1024 * 1024;
const MIN_PASSWORD_LENGTH = 8;
const FALLBACK_VERSION = 1;
const SCRYPT_N = 1 << 15;
const SCRYPT_R = 8;
const SCRYPT_P = 1;

type PasswordEnvelope = {
  version: 1;
  salt: string;
  iv: string;
  tag: string;
  ciphertext: string;
};

export class SecureStorageService {
  private readonly filePath: string;
  private readonly passwordFilePath: string;
  private queue: Promise<void> = Promise.resolve();
  private passwordKey: Buffer | null = null;
  private passwordSalt: Buffer | null = null;

  constructor(userDataPath: string) {
    this.filePath = path.join(userDataPath, 'secrets.enc');
    this.passwordFilePath = path.join(userDataPath, 'secrets.password.enc');
  }

  private osEncryptionAvailable(): boolean {
    const insecureLinuxBackend =
      process.platform === 'linux' &&
      ['basic_text', 'unknown'].includes(safeStorage.getSelectedStorageBackend());
    return safeStorage.isEncryptionAvailable() && !insecureLinuxBackend;
  }

  private async passwordFileExists(): Promise<boolean> {
    try {
      await fs.access(this.passwordFilePath);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw error;
    }
  }

  private async osEncryptedFileExists(): Promise<boolean> {
    try {
      await fs.access(this.filePath);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw error;
    }
  }

  async accessStatus(): Promise<'available' | 'password_setup_required' | 'password_required'> {
    if (await this.passwordFileExists()) {
      return this.passwordKey ? 'available' : 'password_required';
    }
    if (this.osEncryptionAvailable()) return 'available';
    if (await this.osEncryptedFileExists()) {
      throw new Error('The existing OS-encrypted vault is unavailable on this system');
    }
    return 'password_setup_required';
  }

  async configurePassword(password: string): Promise<void> {
    if (password.length < MIN_PASSWORD_LENGTH || password.length > 256) {
      throw new Error('Application password must contain 8 to 256 characters');
    }
    if (await this.passwordFileExists()) {
      throw new Error('Application password storage is already configured');
    }
    if (this.osEncryptionAvailable()) {
      throw new Error('OS-backed secure storage is already available');
    }
    if (await this.osEncryptedFileExists()) {
      throw new Error('Cannot replace an existing OS-encrypted vault with an empty password vault');
    }
    const salt = randomBytes(16);
    const key = await derivePasswordKey(password, salt);
    await this.writePasswordValues({}, key, salt);
    this.passwordKey = key;
    this.passwordSalt = salt;
  }

  async unlockWithPassword(password: string): Promise<boolean> {
    if (!(await this.passwordFileExists())) return this.osEncryptionAvailable();
    try {
      const envelope = await this.readPasswordEnvelope();
      const salt = Buffer.from(envelope.salt, 'base64');
      const key = await derivePasswordKey(password, salt);
      await this.decryptPasswordValues(envelope, key);
      this.passwordKey = key;
      this.passwordSalt = salt;
      return true;
    } catch {
      return false;
    }
  }

  private validateKey(key: string): void {
    if (!key || key.length > MAX_KEY_LENGTH || key.includes('\0')) {
      throw new Error('Invalid secure-storage key');
    }
  }

  private async read(): Promise<Record<string, string>> {
    if (await this.passwordFileExists()) {
      if (!this.passwordKey) throw new Error('Application password is required');
      return this.decryptPasswordValues(await this.readPasswordEnvelope(), this.passwordKey);
    }
    if (!this.osEncryptionAvailable()) throw new Error('Secure storage is locked');
    try {
      const encrypted = await fs.readFile(this.filePath);
      const decrypted = await safeStorage.decryptStringAsync(encrypted);
      const parsed: unknown = JSON.parse(decrypted.result);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('Secure storage has an invalid format');
      }
      return parsed as Record<string, string>;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
      throw error;
    }
  }

  private async write(values: Record<string, string>): Promise<void> {
    if ((await this.passwordFileExists()) || this.passwordKey) {
      if (!this.passwordKey || !this.passwordSalt) {
        throw new Error('Application password is required');
      }
      await this.writePasswordValues(values, this.passwordKey, this.passwordSalt);
      return;
    }
    if (!this.osEncryptionAvailable()) throw new Error('Secure storage is locked');
    const encrypted = await safeStorage.encryptStringAsync(JSON.stringify(values));
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await writeFileAtomic(this.filePath, encrypted, { mode: 0o600 });
  }

  private async readPasswordEnvelope(): Promise<PasswordEnvelope> {
    const parsed: unknown = JSON.parse(await fs.readFile(this.passwordFilePath, 'utf8'));
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      (parsed as PasswordEnvelope).version !== FALLBACK_VERSION ||
      !['salt', 'iv', 'tag', 'ciphertext'].every(
        (key) => typeof (parsed as unknown as Record<string, unknown>)[key] === 'string',
      )
    ) {
      throw new Error('Password-encrypted storage has an invalid format');
    }
    return parsed as PasswordEnvelope;
  }

  private async decryptPasswordValues(
    envelope: PasswordEnvelope,
    key: Buffer,
  ): Promise<Record<string, string>> {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
    const plain = Buffer.concat([
      decipher.update(Buffer.from(envelope.ciphertext, 'base64')),
      decipher.final(),
    ]);
    const parsed: unknown = JSON.parse(plain.toString('utf8'));
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      Array.isArray(parsed) ||
      Object.entries(parsed).some(
        ([keyName, value]) =>
          !keyName || keyName.length > MAX_KEY_LENGTH || typeof value !== 'string',
      )
    ) {
      throw new Error('Password-encrypted storage has invalid values');
    }
    return parsed as Record<string, string>;
  }

  private async writePasswordValues(
    values: Record<string, string>,
    key: Buffer,
    salt: Buffer,
  ): Promise<void> {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(values), 'utf8'),
      cipher.final(),
    ]);
    const envelope: PasswordEnvelope = {
      version: FALLBACK_VERSION,
      salt: salt.toString('base64'),
      iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
      ciphertext: ciphertext.toString('base64'),
    };
    await fs.mkdir(path.dirname(this.passwordFilePath), { recursive: true });
    await writeFileAtomic(this.passwordFilePath, JSON.stringify(envelope), { mode: 0o600 });
  }

  private serialized<T>(task: () => Promise<T>): Promise<T> {
    const result = this.queue.then(task, task);
    this.queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  getItem(key: string): Promise<string | null> {
    this.validateKey(key);
    return this.serialized(async () => (await this.read())[key] ?? null);
  }

  setItem(key: string, value: string): Promise<void> {
    this.validateKey(key);
    if (value.length > MAX_VALUE_LENGTH) throw new Error('Secure-storage value is too large');
    return this.serialized(async () => {
      const values = await this.read();
      values[key] = value;
      await this.write(values);
    });
  }

  deleteItem(key: string): Promise<void> {
    this.validateKey(key);
    return this.serialized(async () => {
      const values = await this.read();
      if (!(key in values)) return;
      delete values[key];
      await this.write(values);
    });
  }
}

function derivePasswordKey(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      password,
      salt,
      32,
      { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P, maxmem: 64 * 1024 * 1024 },
      (error, key) => (error ? reject(error) : resolve(key)),
    );
  });
}
