import type { Event } from 'nostr-tools';
import { MARKET_RELAYS, publicUrl } from './protocol';

export function outboxWriteRelays(event: Event | null): string[] {
  const relays = new Set<string>();
  for (const tag of event?.tags ?? []) {
    if (tag[0] !== 'r' || tag[2] && tag[2] !== 'write') continue;
    try { relays.add(publicUrl(tag[1], true)); } catch { /* Ignore unusable relay hints. */ }
    if (relays.size > 8) return MARKET_RELAYS;
  }
  return relays.size ? [...relays] : MARKET_RELAYS;
}

/** Prefer shared destinations, retaining redundant coverage before pruning small groups. */
export function groupOutboxAuthors(lists: ReadonlyMap<string, readonly string[]>): Map<string, string[]> {
  const candidates = new Map<string, Set<string>>();
  for (const [author, relays] of lists) for (const relay of relays.slice(0, 4)) {
    const authors = candidates.get(relay) ?? new Set<string>();
    authors.add(author); candidates.set(relay, authors);
  }
  const coverage = new Map<string, number>(), groups = new Map<string, string[]>();
  for (const [relay, authors] of [...candidates].sort((a, b) => b[1].size - a[1].size)) {
    const values = [...authors];
    if (candidates.size > 10 && authors.size < 10 && values.every(author => (coverage.get(author) ?? 0) >= 2)) continue;
    groups.set(relay, values);
    for (const author of authors) coverage.set(author, (coverage.get(author) ?? 0) + 1);
  }
  return groups;
}
