import { nip19 } from 'nostr-tools';

const NIP19_MAX_CHARS = 5_000;

export type NostrEventReference = {
  /** Original bech32 identifier without the `nostr:` URI prefix. */
  bech32: string;
  /** Relay hints carried by nevent/naddr, left untrusted until fetch time. */
  relays: string[];
  /** Event id for note/nevent pointers. */
  id?: string;
  /** Author hint for nevent, required author for naddr. */
  author?: string;
  /** Optional nevent kind hint, required naddr kind. */
  kind?: number;
  /** Addressable event's `d` tag value. */
  identifier?: string;
};

/** Decode the three public-event NIP-19 identifiers accepted in message text. */
export function parseNostrEventReference(input: string): NostrEventReference | null {
  const bech32 = input.trim().replace(/^nostr:/i, '').toLowerCase();
  if (bech32.length > NIP19_MAX_CHARS) return null;
  if (!/^(?:note1|nevent1|naddr1)[a-z0-9]+$/.test(bech32)) return null;

  try {
    const decoded = nip19.decode(bech32);
    if (decoded.type === 'note') {
      return { bech32, id: decoded.data, relays: [] };
    }
    if (decoded.type === 'nevent') {
      return {
        bech32,
        id: decoded.data.id,
        author: decoded.data.author,
        kind: decoded.data.kind,
        relays: decoded.data.relays ?? [],
      };
    }
    if (decoded.type === 'naddr') {
      return {
        bech32,
        author: decoded.data.pubkey,
        kind: decoded.data.kind,
        identifier: decoded.data.identifier,
        relays: decoded.data.relays ?? [],
      };
    }
  } catch {
    // Invalid bech32 stays ordinary message text.
  }
  return null;
}
