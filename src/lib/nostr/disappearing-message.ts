import type { Rumor } from '@/db/schema/types';

export const DISAPPEAR_AFTER_TAG = 'disappear-after';
export const DISAPPEARING_DURATIONS = [30, 300, 3600, 86400, 604800] as const;

export function disappearingMessageDuration(rumor: Pick<Rumor, 'kind' | 'tags'>): number | null {
  if (rumor.kind !== 14 || rumor.tags.some(([key]) => key === 'h' || key === 'action')) return null;
  const tag = rumor.tags.find(([key]) => key === DISAPPEAR_AFTER_TAG);
  const seconds = tag?.[1];
  if (tag?.length !== 2 || !seconds || !/^[1-9][0-9]{0,5}$/.test(seconds)) return null;
  return Number(seconds) <= 604800 ? Number(seconds) : null;
}
