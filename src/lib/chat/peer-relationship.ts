export type PeerRelationship = 'unknown' | 'contact' | 'stranger' | 'blocked';

type RelationshipInputs = {
  cachedContact: boolean | undefined;
  cachedBlocked: boolean | undefined;
  liveContact: boolean | undefined;
  liveBlocked: boolean | undefined;
};

/** Resolve a first-frame cache snapshot and live relationship queries without
 * ever treating an unknown value as a stranger. Live values take precedence;
 * blocking takes precedence over contact membership because the two sets are
 * intentionally independent. */
export function resolvePeerRelationship({
  cachedContact,
  cachedBlocked,
  liveContact,
  liveBlocked,
}: RelationshipInputs): PeerRelationship {
  const contact = liveContact ?? cachedContact;
  const blocked = liveBlocked ?? cachedBlocked;

  if (blocked === true) return 'blocked';
  if (contact === undefined || blocked === undefined) return 'unknown';
  return contact ? 'contact' : 'stranger';
}
