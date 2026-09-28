import { and, eq, inArray, notInArray } from 'drizzle-orm';
import type { Event } from 'nostr-tools';

import { db } from '@/db/client';
import { conversations } from '@/db/schema';
import { buildSigner } from '../account/account.service';
import { canApplyConfigurationEvent, prepareConfiguration, publishConfiguration } from '../relay/configuration-publish.service';
import type { Signer } from '../signer/signer.interface';

/**
 * Per-conversation preference flags on the `conversations` table.
 *
 * - **`muted`** is synced across the user's own devices as a private kind-30000
 *   set. Its NIP-44-encrypted content uses `p` for direct counterparties and
 *   `g` for hashed group conversation keys, so mute membership is never public.
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
): Promise<{ conversationKey: string; group: boolean }[]> {
  const rows = await db
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
  return rows.map((row) => ({
    conversationKey: row.conversationKey,
    group: row.groupId != null,
  }));
}

/** Commit the current encrypted snapshot after the optimistic local write can
 * paint. Only persistence is awaited; the shared worker owns relay delivery. */
function persistMutedSet(accountPubkey: string, signer?: Signer): Promise<void> {
  return prepareConfiguration(accountPubkey, KIND_FOLLOW_SET, MUTED_D, async () => {
    const s = signer ?? (await buildSigner(accountPubkey));
    await publishMutedSet(accountPubkey, s);
  });
}

/** Re-publish the private muted set from current local state (replaceable). */
async function publishMutedSet(accountPubkey: string, signer: Signer): Promise<void> {
  if (!signer.nip44Encrypt) return; // remote signers without NIP-44 can't sync
  const muted = await collectMutedConversations(accountPubkey);
  const privateTags = muted.map((item) => [item.group ? 'g' : 'p', item.conversationKey]);
  const content = await signer.nip44Encrypt(accountPubkey, JSON.stringify(privateTags));
  await publishConfiguration(accountPubkey, signer, {
    kind: KIND_FOLLOW_SET,
    content,
    tags: [
      ['d', MUTED_D],
      ['title', MUTED_TITLE],
    ],
    created_at: Math.floor(Date.now() / 1000),
  });
}

/** Set a conversation's mute flag locally, then re-publish the muted set. */
export async function setConversationMuted(
  accountPubkey: string,
  conversationKey: string,
  muted: boolean,
  opts: { signer?: Signer } = {},
): Promise<void> {
  if (muted) {
    const now = Math.floor(Date.now() / 1000);
    await db
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
    await db
      .update(conversations)
      .set({ muted: false })
      .where(
        and(
          eq(conversations.accountPubkey, accountPubkey),
          eq(conversations.conversationKey, conversationKey),
        ),
      );
  }
  // Local state is already visible; wait only for the durable encrypted snapshot.
  await persistMutedSet(accountPubkey, opts.signer);
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

/**
 * Apply a muted-set event read from the replaceable-events cache to the local
 * 1:1 rows: true for members, false for the rest. Pending local work and the
 * latest cached snapshot guard against delayed relay echoes after decryption.
 * A missing or undecryptable event leaves local state
 * untouched (no wipe on a miss). Called by `syncPersonalConfigs` after it has
 * merged the current/legacy d-tag rows.
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
  try {
    const json = await signer.nip44Decrypt(accountPubkey, event.content);
    const tags = JSON.parse(json) as string[][];
    directKeys = tags.filter((tag) => tag[0] === 'p' && tag[1]).map((tag) => tag[1]);
    groupKeys = tags
      .filter((tag) => tag[0] === 'g' && tag[1]?.startsWith('group:'))
      .map((tag) => tag[1]);
  } catch {
    return; // undecryptable / malformed — leave local state untouched
  }
  // Both private p/g values are already stable conversation keys.
  const keys = Array.from(new Set([...directKeys, ...groupKeys]));
  await db.transaction(async (tx) => {
    if (!(await canApplyConfigurationEvent(accountPubkey, KIND_FOLLOW_SET, MUTED_D, event, tx))) return;
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
  });
}
