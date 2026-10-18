type Visit = { accountPubkey: string; key: string };
const listeners = new Set<(visit: Visit) => void>();
/** Only committed visits are broadcast to other application hosts. */
export function notifyExploreVisit(visit: Visit) { for (const listener of listeners) listener(visit); }
export function subscribeExploreVisits(listener: (visit: Visit) => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
