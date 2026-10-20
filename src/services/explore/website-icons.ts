import { platform } from '@/platform';
import { resourceMime } from '@/services/napplet/protocol';
import { discoverWebsiteIcon, requestWebsiteIcon, type DownloadedWebsiteIcon } from './website-icon-discovery';

const MAX_ICON_BYTES = 512 * 1024;
const FRESH_FOR = 24 * 60 * 60 * 1000;
const RETRY_AFTER = 5 * 60 * 1000;
const extensions: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp',
  'image/gif': 'gif', 'image/svg+xml': 'svg', 'image/x-icon': 'ico' };

type IconRecord = { path: string; sourceHash: string; url: string; etag: string | null; lastModified: string | null };
type WebsiteMetadata = { schemaVersion: 1; appId: string; origin: string; checkedAt: number; refreshAfter: number; icon?: IconRecord };
type Entry = { uri?: string; expires: number; recoveryUntil?: number; load?: Promise<string | undefined>; refreshing?: Promise<void> };
const entries = new Map<string, Entry>();
const listeners = new Map<string, Set<(uri: string | undefined) => void>>();
const jobs: (() => void)[] = [];
let active = 0;

export function websiteIconOrigin(source: { origin?: string; key?: string }): string | undefined {
  const value = source.origin ?? source.key;
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (['https:', 'http:'].includes(url.protocol) && !url.username && !url.password) return url.origin;
  } catch { /* Signed application identifiers are not website URLs. */ }
  return undefined;
}

function publish(origin: string, entry: Entry, uri: string | undefined) {
  if (entry.uri === uri) return;
  entry.uri = uri;
  for (const listener of listeners.get(origin) ?? []) listener(uri);
}

export function peekWebsiteIcon(origin: string): string | undefined { return entries.get(origin)?.uri; }
export function subscribeWebsiteIcon(origin: string, listener: (uri: string | undefined) => void): () => void {
  const group = listeners.get(origin) ?? new Set();
  group.add(listener); listeners.set(origin, group);
  return () => { group.delete(listener); if (!group.size) listeners.delete(origin); };
}

async function directoryFor(origin: string) {
  const root = await platform.fileSystem.documentDirectoryUri();
  if (!root) throw new Error('storage-unavailable');
  const hash = await platform.deviceCrypto.sha256Hex(new TextEncoder().encode(origin));
  return `${root.replace(/\/$/, '')}/app-artifacts/website-${hash}`;
}

function validator(value: unknown): value is string | null {
  return value === null || typeof value === 'string' && value.length <= 2048 && !/[\r\n\0]/.test(value);
}

async function readMetadata(directory: string, origin: string): Promise<WebsiteMetadata | undefined> {
  try {
    const file = `${directory}/metadata.json`;
    const stat = await platform.fileSystem.stat(file);
    if (!stat.exists || stat.size != null && stat.size > 16384) return undefined;
    const text = await platform.fileSystem.readText(file);
    if (text.length > 16384) return undefined;
    const value = JSON.parse(text) as WebsiteMetadata;
    if (value.schemaVersion !== 1 || value.appId !== origin || value.origin !== origin ||
      !Number.isFinite(value.checkedAt) || !Number.isFinite(value.refreshAfter)) return undefined;
    const icon = value.icon;
    if (icon && (!/^[a-f0-9]{64}$/.test(icon.sourceHash) ||
      !new RegExp(`^icon-${icon.sourceHash}\\.(png|jpg|webp|gif|svg|ico)$`).test(icon.path) ||
      !websiteIconOrigin({ origin: icon.url }) || icon.url.length > 4096 || !validator(icon.etag) || !validator(icon.lastModified))) return undefined;
    return value;
  } catch { return undefined; }
}

async function existingIcon(directory: string, metadata?: WebsiteMetadata): Promise<string | undefined> {
  if (!metadata?.icon) return undefined;
  const uri = `${directory}/${metadata.icon.path}`;
  const stat = await platform.fileSystem.stat(uri);
  return stat.exists && !stat.isDirectory && (stat.size == null || stat.size > 0 && stat.size <= 1024 * 1024) ? uri : undefined;
}

