import { sql, type SQLWrapper } from 'drizzle-orm';
import { normalizeRelayUrls } from '@/lib/nostr/relay-url';

export const boundedEventRelays = (relays: readonly string[] = []) => normalizeRelayUrls(relays).slice(0, 8);

/** Merge observations atomically so concurrent readers cannot lose each other's sources. */
export function mergeEventRelaySources(column: SQLWrapper, relays: string[]) {
  return sql`(SELECT COALESCE(json_group_array(value),'[]') FROM (
    SELECT value FROM json_each(${column}) UNION SELECT value FROM json_each(${JSON.stringify(relays)}) LIMIT 8
  ))`;
}
