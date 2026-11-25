import type { Rumor } from '@/db/schema/types';

/** Return the one reaction ID an author is asking clients to hide. */
export function reactionRetractionTarget(rumor: Rumor): string | null {
  if (rumor.kind !== 5 || rumor.content !== '') return null;
  const targets = rumor.tags.filter(([key]) => key === 'e');
  const kinds = rumor.tags.filter(([key]) => key === 'k');
  const targetId = targets[0]?.[1];
  if (targets.length !== 1 || !/^[a-f0-9]{64}$/.test(targetId ?? '') ||
      kinds.length !== 1 || kinds[0][1] !== '7') return null;
  return targetId;
}
