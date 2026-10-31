import { db } from '@/db/client';
import { platform } from '@/platform';
import { getDevicePreference, setDevicePreference } from '../device-preferences.service';
import {
  addWallpaperImage, deleteWallpaperImage, loadWallpaper, loadWallpaperLibrary, removeAccountWallpapers,
  saveWallpaper, wallpaperLibraryStore, wallpaperStore,
} from '../chat-wallpaper.service';

let mockAffected: { key: string }[] = [];
let mockRemoved: { key: string }[] = [];
const mockInsertMarker = jest.fn();
jest.mock('@/db/client', () => ({ db: {
  delete: jest.fn(() => ({ where: jest.fn(async () => {}) })),
  select: jest.fn(() => ({ from: () => ({ where: async () => mockRemoved }) })),
  transaction: jest.fn(async (work: (tx: unknown) => Promise<unknown>) => work({
    insert: () => ({ values: (value: unknown) => { mockInsertMarker(value); return { onConflictDoNothing: async () => {} }; } }),
    update: () => ({ set: () => ({ where: () => ({ returning: async () => mockAffected }) }) }),
  })),
} }));
jest.mock('@/services/preferences/device-preferences.service', () => ({
  getDevicePreference: jest.fn(async () => null), setDevicePreference: jest.fn(async () => {}),
}));
jest.mock('@/platform', () => ({ platform: {
  fileSystem: {
    documentDirectoryUri: jest.fn(async () => 'file:///current/'),
    makeDirectory: jest.fn(async () => {}), listDirectory: jest.fn(async () => []),
    copy: jest.fn(async () => {}), delete: jest.fn(async () => {}),
    stat: jest.fn(async () => ({ exists: true })),
  },
  imageManipulator: {
    getDimensions: jest.fn(async () => ({ width: 4000, height: 3000 })),
    renderAndSave: jest.fn(async () => ({ uri: 'file:///cache/converted.jpg', width: 2048, height: 1536 })),
  },
  deviceCrypto: { randomUUID: jest.fn(async () => 'new-image') },
} }));

let counter = 0;
function scope() { return { accountPubkey: 'account', conversationKey: `peer-${++counter}` }; }
const imageUri = 'file:///current/chat-wallpapers/library/new-image.jpg';

beforeEach(() => {
  jest.clearAllMocks();
  mockAffected = [];
  mockRemoved = [];
  jest.mocked(platform.fileSystem.delete).mockResolvedValue();
  jest.mocked(getDevicePreference).mockResolvedValue(null);
  jest.mocked(setDevicePreference).mockResolvedValue();
  jest.mocked(platform.fileSystem.copy).mockResolvedValue();
  jest.mocked(platform.fileSystem.listDirectory).mockResolvedValue([]);
  wallpaperStore().setState({ value: null, uri: null, loaded: false, error: false, saving: false });
  wallpaperLibraryStore.setState({ images: [], loaded: false, error: false, adding: false, deleting: null });
});

it('restores relative library names against the current application directory', async () => {
  const target = scope();
  jest.mocked(getDevicePreference).mockResolvedValue(JSON.stringify({ kind: 'image', fileName: 'saved.jpg', library: true }));
  await loadWallpaper(target);
  expect(wallpaperStore(target).getState()).toMatchObject({
    loaded: true, uri: 'file:///current/chat-wallpapers/library/saved.jpg',
  });
});

it('adds a resized image without changing the selection and cleans up its temporary file', async () => {
  await addWallpaperImage('file:///picker/original.heic');
  expect(platform.imageManipulator.renderAndSave).toHaveBeenCalledWith('file:///picker/original.heic', {
    resize: { width: 2048 }, format: 'jpeg', quality: 0.85,
  });
  expect(wallpaperLibraryStore.getState().images).toEqual([{ fileName: 'new-image.jpg', uri: imageUri }]);
  expect(setDevicePreference).not.toHaveBeenCalled();
  expect(platform.fileSystem.delete).toHaveBeenCalledWith('file:///cache/converted.jpg', { idempotent: true });
});

