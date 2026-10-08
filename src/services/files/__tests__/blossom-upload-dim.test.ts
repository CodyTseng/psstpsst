import { platform } from '@/platform';
import { uploadEncryptedBlobToServer } from '../blossom.service';
import type { Signer } from '../../signer/signer.interface';

jest.mock('@/platform', () => ({ platform: { fileSystem: { uploadFile: jest.fn() } } }));

const hash = 'a'.repeat(64);
const signer = { signEvent: jest.fn().mockResolvedValue({ tags: [] }) } as unknown as Signer;
const uploadFile = platform.fileSystem.uploadFile as jest.Mock;

it.each([
  [{ dim: '1920x1080' }, '1920x1080'],
  [{ nip94: [['dim', '1080x1920']] }, '1080x1920'],
  [{ dim: '0x1080', nip94: [['dim', '640x480']] }, '640x480'],
  [{ dim: 'invalid', nip94: [['dim', '0x720']] }, undefined],
  [{ nip94: [null, 1, ['dim', 123], ['dim', '1280x720']] }, '1280x720'],
  [{}, undefined],
])('preserves only valid descriptor dimensions (%j)', async (fields, expected) => {
  uploadFile.mockResolvedValue({
    status: 200,
    body: JSON.stringify({ url: `https://files.example/${hash}`, sha256: hash, size: 12, ...fields }),
  });
  const result = await uploadEncryptedBlobToServer({
    signer,
    cipherFileUri: 'file:///encrypted.bin',
    cipherSha256Hex: hash,
    sizeBytes: 12,
    server: 'https://files.example',
  });
  expect(result.dim).toBe(expected);
});

it.each([
  [{ thumbhash: 'server-preview' }, 'server-preview'],
  [{ nip94: [['thumbhash', 'tagged-preview']] }, 'tagged-preview'],
  [{ thumbhash: '', nip94: [['thumbhash', 'tagged-preview']] }, 'tagged-preview'],
  [{ thumbhash: 123, nip94: [['thumbhash', '']] }, undefined],
])('preserves descriptor placeholders independently of dimensions (%j)', async (fields, expected) => {
  uploadFile.mockResolvedValue({
    status: 200,
    body: JSON.stringify({ url: `https://files.example/${hash}`, sha256: hash, size: 12, ...fields }),
  });
  const result = await uploadEncryptedBlobToServer({
    signer,
    cipherFileUri: 'file:///encrypted.bin',
    cipherSha256Hex: hash,
    sizeBytes: 12,
    server: 'https://files.example',
  });
  expect(result.thumbhash).toBe(expected);
  expect(result.dim).toBeUndefined();
});
