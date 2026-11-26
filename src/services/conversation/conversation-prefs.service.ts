import { and, eq, inArray, notInArray } from 'drizzle-orm';
import type { Event } from 'nostr-tools';

import { db, type Database } from '@/db/client';
import { conversations } from '@/db/schema';
import { groupConversationKey, isValidGroupId } from '@/lib/nostr/group-messaging';
import { canApplyConfigurationEvent } from '../relay/configuration-publish.service';
import { markPrivateListDirty, queuePrivateListPublication } from '../relay/private-list-sync.service';
import type { Signer } from '../signer/signer.interface';

/**
 * Per-conversation preference flags on the `conversations` table.
 *
 * - **`muted`** is synced across the user's own devices as a private kind-30000
 *   set. Its NIP-44-encrypted content uses `p` for direct counterparties and
 *   `h` for raw group ids, so mute membership is never public.
 * - **`pinned`** is a **device-local** sort preference only — it floats the row
 *   to the top of *this* device's inbox. It is intentionally **not** synced:
 *   pinning is about how this inbox is arranged, not a property of the peer.
 *
 * Both columns stay the local read model (they drive list sorting, the muted
 * unread filter, the row fill).
 */
const KIND_FOLLOW_SET = 30000;
/** d-tag of the private muted set. */
export const MUTED_D = 'psstpsst-muted';
const MUTED_TITLE = 'PsstPsst Muted';

/** Stable keys and identity kind for every muted conversation. */
async function collectMutedConversations(
  accountPubkey: string,
  tx: Database,
): Promise<{ conversationKey: string; groupId: string | null }[]> {
  const rows = await tx
    .select({
      conversationKey: conversations.conversationKey,
      groupId: conversations.groupId,
    })
    .from(conversations)
    .where(
      and(
        eq(conversations.accountPubkey, accountPubkey),
        eq(conversations.muted, true),
      ),
    );
  return rows;
}

function queueMutedSet(accountPubkey: string, signer?: Signer): void {
  queuePrivateListPublication({
    accountPubkey, dTag: MUTED_D, title: MUTED_TITLE, signer,
    readTags: async (tx) => (await collectMutedConversations(accountPubkey, tx)).map((item) =>
      item.groupId != null ? ['h', item.groupId] : ['p', item.conversationKey],
    ),
  });
}

/** Set a conversation's mute flag locally, then re-publish the muted set. */
export async function setConversationMuted(
  accountPubkey: string,
  conversationKey: string,
  muted: boolean,
  opts: { signer?: Signer } = {},
): Promise<void> {
  await db.transaction(async (tx) => {
    await markPrivateListDirty(accountPubkey, MUTED_D, tx);
    if (muted) {
      const now = Math.floor(Date.now() / 1000);
      await tx
        .insert(conversations)
        .values({
          accountPubkey,
          conversationKey,
          createdAt: now,
          createdOrderAt: now * 1000,
          updatedAt: now,
          updatedOrderAt: now * 1000,
          lastMessageAt: null,
          deleted: true,
          muted: true,
        })
        .onConflictDoUpdate({
          target: [conversations.accountPubkey, conversations.conversationKey],
          set: { muted: true },
        });
    } else {
      await tx
        .update(conversations)
        .set({ muted: false })
        .where(
          and(
            eq(conversations.accountPubkey, accountPubkey),
            eq(conversations.conversationKey, conversationKey),
          ),
        );
    }
  });
  queueMutedSet(accountPubkey, opts.signer);
}

/**
 * Set a conversation's pinned flag. **Device-local only** — pinning just floats
 * the row to the top of this device's inbox, so there's no publish/sync (unlike
 * mute). The live query picks up the write and re-sorts.
 */
export async function setConversationPinned(
  accountPubkey: string,
  conversationKey: string,
  pinned: boolean,
): Promise<void> {
  await db
    .update(conversations)
    .set({ pinned })
    .where(
      and(
        eq(conversations.accountPubkey, accountPubkey),
        eq(conversations.conversationKey, conversationKey),
      ),
    );
}

/** Resolve legacy hashes only against this account's known raw group ids.
 * If any id is unavailable, leave the old snapshot intact and retry on sync. */
