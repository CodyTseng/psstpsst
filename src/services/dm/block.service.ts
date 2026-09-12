import { and, eq, notInArray } from 'drizzle-orm';
import type { Event } from 'nostr-tools';

import { db } from '@/db/client';
import { blockedUsers } from '@/db/schema';

import { buildSigner } from '../account/account.service';
import { canApplyConfigurationEvent, prepareConfiguration, publishConfiguration } from '../relay/configuration-publish.service';
import type { Signer } from '../signer/signer.interface';

/**
 * The account's block list: pubkeys whose incoming messages are dropped before
 * they ever hit the store (the check happens in `dm.service` ingestion, on the
 * hot path). Modeled as a **private NIP-51 follow set** (kind 30000,
 * `d=psstpsst-blocked`) — the same shape as the contact list — so the block list
 * syncs across the user's own devices while staying NIP-44-encrypted to self.
 *
 * The local `blocked_users` table is the durable source of truth and feeds the
 * management UI (live query). For the **ingestion hot path** we keep a tiny
 * in-memory mirror per account (`blockedByAccount`) so `isBlocked` is a synchronous
 * `Set.has` — no DB round-trip per incoming gift wrap. The mirror is seeded at
 * `dm.service` init ({@link loadBlockedIntoCache}) and kept in lockstep with
 * every block / unblock / sync.
 */
const KIND_FOLLOW_SET = 30000;
/** d-tag of the private block set. */
export const BLOCKED_D = 'psstpsst-blocked';
const BLOCKED_TITLE = 'PsstPsst Blocked';

/** In-memory mirror of the block set, keyed by account, for synchronous hot-path
 * lookups during ingestion. Rebuilt on load/sync; mutated on block/unblock. */
const blockedByAccount = new Map<string, Set<string>>();

function cacheFor(accountPubkey: string): Set<string> {
  let set = blockedByAccount.get(accountPubkey);
  if (!set) {
    set = new Set();
    blockedByAccount.set(accountPubkey, set);
  }
  return set;
}

/** Synchronous "is this pubkey blocked" for the ingestion hot path. Reads only
 * the in-memory mirror — call {@link loadBlockedIntoCache} once at init first. */
export function isBlocked(accountPubkey: string, pubkey: string): boolean {
  return blockedByAccount.get(accountPubkey)?.has(pubkey) ?? false;
}

/** Cache-only blocked state for transition-sensitive UI. Unlike `isBlocked`,
 * this preserves whether the account mirror has been loaded yet. */
export function getSessionCachedBlockedStatus(
  accountPubkey: string,
  pubkey: string,
): boolean | undefined {
  const blocked = blockedByAccount.get(accountPubkey);
  return blocked ? blocked.has(pubkey) : undefined;
}

/** Seed the in-memory mirror from the local table. Called at `dm.service` init,
 * before the incoming subscription opens, so the first gift wrap is filtered. */
export async function loadBlockedIntoCache(accountPubkey: string): Promise<void> {
  const rows = await db
    .select({ pubkey: blockedUsers.pubkey })
    .from(blockedUsers)
    .where(eq(blockedUsers.accountPubkey, accountPubkey));
  blockedByAccount.set(accountPubkey, new Set(rows.map((r) => r.pubkey)));
}

/** Live-table read of the account's blocked pubkeys (newest first not needed). */
export async function getBlockedPubkeys(accountPubkey: string): Promise<string[]> {
  const rows = await db
    .select({ pubkey: blockedUsers.pubkey })
    .from(blockedUsers)
    .where(eq(blockedUsers.accountPubkey, accountPubkey));
  return rows.map((r) => r.pubkey);
}

/**
 * Re-publish the whole block list as a private NIP-51 follow set: all members
 * live in `.content`, NIP-44-encrypted to self, so who you blocked is never
 * exposed. Replaceable — the latest event always reflects the latest local state.
 */
