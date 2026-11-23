import { platform } from '@/platform';
import { fetchAndDecryptAttachment } from '../file-attachment.service';
import { downloadAttachmentBytes } from '../attachment-download.service';
import { decryptBytes, sha256Hex } from '../file-crypto';
import { markDownloaded } from '../attachment-index.service';
import { attachmentDownloadKey, attachmentTransferStore } from '../attachment-transfer-state';
import { loadSenderMediaServers } from '../media-server.service';
import { buildBlossomUri } from '@/lib/nostr/blossom-uri';
import { findFileMeta, type FileAttachmentMeta } from '@/lib/nostr/file-tags';

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
jest.mock('../media-server.service', () => ({ loadSenderMediaServers: jest.fn() }));
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
  jest.mocked(loadSenderMediaServers).mockResolvedValue([]);
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

const sender = '1'.repeat(64);
const account = '2'.repeat(64);

it('shares one failed download across senders and ignores late progress', async () => {
  const item = meta();
  const key = attachmentDownloadKey(account, item.url);
  let fail!: (error: Error) => void;
  let ready!: () => void;
  const started = new Promise<void>((resolve) => { ready = resolve; });
  jest.mocked(downloadAttachmentBytes).mockImplementationOnce(({ onProgress }) => {
    onProgress?.(1, 3);
    return new Promise((_resolve, reject) => {
      fail = reject;
      ready();
    });
  });

  const first = fetchAndDecryptAttachment(item, { accountPubkey: account, senderPubkey: sender });
  await started;
  const second = fetchAndDecryptAttachment(item, { accountPubkey: account, senderPubkey: '3'.repeat(64) });
  const firstFailure = expect(first).rejects.toMatchObject({ kind: 'download' });
  const secondFailure = expect(second).rejects.toMatchObject({ kind: 'download' });

  expect(attachmentTransferStore.getState().byKey[key]?.receivedBytes).toBe(1);
  fail(new Error('unavailable'));
  await Promise.all([firstFailure, secondFailure]);
  expect(downloadAttachmentBytes).toHaveBeenCalledTimes(1);
  expect(loadSenderMediaServers).toHaveBeenCalledTimes(1);
  expect(loadSenderMediaServers).toHaveBeenCalledWith(sender);
  expect(attachmentTransferStore.getState().byKey[key]).toBeUndefined();
  jest.mocked(downloadAttachmentBytes).mock.calls[0][0].onProgress?.(2, 3);
  expect(attachmentTransferStore.getState().byKey[key]).toBeUndefined();
});

