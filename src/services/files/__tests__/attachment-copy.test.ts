import { platform } from '@/platform';
import { copyAttachment, copyLocalAttachment, copyImageUri } from '../attachment-copy.service';
import { fetchAndDecryptAttachment, getCachedAttachmentUri } from '../file-attachment.service';
import type { FileAttachmentMeta } from '@/lib/nostr/file-tags';

jest.mock('@/platform', () => ({ platform: { clipboard: {
  canCopyAttachment: jest.fn(), copyAttachment: jest.fn(),
}, imageCache: { getCachedUri: jest.fn(), download: jest.fn() },
imageManipulator: { renderAndSave: jest.fn() }, fileSystem: { delete: jest.fn() } } }));
jest.mock('../file-attachment.service', () => ({
  getCachedAttachmentUri: jest.fn(), fetchAndDecryptAttachment: jest.fn(),
}));
const meta = { url: 'https://media.example/file', mime: 'image/png', name: 'photo.png' } as FileAttachmentMeta;

beforeEach(() => {
  jest.resetAllMocks();
  jest.mocked(platform.clipboard.canCopyAttachment).mockReturnValue(true);
  jest.mocked(platform.clipboard.copyAttachment).mockResolvedValue(undefined);
});

it('copies cached content without downloading it', async () => {
  jest.mocked(getCachedAttachmentUri).mockResolvedValue('local-photo');
  await copyAttachment(meta);
  expect(fetchAndDecryptAttachment).not.toHaveBeenCalled();
  expect(platform.clipboard.copyAttachment).toHaveBeenCalledWith('local-photo', {
    mimeType: 'image/png', name: 'photo.png',
  });
});

it('resolves uncached content using the authorized account and integrity checks', async () => {
  jest.mocked(getCachedAttachmentUri).mockResolvedValue(null);
  jest.mocked(fetchAndDecryptAttachment).mockResolvedValue('verified-photo');
  await copyAttachment(meta, { accountPubkey: 'owner' });
  expect(fetchAndDecryptAttachment).toHaveBeenCalledWith(meta, { accountPubkey: 'owner' });
  expect(platform.clipboard.copyAttachment).toHaveBeenCalledWith('verified-photo', expect.anything());
});

it('does not copy content that fails integrity verification', async () => {
  jest.mocked(getCachedAttachmentUri).mockResolvedValue(null);
  jest.mocked(fetchAndDecryptAttachment).mockRejectedValue(new Error('Integrity mismatch'));
  await expect(copyAttachment(meta)).rejects.toThrow('Integrity mismatch');
  expect(platform.clipboard.copyAttachment).not.toHaveBeenCalled();
});

it('never downloads unsupported content', async () => {
  jest.mocked(platform.clipboard.canCopyAttachment).mockReturnValue(false);
  await expect(copyAttachment(meta)).rejects.toThrow('Clipboard unavailable');
  expect(getCachedAttachmentUri).not.toHaveBeenCalled();
  expect(fetchAndDecryptAttachment).not.toHaveBeenCalled();
});

it('propagates clipboard failures for pending attachments', async () => {
  jest.mocked(platform.clipboard.copyAttachment).mockRejectedValue(new Error('Clipboard busy'));
  await expect(copyLocalAttachment({ uri: 'pending-file' })).rejects.toThrow('Clipboard busy');
});

it('copies a cached remote image without another download', async () => {
  jest.mocked(platform.imageCache.getCachedUri).mockResolvedValue('psstpsst-file://cache/photo');
  await copyImageUri('https://media.example/photo');
  expect(platform.imageCache.download).not.toHaveBeenCalled();
  expect(platform.clipboard.copyAttachment).toHaveBeenCalledWith('psstpsst-file://cache/photo', expect.anything());
});

it('downloads remote images through the platform cache after explicit copy', async () => {
  jest.mocked(platform.imageCache.getCachedUri).mockResolvedValue(null);
  jest.mocked(platform.imageCache.download).mockResolvedValue('psstpsst-file://cache/photo');
  await copyImageUri('https://media.example/photo');
  expect(platform.imageCache.download).toHaveBeenCalledWith('https://media.example/photo');
});

it('stages bundled images and cleans up even when copying fails', async () => {
  jest.mocked(platform.imageManipulator.renderAndSave).mockResolvedValue({ uri: 'staged', width: 1, height: 1 });
  jest.mocked(platform.fileSystem.delete).mockResolvedValue(undefined);
  jest.mocked(platform.clipboard.copyAttachment).mockRejectedValue(new Error('Clipboard busy'));
  await expect(copyImageUri('/assets/photo.png')).rejects.toThrow('Clipboard busy');
  expect(platform.fileSystem.delete).toHaveBeenCalledWith('staged', { idempotent: true });
});
