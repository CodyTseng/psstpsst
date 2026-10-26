import { finalizeEvent, generateSecretKey, verifyEvent } from 'nostr-tools';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { base64 } from '@scure/base';
import { platform } from '@/platform';
import { NappletUploads } from '../upload';
import { UPLOAD_CHUNK_BYTES } from '../upload-transport';

const files = new Map<string, Uint8Array[]>();
jest.mock('@/services/files/media-server.service', () => ({ loadAccountMediaServers: jest.fn(async () => ['https://media.example/']) }));
jest.mock('@/platform', () => ({ platform: {
  deviceCrypto: { sha256Hex: jest.fn() },
  fileSystem: { cacheDirectoryUri: jest.fn(async () => 'file:///cache/'), makeDirectory: jest.fn(async () => {}),
    openWriteHandle: jest.fn(), uploadFile: jest.fn(), delete: jest.fn(async () => {}) },
} }));

const secret = generateSecretKey();
beforeEach(() => {
  jest.clearAllMocks(); files.clear();
  jest.mocked(platform.deviceCrypto.sha256Hex).mockImplementation(async (bytes) => bytesToHex(sha256(bytes)));
  jest.mocked(platform.fileSystem.openWriteHandle).mockImplementation(async (path) => {
    files.set(path, []);
    return { writeBytes: async (bytes) => { files.get(path)!.push(bytes.slice()); }, close: async () => {} };
  });
  jest.mocked(platform.fileSystem.uploadFile).mockImplementation(async (url, path, options) => {
    const bytes = new Uint8Array(files.get(path)!.flatMap((chunk) => Array.from(chunk)));
    const hash = bytesToHex(sha256(bytes));
    const auth = JSON.parse(new TextDecoder().decode(base64.decode(options.headers!.Authorization.slice(6))));
    expect(verifyEvent(auth)).toBe(true);
    expect(auth.kind).toBe(24242);
    expect(auth.tags).toContainEqual(['x', hash]);
    expect(auth.tags).toContainEqual(['size', String(bytes.length)]);
    expect(options.httpMethod).toBe('PUT');
    options.onProgress?.(bytes.length, bytes.length);
    return { status: 200, body: JSON.stringify({ url: `${url.replace(/\/upload$/, '')}/${hash}`, sha256: hash, size: bytes.length }) };
  });
});
function harness(allow = true) {
  const abort = new AbortController();
  const messages: Record<string, any>[] = [];
  let version = 0;
  const authorize = jest.fn(async (template, _metadata, _servers, signal: AbortSignal) => {
    const current = version;
    if (!allow) throw new Error('permission-denied');
    const check = () => { if (signal.aborted || current !== version) throw new Error('permission-denied'); };
    return { event: finalizeEvent(template, secret), check };
  });
  const uploads = new NappletUploads({ accountPubkey: 'accountA', signal: abort.signal, send: (m) => messages.push(m),
    version: () => version, authorize });
  const revoke = () => { version++; uploads.authorizationChanged(); };
  return { uploads, messages, authorize, abort, revoke };
}
function submit(value: ReturnType<typeof harness>, bytes: Uint8Array, request: object = {}) {
  const id = `request-${value.messages.length}`;
  value.uploads.transfer({ type: 'upload.transfer.start', id, seq: -1, size: bytes.length,
    request: { mimeType: 'application/octet-stream', filename: '../app-file.bin', ...request } });
  let seq = 0;
  for (let offset = 0; offset < bytes.length; offset += UPLOAD_CHUNK_BYTES)
    value.uploads.transfer({ type: 'upload.transfer.chunk', id, seq: seq++, data: base64.encode(bytes.subarray(offset, offset + UPLOAD_CHUNK_BYTES)) });
  value.uploads.transfer({ type: 'upload.transfer.end', id, seq });
  return value.messages.find((m) => m.type === 'upload.upload.result' && m.id === id)?.result.uploadId as string;
}
async function terminal(value: ReturnType<typeof harness>, id: string) {
  for (let i = 0; i < 200; i++) {
    const status = value.uploads.status(id);
    if (['complete', 'failed', 'cancelled'].includes(status.status)) return status;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  throw new Error('upload did not settle');
}

it('preserves chunked bytes, uses host servers, signs only after consent and returns verified metadata', async () => {
  const value = harness();
  const bytes = Uint8Array.from({ length: 150000 }, (_, i) => i % 251);
  try {
    const info = await value.uploads.info();
    expect(info.rails).toContainEqual({ rail: 'blossom', enabled: true });
    expect(info).not.toHaveProperty('maxBytes');
    const id = submit(value, bytes, { metadata: { server: 'https://attacker.example/' } });
    expect(value.uploads.status(id).status).toBe('pending');
    expect(platform.fileSystem.uploadFile).not.toHaveBeenCalled();
    const status = await terminal(value, id);
    expect(status).toMatchObject({ status: 'complete', ok: true, sha256: bytesToHex(sha256(bytes)), size: bytes.length, mimeType: 'application/octet-stream' });
    expect(status.nip94).toContainEqual(['x', status.sha256]);
    expect(platform.fileSystem.uploadFile).toHaveBeenCalledTimes(1);
    expect(jest.mocked(platform.fileSystem.uploadFile).mock.calls[0][0]).toBe('https://media.example/upload');
    expect(jest.mocked(platform.fileSystem.uploadFile).mock.calls[0][1]).not.toContain('app-file');
    expect(value.authorize).toHaveBeenCalledTimes(1);
    expect(platform.fileSystem.delete).toHaveBeenCalledWith(expect.stringContaining('/napplet-uploads/'), { idempotent: true });
    expect(JSON.stringify(value.messages)).not.toContain('"sig"');
  } finally { value.abort.abort(); value.uploads.close(); }
});

it('refuses a denied upload before staging or sending a file', async () => {
  const value = harness(false);
  try {
    const id = submit(value, new Uint8Array([1, 2, 3]));
    expect(await terminal(value, id)).toMatchObject({ ok: false, status: 'failed', error: 'permission-denied' });
    expect(platform.fileSystem.openWriteHandle).not.toHaveBeenCalled();
    expect(platform.fileSystem.uploadFile).not.toHaveBeenCalled();
  } finally { value.abort.abort(); value.uploads.close(); }
});

it('rejects invalid sizes or out-of-order transfers and keeps statuses endpoint-local', () => {
  const first = harness(); const second = harness();
  try {
    first.uploads.transfer({ type: 'upload.transfer.start', id: 'invalid', seq: -1, size: -1, request: {} });
    expect(first.messages.at(-1)).toMatchObject({ type: 'psst.upload.ack', error: 'invalid-upload-data' });
    first.uploads.transfer({ type: 'upload.transfer.start', id: 'ordered', seq: -1, size: 3, request: {} });
    first.uploads.transfer({ type: 'upload.transfer.chunk', id: 'ordered', seq: 1, data: 'AQID' });
    expect(first.messages.at(-1)?.error).toBe('invalid-transfer');
    expect(() => second.uploads.status('ordered')).toThrow('unknown-upload');
    expect(first.authorize).not.toHaveBeenCalled();
  } finally { first.abort.abort(); second.abort.abort(); first.uploads.close(); second.uploads.close(); }
});

it('accepts transfers beyond the former file and session byte limits', () => {
  const value = harness();
  try {
    for (let index = 0; index < 2; index++) {
      const id = `large-${index}`;
      value.uploads.transfer({ type: 'upload.transfer.start', id, seq: -1, size: 64 * 1024 * 1024, request: {} });
      expect(value.messages.at(-1)).toEqual({ type: 'psst.upload.ack', id, seq: -1 });
      // Discard this transfer without retaining a large test payload.
      value.uploads.transfer({ type: 'upload.transfer.chunk', id, seq: 1, data: 'AQID' });
    }
  } finally { value.abort.abort(); value.uploads.close(); }
});

it('cancels an active HTTP upload when its authorization is revoked', async () => {
  let sending: AbortSignal | undefined;
  jest.mocked(platform.fileSystem.uploadFile).mockImplementation((_url, _path, options) => new Promise((_resolve, reject) => {
    sending = options.signal;
    sending!.addEventListener('abort', () => reject(new Error('cancelled')), { once: true });
  }));
  const value = harness();
  try {
    const id = submit(value, new Uint8Array([1, 2, 3]));
    for (let i = 0; i < 100 && !sending; i++) await new Promise((resolve) => setTimeout(resolve, 1));
    expect(sending).toBeDefined();
    value.revoke();
    expect(await terminal(value, id)).toMatchObject({ status: 'cancelled', ok: false });
    expect(sending!.aborted).toBe(true);
  } finally { value.abort.abort(); value.uploads.close(); }
});

it('aborts HTTP, deletes staged bytes and suppresses late replies when the runtime closes', async () => {
  let sending: AbortSignal | undefined;
  jest.mocked(platform.fileSystem.uploadFile).mockImplementation((_url, _path, options) => new Promise((_resolve, reject) => {
    sending = options.signal;
    sending!.addEventListener('abort', () => reject(new Error('cancelled')), { once: true });
  }));
  const value = harness();
  submit(value, new Uint8Array([1, 2, 3]));
  try {
    for (let i = 0; i < 100 && !sending; i++) await new Promise((resolve) => setTimeout(resolve, 1));
    expect(sending).toBeDefined();
    const replies = value.messages.length;
    value.abort.abort(); value.uploads.close();
    for (let i = 0; i < 100 && !jest.mocked(platform.fileSystem.delete).mock.calls.length; i++) await new Promise((resolve) => setTimeout(resolve, 1));
    expect(sending!.aborted).toBe(true);
    expect(platform.fileSystem.delete).toHaveBeenCalledWith(expect.stringContaining('/napplet-uploads/'), { idempotent: true });
    expect(value.messages).toHaveLength(replies);
  } finally { value.abort.abort(); value.uploads.close(); }
});

it('rejects descriptors that do not identify the original bytes', async () => {
  jest.mocked(platform.fileSystem.uploadFile).mockResolvedValue({ status: 200,
    body: JSON.stringify({ url: `https://media.example/${'f'.repeat(64)}`, sha256: 'f'.repeat(64), size: 3 }) });
  const value = harness();
  try {
    expect(await terminal(value, submit(value, new Uint8Array([1, 2, 3])))).toMatchObject({ status: 'failed', ok: false });
    expect(platform.fileSystem.uploadFile).toHaveBeenCalledTimes(2);
  } finally { value.abort.abort(); value.uploads.close(); }
});
