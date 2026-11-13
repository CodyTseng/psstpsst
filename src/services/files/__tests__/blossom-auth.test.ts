import { Buffer } from 'buffer';
import type { Event } from 'nostr-tools';

import { platform } from '@/platform';
import { uploadEncryptedBlob, uploadEncryptedBlobToServer, uploadPublicBlob } from '../blossom.service';
import type { Signer } from '../../signer/signer.interface';

jest.mock('@/platform', () => ({ platform: { fileSystem: { uploadFile: jest.fn() } } }));

const hash = 'a'.repeat(64);
const event: Event = {
  kind: 24242, pubkey: 'b'.repeat(64), id: 'c'.repeat(64), sig: 'd'.repeat(128),
  created_at: 1, content: 'Upload \uffff image',
  tags: [['t', 'upload'], ['x', hash], ['size', '12'], ['expiration', '301']],
};
const eventBytes = Buffer.from(JSON.stringify(event), 'utf8');
const modernHeader = `Nostr ${eventBytes.toString('base64url')}`;
const legacyHeader = `Nostr ${eventBytes.toString('base64')}`;
const signEvent = jest.fn().mockResolvedValue(event);
const signer = { signEvent } as unknown as Signer;
const uploadFile = jest.mocked(platform.fileSystem.uploadFile);
const success = { status: 200, body: JSON.stringify({ url: `https://files.example/${hash}`, sha256: hash, size: 12 }) };
const options = {
  signer, cipherFileUri: 'file:///encrypted.bin', cipherSha256Hex: hash,
  sizeBytes: 12, server: 'https://files.example',
};
const mirrorResponse = (status: number): Response => ({ status }) as Response;

beforeEach(() => {
  jest.clearAllMocks();
  uploadFile.mockReset();
  uploadFile.mockResolvedValue(success);
});

it('uses UTF-8 unpadded Base64URL for encrypted upload authorization', async () => {
  await uploadEncryptedBlobToServer(options);
  expect(uploadFile).toHaveBeenCalledTimes(1);
  expect(uploadFile.mock.calls[0][2]?.headers?.Authorization).toBe(modernHeader);
  expect(modernHeader).not.toMatch(/[+/=]/);
  expect(signEvent).toHaveBeenCalledTimes(1);
});

it.each([400, 401])('retries status %s once with standard Base64 without signing again', async status => {
  uploadFile.mockResolvedValueOnce({ status, body: 'Invalid token' });
  await uploadEncryptedBlobToServer(options);
  expect(modernHeader).not.toBe(legacyHeader);
  expect(uploadFile).toHaveBeenCalledTimes(2);
  expect(uploadFile.mock.calls.map(call => call[2]?.headers?.Authorization)).toEqual([modernHeader, legacyHeader]);
  expect(signEvent).toHaveBeenCalledTimes(1);
});

it('stops after the legacy encoding is also rejected', async () => {
  uploadFile.mockResolvedValue({ status: 401, body: 'Unauthorized' });
  await expect(uploadEncryptedBlobToServer(options)).rejects.toThrow('401');
  expect(uploadFile).toHaveBeenCalledTimes(2);
});

it.each([403, 413, 500])('does not retry encoding for status %s', async status => {
  uploadFile.mockResolvedValue({ status, body: 'Rejected' });
  await expect(uploadEncryptedBlobToServer(options)).rejects.toThrow(String(status));
  expect(uploadFile).toHaveBeenCalledTimes(1);
});

