import { normalizeSigningSource } from '@/services/signing/source';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { verifyEvent, type Event } from 'nostr-tools';
import { decode, naddrEncode, neventEncode } from 'nostr-tools/nip19';
import { parseNostrEventReference } from '@/lib/nostr/event-reference';
import { normalizeRelayUrls } from '@/lib/nostr/relay-url';
import { publicUrl, appShareAddress, parseManifest, type NappletRelease } from '@/services/napplet/protocol';
export type ExploreKind = 'napplet' | 'napp' | 'nsite' | 'website';
export const FAVORITES_PAGE_SIZE = 50;
export function needsFavoriteMetadata(entry: Pick<ExploreEntry, 'kind' | 'manifest' | 'local'>) { return entry.kind !== 'website' && !entry.local && !entry.manifest; }

type ApplicationAddressEntry = Pick<ExploreEntry, 'kind' | 'address' | 'manifest' | 'eventRelays'>;

export function applicationCopyAddress(entry: ApplicationAddressEntry): string {
  if (entry.address.startsWith('local~')) return entry.address;
  if (entry.kind === 'website') return entry.address;
  const reference = parseNostrEventReference(entry.address);
  const event = entry.manifest;
  const kind = event?.kind ?? reference?.kind;
  const author = event?.pubkey ?? reference?.author;
  const relays = normalizeRelayUrls([...(entry.eventRelays ?? []), ...(reference?.relays ?? [])]).slice(0, 8);
  if (!event && reference?.id) return neventEncode({ id: reference.id, author, kind, relays });
  if (kind !== undefined && author && (kind >= 10000 && kind < 20000 || kind >= 30000 && kind < 40000)) {
    const identifier = kind < 30000 ? '' : event?.tags.find(tag => tag[0] === 'd')?.[1] ?? reference?.identifier;
    if (identifier !== undefined) return naddrEncode({ kind, pubkey: author, identifier, relays });
  }
  const id = event?.id ?? reference?.id;
  if (id) return neventEncode({ id, author, kind, relays });
  return entry.address.trim().replace(/^nostr:/i, '');
}

export function applicationShareLink(entry: ApplicationAddressEntry): string {
  const address = applicationCopyAddress(entry);
  return entry.kind === 'website' ? address : `nostr:${address}`;
}
export const SUPPORTED_NAPP_DOMAINS = ['identity','network','storage','theme','link','relay','outbox','common','config','inc','ui','dev'];

