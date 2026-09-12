import { NIP05_SERVICE_DOMAIN } from '@/lib/nostr/nip05';

export type ProfileNip05Action =
  | { kind: 'loading' | 'claim'; identifier: null }
  | { kind: 'switch' | 'manage'; identifier: string };

/** Resolve the profile field action from the current draft and owned service name. */
export function resolveProfileNip05Action(
  draftNip05: string,
  ownedName: string | null | undefined,
): ProfileNip05Action {
  if (ownedName === undefined) return { kind: 'loading', identifier: null };
  if (ownedName === null) return { kind: 'claim', identifier: null };

  const identifier = `${ownedName}@${NIP05_SERVICE_DOMAIN}`;
  const isCurrent = draftNip05.trim().toLowerCase() === identifier.toLowerCase();
  return { kind: isCurrent ? 'manage' : 'switch', identifier };
}