it('does not retry an upload after cancellation', async () => {
  const controller = new AbortController();
  uploadFile.mockImplementationOnce(async () => {
    controller.abort();
    return { status: 401, body: 'Invalid token' };
  });
  await expect(uploadEncryptedBlobToServer({ ...options, signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
  expect(uploadFile).toHaveBeenCalledTimes(1);
});

it('tries modern encoding again for the next server after an authentication failure', async () => {
  uploadFile.mockResolvedValueOnce({ status: 401, body: 'Rejected' });
  uploadFile.mockResolvedValueOnce({ status: 401, body: 'Rejected' });
  await uploadPublicBlob({
    fileUri: 'file:///public.bin', mime: 'image/png', sha256: hash, size: 12,
    servers: ['https://first.example', 'https://second.example'], authorization: event,
    signal: new AbortController().signal,
  });
  expect(uploadFile.mock.calls.map(call => call[2]?.headers?.Authorization)).toEqual([modernHeader, legacyHeader, modernHeader]);
  expect(uploadFile.mock.calls[2][0]).toBe('https://second.example/upload');
  expect(signEvent).not.toHaveBeenCalled();
});

it('uses the modern token for background mirrors even when the primary required legacy encoding', async () => {
  const originalFetch = global.fetch;
  const fetchMock = jest.fn().mockResolvedValue(mirrorResponse(200));
  global.fetch = fetchMock;
  try {
    uploadFile.mockResolvedValueOnce({ status: 400, body: 'Invalid token' });
    await uploadEncryptedBlob({ ...options, servers: ['https://files.example', 'https://mirror.example'] });
    expect(fetchMock).toHaveBeenCalledWith('https://mirror.example/mirror', expect.objectContaining({
      headers: expect.objectContaining({ Authorization: modernHeader }),
    }));
    expect(signEvent).toHaveBeenCalledTimes(1);
  } finally {
    global.fetch = originalFetch;
  }
});

describe('background mirror encoding compatibility', () => {
  let fetchMock: jest.SpyInstance;

  beforeEach(() => {
    fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(mirrorResponse(200));
  });

  afterEach(() => fetchMock.mockRestore());

  async function mirrorTo(servers: string[] = ['https://mirror.example']) {
    const result = await uploadEncryptedBlob({ ...options, servers: ['https://files.example', ...servers] });
    // Mirroring intentionally outlives the primary upload. Drain its promise
    // continuations before asserting the final number of requests.
    await new Promise<void>(resolve => setTimeout(resolve, 0));
    return result;
  }

  it.each([400, 401])('retries a mirror rejecting Base64URL with status %s using the same event', async status => {
    fetchMock.mockResolvedValueOnce(mirrorResponse(status));
    await mirrorTo();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [first, retry] = fetchMock.mock.calls;
    expect(first[0]).toBe('https://mirror.example/mirror');
    expect(first[1].headers.Authorization).toBe(modernHeader);
    expect(retry[0]).toBe(first[0]);
    expect(retry[1]).toEqual({
      ...first[1], signal: expect.anything(),
      headers: { ...first[1].headers, Authorization: legacyHeader },
    });
    expect(signEvent).toHaveBeenCalledTimes(1);
  });

  it('bounds retries when the legacy encoding is also rejected without failing the primary upload', async () => {
    fetchMock.mockResolvedValue(mirrorResponse(401));
    await expect(mirrorTo()).resolves.toMatchObject({ url: `https://files.example/${hash}` });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each([403, 413, 500])('does not retry a mirror rejecting the request with status %s', async status => {
    fetchMock.mockResolvedValue(mirrorResponse(status));
    await mirrorTo();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('keeps encoding fallback local to each mirror server', async () => {
    fetchMock.mockImplementation(async (url, init) => mirrorResponse(
      url === 'https://legacy.example/mirror' && init.headers.Authorization === modernHeader ? 401 : 200,
    ));
    await mirrorTo(['https://legacy.example', 'https://modern.example']);
    const headersFor = (url: string) => fetchMock.mock.calls
      .filter(call => call[0] === url).map(call => call[1].headers.Authorization);
    expect(headersFor('https://legacy.example/mirror')).toEqual([modernHeader, legacyHeader]);
    expect(headersFor('https://modern.example/mirror')).toEqual([modernHeader]);
    expect(signEvent).toHaveBeenCalledTimes(1);
  });
});