it('does not query sender servers when the original URL supplies valid bytes', async () => {
  await expect(fetchAndDecryptAttachment(meta(), { accountPubkey: account, senderPubkey: sender })).resolves.toMatch(/^local\//);
  expect(loadSenderMediaServers).not.toHaveBeenCalled();
});

it('tries the sender’s mirrors in order on download failures', async () => {
  const item = { ...meta(), url: `https://primary.example/${'a'.repeat(64)}.bin` };
  jest.mocked(loadSenderMediaServers).mockResolvedValueOnce([
    'https://primary.example/', 'https://first-mirror.example/', 'http://localhost:3000/cdn/',
  ]);
  jest.mocked(downloadAttachmentBytes)
    .mockRejectedValueOnce(new Error('404'))
    .mockRejectedValueOnce(new Error('network timeout'));
  await expect(fetchAndDecryptAttachment(item, { accountPubkey: account, senderPubkey: sender })).resolves.toMatch(/^local\//);
  expect(loadSenderMediaServers).toHaveBeenCalledTimes(1);
  expect(loadSenderMediaServers).toHaveBeenCalledWith(sender);
  expect(jest.mocked(downloadAttachmentBytes).mock.calls.map(([opts]) => opts.url)).toEqual([
    item.url,
    `https://first-mirror.example/${'a'.repeat(64)}.bin`,
    `http://localhost:3000/cdn/${'a'.repeat(64)}.bin`,
  ]);
  expect(decryptBytes).toHaveBeenCalledTimes(1);
  expect(markDownloaded).toHaveBeenCalledTimes(1);
});

const candidateServers = ['https://first.example', 'https://second.example'];
const failures = [
  ['bad ciphertext hash', 'integrity', 'ciphertext hash mismatch'],
  ['bad key', 'download', 'decryption failed'],
  ['bad plaintext hash', 'integrity', 'plaintext hash mismatch'],
] as const;

describe.each(['original HTTPS URL', 'discovered mirror', 'Blossom URI'] as const)('%s', (source) => {
  it.each(failures)('does not switch servers after %s', async (failure, kind, message) => {
    const item = meta();
    if (source === 'Blossom URI') item.url = buildBlossomUri(item.cipherSha256Hex, candidateServers);
    if (source === 'discovered mirror') {
      jest.mocked(downloadAttachmentBytes).mockRejectedValueOnce(new Error('404'));
    }
    jest.mocked(loadSenderMediaServers).mockResolvedValue(candidateServers);
    if (failure === 'bad key') {
      jest.mocked(decryptBytes).mockRejectedValueOnce(new Error('decryption failed'));
    } else if (failure === 'bad ciphertext hash') {
      jest.mocked(sha256Hex).mockResolvedValueOnce('f'.repeat(64));
    } else {
      jest.mocked(sha256Hex)
        .mockResolvedValueOnce(item.cipherSha256Hex)
        .mockResolvedValueOnce('f'.repeat(64));
    }

    await expect(fetchAndDecryptAttachment(item, { accountPubkey: account, senderPubkey: sender }))
      .rejects.toMatchObject({ kind, message });
    expect(downloadAttachmentBytes).toHaveBeenCalledTimes(source === 'discovered mirror' ? 2 : 1);
    expect(loadSenderMediaServers).toHaveBeenCalledTimes(source === 'discovered mirror' ? 1 : 0);
    expect(discard).toHaveBeenCalledTimes(1);
    expect(markDownloaded).not.toHaveBeenCalled();
    expect(platform.fileSystem.writeBytes).not.toHaveBeenCalled();
  });
});

it('tries the next hinted Blossom server if the download itself fails', async () => {
  const item = meta();
  item.url = buildBlossomUri(item.cipherSha256Hex, candidateServers);
  jest.mocked(downloadAttachmentBytes).mockRejectedValueOnce(new Error('404'));
  await expect(fetchAndDecryptAttachment(item, { accountPubkey: account, senderPubkey: sender }))
    .resolves.toMatch(/^local\//);
  expect(jest.mocked(downloadAttachmentBytes).mock.calls.map(([opts]) => opts.url)).toEqual(
    candidateServers.map((server) => `${server}/${item.cipherSha256Hex}.bin`),
  );
  expect(loadSenderMediaServers).not.toHaveBeenCalled();
  expect(decryptBytes).toHaveBeenCalledTimes(1);
});

it('does not fall back to the downloading account’s servers when no sender was supplied', async () => {
  const item = meta();
  jest.mocked(downloadAttachmentBytes).mockRejectedValueOnce(new Error('primary unavailable'));
  await expect(fetchAndDecryptAttachment(item, { accountPubkey: account })).rejects.toMatchObject({kind: 'download'});
  expect(downloadAttachmentBytes).toHaveBeenCalledTimes(1);
  expect(loadSenderMediaServers).not.toHaveBeenCalled();
});

it('does not use an arbitrary URL query token as a mirror lookup hash', async () => {
  const item = findFileMeta(`https://primary.example/opaque?token=${'a'.repeat(64)}`, [
    ['decryption-key', 'key'], ['decryption-nonce', 'nonce'],
  ])!;
  jest.mocked(downloadAttachmentBytes).mockRejectedValueOnce(new Error('primary unavailable'));
  jest.mocked(loadSenderMediaServers).mockResolvedValueOnce(['https://mirror.example/']);
  await expect(fetchAndDecryptAttachment(item, { accountPubkey: account, senderPubkey: sender }))
    .rejects.toMatchObject({ kind: 'download' });
  expect(loadSenderMediaServers).not.toHaveBeenCalled();
  expect(downloadAttachmentBytes).toHaveBeenCalledTimes(1);
});

it('uses a hash-named path without an x tag on a local HTTP primary', async () => {
  const hash = 'a'.repeat(64);
  const item = findFileMeta(`http://localhost:3000/${hash}.bin?download=1`, [
    ['decryption-key', 'key'], ['decryption-nonce', 'nonce'],
  ])!;
  jest.mocked(downloadAttachmentBytes).mockRejectedValueOnce(new Error('primary unavailable'));
  jest.mocked(loadSenderMediaServers).mockResolvedValueOnce(['https://mirror.example/']);
  await expect(fetchAndDecryptAttachment(item, { accountPubkey: account, senderPubkey: sender }))
    .resolves.toMatch(/^local\//);
  expect(jest.mocked(downloadAttachmentBytes).mock.calls.map(([opts]) => opts.url)).toEqual([
    item.url, `https://mirror.example/${hash}.bin`,
  ]);
});
