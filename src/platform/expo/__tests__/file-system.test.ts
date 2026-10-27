import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileSystemAdapter } from '../file-system';

jest.mock('expo/fetch', () => ({ fetch: jest.fn() }));
jest.mock('expo-file-system/legacy', () => ({
  getInfoAsync: jest.fn(async (uri: string) => {
    const fs = jest.requireActual('node:fs') as typeof import('node:fs');
    if (!fs.existsSync(uri)) return { exists: false };
    const info = fs.statSync(uri);
    return { exists: true, isDirectory: info.isDirectory(), modificationTime: info.mtimeMs / 1000 };
  }),
}));
jest.mock('expo-file-system', () => {
  const fs = jest.requireActual('node:fs') as typeof import('node:fs');
  // Native Expo rejects the wrong path type instead of treating directories as files.
  class Path {
    readonly uri: string;
    constructor(uri: string, directory: boolean) {
      this.uri = uri;
      if (fs.existsSync(uri) && fs.statSync(uri).isDirectory() !== directory) throw new Error('wrong-path-type');
    }
    async move(destination: Path) {
      if (fs.existsSync(destination.uri)) throw new Error('destination-exists');
      await fs.promises.rename(this.uri, destination.uri);
    }
  }
  return {
    Paths: { info: (uri: string) => ({ exists: fs.existsSync(uri), isDirectory: fs.existsSync(uri) ? fs.statSync(uri).isDirectory() : null }) },
    Directory: class extends Path { constructor(uri: string) { super(uri, true); } },
    File: class extends Path {
      constructor(uri: string) { super(uri, false); }
      info() { const info = fs.statSync(this.uri); return { size: info.size, creationTime: info.birthtimeMs, modificationTime: info.mtimeMs }; }
    },
  };
});

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'psst-expo-fs-')); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

it('moves a staging directory and all nested files to the exact version path', async () => {
  const staging = join(root, 'staging'), version = join(root, 'version');
  mkdirSync(join(staging, 'nested'), { recursive: true });
  writeFileSync(join(staging, 'nested', 'app.blob'), 'app');
  await fileSystemAdapter.move(staging, version);
  expect(existsSync(staging)).toBe(false);
  expect(readFileSync(join(version, 'nested', 'app.blob'), 'utf8')).toBe('app');
});

it('continues to move individual files', async () => {
  const from = join(root, 'from'), to = join(root, 'to');
  writeFileSync(from, 'content');
  await fileSystemAdapter.move(from, to);
  expect(existsSync(from)).toBe(false);
  expect(readFileSync(to, 'utf8')).toBe('content');
});

it('reports directory modification times in milliseconds for age-based cleanup', async () => {
  const info = await fileSystemAdapter.stat(root);
  expect(info).toMatchObject({ exists: true, isDirectory: true, size: null });
  expect(info.modificationTime).toBeCloseTo(statSync(root).mtimeMs, 2);
  await expect(fileSystemAdapter.stat(join(root, 'missing'))).resolves.toMatchObject({ exists: false, modificationTime: null });
});

it('rejects a failed directory move without removing its contents', async () => {
  const from = join(root, 'from'), to = join(root, 'to');
  mkdirSync(from); mkdirSync(to); writeFileSync(join(from, 'app.blob'), 'app');
  await expect(fileSystemAdapter.move(from, to)).rejects.toThrow();
  expect(readFileSync(join(from, 'app.blob'), 'utf8')).toBe('app');
});
