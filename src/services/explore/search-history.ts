import { and, asc, desc, eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { exploreEntries, exploreHistory } from '@/db/schema';
import { parseApplicationAddressQuery } from './address-query';

export const SEARCH_HISTORY_LIMIT = 200;
export const SEARCH_SUGGESTION_LIMIT = 5;

/** Suggestions derive only from committed website visits, never address lookups. */
export async function readSearchHistory(account: string): Promise<string[]> {
  const rows = await db.select({ address: exploreEntries.address }).from(exploreHistory)
    .innerJoin(exploreEntries, and(eq(exploreEntries.accountPubkey, exploreHistory.accountPubkey),
      eq(exploreEntries.sourceId, exploreHistory.sourceId)))
    .where(and(eq(exploreHistory.accountPubkey, account), eq(exploreEntries.kind, 'website')))
    .orderBy(desc(exploreHistory.lastUsedAt), asc(exploreHistory.sourceId)).limit(SEARCH_HISTORY_LIMIT);
  return rows.map(row => row.address);
}

/** Match host/path fragments without a scheme, excluding the complete current URL. */
export function matchSearchHistory(addresses: readonly string[], value: string): string[] {
  const input = value.trim();
  if (!input) return [];
  const parsed = parseApplicationAddressQuery(input);
  const exact = parsed?.type === 'website' ? parsed.key : input;
  const term = input.replace(/^https?:\/\//i, '').replace(/^www\./i, '').toLowerCase();
  if (!term) return [];
  const matches: string[] = [];
  for (const address of addresses) {
    if (address !== exact && address.replace(/^https?:\/\//i, '').replace(/^www\./i, '').toLowerCase().includes(term)) matches.push(address);
    if (matches.length === SEARCH_SUGGESTION_LIMIT) break;
  }
  return matches;
}
