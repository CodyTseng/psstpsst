import { eq, sql } from 'drizzle-orm';

import { db } from '@/db/client';
import { relayLists } from '@/db/schema';
import { DEFAULT_DM_RELAYS, normalizeRelayUrl } from '@/lib/nostr/relay-url';

/** Read persisted inbox configuration without depending on routing or publication. */
export async function loadAccountDmRelays(accountPubkey: string): Promise<string[]> {
  const rows = await db
    .select()
    .from(relayLists)
    .where(eq(relayLists.accountPubkey, accountPubkey))
    .orderBy(sql`rowid`);
  if (rows.length === 0) return DEFAULT_DM_RELAYS.map(normalizeRelayUrl);
  return rows.map((r) => r.relayUrl);
}
