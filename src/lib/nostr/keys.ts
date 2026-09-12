import { generateSecretKey, getPublicKey, nip19 } from 'nostr-tools';
import { bytesToHex, hexToBytes } from 'nostr-tools/utils';

export type Keypair = {
  privkey: Uint8Array;
  pubkey: string;
};

export function generateKeypair(): Keypair {
  const privkey = generateSecretKey();
  return { privkey, pubkey: getPublicKey(privkey) };
}

export function nsecToPrivkey(nsec: string): Uint8Array {
  const decoded = nip19.decode(nsec);
  if (decoded.type !== 'nsec') {
    throw new Error(`Expected nsec, got ${decoded.type}`);
  }
  return decoded.data;
}

export function privkeyToNsec(privkey: Uint8Array): string {
  return nip19.nsecEncode(privkey);
}

export function npubToPubkey(npub: string): string {
  const decoded = nip19.decode(npub);
  if (decoded.type !== 'npub') {
    throw new Error(`Expected npub, got ${decoded.type}`);
  }
  return decoded.data;
}

export function pubkeyToNpub(pubkey: string): string {
  return nip19.npubEncode(pubkey);
}

export type ParsedNostrProfileInput = {
  pubkey: string;
  relays: string[];
};

/**
 * Resolve a user-supplied identifier to a 64-char hex pubkey. Accepts:
 *   - `npub1…` / `nostr:npub1…`
 *   - `nprofile1…` / `nostr:nprofile1…` (uses the embedded pubkey)
 *   - bare 64-char hex
 * Throws if the input can't be resolved to a pubkey. Used by new-chat,
 * search-user, and QR scan flows.
 */
export function parseNostrInput(input: string): string {
  return parseNostrProfileInput(input).pubkey;
}

export function parseNostrProfileInput(input: string): ParsedNostrProfileInput {
  const trimmed = input.trim().replace(/^nostr:/i, '');
  if (/^[0-9a-f]{64}$/i.test(trimmed)) return { pubkey: trimmed.toLowerCase(), relays: [] };
  const decoded = nip19.decode(trimmed);
  if (decoded.type === 'npub') return { pubkey: decoded.data, relays: [] };
  if (decoded.type === 'nprofile') return { pubkey: decoded.data.pubkey, relays: decoded.data.relays ?? [] };
  throw new Error(`Expected npub or nprofile, got ${decoded.type}`);
}

export { bytesToHex, hexToBytes };
