import { platform } from '@/platform';
import { uploadEncryptedBlob, uploadPublicImage } from '../blossom.service';
import type { Signer } from '../../signer/signer.interface';

jest.mock('@/platform', () => ({ platform: {
  confirmationDialog: { confirm: jest.fn() },
  fileSystem: { uploadFile: jest.fn(), readBase64: jest.fn(async () => 'AQID') },
} }));

const hash = 'a'.repeat(64);
const signer = { signEvent: jest.fn(async () => ({ tags: [] })) } as unknown as Signer;
const upload = jest.mocked(platform.fileSystem.uploadFile);
const fallback = 'https://blossom.jumble.social/upload';
const success = { status: 200, body: JSON.stringify({ url: `https://files.example/${hash}`, sha256: hash, size: 3 }) };
const servers = ['https://first.example', 'https://second.example'];
const options = { signer, cipherFileUri: 'file:///cipher.bin', cipherSha256Hex: hash, sizeBytes: 3, servers };
let fetchMock: jest.SpyInstance;

beforeEach(() => {
  jest.clearAllMocks();
  upload.mockReset();
  upload.mockResolvedValue({ status: 503, body: 'Unavailable', headers: { 'X-Reason': 'Storage is full' } });
  fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({ status: 200 } as Response);
});
afterEach(() => fetchMock.mockRestore());

it('automatically tries Jumble after all configured servers fail without asking or mirroring to failed servers', async () => {
  upload.mockImplementation(async url => url === fallback ? success : { status: 503, body: 'Unavailable' });
  await expect(uploadEncryptedBlob(options)).resolves.toMatchObject({ server: 'https://blossom.jumble.social' });
  expect(upload.mock.calls.map(([url]) => url)).toEqual([...servers.map(server => `${server}/upload`), fallback]);
  expect(platform.confirmationDialog.confirm).not.toHaveBeenCalled();
  expect(fetchMock).not.toHaveBeenCalled();
  expect(servers).toEqual(['https://first.example', 'https://second.example']);
});

it('does not upload or mirror to Jumble when a configured server accepts the upload', async () => {
  upload.mockResolvedValueOnce(success);
  await uploadEncryptedBlob(options);
  expect(upload).toHaveBeenCalledTimes(1);
  expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(['https://second.example/mirror']);
});

it('does not retry an already configured Jumble server as an additional fallback', async () => {
  await expect(uploadEncryptedBlob({ ...options, servers: ['https://BLOSSOM.JUMBLE.SOCIAL/'] })).rejects.toThrow('503');
  expect(upload).toHaveBeenCalledTimes(1);
});

it('stops before fallback when the upload is cancelled', async () => {
  const controller = new AbortController();
  upload.mockImplementationOnce(async () => { controller.abort(); return { status: 503, body: '' }; });
  await expect(uploadEncryptedBlob({ ...options, signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
  expect(upload).toHaveBeenCalledTimes(1);
});

it('reports server reasons after both configured servers and the fallback fail', async () => {
  await expect(uploadEncryptedBlob(options)).rejects.toThrow('Storage is full');
  expect(upload).toHaveBeenCalledTimes(3);
  expect(upload.mock.calls.at(-1)?.[0]).toBe(fallback);
  expect(platform.confirmationDialog.confirm).not.toHaveBeenCalled();
});

it('automatically falls back for public images too', async () => {
  upload.mockImplementation(async url => url === fallback ? success : { status: 503, body: '' });
  await expect(uploadPublicImage({ signer, servers, fileUri: 'file:///public.png', metadataStripped: true }))
    .resolves.toMatchObject({ server: 'https://blossom.jumble.social' });
  expect(upload.mock.calls.at(-1)?.[0]).toBe(fallback);
  expect(platform.confirmationDialog.confirm).not.toHaveBeenCalled();
});
