import { LocalInstaller, localInstallPath } from '../local-installer';
import { getData, setData } from '@/services/napplet/repository';
import { commitLocalApplication, readLocalApplication } from '../local-applications';
import { clearSigningPermissions } from '@/services/signing/repository';
import { clearBrowserPermissions } from '../browser-permission-store';
import { platform } from '@/platform';
import type { ExploreEntry } from '../model';

const mockFiles = new Map<string, Uint8Array>();
jest.mock('@/db/client', () => ({ db: {} }));
jest.mock('@/platform', () => ({ platform: {
  deviceCrypto: { sha256Hex: jest.fn(async (bytes: Uint8Array) => jest.requireActual('node:crypto').createHash('sha256').update(bytes).digest('hex')) },
  fileSystem: {
    documentDirectoryUri: async () => '/managed/',
    makeDirectory: jest.fn(async () => {}),
    availableDiskSpace: jest.fn(async () => 1024 * 1024 * 1024),
    openWriteHandle: jest.fn(async (path: string) => {
      mockFiles.set(path, new Uint8Array());
      return { writeBytes: async (bytes: Uint8Array) => {
        const old = mockFiles.get(path)!;
        mockFiles.set(path, new Uint8Array([...old, ...bytes]));
      }, close: jest.fn(async () => {}) };
    }),
    readBytes: jest.fn(async (path: string) => { if (!mockFiles.has(path)) throw new Error('missing'); return mockFiles.get(path)!; }),
    readText: jest.fn(async (path: string) => new TextDecoder().decode(mockFiles.get(path))),
    copy: jest.fn(async (from: string, to: string) => { mockFiles.set(to, mockFiles.get(from)!); }),
    move: jest.fn(async (from: string, to: string) => {
      for (const [path, bytes] of [...mockFiles]) if (path.startsWith(`${from}/`)) { mockFiles.set(to + path.slice(from.length), bytes); mockFiles.delete(path); }
    }),
    delete: jest.fn(async (root: string) => { for (const path of mockFiles.keys()) if (path === root || path.startsWith(`${root}/`)) mockFiles.delete(path); }),
  },
} }));
jest.mock('@/services/napplet/repository', () => ({ getData: jest.fn(async () => '["dev"]'), setData: jest.fn(async () => {}) }));
jest.mock('@/services/signing/repository', () => ({ clearSigningPermissions: jest.fn(async () => {}) }));
jest.mock('../browser-permission-store', () => ({ clearBrowserPermissions: jest.fn(async () => {}) }));
jest.mock('../local-applications', () => ({
  localApplicationDirectory: (...args: unknown[]) => jest.requireActual('../local-applications').localApplicationDirectory(...args),
  readLocalApplication: jest.fn(async () => undefined),
  commitLocalApplication: jest.fn(async (_account, _entry, _previous, current) => { current(); }),
  reapLocalApplicationStorage: jest.fn(async () => {}),
}));
const caller: ExploreEntry = { key: 'https://developer.example', address: 'https://developer.example', title: 'Builder', kind: 'napp',
  description: '', required: ['dev'], servers: [], desktopPosition: null, lastUsedAt: null };
let life: AbortController, installer: LocalInstaller, confirm: jest.Mock, installed: jest.Mock;
beforeEach(() => {
  jest.clearAllMocks(); mockFiles.clear(); life = new AbortController();
  jest.mocked(getData).mockResolvedValue('["dev"]');
  jest.mocked(readLocalApplication).mockResolvedValue(undefined);
  confirm = jest.fn(async () => 'allow'); installed = jest.fn();
  installer = new LocalInstaller('account', caller, life.signal, confirm, installed);
});
afterEach(() => life.abort());
async function stage(metadata: Record<string, unknown> = { id: 'hello', requires: ['ui'] }) {
  const parts = [JSON.stringify(metadata), '<!doctype html><p>Hello</p>', ''];
  const paths = ['metadata.json', 'index.html', 'assets/empty.txt'];
  const transfer = await installer.handle('begin', [parts.map((data, i) => ({ path: paths[i], size: Buffer.byteLength(data) }))]) as { id: string };
  for (const [i, data] of parts.entries()) await installer.handle('chunk', [transfer.id, i, Buffer.from(data).toString('base64')]);
  return transfer.id;
}

