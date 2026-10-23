import { verifyEvent, type Event, type EventTemplate, type Filter } from 'nostr-tools';
import type { ExploreEntry } from './model';

export const COMMENT_KIND = 1111;
export const MAX_COMMENT_LENGTH = 4000;
const hex = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
export type CommentTarget = { key: string; tag: 'A' | 'E' | 'I'; value: string; kind: string; author?: string; eventId?: string };
export type ApplicationComment = { event: Event; parentId?: string };

/** Addressable applications retain one discussion across signed manifest updates. */
export function applicationCommentTarget(entry: ExploreEntry): CommentTarget | undefined {
  if (entry.kind === 'website') {
    try {
      const url = new URL(entry.address);
      if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.href.length > 4096) return undefined;
      return { key: `I:${url.href}`, tag: 'I', value: url.href, kind: 'web' };
    } catch { return undefined; }
  }
  const event = entry.manifest ?? entry.release?.event;
  if (!event || !hex(event.id) || !hex(event.pubkey) || ![5129, 15129, 35129, 35130, 15128, 35128].includes(event.kind)) return undefined;
  const tag = event.kind === 5129 ? 'E' : 'A';
  const identifier = event.kind >= 30000 ? event.tags.find(tag => tag[0] === 'd')?.[1] ?? '' : '';
  const value = tag === 'E' ? event.id : `${event.kind}:${event.pubkey}:${identifier}`;
  return { key: `${tag}:${value}`, tag, value, kind: String(event.kind), author: event.pubkey, eventId: event.id };
}

export function commentFilter(target: CommentTarget, limit: number, until?: number): Filter {
  return { kinds: [COMMENT_KIND], [`#${target.tag}`]: [target.value], limit, ...(until === undefined ? {} : { until }) };
}

function references(tags: string[][], key: string, value: string): boolean {
  return tags.some(tag => tag[0] === key && tag[1] === value);
}

/** Bound live-queue memory before retaining untrusted relay payloads. */
export function isCommentCandidate(input: Event): boolean {
  if (!input || input.kind !== COMMENT_KIND || !hex(input.id) || !hex(input.pubkey) ||
    typeof input.sig !== 'string' || !/^[a-f0-9]{128}$/.test(input.sig) ||
    !Number.isSafeInteger(input.created_at) || input.created_at < 0 ||
    typeof input.content !== 'string' || !input.content.trim() || input.content.length > MAX_COMMENT_LENGTH ||
    !Array.isArray(input.tags) || input.tags.length > 64 ||
    input.tags.some(tag => !Array.isArray(tag) || tag.length > 8 || tag.some(value => typeof value !== 'string' || value.length > 8192))) return false;
  let size = input.content.length;
  for (const tag of input.tags) for (const value of tag) {
    size += value.length;
    if (size > 64 * 1024) return false;
  }
  return true;
}

/** Copy before verification: foreign verification-cache symbols never grant trust. */
export function parseApplicationComment(input: Event, target: CommentTarget, now = Math.floor(Date.now() / 1000)): ApplicationComment | undefined {
  if (!isCommentCandidate(input) || input.created_at > now + 600) return undefined;
  const event: Event = { id: input.id, pubkey: input.pubkey, sig: input.sig, kind: input.kind,
    created_at: input.created_at, content: input.content, tags: input.tags.map(tag => [...tag]) };
  const tags = event.tags;
  if (!references(tags, target.tag, target.value) || !references(tags, 'K', target.kind) ||
    (target.author && !references(tags, 'P', target.author))) return undefined;
  const parentKind = tags.filter(tag => tag[0] === 'k');
  if (parentKind.length !== 1) return undefined;
  let parentId: string | undefined;
  if (parentKind[0][1] === String(COMMENT_KIND)) {
    const parents = tags.filter(tag => tag[0] === 'e');
    if (parents.length !== 1 || !hex(parents[0][1]) || parents[0][1] === event.id ||
      !tags.some(tag => tag[0] === 'p' && hex(tag[1])) ||
      (parents[0][3] && (!hex(parents[0][3]) || !references(tags, 'p', parents[0][3])))) return undefined;
    parentId = parents[0][1];
  } else {
    if (parentKind[0][1] !== target.kind || !references(tags, target.tag.toLowerCase(), target.value) ||
      (target.author && !references(tags, 'p', target.author))) return undefined;
  }
  try { return verifyEvent(event) ? { event, parentId } : undefined; }
  catch { return undefined; }
}

export function commentTemplate(target: CommentTarget, content: string, parent?: ApplicationComment): EventTemplate {
  const text = content.trim();
  if (!text || text.length > MAX_COMMENT_LENGTH) throw new Error('invalid-comment');
  const tags: string[][] = [[target.tag, target.value], ['K', target.kind]];
  if (target.tag === 'E' && target.author) tags[0].push('', target.author);
  if (target.author) tags.push(['P', target.author]);
  if (parent) {
    tags.push(['e', parent.event.id, '', parent.event.pubkey], ['k', String(COMMENT_KIND)], ['p', parent.event.pubkey]);
  } else {
    const reference = [target.tag.toLowerCase(), target.value];
    if (target.tag === 'E' && target.author) reference.push('', target.author);
    tags.push(reference, ['k', target.kind]);
    if (target.author) tags.push(['p', target.author]);
    if (target.tag === 'A' && target.eventId) tags.push(['e', target.eventId, '', target.author!]);
  }
  return { kind: COMMENT_KIND, content: text, tags, created_at: Math.floor(Date.now() / 1000) };
}
