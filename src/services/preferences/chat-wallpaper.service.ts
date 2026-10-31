import { and, like, sql } from 'drizzle-orm';
import { createStore } from 'zustand/vanilla';

import { db } from '@/db/client';
import { devicePreferences } from '@/db/schema';
import { platform } from '@/platform';

import { getDevicePreference, setDevicePreference } from './device-preferences.service';

export type WallpaperScope = { accountPubkey: string; conversationKey: string };
export type ChatWallpaper = { kind: 'none' } | { kind: 'image'; fileName: string; library?: true };
export type WallpaperImage = { fileName: string; uri: string };
export type WallpaperState = {
  value: ChatWallpaper | null;
  uri: string | null;
  loaded: boolean;
  error: boolean;
  saving: boolean;
};

const PREFIX = 'chat.wallpaper.';
const REMOVED_PREFIX = 'chat.wallpaper.removed.';
const IMAGE_NAME = /^[a-zA-Z0-9-]+\.jpg$/;
export const wallpaperLibraryStore = createStore<{
  images: WallpaperImage[]; loaded: boolean; error: boolean; adding: boolean; deleting: string | null;
}>(() => ({ images: [], loaded: false, error: false, adding: false, deleting: null }));
let libraryLoad: Promise<void> | undefined;
let mutationTail: Promise<void> = Promise.resolve();

function mutateWallpaper<T>(work: () => Promise<T>): Promise<T> {
  const pending = mutationTail.then(work);
  mutationTail = pending.then(() => {}, () => {});
  return pending;
}
const stores = new Map<string, ReturnType<typeof createWallpaperStore>>();
const loads = new Map<string, Promise<void>>();

function preferenceKey(scope?: WallpaperScope): string {
  return scope ? `${PREFIX}${scope.accountPubkey}.${scope.conversationKey}` : `${PREFIX}default`;
}

function createWallpaperStore() {
  return createStore<WallpaperState>(() => ({
    value: null, uri: null, loaded: false, error: false, saving: false,
  }));
}

/** Each open scope has its own subscription; message history never participates. */
export function wallpaperStore(scope?: WallpaperScope) {
  const key = preferenceKey(scope);
  let store = stores.get(key);
  if (!store) {
    store = createWallpaperStore();
    stores.set(key, store);
  }
  return store;
}

async function directory(scope?: WallpaperScope): Promise<string> {
  const root = await platform.fileSystem.documentDirectoryUri();
  if (!root) throw new Error('Persistent storage is unavailable');
  return `${root}chat-wallpapers/${scope?.accountPubkey ?? 'default'}/`;
}

function decode(value: string | null): ChatWallpaper | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (parsed && typeof parsed === 'object' && 'kind' in parsed) {
      if (parsed.kind === 'none') return { kind: 'none' };
      if (parsed.kind === 'image' && 'fileName' in parsed &&
          typeof parsed.fileName === 'string' && IMAGE_NAME.test(parsed.fileName)) {
        return { kind: 'image', fileName: parsed.fileName, ...('library' in parsed && parsed.library === true ? { library: true as const } : {}) };
      }
    }
  } catch { /* An invalid preference behaves like an unset preference. */ }
  return null;
}

export async function loadWallpaper(scope?: WallpaperScope): Promise<void> {
  const key = preferenceKey(scope);
  const store = wallpaperStore(scope);
  if (store.getState().loaded) return;
  const pending = loads.get(key);
  if (pending) return pending;
  const load = (async () => {
    store.setState({ error: false });
    try {
      let value = decode(await getDevicePreference(key));
      let uri = value?.kind === 'image'
        ? `${value.library ? await libraryDirectory() : await directory(scope)}${value.fileName}` : null;
      if (value?.kind === 'image' && !value.library && uri) {
        // Preserve wallpapers created before the reusable library was introduced.
        if (!(await platform.fileSystem.stat(uri)).exists) {
          store.setState({ value: { kind: 'none' }, uri: null, loaded: true });
          return;
        }
        const migrated = await copyIntoLibrary(uri);
        const next: ChatWallpaper = { kind: 'image', fileName: migrated.fileName, library: true };
        try {
          await setDevicePreference(key, JSON.stringify(next));
        } catch (error) {
          await platform.fileSystem.delete(migrated.uri, { idempotent: true }).catch(() => {});
          throw error;
        }
        await platform.fileSystem.delete(uri, { idempotent: true }).catch(() => {});
        value = next;
        uri = migrated.uri;
        wallpaperLibraryStore.setState((current) => ({ images: [migrated, ...current.images] }));
      }
      store.setState({ value, uri, loaded: true, error: false });
    } catch {
      store.setState({ error: true });
    }
  })();
  loads.set(key, load);
  try { await load; } finally { loads.delete(key); }
}

