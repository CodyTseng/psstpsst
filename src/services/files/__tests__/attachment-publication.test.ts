import { platform } from '@/platform';
import { fetchAndDecryptAttachment } from '../file-attachment.service';
import { downloadAttachmentBytes } from '../attachment-download.service';
import { decryptBytes, sha256Hex } from '../file-crypto';
import { markDownloaded } from '../attachment-index.service';
import type { FileAttachmentMeta } from '@/lib/nostr/file-tags';

jest.mock('@/platform', () => ({ platform: { fileSystem: {
  stat: jest.fn(), writeBytes: jest.fn(),
} } }));
jest.mock('../attachment-download.service', () => ({ downloadAttachmentBytes: jest.fn() }));
jest.mock('../file-crypto', () => ({ decryptBytes: jest.fn(), sha256Hex: jest.fn() }));
jest.mock('../blossom.service', () => ({ getHashFromURL: () => null }));
jest.mock('../attachment-store', () => ({
  ensureAttachmentDir: async () => {}, attachmentName: (hash: string) => hash,
  attachmentPath: async (name: string) => `local/${name}`, sniffMime: () => 'image/png',
}));
jest.mock('../attachment-index.service', () => ({ resolveDownloaded: jest.fn(async () => null), markDownloaded: jest.fn() }));
jest.mock('../attachment-media-metadata', () => ({}));
jest.mock('../strip-metadata', () => ({}));
jest.mock('../video-poster.service', () => ({}));
jest.mock('../media-server.service', () => ({}));
jest.mock('../nearby-file-upload.service', () => ({}));
jest.mock('../nearby-file-download.service', () => ({}));
jest.mock('../../proximity/proximity.service', () => ({}));
jest.mock('../../proximity/proximity-file-transfer.service', () => ({}));
jest.mock('../../proximity/proximity-file-offer', () => ({ parseNearbyFileOffer: () => null }));

const discard = jest.fn(async () => {});
const cipher = Uint8Array.of(1, 2, 3);
const plain = Uint8Array.of(4, 5, 6);
let serial = 0;
function meta(): FileAttachmentMeta {
  return { url: `https://media.example/${++serial}`, cipherSha256Hex: 'a'.repeat(64),
    plainSha256Hex: 'b'.repeat(64), decryptionKeyHex: 'key', decryptionNonceHex: 'nonce' };
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(downloadAttachmentBytes).mockResolvedValue({ bytes: cipher, discard });
  jest.mocked(sha256Hex).mockImplementation(async (bytes) => bytes === cipher ? 'a'.repeat(64) : 'b'.repeat(64));
  jest.mocked(decryptBytes).mockResolvedValue(plain);
  jest.mocked(platform.fileSystem.stat).mockResolvedValue({ exists: false } as never);
  jest.mocked(platform.fileSystem.writeBytes).mockResolvedValue(undefined);
  jest.mocked(markDownloaded).mockResolvedValue(undefined);
});

it.each(['verification', 'decryption'] as const)('retains completed ciphertext when paused during %s', async (stage) => {
  let finish!: () => void;
  let entered!: () => void;
  const started = new Promise<void>((resolve) => { entered = resolve; });
  if (stage === 'verification') {
    jest.mocked(sha256Hex).mockImplementationOnce(() => new Promise((resolve) => {
      finish = () => resolve('a'.repeat(64)); entered();
    }));
  } else {
    jest.mocked(decryptBytes).mockImplementationOnce(() => new Promise((resolve) => {
      finish = () => resolve(plain); entered();
    }));
  }
  const item = meta();
  const controller = new AbortController();
  const download = fetchAndDecryptAttachment(item, { accountPubkey: 'account', signal: controller.signal });
  await started;
  controller.abort(); finish();
  await expect(download).rejects.toMatchObject({ name: 'AbortError' });
  expect(discard).not.toHaveBeenCalled();
  expect(markDownloaded).not.toHaveBeenCalled();
  await expect(fetchAndDecryptAttachment(item, { accountPubkey: 'account' })).resolves.toMatch(/^local\//);
  expect(discard).toHaveBeenCalledTimes(1);
});

it('discards ciphertext only after plaintext publication succeeds', async () => {
  let finish!: () => void;
  let entered!: () => void;
  const publishing = new Promise<void>((resolve) => { entered = resolve; });
  jest.mocked(markDownloaded).mockImplementationOnce(() => new Promise((resolve) => {
    finish = resolve; entered();
  }));
  const download = fetchAndDecryptAttachment(meta());
  await publishing;
  expect(platform.fileSystem.writeBytes).toHaveBeenCalled();
  expect(discard).not.toHaveBeenCalled();
  finish(); await download;
  expect(discard).toHaveBeenCalledTimes(1);
});

it.each(['ciphertext', 'plaintext'] as const)('discards ciphertext on a %s integrity failure', async (stage) => {
  jest.mocked(sha256Hex).mockImplementation(async (bytes) =>
    stage === 'ciphertext' || bytes === plain ? 'c'.repeat(64) : 'a'.repeat(64));
  await expect(fetchAndDecryptAttachment(meta())).rejects.toMatchObject({ kind: 'integrity' });
  expect(discard).toHaveBeenCalledTimes(1);
  expect(markDownloaded).not.toHaveBeenCalled();
});

it('keeps ciphertext available if plaintext publication fails', async () => {
  jest.mocked(markDownloaded).mockRejectedValueOnce(new Error('Database unavailable'));
  await expect(fetchAndDecryptAttachment(meta())).rejects.toThrow('Database unavailable');
  expect(discard).not.toHaveBeenCalled();
});