async function publishBlockedSet(accountPubkey: string, signer: Signer): Promise<void> {
  if (!signer.nip44Encrypt) return; // remote signers without NIP-44 can't sync
  const pubkeys = await getBlockedPubkeys(accountPubkey);
  const privateTags = pubkeys.map((pk) => ['p', pk]);
  const content = await signer.nip44Encrypt(accountPubkey, JSON.stringify(privateTags));
  await publishConfiguration(accountPubkey, signer, {
    kind: KIND_FOLLOW_SET,
    content,
    tags: [
      ['d', BLOCKED_D],
      ['title', BLOCKED_TITLE],
    ],
    created_at: Math.floor(Date.now() / 1000),
  });
}

/** Commit the current encrypted snapshot after the optimistic local write can
 * paint. Only persistence is awaited; the shared worker owns relay delivery. */
function persistBlockedSet(accountPubkey: string, signer?: Signer): Promise<void> {
  return prepareConfiguration(accountPubkey, KIND_FOLLOW_SET, BLOCKED_D, async () => {
    const s = signer ?? (await buildSigner(accountPubkey));
    await publishBlockedSet(accountPubkey, s);
  });
}

/** Block a user: persist locally, update the hot-path mirror immediately, then
 * re-publish the synced set. Idempotent. The caller is responsible for
 * soft-deleting any existing conversation. */
export async function blockUser(
  accountPubkey: string,
  pubkey: string,
  opts: { signer?: Signer } = {},
): Promise<void> {
  await db
    .insert(blockedUsers)
    .values({ accountPubkey, pubkey, blockedAt: Math.floor(Date.now() / 1000) })
    .onConflictDoNothing();
  cacheFor(accountPubkey).add(pubkey);
  await persistBlockedSet(accountPubkey, opts.signer);
}

/** Unblock a user: remove locally, update the mirror, then re-publish the set. */
export async function unblockUser(
  accountPubkey: string,
  pubkey: string,
  opts: { signer?: Signer } = {},
): Promise<void> {
  await db
    .delete(blockedUsers)
    .where(and(eq(blockedUsers.accountPubkey, accountPubkey), eq(blockedUsers.pubkey, pubkey)));
  blockedByAccount.get(accountPubkey)?.delete(pubkey);
  await persistBlockedSet(accountPubkey, opts.signer);
}

/**
 * Apply a block-set event read from the replaceable-events cache to the local
 * table + the in-memory mirror. Pending local work and the latest cached
 * snapshot guard against a delayed relay echo, including after decryption.
 * No-op when no event exists or the content is undecryptable, so a
 * transient miss never wipes local state. Called by `syncPersonalConfigs` after
 * it has merged the current/legacy d-tag rows.
 */
export async function applyBlockedEvent(
  accountPubkey: string,
  event: Event | null,
  signer: Signer,
): Promise<void> {
  if (!event || !signer.nip44Decrypt) return;
  if (!(await canApplyConfigurationEvent(accountPubkey, KIND_FOLLOW_SET, BLOCKED_D, event))) return;
  let remote: string[];
  try {
    const json = await signer.nip44Decrypt(accountPubkey, event.content);
    const tags = JSON.parse(json) as string[][];
    remote = tags.filter((t) => t[0] === 'p' && t[1]).map((t) => t[1]);
  } catch {
    return; // undecryptable / malformed — leave local state untouched
  }

  const now = Math.floor(Date.now() / 1000);
  const applied = await db.transaction(async (tx) => {
    if (!(await canApplyConfigurationEvent(accountPubkey, KIND_FOLLOW_SET, BLOCKED_D, event, tx))) return;
    if (remote.length > 0) {
      await tx
        .delete(blockedUsers)
        .where(
          and(eq(blockedUsers.accountPubkey, accountPubkey), notInArray(blockedUsers.pubkey, remote)),
        )
        .run();
    } else {
      await tx.delete(blockedUsers).where(eq(blockedUsers.accountPubkey, accountPubkey)).run();
    }
    for (const pubkey of remote) {
      await tx
        .insert(blockedUsers)
        .values({ accountPubkey, pubkey, blockedAt: now })
        .onConflictDoNothing()
        .run();
    }
    return true;
  });
  if (!applied) return;

  // Rebuild the hot-path mirror to match the reconciled table.
  blockedByAccount.set(accountPubkey, new Set(remote));
}