async function migrateMutedTags(accountPubkey: string, tags: string[][]): Promise<string[][] | null> {
  const legacyKeys = [...new Set(tags.filter((tag) => tag[0] === 'g').map((tag) => tag[1]))];
  if (!legacyKeys.length) return tags;
  const groupIds = new Map<string, string>();
  // Bound SQLite parameters; migration never scans message history.
  for (let offset = 0; offset < legacyKeys.length; offset += 400) {
    const rows = await db.select({
      conversationKey: conversations.conversationKey,
      groupId: conversations.groupId,
    }).from(conversations).where(and(
      eq(conversations.accountPubkey, accountPubkey),
      inArray(conversations.conversationKey, legacyKeys.slice(offset, offset + 400)),
    ));
    for (const row of rows) {
      if (isValidGroupId(row.groupId)) groupIds.set(row.conversationKey, row.groupId);
    }
  }
  if (legacyKeys.some((key) => !groupIds.has(key))) return null;
  return tags.map((tag) => tag[0] === 'g' ? ['h', groupIds.get(tag[1])!, ...tag.slice(2)] : tag);
}

/**
 * Apply a muted-set event read from the replaceable-events cache to the local
 * conversation rows: true for members, false for the rest. Pending local work
 * and the latest cache guard against delayed relay echoes after decryption.
 * A missing or undecryptable event leaves local state
 * untouched (no wipe on a miss). Called by `syncPersonalConfigs` after it has
 * loaded the current snapshot. Legacy g tags are converted to h before
 * reconciliation and re-published as a newer encrypted event.
 */
export async function applyMutedEvent(
  accountPubkey: string,
  event: Event | null,
  signer: Signer,
): Promise<void> {
  if (!event || !signer.nip44Decrypt) return;
  if (!(await canApplyConfigurationEvent(accountPubkey, KIND_FOLLOW_SET, MUTED_D, event))) return;
  let directKeys: string[];
  let groupKeys: string[];
  let privateTags: string[][];
  let migrated: boolean;
  try {
    const json = await signer.nip44Decrypt(accountPubkey, event.content);
    const decoded: unknown = JSON.parse(json);
    if (!Array.isArray(decoded) || decoded.some((tag) =>
      !Array.isArray(tag) || tag.some((part) => typeof part !== 'string'),
    )) return;
    const tags = decoded as string[][];
    migrated = tags.some((tag) => tag[0] === 'g');
    const converted = await migrateMutedTags(accountPubkey, tags);
    if (!converted) return;
    privateTags = converted;
    directKeys = privateTags.filter((tag) => tag[0] === 'p' && tag[1]).map((tag) => tag[1]);
    groupKeys = privateTags
      .filter((tag) => tag[0] === 'h' && isValidGroupId(tag[1]))
      .map((tag) => groupConversationKey(tag[1]));
  } catch {
    return; // undecryptable / malformed — leave local state untouched
  }
  // Only p values are conversation keys; h values become hashed local keys.
  const keys = Array.from(new Set([...directKeys, ...groupKeys]));
  const applied = await db.transaction(async (tx) => {
    if (!(await canApplyConfigurationEvent(accountPubkey, KIND_FOLLOW_SET, MUTED_D, event, tx))) return false;
    // Clear mute on every row not in the remote set (an empty set clears all).
    await tx
      .update(conversations)
      .set({ muted: false })
      .where(
        and(
          eq(conversations.accountPubkey, accountPubkey),
          keys.length ? notInArray(conversations.conversationKey, keys) : undefined,
        ),
      )
      .run();
    if (directKeys.length > 0) {
      const now = Math.floor(Date.now() / 1000);
      await tx
        .insert(conversations)
        .values(
          [...new Set(directKeys)].map((conversationKey) => ({
            accountPubkey,
            conversationKey,
            createdAt: now,
            createdOrderAt: now * 1000,
            updatedAt: now,
            updatedOrderAt: now * 1000,
            lastMessageAt: null,
            deleted: true,
            muted: true,
          })),
        )
        .onConflictDoUpdate({
          target: [conversations.accountPubkey, conversations.conversationKey],
          set: { muted: true },
        })
        .run();
    }
    if (groupKeys.length > 0) {
      await tx
        .update(conversations)
        .set({ muted: true })
        .where(
          and(
            eq(conversations.accountPubkey, accountPubkey),
            inArray(conversations.conversationKey, [...new Set(groupKeys)]),
          ),
        )
        .run();
    }
    if (migrated) await markPrivateListDirty(accountPubkey, MUTED_D, tx);
    return true;
  });
  if (applied && migrated) {
    // Converted tags are already plaintext; their publication is independent of
    // reconciliation. Subsequent user edits read the current local mute model.
    queuePrivateListPublication({
      accountPubkey, dTag: MUTED_D, title: MUTED_TITLE, signer,
      readTags: async () => privateTags,
      eventTags: event.tags,
      sourceEventId: event.id,
    });
  }
}
