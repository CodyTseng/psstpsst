import { platform } from '@/platform';
import { createAbortError } from '@/lib/async/abort';
import { downloadAttachmentBytes } from '../attachment-download.service';

jest.mock('@/platform', () => ({ platform: { fileSystem: {
  cacheDirectoryUri: jest.fn(), stat: jest.fn(), readText: jest.fn(), writeText: jest.fn(),
  readBytes: jest.fn(), openWriteHandle: jest.fn(), delete: jest.fn(), requestRemoteFile: jest.fn(),
} } }));
jest.mock('../file-crypto', () => ({ sha256Hex: jest.fn(async () => 'cache-key') }));

const fs = jest.mocked(platform.fileSystem);
const files = new Map<string, Uint8Array>();
const texts = new Map<string, string>();
const options = { url: 'https://media.example/blob', identity: 'hash:key:nonce', immutable: true };
const uri = 'cache/attachment-download-cache-key.part';

beforeEach(() => {
  jest.resetAllMocks();
  files.clear(); texts.clear();
  // resetAllMocks clears the hash implementation too.
  jest.requireMock('../file-crypto').sha256Hex.mockResolvedValue('cache-key');
  fs.cacheDirectoryUri.mockResolvedValue('cache/');
  fs.stat.mockImplementation(async (path) => ({ exists: files.has(path), size: files.get(path)?.length ?? null,
    isDirectory: false, creationTime: null, modificationTime: null }));
  fs.readText.mockImplementation(async (path) => {
    const text = texts.get(path);
    if (!text) throw new Error('missing');
    return text;
  });
  fs.writeText.mockImplementation(async (path, text) => { texts.set(path, text); });
  fs.readBytes.mockImplementation(async (path) => files.get(path)!);
  fs.delete.mockImplementation(async (path) => { files.delete(path); texts.delete(path); });
  fs.openWriteHandle.mockImplementation(async (path, opts) => {
    if (opts?.truncate) files.set(path, new Uint8Array());
    return { close: async () => {}, writeBytes: async (bytes) => {
      const old = files.get(path) ?? new Uint8Array();
      const result = new Uint8Array(old.length + bytes.length);
      result.set(old); result.set(bytes, old.length); files.set(path, result);
    } };
  });
});

it('reports streamed full-response progress when the server ignores Range', async () => {
  const progress = jest.fn();
  fs.requestRemoteFile.mockImplementation(async (_url, opts) => {
    opts.onProgress?.(2, 4);
    return { status: 200, headers: {}, body: new Uint8Array([1, 2, 3, 4]) };
  });
  expect((await downloadAttachmentBytes({ ...options, onProgress: progress })).bytes).toEqual(new Uint8Array([1, 2, 3, 4]));
  expect(progress).toHaveBeenCalledWith(2, 4);
  expect(progress).toHaveBeenLastCalledWith(4, 4);
  expect(files.has(uri)).toBe(true);
});

