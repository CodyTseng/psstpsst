import { platform } from '@/platform';
import { computeThumbhash } from '@/lib/image/thumbhash';
import { copyVideoPoster, getVideoMetadata } from '../video-poster.service';

jest.mock('@/platform', () => ({ platform: {
  fileSystem: {
    cacheDirectoryUri: jest.fn(), makeDirectory: jest.fn(), stat: jest.fn(),
    readBytes: jest.fn(), writeBytes: jest.fn(), move: jest.fn(), copy: jest.fn(), delete: jest.fn(),
  },
  videoThumbnail: { generateMetadata: jest.fn() },
} }));
jest.mock('@/lib/image/thumbhash', () => ({ computeThumbhash: jest.fn() }));

const files = new Map<string, Uint8Array>();
const fs = platform.fileSystem;
const generate = platform.videoThumbnail.generateMetadata as jest.Mock;
let sequence = 0;
const source = () => `file:///immutable-video-${sequence++}.mov`;

beforeEach(() => {
  jest.clearAllMocks();
  files.clear();
  (fs.cacheDirectoryUri as jest.Mock).mockResolvedValue('file:///cache/');
  (fs.makeDirectory as jest.Mock).mockResolvedValue(undefined);
  (fs.stat as jest.Mock).mockImplementation(async (uri) => ({ exists: files.has(uri) }));
  (fs.readBytes as jest.Mock).mockImplementation(async (uri) => {
    if (!files.has(uri)) throw new Error('Missing file');
    return files.get(uri);
  });
  (fs.writeBytes as jest.Mock).mockImplementation(async (uri, bytes) => files.set(uri, bytes));
  (fs.move as jest.Mock).mockImplementation(async (from, to) => {
    if (!files.has(from)) throw new Error('Missing file');
    if (files.has(to)) throw new Error('Destination already exists');
    files.set(to, files.get(from)!);
    files.delete(from);
  });
  (fs.copy as jest.Mock).mockImplementation(async (from, to, options) => {
    if (files.has(to) && !options?.overwrite) throw new Error('Destination already exists');
    files.set(to, files.get(from)!);
  });
  (fs.delete as jest.Mock).mockImplementation(async (uri) => files.delete(uri));
  generate.mockImplementation(async (_uri, options) => {
    files.set(options.posterUri, new Uint8Array([1, 2, 3]));
    return { width: 2056, height: 1576, posterUri: options.posterUri };
  });
  (computeThumbhash as jest.Mock).mockResolvedValue('preview');
});

it('deduplicates simultaneous chat and gallery requests and reuses the image on remount', async () => {
  const uri = source();
  const [chat, gallery] = await Promise.all([
    getVideoMetadata(uri, { includeThumbhash: false }), getVideoMetadata(uri, { includeThumbhash: false }),
  ]);
  expect(chat?.posterUri).toMatch(/\.jpg$/);
  expect(gallery).toEqual(chat);
  expect(await getVideoMetadata(uri, { includeThumbhash: false })).toEqual(chat);
  expect(generate).toHaveBeenCalledTimes(1);
  expect(computeThumbhash).not.toHaveBeenCalled();
});

it('generates a missing wire placeholder from the cached image without decoding the video again', async () => {
  const uri = source();
  const preview = await getVideoMetadata(uri, { includeThumbhash: false });
  const result = await getVideoMetadata(uri);
  expect(result?.thumbhash).toBe('preview');
  expect(computeThumbhash).toHaveBeenCalledWith(preview!.posterUri, 2056, 1576);
  expect(generate).toHaveBeenCalledTimes(1);
});

it('carries the preview to the permanent attachment URI without decoding again', async () => {
  const staged = source();
  const permanent = source();
  await getVideoMetadata(staged, { includeThumbhash: false });
  await copyVideoPoster(staged, permanent);
  expect((await getVideoMetadata(permanent, { includeThumbhash: false }))?.width).toBe(2056);
  expect(generate).toHaveBeenCalledTimes(1);
});

it('uses persistent posters after the bounded memory cache evicts an entry', async () => {
  const uri = source();
  const original = await getVideoMetadata(uri, { includeThumbhash: false });
  for (let index = 0; index < 130; index++) await getVideoMetadata(source(), { includeThumbhash: false });
  const calls = generate.mock.calls.length;
  expect(await getVideoMetadata(uri, { includeThumbhash: false })).toEqual(original);
  expect(generate).toHaveBeenCalledTimes(calls);
});