async function libraryDirectory(): Promise<string> {
  const root = await platform.fileSystem.documentDirectoryUri();
  if (!root) throw new Error('Persistent storage is unavailable');
  return `${root}chat-wallpapers/library/`;
}

export async function loadWallpaperLibrary(): Promise<void> {
  if (wallpaperLibraryStore.getState().loaded) return;
  if (libraryLoad) return libraryLoad;
  libraryLoad = (async () => {
    wallpaperLibraryStore.setState({ error: false });
    try {
      const dir = await libraryDirectory();
      await platform.fileSystem.makeDirectory(dir, { intermediates: true, idempotent: true });
      const [entries, tombstones] = await Promise.all([
        platform.fileSystem.listDirectory(dir),
        db.select({ key: devicePreferences.key }).from(devicePreferences)
          .where(like(devicePreferences.key, `${REMOVED_PREFIX}%`)),
      ]);
      const removed = new Set(tombstones.map((row) => row.key.slice(REMOVED_PREFIX.length)));
      const images = entries.filter((entry) => !entry.isDirectory && IMAGE_NAME.test(entry.name) && !removed.has(entry.name))
        .map((entry) => ({ fileName: entry.name, uri: `${dir}${entry.name}` }));
      const names = new Set(images.map((image) => image.fileName));
      wallpaperLibraryStore.setState((current) => ({
        images: [...current.images.filter((image) => !names.has(image.fileName) && !removed.has(image.fileName)), ...images],
        loaded: true,
      }));
    } catch {
      wallpaperLibraryStore.setState({ error: true });
    }
  })();
  try { await libraryLoad; } finally { libraryLoad = undefined; }
}

async function copyIntoLibrary(sourceUri: string): Promise<WallpaperImage> {
  const dir = await libraryDirectory();
  await platform.fileSystem.makeDirectory(dir, { intermediates: true, idempotent: true });
  const fileName = `${await platform.deviceCrypto.randomUUID()}.jpg`;
  const uri = `${dir}${fileName}`;
  try {
    await platform.fileSystem.copy(sourceUri, uri);
    return { fileName, uri };
  } catch (error) {
    await platform.fileSystem.delete(uri, { idempotent: true }).catch(() => {});
    throw error;
  }
}

async function importImage(sourceUri: string): Promise<WallpaperImage> {
  let temporaryUri: string | undefined;
  try {
    // Allow progress feedback to paint before decoding starts.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    const dimensions = await platform.imageManipulator.getDimensions(sourceUri);
    const longest = Math.max(dimensions.width, dimensions.height);
    if (!Number.isFinite(longest) || longest <= 0) throw new Error('Invalid image dimensions');
    const rendered = await platform.imageManipulator.renderAndSave(sourceUri, {
      resize: longest > 2048
        ? dimensions.width >= dimensions.height ? { width: 2048 } : { height: 2048 }
        : undefined,
      format: 'jpeg', quality: 0.85,
    });
    temporaryUri = rendered.uri;
    return await copyIntoLibrary(rendered.uri);
  } finally {
    if (temporaryUri) await platform.fileSystem.delete(temporaryUri, { idempotent: true }).catch(() => {});
  }
}

/** Adding to the device library does not change any conversation's selection. */
export async function addWallpaperImage(sourceUri: string): Promise<void> {
  await loadWallpaperLibrary();
  const state = wallpaperLibraryStore.getState();
  if (!state.loaded || state.adding) throw new Error('Wallpaper library is not ready');
  wallpaperLibraryStore.setState({ adding: true });
  try {
    const image = await importImage(sourceUri);
    wallpaperLibraryStore.setState((current) => ({ images: [image, ...current.images] }));
  } finally {
    wallpaperLibraryStore.setState({ adding: false });
  }
}