it('keeps completed chunks on pause and continues from their byte offset', async () => {
  const controller = new AbortController();
  fs.requestRemoteFile.mockImplementationOnce(async () => ({
    status: 206, headers: { 'content-range': 'bytes 0-2/5' }, body: new Uint8Array([1, 2, 3]),
  })).mockImplementationOnce(async () => {
    controller.abort(); throw createAbortError();
  });
  await expect(downloadAttachmentBytes({ ...options, signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
  expect(files.get(uri)).toEqual(new Uint8Array([1, 2, 3]));
  fs.requestRemoteFile.mockResolvedValueOnce({
    status: 206, headers: { 'content-range': 'bytes 3-4/5' }, body: new Uint8Array([4, 5]),
  });
  expect((await downloadAttachmentBytes(options)).bytes).toEqual(new Uint8Array([1, 2, 3, 4, 5]));
  expect(fs.requestRemoteFile).toHaveBeenLastCalledWith(options.url, expect.objectContaining({
    headers: { Range: 'bytes=3-4' },
  }));
});

it('replaces the partial instead of appending when Range is ignored on continuation', async () => {
  files.set(uri, new Uint8Array([9, 9])); texts.set(`${uri}.json`, JSON.stringify({ total: 4 }));
  fs.requestRemoteFile.mockResolvedValue({ status: 200, headers: {}, body: new Uint8Array([1, 2, 3, 4]) });
  expect((await downloadAttachmentBytes(options)).bytes).toEqual(new Uint8Array([1, 2, 3, 4]));
});

it('does not reuse a mutable URL partial without a validator', async () => {
  files.set(uri, new Uint8Array([9, 9])); texts.set(`${uri}.json`, JSON.stringify({ total: 4 }));
  fs.requestRemoteFile.mockResolvedValue({ status: 200, headers: {}, body: new Uint8Array([1]) });
  await downloadAttachmentBytes({ ...options, immutable: false });
  expect(fs.requestRemoteFile).toHaveBeenCalledWith(options.url, expect.objectContaining({
    headers: {},
  }));
});

it('uses If-Range for mutable URL continuation', async () => {
  files.set(uri, new Uint8Array([1, 2])); texts.set(`${uri}.json`, JSON.stringify({ total: 4, validator: '"v1"' }));
  fs.requestRemoteFile.mockResolvedValue({ status: 206, headers: { 'content-range': 'bytes 2-3/4', etag: '"v1"' }, body: new Uint8Array([3, 4]) });
  await downloadAttachmentBytes({ ...options, immutable: false });
  expect(fs.requestRemoteFile).toHaveBeenCalledWith(options.url, expect.objectContaining({
    headers: { Range: 'bytes=2-3', 'If-Range': '"v1"' },
  }));
});

it('rejects malformed ranges without saving their bytes', async () => {
  fs.requestRemoteFile.mockResolvedValue({ status: 206, headers: { 'content-range': 'bytes 1-2/4' }, body: new Uint8Array([1, 2]) });
  await expect(downloadAttachmentBytes(options)).rejects.toThrow('Invalid attachment range response');
  expect(files.get(uri)?.length).toBe(0);
});


it('reuses fully downloaded ciphertext after a pause during verification without another request', async () => {
  fs.requestRemoteFile.mockResolvedValue({ status: 200, headers: {}, body: new Uint8Array([1, 2, 3, 4]) });
  const downloaded = await downloadAttachmentBytes(options);
  expect(files.get(uri)).toEqual(downloaded.bytes);
  const continued = await downloadAttachmentBytes(options);
  expect(continued.bytes).toEqual(downloaded.bytes);
  expect(fs.requestRemoteFile).toHaveBeenCalledTimes(1);
  await continued.discard();
  expect(files.has(uri)).toBe(false);
  expect(texts.has(`${uri}.json`)).toBe(false);
});

it('retains a complete mutable response without a validator until it is published', async () => {
  fs.requestRemoteFile.mockResolvedValue({ status: 200, headers: {}, body: new Uint8Array([1, 2]) });
  const mutable = { ...options, immutable: false };
  await downloadAttachmentBytes(mutable);
  expect((await downloadAttachmentBytes(mutable)).bytes).toEqual(new Uint8Array([1, 2]));
  expect(fs.requestRemoteFile).toHaveBeenCalledTimes(1);
});

it('waits for an active cache reader before discarding completed ciphertext', async () => {
  fs.requestRemoteFile.mockResolvedValue({ status: 200, headers: {}, body: Uint8Array.of(1, 2) });
  const first = await downloadAttachmentBytes(options);
  let entered!: () => void;
  let finish!: () => void;
  const reading = new Promise<void>((resolve) => { entered = resolve; });
  fs.readBytes.mockImplementationOnce(async (path) => {
    entered();
    await new Promise<void>((resolve) => { finish = resolve; });
    if (!files.has(path)) throw new Error('File missing');
    return files.get(path)!;
  });
  const second = downloadAttachmentBytes(options);
  await reading;
  const cleanup = first.discard();
  await Promise.resolve();
  expect(fs.delete).not.toHaveBeenCalled();
  finish();
  expect((await second).bytes).toEqual(Uint8Array.of(1, 2));
  await cleanup;
  expect(files.has(uri)).toBe(false);
  expect(fs.requestRemoteFile).toHaveBeenCalledTimes(1);
});

it.each(['open', 'read'] as const)('redownloads when the cached file disappears during %s', async (stage) => {
  files.set(uri, Uint8Array.of(9, 9));
  texts.set(`${uri}.json`, JSON.stringify({ total: 2, complete: true }));
  if (stage === 'open') {
    fs.openWriteHandle.mockImplementationOnce(async () => {
      files.delete(uri); throw new Error('File missing');
    });
  } else {
    fs.readBytes.mockImplementationOnce(async () => {
      files.delete(uri); throw new Error('File missing');
    });
  }
  fs.requestRemoteFile.mockResolvedValue({ status: 200, headers: {}, body: Uint8Array.of(1, 2) });
  expect((await downloadAttachmentBytes(options)).bytes).toEqual(Uint8Array.of(1, 2));
  expect(fs.requestRemoteFile).toHaveBeenCalledTimes(1);
});

it('does not retry filesystem failures when the cache still exists', async () => {
  files.set(uri, Uint8Array.of(1, 2));
  texts.set(`${uri}.json`, JSON.stringify({ total: 2, complete: true }));
  fs.readBytes.mockRejectedValueOnce(new Error('Permission denied'));
  await expect(downloadAttachmentBytes(options)).rejects.toThrow('Permission denied');
  expect(fs.requestRemoteFile).not.toHaveBeenCalled();
});