it.each(['../a', '/a/../b', 'a/./b', '//a', 'a\\b', 'C:/file', '%2e%2e/x', 'a//b', 'a/', '\u0000bad', '__policy__', '/__psst__/x'])('rejects unsafe path %j', value => {
  expect(() => localInstallPath(value)).toThrow();
});
it('normalizes relative paths and rejects duplicate canonical names', async () => {
  expect(localInstallPath('assets/app.js')).toBe('/assets/app.js');
  expect(localInstallPath('assets/hello world.js')).toBe('/assets/hello world.js');
  expect(localInstallPath('assets/你好.js')).toBe('/assets/你好.js');
  await expect(installer.handle('begin', [[{ path: 'index.html', size: 0 }, { path: '/index.html', size: 0 }]])).rejects.toThrow('invalid-install-files');
  expect(platform.fileSystem.makeDirectory).not.toHaveBeenCalled();
});
it('rejects undeclared or revoked installer access before creating files', async () => {
  jest.mocked(getData).mockResolvedValue('[]');
  await expect(stage()).rejects.toThrow('permission-denied');
  expect(platform.fileSystem.makeDirectory).not.toHaveBeenCalled();
});
it('requires metadata and a supported entry point and bounds total bytes', async () => {
  await expect(installer.handle('begin', [[{ path: 'index.html', size: 0 }]])).rejects.toThrow('invalid-install-metadata');
  await expect(installer.handle('begin', [[{ path: 'metadata.json', size: 0 }, { path: 'app.wasm', size: 0 }]])).rejects.toThrow('unsupported-local-format');
  await expect(installer.handle('begin', [[{ path: 'metadata.json', size: 1 }, { path: 'index.html', size: 32 * 1024 * 1024 }]])).rejects.toThrow('installation-too-large');
});
it('installs only hashed app files after target-specific review without inheriting caller grants', async () => {
  const id = await stage();
  await expect(installer.handle('finish', [id])).resolves.toEqual({ nappId: 'local~hello' });
  const app = jest.mocked(commitLocalApplication).mock.calls[0][1];
  expect(app).toMatchObject({ key: 'local~hello', required: ['network', 'ui'], local: { installer: caller.key } });
  expect(app.local!.version).toMatch(/^[a-f0-9]{64}$/);
  expect(platform.fileSystem.move).toHaveBeenCalledWith(expect.stringMatching(/\/staging-[a-f0-9]{32}$/),
    expect.stringContaining(`/${app.local!.version}`));
  expect(app.manifest).toBeUndefined();
  expect(app.files).toHaveLength(3);
  expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ application: expect.objectContaining({ title: 'Builder' }),
    installation: expect.objectContaining({ id: 'local~hello', replacing: false, target: expect.objectContaining({ required: ['network', 'ui'] }) }) }), expect.any(AbortSignal));
  expect(setData).not.toHaveBeenCalled();
  expect(mockFiles.size).toBe(3);
});
it('returns null on cancellation and removes staged bytes without changing an existing version', async () => {
  const id = await stage(); confirm.mockResolvedValue(false);
  await expect(installer.handle('finish', [id])).resolves.toBeNull();
  expect(commitLocalApplication).not.toHaveBeenCalled(); expect(setData).not.toHaveBeenCalled(); expect(mockFiles.size).toBe(0);
});
it('rechecks access after a pending review and never commits after revocation', async () => {
  const id = await stage();
  confirm.mockImplementation(async () => { jest.mocked(getData).mockResolvedValue('[]'); return 'allow'; });
  await expect(installer.handle('finish', [id])).rejects.toThrow('permission-denied');
  expect(commitLocalApplication).not.toHaveBeenCalled(); expect(mockFiles.size).toBe(0);
});
it('leaves authorization cleanup to the version transaction when replacing another installer\'s target', async () => {
  jest.mocked(readLocalApplication).mockResolvedValue({ ...caller, key: 'local~hello', local: { version: 'old', installer: 'other', actions: [] } });
  const id = await stage(); await installer.handle('finish', [id]);
  expect(confirm.mock.calls[0][0].installation).toMatchObject({ replacing: true, otherInstaller: true });
  expect(clearSigningPermissions).not.toHaveBeenCalled();
  expect(clearBrowserPermissions).not.toHaveBeenCalled();
  expect(jest.mocked(commitLocalApplication).mock.calls[0][2]).toBe('old');
});

