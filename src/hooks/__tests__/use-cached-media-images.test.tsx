import { useEffect } from 'react';
import { Image, type ImageRef } from 'expo-image';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import type { ConversationMediaItem } from '../use-conversation-media';
import { useCachedMediaImages } from '../use-cached-media-images';
import { getCachedAttachmentUri } from '@/services/files/file-attachment.service';
import { platform } from '@/platform';

jest.mock('expo-image', () => ({ Image: { readFromCacheAsync: jest.fn(), loadAsync: jest.fn() } }));
let mockElectron = false;
jest.mock('@/lib/platform', () => ({ get IS_ELECTRON() { return mockElectron; } }));
jest.mock('@/platform', () => ({ platform: { imageCache: { getCachedUri: jest.fn(), download: jest.fn() } } }));
jest.mock('@/services/files/file-attachment.service', () => ({ getCachedAttachmentUri: jest.fn() }));

const embedded = (id: string): ConversationMediaItem => ({
  mediaKey: id, source: 'embedded', messageId: id, createdAt: 1, orderAt: 1, isVideo: false,
  meta: { url: `https://media.test/${id}`, kind: 'image', sha256: id },
});
const attachment: ConversationMediaItem = {
  ...embedded('attachment'), source: 'attachment', meta: { url: 'https://media.test/encrypted', cipherSha256Hex: 'cipher', decryptionKeyHex: 'key', decryptionNonceHex: 'nonce' },
};
const decoded = { width: 1600, height: 900 } as ImageRef;
let result: ReturnType<typeof useCachedMediaImages>;
let renderer: ReactTestRenderer;
function Harness({ items }: { items: (ConversationMediaItem | undefined)[] }) {
  const images = useCachedMediaImages(items[0], items[1], items[2]);
  useEffect(() => { result = images; }, [images]);
  return null;
}
async function render(items: (ConversationMediaItem | undefined)[]) {
  await act(async () => {
    const element = <Harness items={items} />;
    if (renderer) renderer.update(element); else renderer = create(element);
  });
}
beforeEach(() => {
  jest.resetAllMocks();
  mockElectron = false;
  jest.mocked(platform.imageCache.getCachedUri).mockResolvedValue(null);
  jest.mocked(Image.readFromCacheAsync).mockResolvedValue(null);
  jest.mocked(getCachedAttachmentUri).mockResolvedValue(null);
  jest.mocked(Image.loadAsync).mockResolvedValue(decoded);
});
afterEach(() => { act(() => renderer.unmount()); renderer = undefined!; });

it('reads direct images by their native cache identity without requesting a remote source', async () => {
  const item = embedded('hash');
  jest.mocked(Image.readFromCacheAsync).mockResolvedValue(decoded);
  await render([undefined, undefined, item]);
  expect(Image.readFromCacheAsync).toHaveBeenCalledWith('hash');
  expect(result.get(item.mediaKey)).toBe(decoded);
  expect(Image.loadAsync).not.toHaveBeenCalled();
});

it('decodes only locally cached attachments and skips videos', async () => {
  jest.mocked(getCachedAttachmentUri).mockResolvedValue('file:///cached.jpg');
  await render([attachment, undefined, { ...embedded('video'), isVideo: true }]);
  expect(getCachedAttachmentUri).toHaveBeenCalledWith(attachment.meta);
  expect(Image.loadAsync).toHaveBeenCalledWith('file:///cached.jpg');
  expect(Image.readFromCacheAsync).not.toHaveBeenCalled();
  expect(result.get(attachment.mediaKey)).toBe(decoded);
});

it('leaves undownloaded attachments unresolved', async () => {
  await render([attachment]);
  expect(Image.loadAsync).not.toHaveBeenCalled();
  expect(result.get(attachment.mediaKey)).toBeNull();
});

it('retains overlapping bitmaps and drops references outside the three-page window', async () => {
  const items = ['a', 'b', 'c', 'd'].map(embedded);
  jest.mocked(Image.readFromCacheAsync).mockResolvedValue(decoded);
  await render(items.slice(0, 3));
  await render(items.slice(1, 4));
  expect([...result.keys()].sort()).toEqual(['b', 'c', 'd']);
  expect(Image.readFromCacheAsync).toHaveBeenCalledTimes(4);
});

it('discards a late cache read after its page leaves the window', async () => {
  let resolve!: (value: ImageRef) => void;
  jest.mocked(Image.readFromCacheAsync).mockReturnValueOnce(new Promise((done) => { resolve = done; }));
  await render([embedded('old')]);
  await render([embedded('new')]);
  await act(async () => resolve(decoded));
  expect(result.has('old')).toBe(false);
});

it('prepares Electron neighbours from local bytes without native APIs or downloads', async () => {
  mockElectron = true;
  jest.mocked(platform.imageCache.getCachedUri).mockResolvedValue('file:///remote-cache.jpg');
  jest.mocked(getCachedAttachmentUri).mockResolvedValue('file:///attachment-cache.jpg');
  const direct = embedded('direct');
  await render([direct, attachment, { ...embedded('video'), isVideo: true }]);
  expect(result.get(direct.mediaKey)).toBe('file:///remote-cache.jpg');
  expect(result.get(attachment.mediaKey)).toBe('file:///attachment-cache.jpg');
  expect(platform.imageCache.getCachedUri).toHaveBeenCalledWith(direct.meta.url);
  expect(platform.imageCache.download).not.toHaveBeenCalled();
  expect(Image.loadAsync).not.toHaveBeenCalled();
  expect(Image.readFromCacheAsync).not.toHaveBeenCalled();
});

it('bounds Electron cache reads to the three-page window and retains overlapping URIs', async () => {
  mockElectron = true;
  jest.mocked(platform.imageCache.getCachedUri).mockResolvedValue('file:///cached.jpg');
  const items = ['a', 'b', 'c', 'd'].map(embedded);
  await render(items.slice(0, 3));
  await render(items.slice(1, 4));
  expect([...result.keys()].sort()).toEqual(['b', 'c', 'd']);
  expect(platform.imageCache.getCachedUri).toHaveBeenCalledTimes(4);
});
