import { clipboardAdapter } from '../clipboard';
import { imageManipulatorAdapter } from '../image-manipulator';
import { fileSystemAdapter } from '../file-system';
import { setImageAsync } from 'expo-clipboard';

jest.mock('../image-manipulator', () => ({ imageManipulatorAdapter: { renderAndSave: jest.fn() } }));
jest.mock('../file-system', () => ({ fileSystemAdapter: { delete: jest.fn() } }));
jest.mock('expo-clipboard', () => ({ setImageAsync: jest.fn() }));

beforeEach(() => {
  jest.resetAllMocks();
  jest.mocked(imageManipulatorAdapter.renderAndSave).mockResolvedValue({
    uri: 'cache-image', width: 2, height: 2, base64: 'png-bytes',
  });
  jest.mocked(fileSystemAdapter.delete).mockResolvedValue(undefined);
  jest.mocked(setImageAsync).mockResolvedValue(undefined);
});

it('offers image copying and rejects ordinary files without image work', async () => {
  expect(clipboardAdapter.canCopyAttachment('image/webp')).toBe(true);
  expect(clipboardAdapter.canCopyAttachment('application/pdf')).toBe(false);
  await expect(clipboardAdapter.copyAttachment('file', { mimeType: 'application/pdf' })).rejects.toThrow();
  expect(imageManipulatorAdapter.renderAndSave).not.toHaveBeenCalled();
});

it('converts attachment encodings before copying and removes the temporary image', async () => {
  await clipboardAdapter.copyAttachment('photo.webp', { mimeType: 'image/webp' });
  expect(imageManipulatorAdapter.renderAndSave).toHaveBeenCalledWith('photo.webp', {
    format: 'png', quality: 1, includeBase64: true,
  });
  expect(setImageAsync).toHaveBeenCalledWith('png-bytes');
  expect(fileSystemAdapter.delete).toHaveBeenCalledWith('cache-image', { idempotent: true });
});

it('reports clipboard errors and still cleans up', async () => {
  jest.mocked(setImageAsync).mockRejectedValue(new Error('Native clipboard unavailable'));
  await expect(clipboardAdapter.copyAttachment('photo', { mimeType: 'image/png' })).rejects.toThrow('Native clipboard unavailable');
  expect(fileSystemAdapter.delete).toHaveBeenCalled();
});
