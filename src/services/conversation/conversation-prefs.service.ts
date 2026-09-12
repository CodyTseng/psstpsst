import { and, eq, notInArray } from 'drizzle-orm';
import type { Event } from 'nostr-tools';

import { db } from '@/db/client';
import { conversations } from '@/db/schema';
import { buildSigner } from '../account/account.service';
import { canApplyConfigurationEvent, prepareConfiguration, publishConfiguration } from '../relay/configuration-publish.service';
import type { Signer } from '../signer/signer.interface';

/**
 * Per-conversation preference flags on the `conversations` table.
 *
 * - **`muted`** is synced across the user's own devices as a **private NIP-51
 *   set** — the same shape as the contact list
 *   ({@link ../contact/contact.service}): a replaceable kind-30000 set whose
 *   member `p`-tags live NIP-44-encrypted in `.content`, so who you mute is
 *   never exposed and only your devices can read it. Every conversation is 1:1,
 *   and its `conversation_key` is exactly the counterparty pubkey carried in the
 *   `p`-tag.
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

/** Counterparty pubkeys of every muted conversation. The conversation_key IS the
 * counterparty pubkey (our own, for a note-to-self), so this is a direct read. */
async function collectMutedPubkeys(accountPubkey: string): Promise<string[]> {
  const rows = await db
    .select({ conversationKey: conversations.conversationKey })
    .from(conversations)
    .where(
      and(
        eq(conversations.accountPubkey, accountPubkey),
        eq(conversations.muted, true),
      ),
    );
  return rows.map((r) => r.conversationKey);
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
  const pubkeys = await collectMutedPubkeys(accountPubkey);
  const privateTags = pubkeys.map((pk) => ['p', pk]);
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
    await db
      .insert(conversations)
      .values({
        accountPubkey,
        conversationKey,
        lastMessageAt: 0,
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
  let pubkeys: string[];
  try {
    const json = await signer.nip44Decrypt(accountPubkey, event.content);
    const tags = JSON.parse(json) as string[][];
    pubkeys = tags.filter((t) => t[0] === 'p' && t[1]).map((t) => t[1]);
  } catch {
    return; // undecryptable / malformed — leave local state untouched
  }
  // conversation_key IS the counterparty pubkey, so the muted p-tags already
  // are the conversation keys — no transform needed.
  const keys = Array.from(new Set(pubkeys));
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
    if (keys.length > 0) {
      await tx
        .insert(conversations)
        .values(
          keys.map((conversationKey) => ({
            accountPubkey,
            conversationKey,
            lastMessageAt: 0,
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
  });
}
