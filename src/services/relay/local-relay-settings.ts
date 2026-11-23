import { eq, sql } from 'drizzle-orm';

import { db } from '@/db/client';
import { relayLists } from '@/db/schema';
import { DEFAULT_DM_RELAYS, normalizeRelayUrl, normalizeRelayUrls } from '@/lib/nostr/relay-url';

import { readRoutingSettingsEdit } from './routing-settings-edits';

/** Read persisted inbox configuration without depending on routing or publication. */
export async function loadAccountDmRelays(accountPubkey: string): Promise<string[]> {
  const edit = await readRoutingSettingsEdit(accountPubkey, 10050);
  if (edit) return edit.urls;
  const rows = await db
    .select()
    .from(relayLists)
    .where(eq(relayLists.accountPubkey, accountPubkey))
    .orderBy(sql`rowid`);
  if (rows.length === 0) return DEFAULT_DM_RELAYS.map(normalizeRelayUrl);
  return normalizeRelayUrls(rows.map((r) => r.relayUrl));
}