it('switches existing images and modes without decoding, copying, or deleting library images', async () => {
  const target = scope();
  await saveWallpaper(target, { fileName: 'first.jpg' });
  await saveWallpaper(target, { fileName: 'second.jpg' });
  await saveWallpaper(target, 'none');
  await saveWallpaper(target, { fileName: 'first.jpg' });
  expect(wallpaperStore(target).getState().uri).toBe('file:///current/chat-wallpapers/library/first.jpg');
  expect(platform.fileSystem.copy).not.toHaveBeenCalled();
  expect(platform.fileSystem.delete).not.toHaveBeenCalled();
  expect(platform.imageManipulator.renderAndSave).not.toHaveBeenCalled();
});

it('applies immediately and rolls back the previous selection if persistence fails', async () => {
  const target = scope();
  await saveWallpaper(target, { fileName: 'old.jpg' });
  let reject!: (error: Error) => void;
  jest.mocked(setDevicePreference).mockImplementationOnce(() => new Promise<void>((_resolve, fail) => { reject = fail; }));
  const pending = saveWallpaper(target, 'none');
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(wallpaperStore(target).getState()).toMatchObject({ value: { kind: 'none' }, saving: true });
  reject(new Error('disk full'));
  await expect(pending).rejects.toThrow('disk full');
  expect(wallpaperStore(target).getState()).toMatchObject({
    value: { kind: 'image', fileName: 'old.jpg', library: true }, saving: false,
  });
  expect(platform.fileSystem.delete).not.toHaveBeenCalled();
});

it('preserves library images when restoring inheritance and isolates account selections', async () => {
  const target = scope();
  const other = { ...target, accountPubkey: 'other' };
  await addWallpaperImage('file:///photo.jpg');
  await saveWallpaper(undefined, { fileName: 'new-image.jpg' });
  await saveWallpaper(target, 'none');
  await loadWallpaper(other);
  expect(wallpaperStore(target).getState().value).toEqual({ kind: 'none' });
  expect(wallpaperStore(other).getState().value).toBeNull();
  await saveWallpaper(target, 'inherit');
  expect(wallpaperStore(target).getState().value).toBeNull();
  expect(wallpaperStore().getState().value?.kind).toBe('image');
  expect(wallpaperLibraryStore.getState().images).toHaveLength(1);
});

it('restores the gallery from managed files after restarting', async () => {
  jest.mocked(platform.fileSystem.listDirectory).mockResolvedValue([
    { name: 'saved.jpg', uri: 'file:///old-container/saved.jpg', isDirectory: false },
    { name: 'ignore.txt', uri: '', isDirectory: false },
  ]);
  await loadWallpaperLibrary();
  expect(wallpaperLibraryStore.getState().images).toEqual([
    { fileName: 'saved.jpg', uri: 'file:///current/chat-wallpapers/library/saved.jpg' },
  ]);
});

it('migrates a previously selected wallpaper into the reusable library', async () => {
  const target = scope();
  jest.mocked(getDevicePreference).mockResolvedValue(JSON.stringify({ kind: 'image', fileName: 'legacy.jpg' }));
  await loadWallpaper(target);
  expect(setDevicePreference).toHaveBeenCalledWith(`chat.wallpaper.account.${target.conversationKey}`,
    JSON.stringify({ kind: 'image', fileName: 'new-image.jpg', library: true }));
  expect(wallpaperStore(target).getState().uri).toBe(imageUri);
  expect(wallpaperLibraryStore.getState().images).toHaveLength(1);
});

it('does not add a broken thumbnail when copying an image fails', async () => {
  jest.mocked(platform.fileSystem.copy).mockRejectedValueOnce(new Error('disk full'));
  await expect(addWallpaperImage('file:///photo.jpg')).rejects.toThrow('disk full');
  expect(wallpaperLibraryStore.getState()).toMatchObject({ images: [], adding: false, deleting: null });
  expect(platform.fileSystem.delete).toHaveBeenCalledWith(imageUri, { idempotent: true });
});

it.each(['not json', '{"kind":"image","fileName":"../secret.jpg"}', '{"kind":"image","fileName":"https://host/photo.jpg"}'])(
  'ignores invalid persisted image references: %s', async (value) => {
    const target = scope();
    jest.mocked(getDevicePreference).mockResolvedValue(value);
    await loadWallpaper(target);
    expect(wallpaperStore(target).getState()).toMatchObject({ value: null, uri: null, loaded: true });
  },
);

