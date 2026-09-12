import { nip05 as nip05utils } from 'nostr-tools';

const HEX_PUBKEY_RE = /^[0-9a-f]{64}$/;
const NIP05_LOCAL_PART_RE = /^[a-z0-9._-]+$/;

/** The app's own NIP-05 hosting service. A bare name in user search resolves
 * against this domain, and the registration service binds names on it. */
export const NIP05_SERVICE_DOMAIN = 'psstpsst.chat';
export const NIP05_SERVICE_BASE_URL = `https://${NIP05_SERVICE_DOMAIN}`;

/** A bare local part (no `@domain`) — eligible for the service-domain fallback. */
const BARE_NAME_RE = /^[a-z0-9][a-z0-9._-]*$/i;

/** Expand a bare local part to an identifier on the app's own NIP-05 domain.
 * Returns null for input that already is (or cannot become) an identifier. */
export function expandBareNip05Name(input: string): string | null {
  const name = input.trim().toLowerCase();
  if (!name || name.includes('@') || /\s/.test(name)) return null;
  return BARE_NAME_RE.test(name) ? `${name}@${NIP05_SERVICE_DOMAIN}` : null;
}

export type ResolvedNip05Profile = {
  identifier: string;
  pubkey: string;
  relays?: string[];
};

export function normalizeNip05Identifier(input: string): string | null {
  const identifier = input.trim();
  if (!identifier || /\s/.test(identifier)) return null;
  const separator = identifier.indexOf('@');
  if (separator <= 0 || separator !== identifier.lastIndexOf('@')) return null;
  if (!NIP05_LOCAL_PART_RE.test(identifier.slice(0, separator))) return null;
  const normalized = identifier.toLowerCase();
  return nip05utils.isNip05(normalized) ? normalized : null;
}

export function isNip05Identifier(input: string): boolean {
  return normalizeNip05Identifier(input) !== null;
}

export async function queryNip05Profile(input: string): Promise<ResolvedNip05Profile | null> {
  const identifier = normalizeNip05Identifier(input);
  if (!identifier) return null;

  let profile: Awaited<ReturnType<typeof nip05utils.queryProfile>>;
  try {
    profile = await nip05utils.queryProfile(identifier);
  } catch {
    return null;
  }
  if (!profile) return null;

  const pubkey = profile.pubkey?.toLowerCase();
  if (!pubkey || !HEX_PUBKEY_RE.test(pubkey)) return null;

  return { identifier, pubkey, relays: profile.relays };
}
