import type { Filter } from 'nostr-tools';

/** Remote relays own filter semantics, extensions and limits. */
export function relayFilters(input: unknown): Filter[] {
  const filters = Array.isArray(input) ? input : [input];
  return filters.map(filter => {
    if (!filter || typeof filter !== 'object' || Array.isArray(filter))
      throw new Error('invalid-filter');
    return { ...filter } as Filter;
  });
}
