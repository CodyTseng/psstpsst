import { Image } from 'expo-image';
import { createVideoPlayer } from 'expo-video';
import { ImageManipulator } from 'expo-image-manipulator';
import { fileSystemAdapter } from '../file-system';
import { videoThumbnailAdapter } from '../video-thumbnail';

jest.mock('expo-image', () => ({ Image: { generateThumbhashAsync: jest.fn() } }));
jest.mock('expo-video', () => ({ createVideoPlayer: jest.fn() }));
jest.mock('expo-image-manipulator', () => ({ ImageManipulator: { manipulate: jest.fn() }, SaveFormat: { JPEG: 'jpeg' } }));
jest.mock('../file-system', () => ({ fileSystemAdapter: { move: jest.fn(), delete: jest.fn() } }));

const thumbnail = { width: 1080, height: 1920, release: jest.fn() };
const player = {
  replaceAsync: jest.fn(),
  generateThumbnailsAsync: jest.fn(),
  release: jest.fn(),
};

beforeEach(() => {
  jest.resetAllMocks();
  (createVideoPlayer as jest.Mock).mockReturnValue(player);
  player.replaceAsync.mockResolvedValue(undefined);
  player.generateThumbnailsAsync.mockResolvedValue([thumbnail]);
  (Image.generateThumbhashAsync as jest.Mock).mockResolvedValue('poster');
});

it('uses the unscaled frame dimensions and releases native resources', async () => {
  await expect(videoThumbnailAdapter.generateMetadata('file:///portrait.mp4'))
    .resolves.toEqual({ width: 1080, height: 1920, thumbhash: 'poster' });
  expect(player.replaceAsync).toHaveBeenCalledWith('file:///portrait.mp4');
  expect(player.generateThumbnailsAsync).toHaveBeenCalledWith(0);
  expect(thumbnail.release).toHaveBeenCalledTimes(1);
  expect(player.release).toHaveBeenCalledTimes(1);
});

it('preserves dimensions when ThumbHash fails', async () => {
  (Image.generateThumbhashAsync as jest.Mock).mockRejectedValue(new Error('No ThumbHash'));
  await expect(videoThumbnailAdapter.generateMetadata('file:///clip.mp4'))
    .resolves.toEqual({ width: 1080, height: 1920, thumbhash: undefined });
  expect(thumbnail.release).toHaveBeenCalledTimes(1);
  expect(player.release).toHaveBeenCalledTimes(1);
});

it('skips ThumbHash generation when only dimensions are needed', async () => {
  await expect(videoThumbnailAdapter.generateMetadata('file:///clip.mp4', { includeThumbhash: false }))
    .resolves.toEqual({ width: 1080, height: 1920 });
  expect(Image.generateThumbhashAsync).not.toHaveBeenCalled();
  expect(thumbnail.release).toHaveBeenCalledTimes(1);
  expect(player.release).toHaveBeenCalledTimes(1);
});

it('releases the player when decoding fails', async () => {
  player.generateThumbnailsAsync.mockRejectedValue(new Error('Unsupported codec'));
  await expect(videoThumbnailAdapter.generateMetadata('file:///clip.mp4'))
    .resolves.toBeUndefined();
  expect(player.release).toHaveBeenCalledTimes(1);
});

it('saves a bounded poster while preserving the original video dimensions', async () => {
  const image = { saveAsync: jest.fn().mockResolvedValue({ uri: 'file:///temp.jpg' }), release: jest.fn() };
  const context = { resize: jest.fn(), renderAsync: jest.fn().mockResolvedValue(image), release: jest.fn() };
  (ImageManipulator.manipulate as jest.Mock).mockReturnValue(context);
  (fileSystemAdapter.move as jest.Mock).mockResolvedValue(undefined);
  (fileSystemAdapter.delete as jest.Mock).mockResolvedValue(undefined);
  await expect(videoThumbnailAdapter.generateMetadata('file:///clip.mp4', {
    includeThumbhash: false, posterUri: 'file:///poster.jpg',
  })).resolves.toEqual({ width: 1080, height: 1920, posterUri: 'file:///poster.jpg' });
  expect(context.resize).toHaveBeenCalledWith({ width: 288 });
  expect(image.release).toHaveBeenCalledTimes(1);
  expect(context.release).toHaveBeenCalledTimes(1);
  expect(thumbnail.release).toHaveBeenCalledTimes(1);
  expect(player.release).toHaveBeenCalledTimes(1);
});