function enqueue(work: (signal: AbortSignal) => Promise<void>): Promise<void> | undefined {
  if (jobs.length >= 64) return undefined;
  const result = new Promise<void>(resolve => {
    jobs.push(() => {
      active++;
      const abort = new AbortController();
      const timer = setTimeout(() => abort.abort(), 8000);
      void work(abort.signal).catch(() => {}).finally(() => {
        clearTimeout(timer); active--; resolve(); next();
      });
    });
  });
  next();
  return result;
}
function next() { while (active < 4 && jobs.length) jobs.shift()!(); }

async function saveIcon(directory: string, downloaded: DownloadedWebsiteIcon, previous: WebsiteMetadata | undefined) {
  const sourceHash = await platform.deviceCrypto.sha256Hex(downloaded.bytes);
  if (sourceHash === previous?.icon?.sourceHash && await existingIcon(directory, previous)) return { path: previous.icon.path, sourceHash };
  const extension = extensions[downloaded.mime];
  if (!extension) throw new Error('invalid-icon');
  await platform.fileSystem.makeDirectory(directory, { intermediates: true, idempotent: true });
  const token = await platform.deviceCrypto.randomUUID();
  const staging = `${directory}/icon-input-${token}.${extension}`;
  let rendered: string | undefined;
  const output = `${directory}/icon-output-${token}.partial`;
  try {
    await platform.fileSystem.writeBytes(staging, downloaded.bytes);
    let path = `icon-${sourceHash}.png`;
    try {
      const { width, height } = await platform.imageManipulator.getDimensions(staging);
      if (!(width > 0 && height > 0 && Number.isFinite(width) && Number.isFinite(height))) throw new Error('invalid-icon-size');
      const scale = Math.min(1, 256 / width, 256 / height);
      rendered = (await platform.imageManipulator.renderAndSave(staging, {
        resize: { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }, format: 'png', quality: 1,
      })).uri;
      await platform.fileSystem.copy(rendered, output, { overwrite: true });
    } catch {
      // Keep formats already supported by the image view when a native converter cannot decode them.
      path = `icon-${sourceHash}.${extension}`;
      await platform.fileSystem.copy(staging, output, { overwrite: true });
    }
    try { await platform.fileSystem.move(output, `${directory}/${path}`); }
    catch (error) { if (!(await platform.fileSystem.stat(`${directory}/${path}`)).exists) throw error; }
    return { path, sourceHash };
  } finally {
    await platform.fileSystem.delete(staging, { idempotent: true }).catch(() => {});
    await platform.fileSystem.delete(output, { idempotent: true }).catch(() => {});
    if (rendered) await platform.fileSystem.delete(rendered, { idempotent: true }).catch(() => {});
  }
}

