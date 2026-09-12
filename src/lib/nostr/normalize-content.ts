import { nip19 } from 'nostr-tools';

const MAX_NIP19_CHARS = 5_000;
const SUPPORTED_TYPES = new Set(['note', 'nevent', 'naddr', 'npub', 'nprofile']);

// Only whitespace-delimited tokens are candidates. This deliberately excludes
// identifiers embedded in URLs, Markdown destinations, punctuation, or other
// text rather than trying to reverse-engineer every possible URL grammar.
const BARE_NIP19_RE =
  /(^|\s)((?:note1|nevent1|naddr1|npub1|nprofile1)[a-z0-9]+)(?=\s|$)/gi;

/** Add the `nostr:` URI scheme to valid bare message tokens. Existing URIs and
 * identifiers embedded in other text remain byte-for-byte unchanged. */
export function normalizeBareNostrUris(content: string): string {
  return content.replace(BARE_NIP19_RE, (match, leading: string, token: string) => {
    if (token.length > MAX_NIP19_CHARS) return match;
    try {
      const decoded = nip19.decode(token.toLowerCase());
      if (!SUPPORTED_TYPES.has(decoded.type)) return match;
      return `${leading}nostr:${token}`;
    } catch {
      return match;
    }
  });
}
