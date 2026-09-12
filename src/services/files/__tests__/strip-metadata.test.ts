import { platform } from '@/platform';

import { prepareAttachmentImage } from '../strip-metadata';

jest.mock('@/platform', () => ({
  platform: {
    imageManipulator: { renderAndSave: jest.fn() },
    fileSystem: { stat: jest.fn(), delete: jest.fn().mockResolvedValue(undefined) },
  },
}));

const renderAndSave = platform.imageManipulator.renderAndSave as jest.Mock;
const stat = platform.fileSystem.stat as jest.Mock;
const remove = platform.fileSystem.delete as jest.Mock;

describe('attachment image preparation', () => {
  beforeEach(() => jest.clearAllMocks());

  it('keeps original dimensions and maximum encoder quality when requested', async () => {
    renderAndSave.mockResolvedValue({ uri: 'file:///original.jpg', width: 3000, height: 2000 });

    await expect(
      prepareAttachmentImage('file:///source.jpg', 'image/jpeg', 'original', {
        width: 3000,
        height: 2000,
      }),
    ).resolves.toEqual({ uri: 'file:///original.jpg', width: 3000, height: 2000 });
    expect(renderAndSave).toHaveBeenCalledWith('file:///source.jpg', {
      format: 'jpeg',
      quality: 1,
    });
  });

  it('uses an off-thread WebP candidate capped at 1600px and 512 KiB', async () => {
    renderAndSave
      .mockResolvedValueOnce({ uri: 'file:///sanitized.jpg', width: 3000, height: 2000 })
      .mockResolvedValueOnce({ uri: 'file:///optimized.webp', width: 1600, height: 1067 });
    stat
      .mockResolvedValueOnce({ exists: true, size: 3_000_000 })
      .mockResolvedValueOnce({ exists: true, size: 400_000 });

    await expect(
      prepareAttachmentImage('file:///source.jpg', 'image/jpeg', 'optimized', {
        width: 3000,
        height: 2000,
      }),
    ).resolves.toEqual({ uri: 'file:///optimized.webp', width: 1600, height: 1067, size: 400_000 });
    expect(renderAndSave).toHaveBeenLastCalledWith('file:///source.jpg', {
      resize: { width: 1600 },
      format: 'webp',
      quality: 0.82,
    });
    expect(remove).toHaveBeenCalledWith('file:///sanitized.jpg', { idempotent: true });
  });

  it('does not flatten animated GIF images', async () => {
    await expect(
      prepareAttachmentImage('file:///animated.gif', 'image/gif', 'optimized'),
    ).resolves.toBeNull();
    expect(renderAndSave).not.toHaveBeenCalled();
  });
});