async function refresh(origin: string, directory: string, entry: Entry, previous: WebsiteMetadata | undefined, signal: AbortSignal) {
  const files = platform.fileSystem;
  try {
    let downloaded: DownloadedWebsiteIcon | undefined;
    const old = previous?.icon;
    if (old) {
      try {
        const response = await requestWebsiteIcon(old.url, MAX_ICON_BYTES, signal, entry.uri ? {
          ...(old.etag ? { etag: old.etag } : {}), ...(old.lastModified ? { lastModified: old.lastModified } : {}),
        } : undefined);
        if (response.status === 304 && await existingIcon(directory, previous)) {
          entry.expires = Date.now() + FRESH_FOR;
          await files.updateJson(`${directory}/metadata.json`, { checkedAt: Date.now(), refreshAfter: entry.expires,
            icon: { etag: validator(response.etag ?? null) ? response.etag ?? old.etag : old.etag,
              lastModified: validator(response.lastModified ?? null) ? response.lastModified ?? old.lastModified : old.lastModified } });
          return;
        }
        const mime = resourceMime(response.bytes);
        if (extensions[mime]) downloaded = { ...response, mime, url: old.url };
      } catch { /* Rediscover a moved icon, retaining the existing display while offline. */ }
    }
    downloaded ??= await discoverWebsiteIcon(origin, signal);
    if (!downloaded || signal.aborted) throw new Error('icon-unavailable');
    const { path, sourceHash } = await saveIcon(directory, downloaded, previous);
    if (signal.aborted) throw new Error('icon-cancelled');
    const now = Date.now();
    const icon: IconRecord = { path, sourceHash, url: downloaded.url,
      etag: validator(downloaded.etag ?? null) ? downloaded.etag ?? null : null,
      lastModified: validator(downloaded.lastModified ?? null) ? downloaded.lastModified ?? null : null };
    await files.updateJson(`${directory}/metadata.json`, {
      schemaVersion: 1, appId: origin, origin, checkedAt: now, refreshAfter: now + FRESH_FOR, icon,
    });
    entry.expires = now + FRESH_FOR;
    publish(origin, entry, `${directory}/${path}`);
    if (old && old.path !== path) {
      const current = await readMetadata(directory, origin);
      if (current?.icon?.path === path) await files.delete(`${directory}/${old.path}`, { idempotent: true }).catch(() => {});
    }
  } catch {
    entry.expires = Date.now() + RETRY_AFTER;
    // Persist the retry deadline without replacing a usable old icon.
    await files.makeDirectory(directory, { intermediates: true, idempotent: true });
    await files.updateJson(`${directory}/metadata.json`, {
      schemaVersion: 1, appId: origin, origin, checkedAt: Date.now(), refreshAfter: entry.expires,
    }).catch(() => {});
  }
}

async function load(origin: string, entry: Entry): Promise<string | undefined> {
  const directory = await directoryFor(origin);
  const metadata = await readMetadata(directory, origin);
  const uri = await existingIcon(directory, metadata);
  publish(origin, entry, uri);
  entry.expires = metadata?.refreshAfter ?? 0;
  if (entry.expires > Date.now() && (uri || !metadata?.icon)) return uri;
  if (!entry.refreshing) {
    entry.refreshing = enqueue(signal => refresh(origin, directory, entry, metadata, signal));
    if (entry.refreshing) void entry.refreshing.finally(() => { entry.refreshing = undefined; });
  }
  if (!uri) await entry.refreshing;
  return entry.uri;
}

export function loadWebsiteIcon(value: string): Promise<string | undefined> {
  const origin = websiteIconOrigin({ origin: value });
  if (!origin) return Promise.resolve(undefined);
  let entry = entries.get(origin);
  if (!entry) {
    if (entries.size >= 128) entries.delete(entries.keys().next().value!);
    entry = { expires: 0 }; entries.set(origin, entry);
  }
  if (entry.load) return entry.load;
  if (entry.refreshing && entry.uri) return Promise.resolve(entry.uri);
  if (entry.expires > Date.now()) return Promise.resolve(entry.uri);
  const current = entry;
  const task = load(origin, current).catch(() => { current.expires = Date.now() + RETRY_AFTER; return current.uri; });
  current.load = task;
  void task.finally(() => { if (current.load === task) current.load = undefined; });
  return task;
}

/** Recover a missing/corrupt local file, including one replaced by another desktop host. */
export async function retryWebsiteIcon(origin: string, uri: string): Promise<string | undefined> {
  const entry = entries.get(origin);
  if (entry?.uri !== uri) return entry?.uri;
  if ((entry.recoveryUntil ?? 0) > Date.now()) {
    publish(origin, entry, undefined); entry.expires = entry.recoveryUntil!;
    return undefined;
  }
  entry.recoveryUntil = Date.now() + RETRY_AFTER;
  publish(origin, entry, undefined); entry.expires = 0;
  try {
    const directory = await directoryFor(origin);
    const metadata = await readMetadata(directory, origin);
    if (metadata?.icon && `${directory}/${metadata.icon.path}` === uri)
      await platform.fileSystem.delete(uri, { idempotent: true });
    return await loadWebsiteIcon(origin);
  } catch { return undefined; }
}
