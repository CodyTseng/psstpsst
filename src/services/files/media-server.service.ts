import { eq, sql } from 'drizzle-orm';
import type { Event } from 'nostr-tools';

import { db } from '@/db/client';
import { mediaServerLists } from '@/db/schema';
import { DEFAULT_BLOSSOM_SERVERS, normalizeBlossomUrl } from '@/lib/nostr/blossom-url';

import { publishConfiguration } from '../relay/configuration-publish.service';
import type { Signer } from '../signer/signer.interface';

/** BUD-03 "User Server List" — the account's preferred Blossom media servers. */
export const KIND_BLOSSOM_SERVER_LIST = 10063;

/** Parse media-server URLs out of a kind-10063 event's `server` tags. */
function parseServerTags(event: Event): string[] {
  return event.tags
    .filter((t) => t[0] === 'server' && t[1])
    .map((t) => {
      try {
        return normalizeBlossomUrl(t[1]);
      } catch {
        return null;
      }
    })
    .filter((u): u is string => u !== null);
}

/** Load the account's stored media servers (in order), falling back to defaults. */
export async function loadAccountMediaServers(accountPubkey: string): Promise<string[]> {
  const rows = await db
    .select()
    .from(mediaServerLists)
    .where(eq(mediaServerLists.accountPubkey, accountPubkey))
    .orderBy(sql`rowid`);
  if (rows.length === 0) return DEFAULT_BLOSSOM_SERVERS.map(normalizeBlossomUrl);
  return rows.map((r) => r.serverUrl);
}

/** Replace the account's media-server list and publish kind 10063 (BUD-03). */
export async function saveAndPublishMediaServers(opts: {
  accountPubkey: string;
  signer: Signer;
  servers: string[];
}): Promise<void> {
  const normalized = opts.servers.map(normalizeBlossomUrl);
  const now = Math.floor(Date.now() / 1000);

  await db.transaction(async (tx) => {
    await tx
      .delete(mediaServerLists)
      .where(eq(mediaServerLists.accountPubkey, opts.accountPubkey))
      .run();
    for (const url of normalized) {
      await tx
        .insert(mediaServerLists)
        .values({
          accountPubkey: opts.accountPubkey,
          serverUrl: url,
          updatedAt: now,
        })
        .run();
    }
  });

  await publishConfiguration(opts.accountPubkey, opts.signer, {
    kind: KIND_BLOSSOM_SERVER_LIST,
    content: '',
    tags: normalized.map((u) => ['server', u]),
    created_at: now,
  });
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
  if (!event) return;
  const servers = parseServerTags(event);
  if (servers.length === 0) return;

  const rows = await db
    .select()
    .from(mediaServerLists)
    .where(eq(mediaServerLists.accountPubkey, accountPubkey));
  const localTs = rows.reduce((max, r) => Math.max(max, r.updatedAt), 0);
  if (event.created_at <= localTs) return;

  await db.transaction(async (tx) => {
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
