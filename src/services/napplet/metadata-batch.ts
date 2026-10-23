import type { Filter } from 'nostr-tools';

export type MetadataCoordinate = { pubkey: string; kind: number };
/** A replaceable kind has one current event per author; the limit must cover every requested author. */
export function metadataFilters(requests: readonly MetadataCoordinate[]): Filter[][] {
  const kinds = new Map<number, Set<string>>();
  for (const { pubkey, kind } of requests) { const authors = kinds.get(kind) ?? new Set<string>(); authors.add(pubkey); kinds.set(kind, authors); }
  const filters: Filter[] = [];
  for (const [kind, authors] of kinds) {
    const values = [...authors];
    const width = kind === 0 || kind === 3 || kind >= 10000 && kind < 20000 ? 16 : 1;
    for (let offset = 0; offset < values.length; offset += width) {
      const batch = values.slice(offset, offset + width);
      filters.push({ kinds: [kind], authors: batch, limit: batch.length });
    }
  }
  const batches: Filter[][] = [];
  for (let offset = 0; offset < filters.length; offset += 8) batches.push(filters.slice(offset, offset + 8));
  return batches;
}
