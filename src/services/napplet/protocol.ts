import { randomBytes, bytesToHex } from '@noble/hashes/utils.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { verifyEvent, type Event, type Filter } from 'nostr-tools';
import { decode, naddrEncode, neventEncode } from 'nostr-tools/nip19';

export const NAP_DOMAINS = [
  'shell',
  'theme',
  'storage',
  'resource',
  'upload',
  'link',
  'identity',
  'intent',
  'relay',
  'outbox',
  'inc',
  'config',
] as const;
export const MARKET_RELAYS = [
  'wss://relay.napplet.soy/',
  'wss://nos.lol/',
  'wss://relay.ditto.pub/',
];
export const MAX_ARTIFACT_BYTES = 25 * 1024 * 1024;
export const MAX_RESOURCE_BYTES = 10 * 1024 * 1024;
export type NappletRelease = {
  key: string;
  event: Event;
  eventRelays?: string[];
  hash: string;
  title: string;
  description: string;
  required: string[];
  optional: string[];
  servers: string[];
  icon?: { hash: string; mime: string };
  intents: { convention: string; params: string[] }[];
};
export type NappletInstallation = NappletRelease & {
  lastUsedAt: number | null;
  desktopPosition: number | null;
  previousManifest: string | null;
};
export function randomId(): string {
  return bytesToHex(randomBytes(16));
}

export function parseManifest(input: unknown): NappletRelease {
  const source = input as Event;
  const event: Event = source && {
    id: source.id,
    pubkey: source.pubkey,
    sig: source.sig,
    kind: source.kind,
    created_at: source.created_at,
    content: source.content,
    tags: source.tags,
  };
  if (
    !event ||
    ![5129, 15129, 35129].includes(event.kind) ||
    !Array.isArray(event.tags) ||
    !/^[a-f0-9]{64}$/.test(event.pubkey) ||
    !/^[a-f0-9]{64}$/.test(event.id) ||
    !/^[a-f0-9]{128}$/.test(event.sig) ||
    eventWeight(event) > 256 * 1024 ||
    !Number.isSafeInteger(event.created_at) ||
    event.created_at < 0 ||
    event.tags.length > 512 ||
    typeof event.content !== 'string' ||
    event.content.length > 16000 ||
    !verifyEvent(event)
  )
    throw new Error('applications.invalid_manifest');
  const tags = (name: string) => event.tags.filter((tag) => tag[0] === name);
  const hashes = tags('x');
  const ds = tags('d');
  if (event.kind === 35129 ? ds.length !== 1 || !ds[0][1] : ds.length !== 0)
    throw new Error('applications.invalid_manifest');
  // Select the signed format once; a malformed standalone listing cannot downgrade.
  const legacy = !hashes.some((tag) => tag.length === 2) &&
    (tags('path').length > 0 || hashes.some((tag) => tag[2] === 'aggregate'));
  let artifactHash: string;
  let description: string;
  if (legacy) {
    const paths = tags('path');
    if (paths.length !== 1 || paths[0].length !== 3 || paths[0][1] !== '/index.html' ||
        !/^[a-f0-9]{64}$/.test(paths[0][2]) || tags('R').length || tags('O').length ||
        tags('description').length > 1 || hashes.length > 1 || (event.kind === 5129 && hashes.length !== 1))
      throw new Error('applications.invalid_manifest');
    artifactHash = paths[0][2];
    const aggregate = bytesToHex(sha256(new TextEncoder().encode(`${artifactHash} /index.html\n`)));
    if (hashes.length && (hashes[0].length !== 3 || hashes[0][2] !== 'aggregate' || hashes[0][1] !== aggregate))
      throw new Error('applications.invalid_manifest');
    description = tags('description')[0]?.[1] ?? '';
    if (description.length > 16000) throw new Error('applications.invalid_manifest');
  } else {
    if (hashes.length !== 1 || hashes[0].length !== 2 || !/^[a-f0-9]{64}$/.test(hashes[0][1]) ||
        !event.content.trim() || tags('path').length || tags('requires').length || tags('description').length)
      throw new Error('applications.invalid_manifest');
    artifactHash = hashes[0][1];
    description = event.content;
  }
  const domains = (name: string) => [...new Set(tags(name).map((tag) => {
    if (tag.length !== 2) throw new Error('applications.invalid_manifest');
    return tag[1];
  }))];
  const required = domains(legacy ? 'requires' : 'R');
  const optional = legacy ? [] : domains('O');
  if (
    [...required, ...optional].some(
      (d) => typeof d !== 'string' || !/^[a-z][a-z0-9-]*$/.test(d),
    )
  )
    throw new Error('applications.invalid_manifest');
  const icon = tags('icon')[0];
  return {
    key:
      event.kind === 5129
        ? `5129:${event.id}`
        : `${event.kind}:${event.pubkey}:${ds[0]?.[1] ?? ''}`,
    event,
    hash: artifactHash,
    title:
      tags('title')[0]?.[1]?.slice(0, 160) || ds[0]?.[1]?.slice(0, 160) || event.id.slice(0, 8),
    description,
    required,
    optional,
    servers: tags('server')
      .map((t) => t[1])
      .filter((v) => {
        try {
          publicUrl(v);
          return true;
        } catch {
          return false;
        }
      })
      .slice(0, 8),
    icon:
      icon &&
      /^[a-f0-9]{64}$/.test(icon[1]) &&
      ['image/png', 'image/jpeg', 'image/webp'].includes(icon[2])
        ? { hash: icon[1], mime: icon[2] }
        : undefined,
    intents: tags('i')
      .slice(0, 32)
      .filter((t) => /^napplet:[a-z0-9-]+\/[a-z0-9-]+$/.test(t[1]))
      .map((t) => ({ convention: t[1], params: t.slice(2) })),
  };
}

