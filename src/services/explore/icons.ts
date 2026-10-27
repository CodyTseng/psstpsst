import { base64 } from '@scure/base';
import { resourceMime, type NappletRelease } from '@/services/napplet/protocol';
import { loadSiteBlob, loadIcon, recordArtifactIcon } from '@/services/napplet/artifacts';
import type { SiteFile } from './model';
import type { Event } from 'nostr-tools';
import { loadWebsiteIcon, websiteIconOrigin } from './website-icons';
export { loadWebsiteIcon, websiteIconOrigin } from './website-icons';

export type WebsiteIconSource = { origin?: string; key?: string };
export type ApplicationIconSource = Pick<NappletRelease, 'icon' | 'servers'> & WebsiteIconSource & {
  localIcon?: { account: string; appId: string; version: string; hash: string };
  manifest?: Pick<Event, 'id' | 'kind' | 'pubkey' | 'tags'>;
  files?: readonly SiteFile[];
};

const MAX_ICON_BYTES = 512 * 1024;

const cache = new Map<string, { expires: number; value: Promise<string | undefined> }>();
const jobs: (() => void)[] = [];
let active = 0;
const next = () => { if (active < 4) jobs.shift()?.(); };

function cachedIcon(key: string, load: (signal: AbortSignal) => Promise<string | undefined>): Promise<string | undefined> {
  const cached = cache.get(key);
  if (cached && cached.expires > Date.now()) return cached.value;
  if (jobs.length >= 64) return Promise.resolve(undefined);
  if (cache.size >= 128) cache.delete(cache.keys().next().value!);
  const entry = { expires: Infinity, value: Promise.resolve<string | undefined>(undefined) };
  entry.value = new Promise(resolve => {
    jobs.push(() => {
      active++;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      void load(controller.signal)
        .catch(() => undefined)
        .then(value => {
          entry.expires = Date.now() + (value ? 60 : 5) * 60000;
          resolve(value);
        })
        .finally(() => { clearTimeout(timer); active--; next(); });
    });
    next();
  });
  cache.set(key, entry);
  return entry.value;
}

export function applicationIconKey(source: ApplicationIconSource): string {
  if (source.localIcon) return JSON.stringify(source.localIcon);
  return websiteIconOrigin(source) ?? source.manifest?.id ?? `${source.icon?.hash ?? ''}:${source.icon?.mime ?? ''}`;
}

/** Signed sites use declared artwork or one conventional file, without reading page metadata. */
export function loadApplicationIcon(source: ApplicationIconSource): Promise<string | undefined> {
  if (source.localIcon) {
    const icon = source.localIcon;
    return cachedIcon(JSON.stringify(icon), async signal => {
      const { loadLocalFile } = await import('./local-applications');
      const bytes = await loadLocalFile(icon.account, icon.appId, icon.version, icon.hash, signal, MAX_ICON_BYTES);
      const mime = resourceMime(bytes);
      return /^image\//.test(mime) ? `data:${mime};base64,${base64.encode(bytes)}` : undefined;
    });
  }
  const origin = websiteIconOrigin(source);
  if (origin) return loadWebsiteIcon(origin);
  if (!source.files || !source.manifest) return loadIcon(source);
  return cachedIcon(`site:${source.manifest.id}`, async signal => {
    if (source.icon) return loadIcon(source);
    for (const path of ['/favicon.svg', '/favicon.png', '/favicon.ico']) {
      const file = source.files!.find(file => file.path === path);
      if (!file) continue;
      const bytes = await loadSiteBlob(source, file.hash, signal, MAX_ICON_BYTES);
      const mime = resourceMime(bytes);
      if (!['image/x-icon', 'image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml'].includes(mime)) return undefined;
      await recordArtifactIcon(source, file.hash);
      return `data:${mime};base64,${base64.encode(bytes)}`;
    }
    return undefined;
  });
}