it('deduplicates concurrent reads and permits retry after a read failure', async () => {
  const target = scope();
  jest.mocked(getDevicePreference).mockRejectedValueOnce(new Error('locked'));
  await Promise.all([loadWallpaper(target), loadWallpaper(target)]);
  expect(getDevicePreference).toHaveBeenCalledTimes(1);
  expect(wallpaperStore(target).getState()).toMatchObject({ loaded: false, error: true });
  await loadWallpaper(target);
  expect(wallpaperStore(target).getState()).toMatchObject({ loaded: true, error: false });
});

it('removes account overrides without removing the shared library', async () => {
  const target = scope();
  await addWallpaperImage('file:///photo.jpg');
  await removeAccountWallpapers(target.accountPubkey);
  expect(platform.fileSystem.delete).toHaveBeenCalledWith('file:///current/chat-wallpapers/account/', { idempotent: true });
  expect(wallpaperLibraryStore.getState().images).toHaveLength(1);
  expect(platform.fileSystem.delete).not.toHaveBeenCalledWith(imageUri, expect.anything());
});


it('deletes a shared image and resets global and conversation references, preserving other selections', async () => {
  const target = scope();
  const other = scope();
  await addWallpaperImage('file:///photo.jpg');
  await saveWallpaper(undefined, { fileName: 'new-image.jpg' });
  await saveWallpaper(target, { fileName: 'new-image.jpg' });
  await saveWallpaper(other, { fileName: 'other.jpg' });
  mockAffected = [{ key: 'chat.wallpaper.default' }, { key: `chat.wallpaper.account.${target.conversationKey}` }];
  await deleteWallpaperImage('new-image.jpg');
  expect(mockInsertMarker).toHaveBeenCalledWith(expect.objectContaining({ key: 'chat.wallpaper.removed.new-image.jpg', value: 'true' }));
  expect(wallpaperStore().getState()).toMatchObject({ value: { kind: 'none' }, uri: null });
  expect(wallpaperStore(target).getState()).toMatchObject({ value: null, uri: null });
  expect(wallpaperStore(other).getState().value).toMatchObject({ kind: 'image', fileName: 'other.jpg' });
  expect(wallpaperLibraryStore.getState()).toMatchObject({ images: [], deleting: null });
  expect(platform.fileSystem.delete).toHaveBeenCalledWith(imageUri, { idempotent: true });
});

it('keeps the image and selection if the deletion transaction fails', async () => {
  const target = scope();
  await addWallpaperImage('file:///photo.jpg');
  await saveWallpaper(target, { fileName: 'new-image.jpg' });
  jest.mocked(db.transaction).mockRejectedValueOnce(new Error('database unavailable'));
  jest.mocked(platform.fileSystem.delete).mockClear();
  await expect(deleteWallpaperImage('new-image.jpg')).rejects.toThrow('database unavailable');
  expect(wallpaperLibraryStore.getState()).toMatchObject({ deleting: null });
  expect(wallpaperLibraryStore.getState().images).toHaveLength(1);
  expect(wallpaperStore(target).getState().value).toMatchObject({ fileName: 'new-image.jpg' });
  expect(platform.fileSystem.delete).not.toHaveBeenCalled();
});

it('does not restore a deleted thumbnail if file cleanup fails', async () => {
  await addWallpaperImage('file:///photo.jpg');
  jest.mocked(platform.fileSystem.delete).mockRejectedValueOnce(new Error('file busy'));
  const warning = jest.spyOn(console, 'warn').mockImplementation(() => {});
  await deleteWallpaperImage('new-image.jpg');
  expect(wallpaperLibraryStore.getState().images).toHaveLength(0);
  mockRemoved = [{ key: 'chat.wallpaper.removed.new-image.jpg' }];
  jest.mocked(platform.fileSystem.listDirectory).mockResolvedValue([{ name: 'new-image.jpg', uri: imageUri, isDirectory: false }]);
  wallpaperLibraryStore.setState({ loaded: false });
  await loadWallpaperLibrary();
  expect(wallpaperLibraryStore.getState().images).toHaveLength(0);
  warning.mockRestore();
});

it('rejects a stale selection of a deleted image', async () => {
  const target = scope();
  await loadWallpaper(target);
  jest.mocked(getDevicePreference).mockImplementation(async (key) => key === 'chat.wallpaper.removed.deleted.jpg' ? 'true' : null);
  await expect(saveWallpaper(target, { fileName: 'deleted.jpg' })).rejects.toThrow('Wallpaper was deleted');
  expect(wallpaperStore(target).getState()).toMatchObject({ value: null, uri: null, saving: false });
});