it.each(['missing', 'corrupt'])('restores %s metadata when its JPEG survives on a non-overwriting filesystem', async (condition) => {
  const uri = source();
  const original = await getVideoMetadata(uri, { includeThumbhash: false });
  const metadataPath = original!.posterUri!.replace(/\.jpg$/, '.json');
  if (condition === 'missing') files.delete(metadataPath);
  else files.set(metadataPath, new TextEncoder().encode('invalid JSON'));
  // Force the next request to read disk, as it would after an application restart.
  for (let index = 0; index < 130; index++) await getVideoMetadata(source(), { includeThumbhash: false });
  const calls = generate.mock.calls.length;
  const repaired = await getVideoMetadata(uri, { includeThumbhash: false });
  expect(repaired?.posterUri).toBe(original!.posterUri);
  expect(files.has(metadataPath)).toBe(true);
  expect(JSON.parse(new TextDecoder().decode(files.get(metadataPath)))).toMatchObject({ width: 2056, height: 1576 });
  expect(generate).toHaveBeenCalledTimes(calls + 1);
  await getVideoMetadata(uri, { includeThumbhash: false });
  expect(generate).toHaveBeenCalledTimes(calls + 1);
});

it('replaces the metadata JSON when adding a ThumbHash to an existing poster', async () => {
  const uri = source();
  const original = await getVideoMetadata(uri, { includeThumbhash: false });
  await getVideoMetadata(uri);
  const metadataPath = original!.posterUri!.replace(/\.jpg$/, '.json');
  expect(JSON.parse(new TextDecoder().decode(files.get(metadataPath)))).toMatchObject({ thumbhash: 'preview' });
  expect(generate).toHaveBeenCalledTimes(1);
});

it('regenerates an OS-evicted poster and never reads remote URLs', async () => {
  const uri = source();
  const original = await getVideoMetadata(uri, { includeThumbhash: false });
  files.delete(original!.posterUri!);
  await getVideoMetadata(uri, { includeThumbhash: false });
  expect(generate).toHaveBeenCalledTimes(2);
  await expect(getVideoMetadata('https://remote.example/video.mp4')).resolves.toBeUndefined();
  expect(generate).toHaveBeenCalledTimes(2);
});

it('limits concurrent video decodes to two', async () => {
  const releases: (() => void)[] = [];
  let active = 0;
  let peak = 0;
  generate.mockImplementation(async (_uri, options) => {
    active++;
    peak = Math.max(peak, active);
    await new Promise<void>((resolve) => releases.push(resolve));
    active--;
    files.set(options.posterUri, new Uint8Array([1]));
    return { width: 100, height: 100, posterUri: options.posterUri };
  });
  const jobs = Array.from({ length: 6 }, () => getVideoMetadata(source(), { includeThumbhash: false }));
  for (let index = 0; index < 3; index++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(releases.length).toBe(2);
    releases.splice(0).forEach((release) => release());
  }
  await Promise.all(jobs);
  expect(peak).toBe(2);
});

it('does not retry a failed decode every time a list row remounts', async () => {
  generate.mockResolvedValue(undefined);
  const uri = source();
  await getVideoMetadata(uri, { includeThumbhash: false });
  await getVideoMetadata(uri, { includeThumbhash: false });
  expect(generate).toHaveBeenCalledTimes(1);
});

it('skips queued posters after all their list rows unmount, without caching a failure', async () => {
  const releases: (() => void)[] = [];
  const abandoned = source();
  generate.mockImplementation(async (_uri, options) => {
    if (_uri !== abandoned) await new Promise<void>((resolve) => releases.push(resolve));
    files.set(options.posterUri, new Uint8Array([1]));
    return { width: 100, height: 100, posterUri: options.posterUri };
  });
  const first = getVideoMetadata(source(), { includeThumbhash: false });
  const second = getVideoMetadata(source(), { includeThumbhash: false });
  const controller = new AbortController();
  const cancelled = getVideoMetadata(abandoned, { includeThumbhash: false, signal: controller.signal });
  controller.abort();
  await new Promise((resolve) => setTimeout(resolve, 0));
  releases.forEach((release) => release());
  await Promise.all([first, second]);
  await expect(cancelled).resolves.toBeUndefined();
  expect(generate).toHaveBeenCalledTimes(2);
  await getVideoMetadata(abandoned, { includeThumbhash: false });
  expect(generate).toHaveBeenCalledTimes(3);
});

it('keeps real dimensions if publishing the poster cache fails', async () => {
  (fs.move as jest.Mock).mockRejectedValueOnce(new Error('Disk full'));
  await expect(getVideoMetadata(source(), { includeThumbhash: false }))
    .resolves.toMatchObject({ width: 2056, height: 1576, posterUri: undefined });
});