it('does not revoke the existing app when moving replacement files fails', async () => {
  jest.mocked(readLocalApplication).mockResolvedValue({ ...caller, key: 'local~hello', local: { version: 'old', installer: caller.key, actions: [] } });
  const id = await stage();
  jest.mocked(platform.fileSystem.move).mockRejectedValueOnce(new Error('move-failed'));
  await expect(installer.handle('finish', [id])).rejects.toThrow('installation-failed');
  expect(clearSigningPermissions).not.toHaveBeenCalled(); expect(clearBrowserPermissions).not.toHaveBeenCalled();
  expect(commitLocalApplication).not.toHaveBeenCalled();
});
it('rejects reordered or oversized chunks and a premature commit', async () => {
  const { id } = await installer.handle('begin', [[{ path: 'metadata.json', size: 1 }, { path: 'index.html', size: 1 }]]) as { id: string };
  await expect(installer.handle('chunk', [id, 1, 'YQ=='])).rejects.toThrow('invalid-install-chunk');
  await expect(installer.handle('chunk', [id, 0, 'YWI='])).rejects.toThrow('invalid-install-chunk');
  await expect(installer.handle('finish', [id])).rejects.toThrow('incomplete-installation');
  expect(commitLocalApplication).not.toHaveBeenCalled(); expect(mockFiles.size).toBe(0);
});
it('cleans files and drops pending installation when its document closes during review', async () => {
  const id = await stage();
  confirm.mockImplementation(async () => { life.abort(); return 'allow'; });
  await expect(installer.handle('finish', [id])).rejects.toThrow();
  expect(commitLocalApplication).not.toHaveBeenCalled(); expect(mockFiles.size).toBe(0);
});

it('rejects malformed grant data instead of accepting substring matches', async () => {
  jest.mocked(getData).mockResolvedValue('"dev"');
  await expect(stage()).rejects.toThrow('permission-denied');
});
it('redacts underlying filesystem error messages from installer replies', async () => {
  jest.mocked(platform.fileSystem.makeDirectory).mockRejectedValueOnce(new Error('private host path and credentials'));
  await expect(stage()).rejects.toThrow('installation-failed');
});
it('closes a writer opened after cancellation without discarding a newer transfer', async () => {
  const descriptors = [{ path: 'metadata.json', size: 1 }, { path: 'index.html', size: 1 }];
  const first = await installer.handle('begin', [descriptors]) as { id: string };
  let finish!: (writer: { writeBytes: jest.Mock; close: jest.Mock }) => void;
  jest.mocked(platform.fileSystem.openWriteHandle).mockImplementationOnce(async () => new Promise(resolve => { finish = resolve; }));
  const pending = installer.handle('chunk', [first.id, 0, 'YQ==']);
  const rejected = expect(pending).rejects.toThrow('installation-unavailable');
  await installer.handle('cancel', [first.id]);
  const second = await installer.handle('begin', [descriptors]) as { id: string };
  const close = jest.fn(async () => {});
  finish({ writeBytes: jest.fn(async () => {}), close });
  await rejected;
  expect(close).toHaveBeenCalled();
  await expect(installer.handle('chunk', [second.id, 0, 'YQ=='])).resolves.toBe(1);
});
it('does not erase committed bytes if a document closes while its commit acknowledgment is in flight', async () => {
  const id = await stage();
  jest.mocked(commitLocalApplication).mockImplementationOnce(async () => {
    life.abort();
    await Promise.resolve();
    expect(mockFiles.size).toBe(3);
  });
  await expect(installer.handle('finish', [id])).resolves.toEqual({ nappId: 'local~hello' });
  expect(mockFiles.size).toBe(3);
});