export function applicationSigningSource(app: Pick<ExploreEntry, 'kind' | 'address' | 'key'>): string {
  return app.kind === 'website' ? new URL(app.address).origin : normalizeSigningSource(app.key);
}
export type SiteFile = {
  path: string;
  hash: string;
  mime: string;
};
export type ExploreEntry = {
  local?: { version: string; installer: string; actions: string[] };
  localIcon?: { account: string; appId: string; version: string; hash: string };
  key: string;
  address: string;
  title: string;
  kind: ExploreKind;
  description: string;
  servers: string[];
  icon?: {
    hash: string;
    mime: string;
  };
  manifest?: Event;
  /** Relays observed returning this exact manifest; address hints remain separate. */
  eventRelays?: string[];
  release?: NappletRelease;
  files?: SiteFile[];
  required: string[];
  desktopPosition: number | null;
  lastUsedAt: number | null;
};
export type ApplicationInfo = Pick<ExploreEntry, 'title' | 'description' | 'servers' | 'icon' | 'required' | 'files' | 'manifest' | 'localIcon'> & {
  local?: boolean;
  publisher?: string;
  origin?: string;
  kind?: ExploreKind;
};
export type ApplicationListEntry = Pick<ExploreEntry, 'title' | 'kind' | 'servers' | 'icon' | 'files' | 'manifest' | 'localIcon'> & { publisher?: string; key?: string; description?: string };
export function applicationListEntry(entry: ExploreEntry): ApplicationListEntry {
  return { key: entry.key, title: entry.title, description: entry.description, kind: entry.kind, servers: entry.servers, icon: entry.icon, localIcon: entry.localIcon, files: entry.files, manifest: entry.manifest, publisher: entry.manifest?.pubkey ?? entry.release?.event.pubkey };
}
export function applicationRequirements(kind: ExploreKind, declared: readonly string[]): string[] {
  return [...new Set([...(kind === 'napp' ? ['network'] : []), ...declared])];
}
export function applicationPresentation(entry: ExploreEntry | NappletRelease): ApplicationInfo {
  return { localIcon: 'localIcon' in entry ? entry.localIcon : undefined, local: 'local' in entry && !!entry.local, title:entry.title,description:entry.description,kind:'kind' in entry?entry.kind:'napplet',required:'kind' in entry ? applicationRequirements(entry.kind, entry.required) : entry.required,servers:entry.servers,icon:entry.icon,
    files:'files' in entry?entry.files:undefined,manifest:'event' in entry?entry.event:entry.manifest,
    publisher:'event' in entry?entry.event.pubkey:entry.manifest?.pubkey,
    origin:'kind' in entry&&entry.kind==='website'?new URL(entry.address).origin:undefined };
}
export type GridApp = Pick<ExploreEntry, 'key' | 'title' | 'servers' | 'icon' | 'desktopPosition' | 'lastUsedAt' | 'files' | 'manifest' | 'local' | 'localIcon'>;
export function websiteAddress(value: string): string {
  const url = new URL(value.includes('://') ? value : `https://${value}`);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || !url.hostname || value.length > 8192)
    throw new Error('napplets.invalid_manifest');
  return url.href;
}
export function websiteEntry(value: string): ExploreEntry {
  const address = websiteAddress(value);
  return { key: address, address, title: new URL(address).host, kind: 'website', description: '', servers: [], required: [], desktopPosition: null, lastUsedAt: null };
}
export function sitePath(value: string): string {
  if (!value.startsWith('/') || value.startsWith('//') || /[?#\\\u0000-\u001f]/.test(value) || value.split('/').some((s) => ['.', '..'].includes(s)))
    throw new Error('napplets.invalid_manifest');
  const url = new URL(value, 'https://site.invalid');
  if (decodeURIComponent(url.pathname) !== value || url.pathname !== value)
    throw new Error('napplets.invalid_manifest');
  return value;
}
export function fileMime(path: string): string {
  const types: Record<string, string> = { html: 'text/html', htm: 'text/html', js: 'text/javascript', mjs: 'text/javascript', css: 'text/css', json: 'application/json', svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', ico: 'image/x-icon', woff: 'font/woff', woff2: 'font/woff2', wasm: 'application/wasm', txt: 'text/plain' };
  return types[path.split('.').pop()!.toLowerCase()] ?? 'application/octet-stream';
}
export function parseSite(input: Event): ExploreEntry {
  // Verification caches on foreign objects are never an authority boundary.
  const event: Event = { id: input.id, pubkey: input.pubkey, sig: input.sig, kind: input.kind, created_at: input.created_at, content: input.content, tags: input.tags };
  if (!Number.isSafeInteger(event.created_at) || event.created_at < 0 || ![15128, 35128, 35130].includes(event.kind) || !Array.isArray(event.tags) || event.tags.length > 1024 || JSON.stringify(event).length > 256 * 1024 || !verifyEvent(event))
    throw new Error('napplets.invalid_manifest');
  const tags = (key: string) => event.tags.filter((t) => t[0] === key);
  const named = event.kind !== 15128;
  if (named ? tags('d').length !== 1 || !tags('d')[0][1] : tags('d').length !== 0)
    throw new Error('napplets.invalid_manifest');
  const files = tags('path').map((t) => {
    if (!/^[a-f0-9]{64}$/.test(t[2] ?? ''))
      throw new Error('napplets.invalid_manifest');
    const path = sitePath(t[1]);
    return { path, hash: t[2], mime: fileMime(path) };
  });
  if (!files.length || files.length > 512 || !files.some((f) => f.path === '/index.html') || new Set(files.map((f) => f.path)).size !== files.length)
    throw new Error('napplets.invalid_manifest');
  const aggregate = tags('x').find((t) => t[2] === 'aggregate');
  if (aggregate) {
    const lines = [...files].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0).map((f) => `${f.hash} ${f.path}\n`).join('');
    if (bytesToHex(sha256(new TextEncoder().encode(lines))) !== aggregate[1])
      throw new Error('napplets.invalid_manifest');
  }
  const key = naddrEncode({ kind: event.kind, pubkey: event.pubkey, identifier: tags('d')[0]?.[1] ?? '' });
  const servers = [...new Set(tags('server').map((t) => publicUrl(t[1])))].slice(0, 8);
  const iconFile = files.find((f) => f.path === tags('icon')[0]?.[1]);
  // Napps are web applications; their normal network access must be visible in host consent.
  const required = applicationRequirements(event.kind === 35130 ? 'napp' : 'nsite', tags('requires').map(tag => tag[1]).filter(Boolean));
  return { key, address: key, title: (tags('title')[0]?.[1] ?? tags('d')[0]?.[1] ?? '').slice(0, 200) || key,
    kind: event.kind === 35130 ? 'napp' : 'nsite', description: (tags('description')[0]?.[1] ?? event.content).slice(0, 16000),
    servers, manifest: event, files, required,
    ...(iconFile && ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml', 'image/x-icon'].includes(iconFile.mime) ? { icon: { hash: iconFile.hash, mime: iconFile.mime } } : {}),
    desktopPosition: null, lastUsedAt: null };
}
export function signedAddress(value: string) {
  const input = value.trim().replace(/^nostr:/, '');
  const parsed = decode(input);
  if (parsed.type !== 'naddr' || ![15128, 35128, 35130].includes(parsed.data.kind))
    return null;
  return { source: naddrEncode({ kind: parsed.data.kind, pubkey: parsed.data.pubkey, identifier: parsed.data.identifier }),
    filter: { kinds: [parsed.data.kind], authors: [parsed.data.pubkey], ...(parsed.data.kind === 15128 ? {} : { '#d': [parsed.data.identifier] }) },
    relays: (parsed.data.relays ?? []).slice(0, 4), author: parsed.data.pubkey };
}

/** Keep shortcut membership while trimming the bounded recent-address cache. */
export function withVisit(entries: readonly ExploreEntry[], app: ExploreEntry, at: number): ExploreEntry[] {
  const previous=entries.find(entry=>entry.key===app.key);
  const updated={...app,desktopPosition:previous?previous.desktopPosition:app.desktopPosition,lastUsedAt:at};
  const next=[updated,...entries.filter(entry=>entry.key!==app.key)];
  const recent=new Set(next.filter(entry=>entry.lastUsedAt!==null)
    .sort((a,b)=>b.lastUsedAt!-a.lastUsedAt!||(a.key<b.key?-1:a.key>b.key?1:0)).slice(0,512).map(entry=>entry.key));
  return next.flatMap(entry=>recent.has(entry.key)?[entry]:entry.desktopPosition!==null?[{...entry,lastUsedAt:null}]:[]);
}

export function fromNapplet(release: ReturnType<typeof parseManifest>): ExploreEntry {
  const key = normalizeSigningSource(appShareAddress(release));
  return { key, address: key, title: release.title, kind: 'napplet', description: release.description, servers: release.servers, eventRelays: release.eventRelays,
    icon: release.icon, manifest: release.event, release, required: release.required, desktopPosition: null, lastUsedAt: null };
}

/** Preserve settled row identities when a cache check changes only freshness metadata. */
export function mergeApplicationEntries(previous: ExploreEntry[], incoming: ExploreEntry[]): ExploreEntry[] {
  const pending = new Map(incoming.map(entry => [entry.key, entry]));
  let changed = previous.length !== incoming.length;
  const result: ExploreEntry[] = [];
  for (const entry of previous) {
    const updated = pending.get(entry.key);
    pending.delete(entry.key);
    if (!updated) { changed = true; continue; }
    const same = entry === updated || entry.manifest?.id === updated.manifest?.id && entry.title === updated.title && entry.kind === updated.kind &&
      entry.description === updated.description && entry.icon?.hash === updated.icon?.hash && entry.icon?.mime === updated.icon?.mime &&
      entry.local?.version === updated.local?.version && entry.local?.installer === updated.local?.installer &&
      (entry.local?.actions === updated.local?.actions || (entry.local?.actions.length ?? 0) === (updated.local?.actions.length ?? 0) &&
        (entry.local?.actions ?? []).every((action, index) => action === updated.local?.actions[index])) &&
      entry.localIcon?.account === updated.localIcon?.account && entry.localIcon?.appId === updated.localIcon?.appId &&
      entry.localIcon?.version === updated.localIcon?.version && entry.localIcon?.hash === updated.localIcon?.hash &&
      (entry.required === updated.required || (entry.required?.length ?? 0) === (updated.required?.length ?? 0) &&
        (entry.required ?? []).every((value, index) => value === updated.required?.[index])) &&
      (entry.files === updated.files || (entry.files?.length ?? 0) === (updated.files?.length ?? 0) &&
        (entry.files ?? []).every((file, index) => file.path === updated.files?.[index].path && file.hash === updated.files?.[index].hash && file.mime === updated.files?.[index].mime)) &&
      entry.address === updated.address && entry.desktopPosition === updated.desktopPosition && entry.lastUsedAt === updated.lastUsedAt &&
      entry.servers.length === updated.servers.length && entry.servers.every((server, index) => server === updated.servers[index]) &&
      (entry.eventRelays?.length ?? 0) === (updated.eventRelays?.length ?? 0) &&
      (entry.eventRelays ?? []).every((relay, index) => relay === updated.eventRelays?.[index]);
    result.push(same ? entry : updated);
    changed ||= !same;
  }
  result.push(...pending.values());
  return changed ? result : previous;
}