/** Conservative byte accounting avoids materializing a second serialized event. */
export function eventWeight(event: Event): number {
  if (typeof event.content !== 'string' || !Array.isArray(event.tags)) return Infinity;
  let size = 512 + event.content.length * 3;
  for (const tag of event.tags) {
    if (!Array.isArray(tag)) return Infinity;
    for (const value of tag) {
      if (typeof value !== 'string') return Infinity;
      size += value.length * 3 + 8;
    }
  }
  return size;
}

/** URL syntax policy complements the adapter's connection-time DNS enforcement. */
export function publicUrl(value: string, websocket = false): string {
  const url = new URL(value);
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (
    value.length > 4096 ||
    url.protocol !== (websocket ? 'wss:' : 'https:') ||
    url.username ||
    url.password ||
    (url.port && url.port !== '443') ||
    !host.includes('.') ||
    host.includes(':') ||
    /^(?:0|10|127|169\.254|192\.168|172\.(?:1[6-9]|2\d|3[01]))\./.test(host) ||
    /\.(?:local|localhost|internal|home|test|invalid)$/.test(host)
  )
    throw new Error('blocked-by-policy');
  url.hash = '';
  return url.toString();
}

export function parseAppAddress(value: string): { filters: Filter[]; relays: string[]; author?: string } {
  if (value.length > 8192) throw new Error('applications.invalid_manifest');
  const match = value.trim().match(/(?:naddr|nevent|note)1[023456789acdefghjklmnpqrstuvwxyz]+/i);
  const code = match?.[0] ?? value.trim().replace(/^nostr:/, '');
  if (/^[a-f0-9]{64}$/.test(code)) return { filters: [{ ids: [code] }], relays: [] };
  const decoded = decode(code);
  if (decoded.type === 'naddr' && [15129, 35129].includes(decoded.data.kind))
    return {
      author: decoded.data.pubkey,
      filters: [
        {
          kinds: [decoded.data.kind],
          authors: [decoded.data.pubkey],
          ...(decoded.data.kind === 35129 ? { '#d': [decoded.data.identifier] } : {}),
        },
      ],
      relays: (decoded.data.relays ?? []).map((v) => publicUrl(v, true)).slice(0, 4),
    };
  if (decoded.type === 'nevent')
    return {
      author: decoded.data.author,
      filters: [{ ids: [decoded.data.id] }],
      relays: (decoded.data.relays ?? []).map((v) => publicUrl(v, true)).slice(0, 4),
    };
  if (decoded.type === 'note') return { filters: [{ ids: [decoded.data] }], relays: [] };
  throw new Error('applications.invalid_manifest');
}

export function resourceMime(bytes: Uint8Array): string {
  if (bytes.length >= 6 && bytes[0] === 0 && bytes[1] === 0 && bytes[2] === 1 && bytes[3] === 0 && (bytes[4] || bytes[5])) return 'image/x-icon';
  const head = new TextDecoder().decode(bytes.slice(0, 512));
  if (bytes[0] === 137 && head.slice(1, 4) === 'PNG') return 'image/png';
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  if (/^GIF8[79]a/.test(head)) return 'image/gif';
  if (head.startsWith('RIFF') && head.slice(8, 12) === 'WEBP') return 'image/webp';
  if (head.startsWith('wOF2')) return 'font/woff2';
  if (head.startsWith('wOFF')) return 'font/woff';
  if (/^\s*(?:<\?xml[^>]*>\s*)?<svg[\s>]/i.test(head)) return 'image/svg+xml';
  const large = bytes.length > 65536;
  const text = new TextDecoder('utf-8', { fatal: !large }).decode(
    large ? bytes.subarray(0, 65536) : bytes,
  );
  if (/[<>\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text)) throw new Error('blocked-by-policy');
  if (large && /^[\s]*[\[{]/.test(text)) return 'application/json';
  try {
    JSON.parse(text);
    return 'application/json';
  } catch {
    return 'text/plain';
  }
}

/** Share stable app addresses while retaining immutable snapshot identifiers. */
export function appShareAddress(release: NappletRelease): string {
  const event = release.event;
  const address = event.kind === 5129 ? neventEncode({ id: event.id, author: event.pubkey, kind: event.kind, relays: release.eventRelays }) : naddrEncode({
    kind: event.kind, pubkey: event.pubkey,
    identifier: event.kind === 35129 ? event.tags.find((tag) => tag[0] === 'd')?.[1] ?? '' : '',
    relays: release.eventRelays,
  });
  return `nostr:${address}`;
}
