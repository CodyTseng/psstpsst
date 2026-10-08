import { platform } from '@/platform';
import { computeThumbhash } from '@/lib/image/thumbhash';
import { getVideoMetadata } from '../video-poster.service';
import { readAttachmentMediaMetadata } from '../attachment-media-metadata';

jest.mock('@/platform', () => ({
  platform: {
    imageManipulator: { getDimensions: jest.fn() },
    videoThumbnail: { generateMetadata: jest.fn() },
  },
}));
jest.mock('../video-poster.service', () => ({ getVideoMetadata: jest.fn() }));
jest.mock('@/lib/image/thumbhash', () => ({ computeThumbhash: jest.fn() }));

const getDimensions = platform.imageManipulator.getDimensions as jest.Mock;
const generateMetadata = getVideoMetadata as jest.Mock;
const thumbhash = computeThumbhash as jest.Mock;

beforeEach(() => {
  jest.resetAllMocks();
  thumbhash.mockResolvedValue('image-preview');
});

it('reads video dimensions and its placeholder with one decode', async () => {
  generateMetadata.mockResolvedValue({ width: 1080, height: 1920, thumbhash: 'poster' });
  await expect(readAttachmentMediaMetadata('file:///clip.mp4', 'video/mp4'))
    .resolves.toEqual({ dim: '1080x1920', thumbhash: 'poster' });
  expect(generateMetadata).toHaveBeenCalledTimes(1);
  expect(generateMetadata).toHaveBeenCalledWith('file:///clip.mp4');
  expect(getDimensions).not.toHaveBeenCalled();
});

it.each(['image/jpeg', 'video/mp4'])(
  'uses complete server metadata for %s without reading local media', async (mime) => {
    await expect(readAttachmentMediaMetadata('file:///source', mime,
      { width: 1600, height: 900 }, '1920x1080', 'server-preview'))
      .resolves.toEqual({ dim: '1920x1080', thumbhash: 'server-preview' });
    expect(getDimensions).not.toHaveBeenCalled();
    expect(generateMetadata).not.toHaveBeenCalled();
    expect(thumbhash).not.toHaveBeenCalled();
  },
);

it('generates the missing image placeholder without rereading server dimensions', async () => {
  await expect(readAttachmentMediaMetadata('file:///image', 'image/jpeg', undefined, '640x480'))
    .resolves.toEqual({ dim: '640x480', thumbhash: 'image-preview' });
  expect(getDimensions).not.toHaveBeenCalled();
  expect(thumbhash).toHaveBeenCalledWith('file:///image', 640, 480);
});

it('keeps server video dimensions while generating the missing placeholder', async () => {
  generateMetadata.mockResolvedValue({ width: 1920, height: 1080, thumbhash: 'local-poster' });
  await expect(readAttachmentMediaMetadata('file:///clip', 'video/mp4', undefined, '640x480'))
    .resolves.toEqual({ dim: '640x480', thumbhash: 'local-poster' });
  expect(generateMetadata).toHaveBeenCalledTimes(1);
});

it('reads missing image dimensions without regenerating the server placeholder', async () => {
  getDimensions.mockResolvedValue({ width: 320, height: 640 });
  await expect(readAttachmentMediaMetadata('file:///image', 'image/png', undefined,
    undefined, 'server-preview')).resolves.toEqual({ dim: '320x640', thumbhash: 'server-preview' });
  expect(thumbhash).not.toHaveBeenCalled();
});

it('reads missing video dimensions without generating a second ThumbHash', async () => {
  generateMetadata.mockResolvedValue({ width: 320, height: 640 });
  await expect(readAttachmentMediaMetadata('file:///clip', 'video/mp4', undefined,
    undefined, 'server-preview')).resolves.toEqual({ dim: '320x640', thumbhash: 'server-preview' });
  expect(generateMetadata).toHaveBeenCalledWith('file:///clip', { includeThumbhash: false });
});