/** Apply an existing image without decoding or copying it again. Roll back failed writes. */
export async function saveWallpaper(
  scope: WallpaperScope | undefined,
  choice: 'inherit' | 'none' | { fileName: string },
): Promise<void> {
  await loadWallpaper(scope);
  return mutateWallpaper(async () => {
    const store = wallpaperStore(scope);
    const previous = store.getState();
    if (!previous.loaded || previous.saving) throw new Error('Wallpaper storage is not ready');
    store.setState({ saving: true });
    try {
      let value: ChatWallpaper | null = choice === 'none' ? { kind: 'none' } : null;
      let uri: string | null = null;
      if (typeof choice === 'object') {
        if (!IMAGE_NAME.test(choice.fileName)) throw new Error('Invalid wallpaper image');
        if (await getDevicePreference(`${REMOVED_PREFIX}${choice.fileName}`)) throw new Error('Wallpaper was deleted');
        uri = `${await libraryDirectory()}${choice.fileName}`;
        value = { kind: 'image', fileName: choice.fileName, library: true };
      }
      store.setState({ value, uri });
      await setDevicePreference(preferenceKey(scope), JSON.stringify(value));
      store.setState({ saving: false });
    } catch (error) {
      store.setState({ value: previous.value, uri: previous.uri, saving: false });
      throw error;
    }
  });
}

/** Reset every reference atomically before reclaiming a shared library image. */
export async function deleteWallpaperImage(fileName: string): Promise<void> {
  if (!IMAGE_NAME.test(fileName)) throw new Error('Invalid wallpaper image');
  if (wallpaperLibraryStore.getState().deleting) throw new Error('Wallpaper deletion is already in progress');
  wallpaperLibraryStore.setState({ deleting: fileName });
  try {
    const uri = `${await libraryDirectory()}${fileName}`;
    await mutateWallpaper(async () => {
      const affected = await db.transaction(async (tx) => {
        const updatedAt = Math.floor(Date.now() / 1000);
        // A tombstone keeps failed file cleanup from restoring the image on restart.
        await tx.insert(devicePreferences).values({
          key: `${REMOVED_PREFIX}${fileName}`, value: 'true', updatedAt,
        }).onConflictDoNothing();
        return tx.update(devicePreferences).set({
          value: sql`CASE WHEN ${devicePreferences.key} = ${preferenceKey()}
            THEN ${JSON.stringify({ kind: 'none' })} ELSE 'null' END`,
          updatedAt,
        }).where(and(
          like(devicePreferences.key, `${PREFIX}%`),
          sql`CASE WHEN json_valid(${devicePreferences.value})
            THEN json_extract(${devicePreferences.value}, '$.kind') END = 'image'`,
          sql`CASE WHEN json_valid(${devicePreferences.value})
            THEN json_extract(${devicePreferences.value}, '$.fileName') END = ${fileName}`,
          sql`CASE WHEN json_valid(${devicePreferences.value})
            THEN json_extract(${devicePreferences.value}, '$.library') END = 1`,
        )).returning({ key: devicePreferences.key });
      });
      for (const { key } of affected) {
        stores.get(key)?.setState({ value: key === preferenceKey() ? { kind: 'none' } : null, uri: null });
      }
      wallpaperLibraryStore.setState((current) => ({ images: current.images.filter((image) => image.fileName !== fileName) }));
    });
    await platform.fileSystem.delete(uri, { idempotent: true })
      .catch((error) => console.warn('[wallpaper] Failed to clean up deleted image bytes.', error));
  } finally {
    wallpaperLibraryStore.setState({ deleting: null });
  }
}

export async function removeAccountWallpapers(accountPubkey: string): Promise<void> {
  const prefix = `${PREFIX}${accountPubkey}.`;
  await db.delete(devicePreferences).where(like(devicePreferences.key, `${prefix}%`));
  await platform.fileSystem.delete(await directory({ accountPubkey, conversationKey: '' }), {
    idempotent: true,
  });
  for (const key of stores.keys()) {
    if (key.startsWith(prefix)) stores.delete(key);
  }
}
