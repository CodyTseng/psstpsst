import { useEffect } from 'react';
import { Image, type ImageRef } from 'expo-image';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import type { ConversationMediaItem } from '../use-conversation-media';
import { useCachedMediaImages } from '../use-cached-media-images';
import { getCachedAttachmentUri, getSessionCachedUri } from '@/services/files/file-attachment.service';
import { getCachedImageUri, getSessionImageUri } from '@/services/emoji/image-cache.service';
import { platform } from '@/platform';

jest.mock('expo-image', () => ({ Image: { readFromCacheAsync: jest.fn(), loadAsync: jest.fn() } }));
let mockElectron = false;
jest.mock('@/lib/platform', () => ({ get IS_ELECTRON() { return mockElectron; } }));
jest.mock('@/platform', () => ({ platform: { imageCache: { getCachedUri: jest.fn(), download: jest.fn() } } }));
jest.mock('@/services/files/file-attachment.service', () => ({ getCachedAttachmentUri: jest.fn(), getSessionCachedUri: jest.fn() }));
jest.mock('@/services/emoji/image-cache.service', () => ({ getCachedImageUri: jest.fn(), getSessionImageUri: jest.fn() }));

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
  const images = useCachedMediaImages(items[0], items[1], items[2], items[3], items[4]);
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
  jest.mocked(getSessionCachedUri).mockReturnValue(null);
  jest.mocked(getSessionImageUri).mockReturnValue(null);
  jest.mocked(getCachedImageUri).mockImplementation((url) => platform.imageCache.getCachedUri(url));
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

it('prepares the extended desktop window using only local cache reads', async () => {
  mockElectron = true;
  jest.mocked(platform.imageCache.getCachedUri).mockResolvedValue('file:///cached.jpg');
  const items = ['a', 'b', 'c', 'd', 'e', 'f'].map(embedded);
  await render(items.slice(0, 5));
  await render(items.slice(1, 6));
  expect([...result.keys()].sort()).toEqual(['b', 'c', 'd', 'e', 'f']);
  expect(platform.imageCache.getCachedUri).toHaveBeenCalledTimes(6);
  expect(platform.imageCache.download).not.toHaveBeenCalled();
});

it('reuses pending Electron reads across a window shift and publishes the retained page', async () => {
  mockElectron = true;
  let resolve!: (value: string) => void;
  const retained = embedded('retained');
  jest.mocked(platform.imageCache.getCachedUri).mockReturnValueOnce(new Promise((done) => { resolve = done; }));
  await render([retained]);
  await render([retained, embedded('new')]);
  expect(jest.mocked(platform.imageCache.getCachedUri).mock.calls.filter(([url]) => url === retained.meta.url)).toHaveLength(1);
  await act(async () => resolve('file:///retained.jpg'));
  expect(result.get(retained.mediaKey)).toBe('file:///retained.jpg');
});

it('finishes an overlapping native attachment decode without restarting the cache lookup', async () => {
  let resolve!: (value: string) => void;
  jest.mocked(getCachedAttachmentUri).mockReturnValueOnce(new Promise((done) => { resolve = done; }));
  await render([attachment]);
  await render([attachment, embedded('new')]);
  expect(getCachedAttachmentUri).toHaveBeenCalledTimes(1);
  await act(async () => resolve('file:///retained.jpg'));
  expect(Image.loadAsync).toHaveBeenCalledTimes(1);
  expect(result.get(attachment.mediaKey)).toBe(decoded);
});

it('seeds cached desktop attachments and direct images before asynchronous reads', async () => {
  mockElectron = true;
  const direct = embedded('direct');
  jest.mocked(getSessionCachedUri).mockReturnValue('file:///attachment.jpg');
  jest.mocked(getSessionImageUri).mockReturnValue('file:///direct.jpg');
  await render([attachment, direct]);
  expect(result.get(attachment.mediaKey)).toBe('file:///attachment.jpg');
  expect(result.get(direct.mediaKey)).toBe('file:///direct.jpg');
  expect(getCachedAttachmentUri).not.toHaveBeenCalled();
  expect(getCachedImageUri).not.toHaveBeenCalled();
  expect(Image.loadAsync).not.toHaveBeenCalled();
});

it('reuses newly known desktop URIs when a page reenters the bounded window', async () => {
  mockElectron = true;
  await render([attachment]);
  await render([embedded('other')]);
  jest.mocked(getSessionCachedUri).mockReturnValue('file:///attachment.jpg');
  await render([attachment]);
  expect(result.get(attachment.mediaKey)).toBe('file:///attachment.jpg');
  expect(getCachedAttachmentUri).toHaveBeenCalledTimes(1);
  expect(result.has('other')).toBe(false);
});
