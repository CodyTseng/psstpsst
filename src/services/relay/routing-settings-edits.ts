import type { Event } from 'nostr-tools';
import { and, eq } from 'drizzle-orm';

import { db, type Database } from '@/db/client';
import { mediaServerLists, relayLists, routingSettingsEdits } from '@/db/schema';
import { normalizeBlossomUrls } from '@/lib/nostr/blossom-url';
import { normalizeRelayUrls } from '@/lib/nostr/relay-url';

export function isRoutingSettingsKind(kind: number): boolean {
  return kind === 10002 || kind === 10050 || kind === 10063;
}

export function routingSettingsSlot(accountPubkey: string, kind: number) {
  return and(eq(routingSettingsEdits.accountPubkey, accountPubkey), eq(routingSettingsEdits.kind, kind));
}

export async function readRoutingSettingsEdit(accountPubkey: string, kind: number, tx: Database = db) {
  const [row] = await tx.select().from(routingSettingsEdits).where(routingSettingsSlot(accountPubkey, kind)).limit(1);
  return row;
}

/** Mirror the winning signed declaration into its domain's local URL list. */
export async function persistRoutingSettingsEvent(event: Event, tx: Database): Promise<void> {
  const accountPubkey = event.pubkey;
  const updatedAt = event.created_at;
  if (event.kind === 10050) {
    const urls = normalizeRelayUrls(event.tags.filter(([name, url]) => name === 'relay' && url).map(tag => tag[1]));
    await tx.delete(relayLists).where(eq(relayLists.accountPubkey, accountPubkey)).run();
    for (const relayUrl of urls) {
      await tx.insert(relayLists).values({ accountPubkey, relayUrl, updatedAt, read: false, write: false }).run();
    }
  } else if (event.kind === 10063) {
    const urls = normalizeBlossomUrls(event.tags.filter(([name, url]) => name === 'server' && url).map(tag => tag[1]));
    if (!urls.length) return;
    await tx.delete(mediaServerLists).where(eq(mediaServerLists.accountPubkey, accountPubkey)).run();
    for (const serverUrl of urls) {
      await tx.insert(mediaServerLists).values({ accountPubkey, serverUrl, updatedAt }).run();
    }
  }
}
