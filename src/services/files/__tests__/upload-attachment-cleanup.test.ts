import { platform } from '@/platform';
import { uploadAttachment } from '../file-attachment.service';
import { readAttachmentMediaMetadata } from '../attachment-media-metadata';
import { uploadEncryptedBlob } from '../blossom.service';
import { encryptBytes } from '../file-crypto';
import { prepareAttachmentImage } from '../strip-metadata';

jest.mock('@/platform', () => ({ platform: { fileSystem: {
  cacheDirectoryUri: jest.fn(), stat: jest.fn(), makeDirectory: jest.fn(),
  readBytes: jest.fn(), writeBytes: jest.fn(), delete: jest.fn(),
} } }));
jest.mock('../attachment-media-metadata', () => ({ readAttachmentMediaMetadata: jest.fn() }));
jest.mock('../blossom.service', () => ({ uploadEncryptedBlob: jest.fn() }));
jest.mock('../file-crypto', () => ({ encryptBytes: jest.fn() }));
jest.mock('../strip-metadata', () => ({ prepareAttachmentImage: jest.fn() }));
jest.mock('../attachment-store', () => ({
  extFromName: () => undefined, sniffMime: () => 'video/mp4',
}));
jest.mock('../video-poster.service', () => ({}));
jest.mock('../attachment-index.service', () => ({}));
jest.mock('../media-server.service', () => ({}));
jest.mock('../nearby-file-upload.service', () => ({}));
jest.mock('../nearby-file-download.service', () => ({}));
jest.mock('../../proximity/proximity.service', () => ({}));
jest.mock('../../proximity/proximity-file-transfer.service', () => ({}));
jest.mock('../../proximity/proximity-file-offer', () => ({}));
jest.mock('../attachment-transfer-state', () => ({}));

const files = new Map<string, Uint8Array>();
const fs = platform.fileSystem;
let written: Promise<string>;
let notifyWritten: (uri: string) => void;
const cipher = new Uint8Array([1, 2, 3]);

beforeEach(() => {
  jest.resetAllMocks();
  files.clear();
  written = new Promise((resolve) => { notifyWritten = resolve; });
  (fs.cacheDirectoryUri as jest.Mock).mockResolvedValue('file:///cache/');
  (fs.stat as jest.Mock).mockResolvedValue({ exists: true });
  (fs.readBytes as jest.Mock).mockResolvedValue(new Uint8Array([4, 5, 6]));
  (fs.writeBytes as jest.Mock).mockImplementation(async (uri, bytes) => {
    files.set(uri, bytes);
    notifyWritten(uri);
  });
  (fs.delete as jest.Mock).mockImplementation(async (uri) => { files.delete(uri); });
  jest.mocked(prepareAttachmentImage).mockResolvedValue(null);
  jest.mocked(encryptBytes).mockResolvedValue({
    cipher, cipherSha256Hex: 'cipher-hash', plainSha256Hex: 'plain-hash', keyHex: 'key', nonceHex: 'nonce',
  });
});

it.each(['paused', 'cancelled'])('removes staged ciphertext when %s during preview generation', async () => {
  let finishPreview!: (metadata: { dim: string }) => void;
  jest.mocked(readAttachmentMediaMetadata).mockImplementation(() => new Promise((resolve) => {
    finishPreview = resolve;
  }));
  const controller = new AbortController();
  const dimensions = jest.fn();
  const upload = uploadAttachment({ signer: {} as never, localUri: 'file:///video.mp4', mime: 'video/mp4',
    signal: controller.signal, onMediaDimensions: dimensions });
  const uri = await written;
  expect(files.get(uri)).toBe(cipher);
  controller.abort();
  finishPreview({ dim: '2056x1576' });
  await expect(upload).rejects.toMatchObject({ name: 'AbortError' });
  expect(fs.delete).toHaveBeenCalledWith(uri, { idempotent: true });
  expect(files.size).toBe(0);
  expect(uploadEncryptedBlob).not.toHaveBeenCalled();
  expect(dimensions).not.toHaveBeenCalled();
});

it('also removes a partial ciphertext file if writing fails', async () => {
  (fs.writeBytes as jest.Mock).mockImplementation(async (uri, bytes) => {
    files.set(uri, bytes);
    throw new Error('Write failed');
  });
  await expect(uploadAttachment({ signer: {} as never, localUri: 'file:///video.mp4', mime: 'video/mp4' }))
    .rejects.toThrow('Write failed');
  expect(files.size).toBe(0);
  expect(uploadEncryptedBlob).not.toHaveBeenCalled();
});
