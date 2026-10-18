import { normalizeSigningSource } from '@/services/signing/source';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { verifyEvent, type Event } from 'nostr-tools';
import { decode, naddrEncode } from 'nostr-tools/nip19';
import { publicUrl, appShareAddress, parseManifest, type NappletRelease } from '@/services/napplet/protocol';
export type ExploreKind = 'napplet' | 'napp' | 'nsite' | 'website';
export type SiteFile = {
  path: string;
  hash: string;
  mime: string;
};
export type ExploreEntry = {
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
  release?: NappletRelease;
  files?: SiteFile[];
  required: string[];
  desktopPosition: number | null;
  lastUsedAt: number | null;
};
export type ApplicationInfo = Pick<ExploreEntry, 'title' | 'description' | 'servers' | 'icon' | 'required'> & {
  publisher?: string;
  origin?: string;
};
export function applicationPresentation(entry: ExploreEntry | NappletRelease): ApplicationInfo {
  return { title:entry.title,description:entry.description,required:entry.required,servers:entry.servers,icon:entry.icon,
    publisher:'event' in entry?entry.event.pubkey:entry.manifest?.pubkey,
    origin:'kind' in entry&&entry.kind==='website'?new URL(entry.address).origin:undefined };
}
export type GridApp = Pick<ExploreEntry, 'key' | 'title' | 'servers' | 'icon' | 'desktopPosition' | 'lastUsedAt'>;
export function websiteAddress(value: string): string {
  const url = new URL(value.includes('://') ? value : `https://${value}`);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || !url.hostname || value.length > 8192)
    throw new Error('napplets.invalid_manifest');
  return url.href;
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
  return { key, address: key, title: (tags('title')[0]?.[1] ?? tags('d')[0]?.[1] ?? '').slice(0, 200) || key,
    kind: event.kind === 35130 ? 'napp' : 'nsite', description: (tags('description')[0]?.[1] ?? event.content).slice(0, 16000),
    servers, manifest: event, files, required: [...new Set(tags('requires').map((t) => t[1]).filter(Boolean))],
    ...(iconFile && ['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(iconFile.mime) ? { icon: { hash: iconFile.hash, mime: iconFile.mime } } : {}),
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
  return { key, address: key, title: release.title, kind: 'napplet', description: release.description, servers: release.servers,
    icon: release.icon, manifest: release.event, release, required: release.required, desktopPosition: null, lastUsedAt: null };
}
