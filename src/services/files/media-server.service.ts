import { eq, sql } from 'drizzle-orm';
import type { Event } from 'nostr-tools';

import { db } from '@/db/client';
import { mediaServerLists } from '@/db/schema';
import { DEFAULT_BLOSSOM_SERVERS, normalizeBlossomUrl, normalizeBlossomUrls, normalizeAdvertisedBlossomUrl } from '@/lib/nostr/blossom-url';

import { canApplyConfigurationEvent, prepareConfiguration, publishConfigurationAndWait } from '../relay/configuration-publish.service';
import { DISCOVERY_RELAYS } from '@/lib/nostr/relay-url';
import { publicUrl } from '../napplet/protocol';
import { fetchReplaceable, peerMetaRelays } from '../relay/relay-router';
import { loadCachedReplaceableEvent } from '../relay/replaceable-events.service';
import type { Signer } from '../signer/signer.interface';

/** BUD-03 "User Server List" — the account's preferred Blossom media servers. */
export const KIND_BLOSSOM_SERVER_LIST = 10063;

/** Parse media-server URLs out of a kind-10063 event's `server` tags. */
function parseServerTags(event: Event): string[] {
  return normalizeBlossomUrls(event.tags
    .filter((t) => t[0] === 'server' && t[1])
    .map(t => t[1]));
}

/** Load the account's stored media servers (in order), falling back to defaults. */
export async function loadAccountMediaServers(accountPubkey: string): Promise<string[]> {
  const rows = await db
    .select()
    .from(mediaServerLists)
    .where(eq(mediaServerLists.accountPubkey, accountPubkey))
    .orderBy(sql`rowid`);
  if (rows.length === 0) return DEFAULT_BLOSSOM_SERVERS.map(normalizeBlossomUrl);
  return normalizeBlossomUrls(rows.map((r) => r.serverUrl));
}

/** Resolve the sender's published list, never the receiving account's settings. */
export async function loadSenderMediaServers(senderPubkey: string): Promise<string[]> {
  if (!/^[0-9a-f]{64}$/.test(senderPubkey)) return [];
  const key = { pubkey: senderPubkey, kind: KIND_BLOSSOM_SERVER_LIST };
  const event = await loadCachedReplaceableEvent(key, {
    relays: async () => {
      const hints = await peerMetaRelays(senderPubkey).catch(() => []);
      return [...new Set([...hints, ...DISCOVERY_RELAYS].flatMap((hint) => {
        try { return [publicUrl(hint, true)]; } catch { return []; }
      }))];
    },
    query: async (relays) => {
      const fetched = await fetchReplaceable(relays, key.kind, key.pubkey);
      return fetched ? [fetched] : [];
    },
  });
  if (!event) return [];
  const servers = new Set<string>();
  for (const [type, value] of event.tags) {
    if (type !== 'server' || !value) continue;
    try { servers.add(normalizeAdvertisedBlossomUrl(value)); } catch { /* An authenticated hint is still an untrusted URL. */ }
    if (servers.size === 8) break;
  }
  return [...servers];
}

/** Replace the account's media-server list and publish kind 10063 (BUD-03). */
export async function saveAndPublishMediaServers(opts: {
  accountPubkey: string;
  signer: Signer;
  servers: string[];
  abort?: AbortSignal;
}): Promise<void> {
  const normalized = Array.from(new Set(opts.servers.map(normalizeBlossomUrl)));
  if (!normalized.length) throw new Error('At least one media server is required.');
  await prepareConfiguration(opts.accountPubkey, KIND_BLOSSOM_SERVER_LIST, '', () =>
    publishConfigurationAndWait(opts.accountPubkey, opts.signer, {
      kind: KIND_BLOSSOM_SERVER_LIST, content: '', tags: normalized.map(url => ['server', url]),
      created_at: Math.floor(Date.now() / 1000),
    }, async (event, tx) => {
      await tx.delete(mediaServerLists).where(eq(mediaServerLists.accountPubkey, opts.accountPubkey));
      for (const serverUrl of normalized) {
        await tx.insert(mediaServerLists).values({ accountPubkey: opts.accountPubkey,
          serverUrl, updatedAt: event.created_at });
      }
    }, undefined, opts.abort),
  );
}

/**
 * Apply a kind-10063 event read from the replaceable-events cache to the local
 * table so a list configured on another device takes effect here. Newest-wins
 * (the stored `updatedAt` mirrors the event `created_at`):
 *   - no event / empty list → no-op, never wipes local on a transient miss;
 *   - older than local      → no-op, a stale device can't clobber a fresh edit.
 * Called by `syncPersonalConfigs` with the cached row.
 */
export async function applyMediaServersEvent(
  accountPubkey: string,
  event: Event | null,
): Promise<void> {
  if (!event || event.kind !== KIND_BLOSSOM_SERVER_LIST || event.pubkey !== accountPubkey) return;
  const servers = parseServerTags(event);
  if (servers.length === 0) return;

  const rows = await db
    .select()
    .from(mediaServerLists)
    .where(eq(mediaServerLists.accountPubkey, accountPubkey));
  const localTs = rows.reduce((max, r) => Math.max(max, r.updatedAt), 0);
  if (event.created_at <= localTs) return;

  await db.transaction(async (tx) => {
    if (!(await canApplyConfigurationEvent(accountPubkey, event.kind, '', event, tx))) return;
    await tx
      .delete(mediaServerLists)
      .where(eq(mediaServerLists.accountPubkey, accountPubkey))
      .run();
    for (const url of servers) {
      await tx
        .insert(mediaServerLists)
        .values({
          accountPubkey,
          serverUrl: url,
          updatedAt: event.created_at,
        })
        .run();
    }
  });
}
