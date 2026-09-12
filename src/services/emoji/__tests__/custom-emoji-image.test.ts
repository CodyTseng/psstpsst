import { platform } from '@/platform';
import { uploadPublicImage } from '@/services/files/blossom.service';

import { uploadCustomEmojiImage } from '../custom-emoji-image.service';

jest.mock('@/platform', () => ({
  platform: {
    fileSystem: {
      cacheDirectoryUri: jest.fn(),
      copy: jest.fn(),
      delete: jest.fn(),
    },
    deviceCrypto: { randomUUID: jest.fn() },
  },
}));
jest.mock('@/services/account/account.service', () => ({
  buildSigner: jest.fn().mockResolvedValue({}),
}));
jest.mock('@/services/files/media-server.service', () => ({
  loadAccountMediaServers: jest.fn().mockResolvedValue(['https://media.example']),
}));
jest.mock('@/services/files/blossom.service', () => ({
  uploadPublicImage: jest.fn(),
}));

const fs = jest.mocked(platform.fileSystem);
const upload = jest.mocked(uploadPublicImage);
const stagedUri = 'psstpsst-file://cache/custom-emoji-test-id';
const options = {
  accountPubkey: 'account',
  shortcode: 'test',
  mime: 'image/png',
  metadataStripped: true,
  preserveSourceBytes: false,
};

describe('custom emoji image upload', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    fs.cacheDirectoryUri.mockResolvedValue('psstpsst-file://cache/');
    fs.copy.mockResolvedValue(undefined);
    fs.delete.mockResolvedValue(undefined);
    jest.mocked(platform.deviceCrypto.randomUUID).mockResolvedValue('test-id');
    upload.mockResolvedValue({
      url: 'https://media.example/sticker.png',
      sha256: 'hash',
      size: 100,
      server: 'https://media.example',
    });
  });

  it.each(['data:image/png;base64,AAAA', 'blob:http://localhost/image'])(
    'stages %s before uploading and deletes only the staged file',
    async (fileUri) => {
      upload.mockImplementationOnce(async (input) => {
        expect(fs.copy).toHaveBeenCalledWith(fileUri, stagedUri);
        expect(fs.delete).not.toHaveBeenCalled();
        expect(input.fileUri).toBe(stagedUri);
        return { url: 'https://media.example/sticker.png', sha256: 'hash', size: 100, server: 'https://media.example' };
      });
      await expect(uploadCustomEmojiImage({ ...options, fileUri })).resolves.toEqual({
        shortcode: 'test',
        url: 'https://media.example/sticker.png',
      });
      expect(fs.delete).toHaveBeenCalledWith(stagedUri, { idempotent: true });
    },
  );

  it('preserves animated GIF bytes and upload options', async () => {
    await uploadCustomEmojiImage({
      ...options,
      fileUri: 'blob:http://localhost/animated',
      mime: 'image/gif',
      metadataStripped: false,
      preserveSourceBytes: true,
    });
    expect(upload).toHaveBeenCalledWith(expect.objectContaining({
      fileUri: stagedUri,
      mime: 'image/gif',
      metadataStripped: false,
      preserveSourceBytes: true,
    }));
  });

  it.each(['copy', 'upload'] as const)('cleans up on %s failure without hiding the error', async (step) => {
    const error = new Error(`${step} failed`);
    if (step === 'copy') fs.copy.mockRejectedValueOnce(error);
    else upload.mockRejectedValueOnce(error);
    await expect(uploadCustomEmojiImage({ ...options, fileUri: 'data:image/png;base64,AAAA' })).rejects.toBe(error);
    expect(fs.delete).toHaveBeenCalledWith(stagedUri, { idempotent: true });
    if (step === 'copy') expect(upload).not.toHaveBeenCalled();
  });

  it.each([
    ['psstpsst-file://cache/existing.png', 'psstpsst-file://cache/existing.png'],
    ['/tmp/native.png', 'file:///tmp/native.png'],
    ['file:///tmp/native.png', 'file:///tmp/native.png'],
  ])('keeps existing file %s under its original owner', async (fileUri, expectedUri) => {
    await uploadCustomEmojiImage({ ...options, fileUri });
    expect(upload).toHaveBeenCalledWith(expect.objectContaining({ fileUri: expectedUri }));
    expect(fs.copy).not.toHaveBeenCalled();
    expect(fs.delete).not.toHaveBeenCalled();
  });
});