it('preserves supplied metadata if local decoding fails', async () => {
  generateMetadata.mockRejectedValue(new Error('Unsupported codec'));
  await expect(readAttachmentMediaMetadata('file:///clip', 'video/mp4', undefined, '640x480'))
    .resolves.toEqual({ dim: '640x480' });
  await expect(readAttachmentMediaMetadata('file:///clip', 'video/mp4', undefined,
    undefined, 'server-preview')).resolves.toEqual({ thumbhash: 'server-preview' });
});

it('reuses upload-preview metadata without decoding again, keeping server fields authoritative', async () => {
  await expect(readAttachmentMediaMetadata('file:///clip', 'video/mp4', undefined,
    '2056x1576', undefined, { dim: '1920x1080', thumbhash: 'local-preview' }))
    .resolves.toEqual({ dim: '2056x1576', thumbhash: 'local-preview' });
  await expect(readAttachmentMediaMetadata('file:///clip', 'video/mp4', undefined,
    undefined, 'server-preview', { dim: '1920x1080', thumbhash: 'local-preview' }))
    .resolves.toEqual({ dim: '1920x1080', thumbhash: 'server-preview' });
  expect(generateMetadata).not.toHaveBeenCalled();
  expect(getDimensions).not.toHaveBeenCalled();
  expect(thumbhash).not.toHaveBeenCalled();
});

it('falls back to file dimensions when server dimensions are invalid', async () => {
  generateMetadata.mockResolvedValue({ width: 640, height: 480 });
  await expect(readAttachmentMediaMetadata('file:///clip', 'video/mp4', undefined, '0x480'))
    .resolves.toEqual({ dim: '640x480' });
  expect(generateMetadata).toHaveBeenCalledTimes(1);
});

it('keeps video dimensions when placeholder generation fails', async () => {
  generateMetadata.mockResolvedValue({ width: 1920, height: 1080 });
  await expect(readAttachmentMediaMetadata('file:///clip.mp4', 'video/mp4'))
    .resolves.toEqual({ dim: '1920x1080' });
});

it.each(['image/gif', 'image/webp', 'image/avif', 'image/svg+xml'])(
  'reads dimensions directly for unmodified %s files', async (mime) => {
    getDimensions.mockResolvedValue({ width: 320, height: 640 });
    await expect(readAttachmentMediaMetadata('file:///original', mime))
      .resolves.toEqual({ dim: '320x640', thumbhash: 'image-preview' });
    expect(getDimensions).toHaveBeenCalledWith('file:///original');
    expect(thumbhash).toHaveBeenCalledWith('file:///original', 320, 640);
  },
);

it('uses encoder output dimensions without decoding the optimized image again', async () => {
  await expect(readAttachmentMediaMetadata('file:///optimized.webp', 'image/webp', {
    width: 1600, height: 900,
  })).resolves.toEqual({ dim: '1600x900', thumbhash: 'image-preview' });
  expect(getDimensions).not.toHaveBeenCalled();
  expect(thumbhash).toHaveBeenCalledWith('file:///optimized.webp', 1600, 900);
});

it.each([0, -1, NaN, Infinity, 1.5])('omits invalid dimensions (%s)', async (width) => {
  getDimensions.mockResolvedValue({ width, height: 100 });
  await expect(readAttachmentMediaMetadata('file:///image', 'image/png')).resolves.toEqual({});
  expect(thumbhash).not.toHaveBeenCalled();
});

it('allows unsupported media to be sent without dimensions', async () => {
  generateMetadata.mockRejectedValue(new Error('Unsupported codec'));
  await expect(readAttachmentMediaMetadata('file:///clip', 'video/mp4')).resolves.toEqual({});
});

it('does not decode voice containers or other nonvisual files', async () => {
  await expect(readAttachmentMediaMetadata('file:///voice.mp4', 'audio/mp4')).resolves.toEqual({});
  await expect(readAttachmentMediaMetadata('file:///document', 'application/pdf'))
    .resolves.toEqual({});
  expect(generateMetadata).not.toHaveBeenCalled();
  expect(getDimensions).not.toHaveBeenCalled();
});
