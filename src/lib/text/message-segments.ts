import { parseNostrInput } from '@/lib/nostr/keys';
import {
  parseNostrEventReference,
  type NostrEventReference,
} from '@/lib/nostr/event-reference';

/**
 * Split a message body into renderable spans: plain text, tappable URLs, and
 * `nostr:` profile mentions, and public-event references. One ordered pass so a
 * message mixing prose, links, mentions, and event references renders each in
 * place.
 *
 * - URLs: `http(s)://…` and bare `www.…`; trailing sentence punctuation is left
 *   out of the link (kept as following text).
 * - Mentions: `nostr:npub1…` / `nostr:nprofile1…`, decoded to a hex pubkey; an
 *   undecodable token falls back to plain text.
 * - Events: `nostr:note1…` / `nostr:nevent1…` / `nostr:naddr1…`, decoded to a
 *   typed pointer; an undecodable token falls back to plain text.
 */
export type MessageSegment =
  | { type: 'text'; value: string }
  | { type: 'url'; value: string; href: string }
  | { type: 'mention'; value: string; pubkey: string }
  | { type: 'event'; value: string; reference: NostrEventReference };

export type MessageContentBlock =
  | { type: 'text'; segments: Exclude<MessageSegment, { type: 'event' }>[] }
  | { type: 'event'; reference: NostrEventReference }
  | { type: 'media'; value: string; href: string };

// A URL, nostr profile mention, or event reference. Global + case-insensitive;
// `lastIndex` is reset before each use (the regex instance is reused across calls).
const TOKEN_RE =
  /(?:https?:\/\/|www\.)\S+|nostr:(?:npub1|nprofile1|note1|nevent1|naddr1)[a-z0-9]+/gi;
// Trailing characters that read as sentence punctuation, not part of a URL.
const TRAILING = /[.,;:!?)\]}'"]+$/;

export function parseMessageSegments(input: string): MessageSegment[] {
  const segments: MessageSegment[] = [];
  let last = 0;
  TOKEN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TOKEN_RE.exec(input)) !== null) {
    const start = m.index;

    if (/^nostr:/i.test(m[0])) {
      const eventReference = parseNostrEventReference(m[0]);
      if (eventReference) {
        if (start > last) segments.push({ type: 'text', value: input.slice(last, start) });
        segments.push({ type: 'event', value: m[0], reference: eventReference });
        last = start + m[0].length;
        TOKEN_RE.lastIndex = last;
        continue;
      }

      let pubkey: string | null = null;
      try {
        pubkey = parseNostrInput(m[0]);
      } catch {
        pubkey = null;
      }
      if (!pubkey) continue; // undecodable — leave it for the next text slice
      if (start > last) segments.push({ type: 'text', value: input.slice(last, start) });
      segments.push({ type: 'mention', value: m[0], pubkey });
      last = start + m[0].length;
      TOKEN_RE.lastIndex = last;
      continue;
    }

    // URL — strip trailing punctuation back into the following text.
    let url = m[0];
    const trail = url.match(TRAILING)?.[0] ?? '';
    if (trail) url = url.slice(0, url.length - trail.length);
    if (!url) continue;
    if (start > last) segments.push({ type: 'text', value: input.slice(last, start) });
    const href = url.startsWith('www.') ? `https://${url}` : url;
    segments.push({ type: 'url', value: url, href });
    last = start + url.length;
    TOKEN_RE.lastIndex = last;
  }
  if (last < input.length) segments.push({ type: 'text', value: input.slice(last) });
  return segments;
}

/** Split parsed content into inline-text runs and rich block content. Media URLs
 * are supplied by the caller because their classification also consults event
 * tags. Whitespace directly around a block is layout separation rather than
 * visible bubble text, so it is trimmed without disturbing prose whitespace. */
export function splitMessageContentBlocks(
  segments: MessageSegment[],
  mediaUrls?: ReadonlySet<string>,
): MessageContentBlock[] {
  const blocks: MessageContentBlock[] = [];
  let inline: Exclude<MessageSegment, { type: 'event' }>[] = [];

  const flushInline = () => {
    if (inline.length === 0) return;
    const next = inline.map((segment) => ({ ...segment }));
    const first = next[0];
    if (first.type === 'text') first.value = first.value.replace(/^\s+/, '');
    const last = next[next.length - 1];
    if (last.type === 'text') last.value = last.value.replace(/\s+$/, '');
    const visible = next.filter((segment) => segment.type !== 'text' || segment.value.length > 0);
    if (visible.length > 0) blocks.push({ type: 'text', segments: visible });
    inline = [];
  };

  for (const segment of segments) {
    if (segment.type === 'event') {
      flushInline();
      blocks.push({ type: 'event', reference: segment.reference });
    } else if (segment.type === 'url' && mediaUrls?.has(segment.href)) {
      flushInline();
      blocks.push({ type: 'media', value: segment.value, href: segment.href });
    } else {
      inline.push(segment);
    }
  }
  flushInline();
  return blocks;
}

const SOLE_EVENT_RE = /^nostr:(?:note1|nevent1|naddr1)[a-z0-9]+$/i;

/** Return the decoded pointer when a message contains exactly one event
 * reference. Preview surfaces can replace the raw identifier with a label. */
export function soleEventReference(input: string): NostrEventReference | null {
  const trimmed = input.trim();
  if (!SOLE_EVENT_RE.test(trimmed)) return null;
  return parseNostrEventReference(trimmed);
}

const SOLE_MENTION_RE = /^nostr:(?:npub1|nprofile1)[a-z0-9]+$/i;

/**
 * If the message (trimmed) is *only* a single `nostr:` profile mention, return
 * its hex pubkey — the caller renders it as a profile card instead of text.
 * Otherwise null.
 */
export function soleMentionPubkey(input: string): string | null {
  const trimmed = input.trim();
  if (!SOLE_MENTION_RE.test(trimmed)) return null;
  try {
    return parseNostrInput(trimmed);
  } catch {
    return null;
  }
}
