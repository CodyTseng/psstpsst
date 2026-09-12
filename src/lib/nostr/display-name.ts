import { abbreviateNpub, abbreviatePubkey } from './format';
import { pubkeyToNpub } from './keys';

/**
 * Name-bearing fields used to resolve which name to show for a pubkey.
 * Structurally compatible with both a `profiles` DB row and a parsed kind-0
 * profile; `petname` is the local nickname from the `contacts` table.
 */
export type DisplayNameSource = {
  /** Local nickname set by the user (contacts table). Highest priority. */
  petname?: string | null;
  /** kind-0 `display_name`. */
  displayName?: string | null;
  /** kind-0 `name`. */
  name?: string | null;
};

/**
 * The real human name for a pubkey, in priority order:
 * local nickname (petname) → profile `display_name` → profile `name`.
 * Returns null when none is set, so the caller can decide on a fallback.
 *
 * Use this when you need to distinguish "has a real name" from "fallback"
 * (e.g. alphabetical bucketing); otherwise prefer {@link resolveDisplayName}.
 */
export function resolveName(source?: DisplayNameSource | null): string | null {
  return source?.petname || source?.displayName || source?.name || null;
}

/**
 * The single source of truth for the name shown for a pubkey across the whole
 * app — chat header, reply previews, conversation/contact lists, profiles.
 * Falls back to `fallback` (e.g. an i18n "Unnamed") and, failing that, an
 * abbreviated **npub** (`npub1…` — the public identifier other clients show,
 * not the raw hex pubkey). Every display surface should call this so the same
 * person always shows the same name (including the user's private petname,
 * which wins over the published profile name).
 */
export function resolveDisplayName(
  pubkey: string,
  source?: DisplayNameSource | null,
  fallback?: string,
): string {
  return resolveName(source) ?? fallback ?? abbreviatedNpub(pubkey);
}

/** `npub1…` abbreviated for the name slot; falls back to the hex pubkey on any
 * encoding failure (e.g. an empty or malformed key). */
function abbreviatedNpub(pubkey: string): string {
  if (!pubkey) return '';
  try {
    return abbreviateNpub(pubkeyToNpub(pubkey));
  } catch {
    return abbreviatePubkey(pubkey);
  }
}
